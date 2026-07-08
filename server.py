#!/usr/bin/env python3
"""
Local server for Tibia Item Market + Loot Finder.
Run: py server.py
Open: http://localhost:8000
Uses only Python standard library.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from pathlib import Path
import json, re, time, html, os, sys, subprocess

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
CACHE.mkdir(exist_ok=True)
PORT = int(os.environ.get("PORT", "8000"))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TibiaItemLocalServer/1.2"
ALLOWED_WORLDS = ["Bona", "Celesta", "Dia"]
DEFAULT_WORLD = "Bona"
TIBIA_MARKET_TOP_API = "https://api.tibiamarket.top"
MARKET_TOP_CACHE = CACHE / "tibiamarket_top_prices.json"


def normalize_world(world: str) -> str:
    w = (world or DEFAULT_WORLD).strip().lower()
    for allowed in ALLOWED_WORLDS:
        if w == allowed.lower():
            return allowed
    return DEFAULT_WORLD



def slugify_item(name: str) -> str:
    s = html.unescape(name or "").lower().strip()
    s = s.replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def wiki_title(name: str) -> str:
    return str(name or "").strip().replace(" ", "_")


def wiki_url(title: str) -> str:
    return "https://tibia.fandom.com/wiki/" + quote(wiki_title(title), safe=":_")


def cache_get(key: str, max_age=6*3600):
    p = CACHE / re.sub(r"[^a-zA-Z0-9_.-]+", "_", key)
    if p.exists() and time.time() - p.stat().st_mtime < max_age:
        return p.read_text(encoding="utf-8", errors="ignore")
    return None


def cache_set(key: str, text: str):
    p = CACHE / re.sub(r"[^a-zA-Z0-9_.-]+", "_", key)
    p.write_text(text, encoding="utf-8", errors="ignore")


def fetch_text(url: str, cache_key=None, max_age=6*3600) -> str:
    if cache_key:
        cached = cache_get(cache_key, max_age=max_age)
        if cached is not None:
            return cached
    req = Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"})
    with urlopen(req, timeout=25) as r:
        raw = r.read()
        charset = r.headers.get_content_charset() or "utf-8"
        text = raw.decode(charset, errors="replace")
    if cache_key:
        cache_set(cache_key, text)
    return text


def fetch_json_url(url: str, cache_key=None, max_age=1800):
    text = fetch_text(url, cache_key=cache_key, max_age=max_age)
    text_strip = text.lstrip()
    if text_strip.startswith("<"):
        raise ValueError(f"Expected JSON but got HTML from {url}")
    return json.loads(text)


def deep_iter_records(obj):
    """Yield dict records from a nested API response."""
    if isinstance(obj, list):
        for x in obj:
            yield from deep_iter_records(x)
    elif isinstance(obj, dict):
        # If this dict itself looks like a market/metadata record, yield it.
        keys = {str(k).lower() for k in obj.keys()}
        if keys & {"name", "item", "item_name", "itemid", "item_id", "world", "server", "buy_offer", "sell_offer", "month_sell_offer", "month_average_sell"}:
            yield obj
        # Also inspect common containers.
        for k in ("data", "results", "items", "values", "market_values", "marketValues"):
            if k in obj:
                yield from deep_iter_records(obj[k])


def first_int_field(d: dict, names):
    for name in names:
        for k, v in d.items():
            if str(k).lower() == name.lower():
                n = parse_int(v)
                if n is not None:
                    return n
    return None


def first_str_field(d: dict, names):
    for name in names:
        for k, v in d.items():
            if str(k).lower() == name.lower() and v is not None:
                val = str(v).strip()
                if val:
                    return val
    return ""


def build_metadata_maps(metadata_obj):
    id_to_name, name_to_id = {}, {}
    for rec in deep_iter_records(metadata_obj):
        name = first_str_field(rec, ["name", "item_name", "itemName", "market_name", "item"])
        item_id = first_str_field(rec, ["item_id", "itemId", "itemid", "id"])
        if name:
            name_to_id[re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()] = item_id
        if item_id and name:
            id_to_name[str(item_id)] = name
    return id_to_name, name_to_id


def tmt_entry_world(rec: dict) -> str:
    return first_str_field(rec, ["world", "world_name", "worldName", "server", "server_name", "serverName"])


def tmt_entry_name(rec: dict, id_to_name: dict) -> str:
    name = first_str_field(rec, ["name", "item", "item_name", "itemName", "market_name"])
    if name:
        return name
    item_id = first_str_field(rec, ["item_id", "itemId", "itemid", "id"])
    return id_to_name.get(str(item_id), "") if item_id else ""


def tmt_normalize_price_record(rec: dict, id_to_name: dict, requested_world: str, requested_item: str) -> dict:
    name = tmt_entry_name(rec, id_to_name) or requested_item
    world = tmt_entry_world(rec) or requested_world
    buy_offer = first_int_field(rec, ["buy_offer", "buyOffer", "current_buy_offer", "currentBuyOffer", "highest_buy_offer", "highestBuyOffer", "highest_buy", "highestBuy", "month_buy_offer", "monthBuyOffer"])
    sell_offer = first_int_field(rec, ["sell_offer", "sellOffer", "current_sell_offer", "currentSellOffer", "lowest_sell_offer", "lowestSellOffer", "lowest_sell", "lowestSell", "month_sell_offer", "monthSellOffer"])
    month_avg_sell = first_int_field(rec, ["month_average_sell", "monthAverageSell", "month_avg_sell", "monthAvgSell", "avg_sell", "average_sell", "averageSell", "day_average_sell", "dayAverageSell"])
    month_avg_buy = first_int_field(rec, ["month_average_buy", "monthAverageBuy", "month_avg_buy", "monthAvgBuy", "avg_buy", "average_buy", "averageBuy", "day_average_buy", "dayAverageBuy"])
    sold = first_int_field(rec, ["month_sold", "monthSold", "sold", "day_sold", "daySold"])
    bought = first_int_field(rec, ["month_bought", "monthBought", "bought", "day_bought", "dayBought"])
    timestamp = first_str_field(rec, ["time", "timestamp", "date", "last_update", "lastUpdate", "last_seen", "lastSeen"])
    avg_used = sell_offer or month_avg_sell or buy_offer or month_avg_buy
    return {
        "item": name,
        "world": normalize_world(world),
        "url": "https://www.tibiamarket.top/",
        "source": "TibiaMarket.top API",
        "buy_offer": buy_offer,
        "sell_offer": sell_offer,
        "month_average_sell": month_avg_sell,
        "month_average_buy": month_avg_buy,
        "month_sold": sold,
        "month_bought": bought,
        "current_market_price": sell_offer,
        "global_average_price": month_avg_sell,
        "avg_value_used": avg_used,
        "last_market_check": timestamp[:80] if timestamp else "",
    }


def load_market_top_cache():
    if not MARKET_TOP_CACHE.exists():
        return None
    try:
        return json.loads(MARKET_TOP_CACHE.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return None


def write_market_top_cache(obj):
    MARKET_TOP_CACHE.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def fetch_market_top_bundle(world: str = "") -> dict:
    """Download current TibiaMarket.top API data and store it locally.

    The API is documented through FastAPI/Swagger. Different deployments have
    used slightly different query parameter names, so the downloader tries a
    small set of safe variants and stores whichever JSON response works.
    """
    requested_world = normalize_world(world or DEFAULT_WORLD)
    metadata = None
    metadata_error = ""
    try:
        metadata = fetch_json_url(f"{TIBIA_MARKET_TOP_API}/item_metadata", cache_key="tmt_item_metadata.json", max_age=12*3600)
    except Exception as e:
        metadata_error = str(e)
        metadata = []

    values = None
    tried = []
    errors = []
    value_urls = [
        f"{TIBIA_MARKET_TOP_API}/market_values?world={quote(requested_world)}",
        f"{TIBIA_MARKET_TOP_API}/market_values?server={quote(requested_world)}",
        f"{TIBIA_MARKET_TOP_API}/market_values?world_name={quote(requested_world)}",
        f"{TIBIA_MARKET_TOP_API}/market_values",
    ]
    for url in value_urls:
        try:
            tried.append(url)
            values = fetch_json_url(url, cache_key="tmt_market_values_" + slugify_item(url) + ".json", max_age=30*60)
            # Accept only if it contains some records.
            if list(deep_iter_records(values)):
                break
        except Exception as e:
            errors.append(f"{url}: {e}")
            values = None

    if values is None:
        raise RuntimeError("Could not download TibiaMarket.top market values. " + " | ".join(errors[-3:]))

    bundle = {
        "source": "https://www.tibiamarket.top/",
        "api": TIBIA_MARKET_TOP_API,
        "world": requested_world,
        "downloaded_at": int(time.time()),
        "metadata_error": metadata_error,
        "tried": tried,
        "metadata": metadata,
        "values": values,
    }
    write_market_top_cache(bundle)
    record_count = len(list(deep_iter_records(values)))
    return {"ok": True, "world": requested_world, "record_count": record_count, "metadata_error": metadata_error, "tried": tried, "message": f"Downloaded {record_count} market record(s) from TibiaMarket.top."}


def find_market_top_price(world: str, item: str, allow_download: bool = False) -> dict | None:
    requested_world = normalize_world(world)
    bundle = load_market_top_cache()
    if bundle is None and allow_download:
        fetch_market_top_bundle(requested_world)
        bundle = load_market_top_cache()
    if not bundle:
        return None
    id_to_name, name_to_id = build_metadata_maps(bundle.get("metadata") or [])
    item_key = re.sub(r"[^a-z0-9]+", " ", str(item or "").lower()).strip()
    item_id = name_to_id.get(item_key, "")
    best = None
    for rec in deep_iter_records(bundle.get("values") or []):
        rec_world = tmt_entry_world(rec)
        if rec_world and rec_world.lower() != requested_world.lower():
            continue
        rec_name = tmt_entry_name(rec, id_to_name)
        rec_key = re.sub(r"[^a-z0-9]+", " ", rec_name.lower()).strip() if rec_name else ""
        rec_id = first_str_field(rec, ["item_id", "itemId", "itemid", "id"])
        if rec_key == item_key or (item_id and rec_id and str(rec_id) == str(item_id)):
            best = rec
            break
    if not best:
        return None
    data = tmt_normalize_price_record(best, id_to_name, requested_world, item)
    data["url"] = "https://www.tibiamarket.top/"
    data["from_market_top_cache"] = True
    return data


def strip_tags(s: str) -> str:
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return html.unescape(re.sub(r"\s+", " ", s)).strip()


def parse_int(text):
    if text is None:
        return None
    m = re.search(r"\d[\d,\.]*", str(text))
    if not m:
        return None
    return int(re.sub(r"[^0-9]", "", m.group(0)))


def after_label(text, label, stop_labels):
    low = text.lower()
    start = low.find(label.lower())
    if start < 0:
        return ""
    start += len(label)
    end = len(text)
    for st in stop_labels:
        pos = low.find(st.lower(), start)
        if pos >= 0:
            end = min(end, pos)
    return text[start:end].strip(" :-–—\n\t")


def parse_tibiaprices_page(page: str, requested_world: str, item: str, url: str, page_world: str) -> dict:
    """Parse a TibiaPrices item page. If the page is for another world,
    try to extract requested_world from the monthly world table.
    """
    text = strip_tags(page)
    data = {"item": item, "world": normalize_world(requested_world), "url": url, "source": "TibiaPrices"}

    if "Page Not Found" in text or "404" in text[:300]:
        data["error"] = "Price page not found"
        return data

    current = after_label(text, "Current Market Price", ["World price", "Global average price", "Availability", "Demand", "Last market check"])
    global_avg = after_label(text, "Global average price", ["Availability", "Demand", "Item", "World", "Last market check", "NPC prices"])
    last = after_label(text, "Last market check:", ["Current Market Price", "Global average price", "Availability", "Demand"])
    availability = after_label(text, "Availability", ["Demand", "Item", "World", "NPC prices", "Last market check"])
    demand = after_label(text, "Demand", ["NPC prices", "Item", "World", "Compare", "Similar", "Last market check"])

    current_value = None if re.search(r"no offers", current or "", re.I) else parse_int(current)
    global_value = None if re.search(r"no offers", global_avg or "", re.I) else parse_int(global_avg)

    # If the exact requested world page 404s, we load any known-world page for the item.
    # Those pages include a Monthly Statistics table with prices from many worlds.
    requested_key = re.sub(r"[^a-z0-9]+", "", (requested_world or "").lower())
    page_key = re.sub(r"[^a-z0-9]+", "", (page_world or "").lower())
    extracted_from_world_table = None
    if requested_key and page_key != requested_key:
        sec = after_label(text, "Lowest Selling Offers", ["Highest Buying Offers", "Highest Selling Offer", "Average Selling Offer", "Similar items"])
        # Match world name followed by a price. This intentionally uses the display-world spelling, not slug.
        world_re = re.escape(requested_world.strip())
        m = re.search(rf"(?:^|\s){world_re}\s+(\d[\d,\.]*)(?:\s|$)", sec, flags=re.I)
        if m:
            extracted_from_world_table = parse_int(m.group(1))
            current_value = extracted_from_world_table
            data["note"] = f"Exact {requested_world} page was unavailable; used {requested_world} row from another TibiaPrices item page."
        else:
            data["note"] = f"Exact {requested_world} page was unavailable; using global average from another TibiaPrices item page."

    data["buy_offer"] = None
    data["sell_offer"] = current_value
    data["current_market_price"] = current_value
    data["global_average_price"] = global_value
    # For farming efficiency we want world-specific value if available; otherwise global average; otherwise page current.
    data["avg_value_used"] = current_value or global_value
    data["last_market_check"] = last[:80] if last else ""
    data["availability"] = re.sub(r"\s+", " ", availability[:80]).strip()
    data["demand"] = re.sub(r"\s+", " ", demand[:80]).strip()
    return data


def get_price(world: str, item: str) -> dict:
    requested_world = normalize_world(world)
    # Prefer TibiaMarket.top current buy/sell data if the user downloaded it.
    try:
        tmt = find_market_top_price(requested_world, item, allow_download=False)
        if tmt and (tmt.get("buy_offer") is not None or tmt.get("sell_offer") is not None or tmt.get("avg_value_used") is not None):
            return tmt
    except Exception:
        pass

    world_slug = slugify_item(requested_world)
    item_slug = slugify_item(item)

    # Only check the worlds the user cares about. This avoids wasting time on
    # pages/worlds that will not be used for decision making.
    fallback_worlds = [world_slug] + [slugify_item(w) for w in ALLOWED_WORLDS if slugify_item(w) != world_slug]
    seen = set()
    last_error = None
    for ws in fallback_worlds:
        if not ws or ws in seen:
            continue
        seen.add(ws)
        url = f"https://tibiaprices.com/world/{ws}/item/{item_slug}/"
        try:
            page = fetch_text(url, cache_key=f"price_{ws}_{item_slug}.html", max_age=12*3600)
            data = parse_tibiaprices_page(page, requested_world, item, url, ws)
            if data.get("avg_value_used") is not None:
                data["tried_worlds"] = list(seen)
                return data
            last_error = data.get("error") or "No price parsed from page"
        except HTTPError as e:
            last_error = f"HTTP {e.code}: {e.reason}"
            continue
        except Exception as e:
            last_error = str(e)
            continue

    # Return a non-fatal result; the UI/table can still show loot/drop/HP data.
    return {
        "item": item,
        "world": requested_world,
        "url": f"https://tibiaprices.com/world/{world_slug}/item/{item_slug}/",
        "source": "TibiaPrices",
        "buy_offer": None,
        "sell_offer": None,
        "current_market_price": None,
        "global_average_price": None,
        "avg_value_used": None,
        "error": f"No TibiaPrices page/value found for this item after fallback worlds. Last error: {last_error}",
        "tried_worlds": list(seen),
    }


def fandom_parse(title: str) -> str:
    api = "https://tibia.fandom.com/api.php?action=parse&prop=text&format=json&page=" + quote(wiki_title(title), safe=":_")
    # Wiki loot/HP data changes rarely, so keep it cached longer.
    raw = fetch_text(api, cache_key=f"wiki_{wiki_title(title)}.json", max_age=7*24*3600)
    obj = json.loads(raw)
    return obj.get("parse", {}).get("text", {}).get("*", "")


def extract_links(snippet: str):
    out, seen = [], set()
    for m in re.finditer(r'<a\b[^>]*href="([^"]+)"[^>]*?(?:title="([^"]+)")?[^>]*>(.*?)</a>', snippet, flags=re.I|re.S):
        href, title, inner = m.group(1), m.group(2) or "", strip_tags(m.group(3))
        name = html.unescape(title or inner).strip()
        name = re.sub(r"\s+", " ", name)
        if not name or len(name) > 60:
            continue
        if re.search(r"^(File|Image|Category|Special|Help|Template):", name, re.I):
            continue
        if not href.startswith("/wiki/") and "tibia.fandom.com/wiki/" not in href:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def load_weekly_sources(item: str):
    try:
        weekly = json.loads((ROOT / "weekly_items.json").read_text(encoding="utf-8"))
    except Exception:
        return []
    target = re.sub(r"[^a-z0-9]+", " ", item.lower()).strip()
    for row in weekly:
        rn = re.sub(r"[^a-z0-9]+", " ", row.get("name", "").lower()).strip()
        if rn == target:
            s = row.get("dropSources", "")
            if s and "not batch" not in s.lower() and "source-specific" not in s.lower():
                return [x.strip() for x in s.split(";") if x.strip()]
    return []


def extract_drop_sources(item: str) -> list:
    sources = []
    try:
        h = fandom_parse(item)
        labels = ["Dropped By", "Dropped from", "Dropped From", "Loot from", "Loot From"]

        # Best case: capture only the table row that contains the label. The old
        # parser grabbed a large slice after "Dropped By", which sometimes swept
        # unrelated links such as spells/effects into the source list.
        for row in re.findall(r"<tr[\s\S]*?</tr>", h, flags=re.I):
            row_text = strip_tags(row).lower()
            if any(label.lower() in row_text for label in labels):
                sources.extend(extract_links(row))
                break

        # Fallback: use a short bounded slice, not the whole page.
        if not sources:
            low = h.lower()
            for label in labels:
                idx = low.find(label.lower())
                if idx >= 0:
                    snippet = h[idx: idx + 2500]
                    stop = re.search(r"<tr\b|<h2\b|<h3\b|<table\b", snippet[100:], flags=re.I)
                    if stop:
                        snippet = snippet[:100 + stop.start()]
                    sources.extend(extract_links(snippet))
                    break

        # Also try section heading fallback, but keep it bounded.
        if not sources:
            sec = re.search(r"<span[^>]*id=\"(?:Dropped_By|Dropped_from|Loot_from)[^\"]*\"[\s\S]{0,3000}", h, flags=re.I)
            if sec:
                sources.extend(extract_links(sec.group(0)))
    except Exception:
        pass

    if not sources:
        sources = load_weekly_sources(item)

    bad = {"loot", "creatures", "items", "market", "tibiawiki", item.lower(), "invisibility"}
    clean, seen = [], set()
    for s in sources:
        s = html.unescape(s).replace("/Creature", "").strip()
        key = re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
        if not key or key in seen or key in bad:
            continue
        # Filter likely non-creature links from item pages.
        if looks_non_monster_source(s):
            continue
        seen.add(key); clean.append(s)
    return clean[:50]

def page_has_category(page_html: str, category: str) -> bool:
    # Fandom parse HTML usually contains category links like /wiki/Category:Creatures or /wiki/Category:NPCs.
    cat = re.escape(category)
    return bool(re.search(rf"Category:{cat}(?:[\"/#?<]|$)", page_html, flags=re.I))


def page_looks_like_npc(page_html: str) -> bool:
    if page_has_category(page_html, "NPCs"):
        return True
    txt = strip_tags(page_html[:6000]).lower()
    npc_markers = [
        "this npc", "is an npc", "this is a npc", "buying from npc", "selling from npc",
        "job:", "job ", "gender:", "city:", "location:", "sells", "buys"
    ]
    # Use category as the strongest signal. Text markers are intentionally only checked near the start.
    return any(m in txt for m in npc_markers) and not page_has_category(page_html, "Creatures")


def page_looks_like_boss(page_html: str, name: str = "") -> bool:
    """Reject bosses for weekly efficiency sources.

    TibiaWiki/Fandom boss pages normally carry categories containing Boss/Bosses.
    We also keep a small name-based guard for common boss-only page names that
    sometimes appear in loot lists but are not useful for farming comparisons.
    """
    if re.search(r"Category:[^\"'<]*Boss", page_html, flags=re.I):
        return True
    key = re.sub(r"[^a-z0-9]+", " ", str(name or "").lower()).strip()
    boss_name_markers = [
        "boss", "the count of", "the duke of", "the pale count", "gaz haragoth", "ghazbaran",
        "orshabaal", "morgaroth", "ferumbras", "mawhawk", "drume", "oberon", "scarlett",
        "timira", "leiden", "jaul", "obujos", "tanjis", "zushuka", "omrafir", "world devourer"
    ]
    return any(m in key for m in boss_name_markers)


def parse_hp_from_html(page_html: str):
    """Return creature HP, but only from real creature infobox/table fields.

    The previous parser could read any number from a row that merely contained
    the letters "HP" somewhere. Fandom pages contain lots of unrelated numbers
    (image sizes, sell prices, NPC text, spell values), so that caused random
    HP values in the weekly table. This parser only accepts:
      1) PortableInfobox fields with data-source hitpoints/health/hp, or
      2) a table row where the first cell label is exactly HP/Health/Hit Points.
    """
    def clean_num(value_html: str):
        txt = strip_tags(value_html).replace(',', '')
        # Avoid ranges and explanatory text. Take the first standalone integer.
        m = re.search(r"\b(\d{1,9})\b", txt)
        if not m:
            return None
        n = int(m.group(1))
        if n <= 0 or n > 10000000:
            return None
        return n

    # PortableInfobox, e.g. data-source="hitpoints" ... pi-data-value ... 70
    for src in ["hitpoints", "hit_points", "health", "hp"]:
        pat = rf'<[^>]+data-source=["\']{src}["\'][\s\S]{{0,1800}}?<div[^>]*class=["\'][^"\']*pi-data-value[^"\']*["\'][^>]*>([\s\S]*?)</div>'
        for m in re.finditer(pat, page_html, flags=re.I):
            n = clean_num(m.group(1))
            if n is not None:
                return n

    # PortableInfobox label/value pair fallback.
    pat = r'<h3[^>]*class=["\'][^"\']*pi-data-label[^"\']*["\'][^>]*>\s*(?:Hit Points|Hitpoints|Health|HP)\s*</h3>\s*<div[^>]*class=["\'][^"\']*pi-data-value[^"\']*["\'][^>]*>([\s\S]*?)</div>'
    for m in re.finditer(pat, page_html, flags=re.I):
        n = clean_num(m.group(1))
        if n is not None:
            return n

    # Old-style wikitable/infobox rows. Only parse the value cell, not the whole row.
    for row in re.findall(r"<tr[^>]*>[\s\S]*?</tr>", page_html, flags=re.I):
        cells = re.findall(r"<t[hd][^>]*>([\s\S]*?)</t[hd]>", row, flags=re.I)
        if len(cells) < 2:
            continue
        label = strip_tags(cells[0]).strip().lower().rstrip(':')
        label = re.sub(r"\s+", " ", label)
        if label in {"hp", "health", "hit points", "hitpoints"}:
            n = clean_num(cells[1])
            if n is not None:
                return n

    return None

def creature_hp(creature: str):
    try:
        h = fandom_parse(creature)
        if page_looks_like_npc(h) or page_looks_like_boss(h, creature) or page_has_category(h, "Spells") or page_has_category(h, "Runes"):
            return None
        hp = parse_hp_from_html(h)
        if not isinstance(hp, int) or hp <= 0:
            return None
        # Extra guard: if there is no creature-ish category and the page looks like an item/NPC/quest, reject it.
        if not page_has_category(h, "Creatures"):
            txt = strip_tags(h[:8000]).lower()
            creatureish = any(x in txt for x in ["hit points", "bestiary", "experience points", "summon", "convince"])
            if not creatureish:
                return None
        return hp
    except Exception:
        return None


def parse_loot_stats(stats_html: str, item: str):
    # Search rows that contain the item, then extract percentage and nearby numbers.
    target = re.escape(item)
    for row in re.findall(r"<tr[\s\S]*?</tr>", stats_html, flags=re.I):
        row_text = strip_tags(row)
        if not re.search(target, row_text, flags=re.I):
            continue
        chance = re.search(r"\d+(?:\.\d+)?\s*%", row_text)
        nums = re.findall(r"\b\d+(?:\.\d+)?\b", row_text.replace(",", ""))
        avg = ""
        # Often avg/kill is a decimal; choose first decimal that is not part of a percent if possible.
        for n in nums:
            if "." in n and (not chance or n not in chance.group(0)):
                avg = n; break
        sample = nums[-1] if nums else ""
        return {"chance": chance.group(0).replace(" ", "") if chance else "Found row, chance unclear", "average": avg or "—", "sample": sample or "—"}
    return None



def parse_chance_percent(chance_text: str):
    if not chance_text:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", str(chance_text))
    if not m:
        return None
    try:
        return float(m.group(1))
    except Exception:
        return None


def looks_non_monster_source(name: str) -> bool:
    key = re.sub(r"[^a-z0-9]+", " ", str(name or "").lower()).strip()
    if not key:
        return True
    non_monster_words = [
        "npc", "rashid", "yasir", "hireling", "quest", "box", "chest", "crate", "bag", "reward", "market",
        "creature products", "outfit", "achievement", "book", "item", "depot", "store", "tibia coins",
        "king", "queen", "emperor", "empress", "captain", "guide", "banker", "merchant", "trader", "shopkeeper",
        "invisibility", "invisible", "spell", "rune", "magic", "blessing", "imbuement", "charm"
    ]
    return any(w in key for w in non_monster_words)

def get_loot_sources(item: str) -> list:
    sources = [s for s in extract_drop_sources(item) if not looks_non_monster_source(s)]
    if not sources:
        return [{"source":"No monster source parsed", "hp":None, "hpText":"—", "chance":"—", "chancePercent":None, "average":"—", "sample":"—", "url":wiki_url(item), "note":"Open item page manually"}]

    with_hp = []
    for s in sources:
        hpv = creature_hp(s)
        # Do not count NPCs/non-monsters for the lowest-HP source. In practice, pages without HP are excluded here.
        if isinstance(hpv, int) and hpv > 0:
            with_hp.append({"source":s, "hp":hpv, "hpText": f"{hpv:,}"})

    if not with_hp:
        return [{"source":"No monster source with HP parsed", "hp":None, "hpText":"—", "chance":"—", "chancePercent":None, "average":"—", "sample":"—", "url":wiki_url(item), "note":"NPCs/non-monsters ignored"}]

    with_hp.sort(key=lambda r: (r["hp"], r["source"].lower()))
    easiest = with_hp[:6]
    rows = []
    for r in easiest:
        stats_title = f"Loot_Statistics:{r['source']}"
        parsed = None
        try:
            stats_html = fandom_parse(stats_title)
            parsed = parse_loot_stats(stats_html, item)
        except Exception:
            parsed = None
        chance_text = (parsed or {}).get("chance") or "Not found on statistics page"
        rows.append({
            "source": r["source"],
            "hp": r["hp"],
            "hpText": r["hpText"],
            "chance": chance_text,
            "chancePercent": parse_chance_percent(chance_text),
            "average": (parsed or {}).get("average") or "—",
            "sample": (parsed or {}).get("sample") or "—",
            "url": wiki_url(stats_title),
            "creatureUrl": wiki_url(r["source"]),
            "totalParsedSources": len(sources)
        })
    return rows


def get_weekly_row(world: str, item: str) -> dict:
    # Whole weekly rows are cached because they require multiple remote page loads
    # (price page + item page + creature page + loot statistics page). The first
    # run can still take time, but repeats become near-instant.
    requested_world = normalize_world(world)
    cache_key = "weeklyrow_v5_twosources_no_bosses_no_eff_" + slugify_item(requested_world) + "_" + slugify_item(item) + ".json"
    cached = cache_get(cache_key, max_age=12*3600)
    if cached:
        try:
            obj = json.loads(cached)
            obj["fromCache"] = True
            return obj
        except Exception:
            pass

    price = get_price(requested_world, item)
    sources = get_loot_sources(item)
    monster_sources = [s for s in sources if s.get("source") and isinstance(s.get("hp"), int)]
    top_sources = monster_sources[:2]
    best = top_sources[0] if top_sources else {}
    avg_value = price.get("avg_value_used") or price.get("global_average_price") or price.get("current_market_price")
    chance_pct = best.get("chancePercent")
    source_labels = [f"{s.get('source')} ({s.get('hp'):,} HP)" for s in top_sources]
    chance_labels = []
    for s in top_sources:
        ch = s.get("chance") or "—"
        chance_labels.append(f"{s.get('source')}: {ch}")
    row = {
        "name": item,
        "avgValue": avg_value,
        "currentMarketPrice": price.get("current_market_price"),
        "globalAveragePrice": price.get("global_average_price"),
        "priceUrl": price.get("url"),
        "priceError": price.get("error"),
        "monsterSources": source_labels,
        "monsterSourcesText": "; ".join(source_labels),
        "lowestSource": "; ".join(source_labels),
        "lowestHp": best.get("hp") if best and best.get("hp") else None,
        "dropChanceText": "; ".join(chance_labels),
        "dropChancePercent": chance_pct,
        "sourceUrl": best.get("url") or wiki_url(item),
        "wikiUrl": wiki_url(item),
        "fromCache": False,
    }
    try:
        cache_set(cache_key, json.dumps(row, ensure_ascii=False))
    except Exception:
        pass
    return row


def run_git_update() -> dict:
    """Update the app when the folder is a Git clone.
    This intentionally only supports fast-forward pulls to avoid overwriting local changes.
    """
    git_dir = ROOT / ".git"
    if not git_dir.exists():
        return {
            "ok": False,
            "error": "This folder is not a Git clone. Upload this project to GitHub, then clone it with git clone. ZIP downloads cannot auto-update with git pull.",
            "hint": "Use update.bat or clone the GitHub repo folder."
        }
    try:
        res = subprocess.run(
            ["git", "pull", "--ff-only"],
            cwd=str(ROOT),
            text=True,
            capture_output=True,
            timeout=60,
        )
        return {
            "ok": res.returncode == 0,
            "stdout": res.stdout.strip(),
            "stderr": res.stderr.strip(),
            "code": res.returncode,
            "message": "Updated. Restart the server if files changed." if res.returncode == 0 else "Git pull failed."
        }
    except FileNotFoundError:
        return {"ok": False, "error": "Git is not installed or not in PATH. Install Git for Windows, then try again."}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def clear_cache() -> dict:
    removed = 0
    for p in CACHE.glob("*"):
        try:
            if p.is_file():
                p.unlink()
                removed += 1
        except Exception:
            pass
    return {"ok": True, "removed": removed, "message": f"Cleared {removed} cached file(s)."}


class Handler(SimpleHTTPRequestHandler):
    def end_json(self, obj, status=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        try:
            if parsed.path == "/api/price":
                item = qs.get("item", [""])[0].strip()
                world = normalize_world(qs.get("world", [DEFAULT_WORLD])[0])
                if not item:
                    return self.end_json({"error":"Missing item"}, 400)
                return self.end_json(get_price(world, item))
            if parsed.path == "/api/loot_sources":
                item = qs.get("item", [""])[0].strip()
                if not item:
                    return self.end_json({"error":"Missing item"}, 400)
                return self.end_json(get_loot_sources(item))
            if parsed.path == "/api/weekly_row":
                item = qs.get("item", [""])[0].strip()
                world = normalize_world(qs.get("world", [DEFAULT_WORLD])[0])
                if not item:
                    return self.end_json({"error":"Missing item"}, 400)
                return self.end_json(get_weekly_row(world, item))
            if parsed.path == "/api/update":
                return self.end_json(run_git_update())
            if parsed.path == "/api/clear_cache":
                return self.end_json(clear_cache())
            if parsed.path == "/api/download_market_top":
                world = normalize_world(qs.get("world", [DEFAULT_WORLD])[0])
                return self.end_json(fetch_market_top_bundle(world))
        except Exception as e:
            return self.end_json({"error": str(e)}, 500)
        return super().do_GET()


def main():
    os.chdir(ROOT)
    print(f"Serving Tibia Item Market + Loot Finder on http://localhost:{PORT}/")
    print("Press Ctrl+C to stop.")
    server = ThreadingHTTPServer(("", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")

if __name__ == "__main__":
    main()
