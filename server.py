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
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TibiaItemLocalServer/1.1"


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
    data = {"item": item, "world": requested_world or "Antica", "url": url, "source": "TibiaPrices"}

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

    data["current_market_price"] = current_value
    data["global_average_price"] = global_value
    # For farming efficiency we want world-specific value if available; otherwise global average; otherwise page current.
    data["avg_value_used"] = current_value or global_value
    data["last_market_check"] = last[:80] if last else ""
    data["availability"] = re.sub(r"\s+", " ", availability[:80]).strip()
    data["demand"] = re.sub(r"\s+", " ", demand[:80]).strip()
    return data


def get_price(world: str, item: str) -> dict:
    requested_world = world or "Antica"
    world_slug = slugify_item(requested_world)
    item_slug = slugify_item(item)

    # First try the exact requested world. If that page does not exist, try a few
    # common worlds that often have an item page and then parse the requested
    # world's price from the cross-world monthly table on that page.
    fallback_worlds = [world_slug, "antica", "secura", "vunira", "ombra", "bona", "nefera", "celesta", "belobra", "refugia", "pacera", "monza"]
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
        # Fandom often has a table row where the first cell is "Dropped By". Take a wide slice.
        for label in ["Dropped By", "Dropped from", "Dropped From", "Loot from", "Loot From"]:
            idx = h.lower().find(label.lower())
            if idx >= 0:
                snippet = h[idx: idx + 12000]
                sources.extend(extract_links(snippet))
                break
        # Also try section heading fallback.
        if not sources:
            sec = re.search(r"<span[^>]*id=\"(?:Dropped_By|Dropped_from|Loot_from)[^\"]*\"[\s\S]{0,12000}", h, flags=re.I)
            if sec:
                sources.extend(extract_links(sec.group(0)))
    except Exception:
        pass

    if not sources:
        sources = load_weekly_sources(item)

    bad = {"loot", "creatures", "items", "market", "tibiawiki", item.lower()}
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


def parse_hp_from_html(page_html: str):
    text = strip_tags(page_html).replace(",", "")
    patterns = [
        r"(?:Hit Points|Hitpoints|Health|HP)\s*[:\-]?\s*(\d{1,9})\b",
        r"\b(\d{1,9})\s*(?:hit points|hitpoints|health|hp)\b",
    ]
    for pat in patterns:
        m = re.search(pat, text, flags=re.I)
        if m:
            return int(m.group(1))
    return None


def creature_hp(creature: str):
    try:
        h = fandom_parse(creature)
        return parse_hp_from_html(h)
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
        "creature products", "outfit", "achievement", "book", "item", "depot", "store", "tibia coins"
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
    requested_world = world or "Antica"
    cache_key = "weeklyrow_" + slugify_item(requested_world) + "_" + slugify_item(item) + ".json"
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
    best = sources[0] if sources else {}
    avg_value = price.get("avg_value_used") or price.get("global_average_price") or price.get("current_market_price")
    chance_pct = best.get("chancePercent")
    efficiency = None
    if isinstance(avg_value, int) and isinstance(chance_pct, (int, float)):
        efficiency = round(avg_value * chance_pct / 100, 4)
    row = {
        "name": item,
        "avgValue": avg_value,
        "currentMarketPrice": price.get("current_market_price"),
        "globalAveragePrice": price.get("global_average_price"),
        "priceUrl": price.get("url"),
        "priceError": price.get("error"),
        "lowestSource": best.get("source") if best and best.get("hp") else "",
        "lowestHp": best.get("hp") if best and best.get("hp") else None,
        "dropChanceText": best.get("chance") or "",
        "dropChancePercent": chance_pct,
        "efficiency": efficiency,
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
                world = qs.get("world", ["Antica"])[0].strip() or "Antica"
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
                world = qs.get("world", ["Antica"])[0].strip() or "Antica"
                if not item:
                    return self.end_json({"error":"Missing item"}, 400)
                return self.end_json(get_weekly_row(world, item))
            if parsed.path == "/api/update":
                return self.end_json(run_git_update())
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
