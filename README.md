# Tibia Weekly Market Helper

Local web app for Tibia weekly Delivery Task items.

It can:

- search any item by name,
- load market value where a public price page is available,
- show whether the item is in the weekly Delivery Task pool,
- list up to 6 lowest-HP monster sources,
- show HP and TibiaWiki/Fandom loot-stat drop chance when available,
- enrich the weekly table with avg value, drop chance %, two lowest-HP non-boss monster sources, and expected gp/kill,
- export weekly results to CSV for Excel.

## Run on Windows

Open this folder, click the address bar, type `cmd`, press Enter, then run:

```bat
py server.py
```

Open:

```text
http://localhost:8000
```

You can also double-click `start.bat`.

## GitHub setup

### First time upload

1. Create a new empty GitHub repository named:

```text
tibia-weekly-market-helper
```

2. Install Git for Windows if you do not have it.

3. Open Command Prompt in this folder and run:

```bat
git init
git add .
git commit -m "Initial version"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/tibia-weekly-market-helper.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

### Better install after uploading

After the repo exists on GitHub, install the app by cloning it instead of downloading ZIPs:

```bat
cd %USERPROFILE%\Downloads
git clone https://github.com/YOUR_USERNAME/tibia-weekly-market-helper.git
cd tibia-weekly-market-helper
py server.py
```

From then on, the folder has Git metadata and can update itself.

## Updating

If you installed with `git clone`, you have three update options:

1. Use the button in the site: **Update app from GitHub**.
2. Run:

```bat
git pull --ff-only
```

3. Double-click `update.bat`.

After updating, stop the server with `Ctrl+C`, run `py server.py` again, and refresh the browser with `Ctrl+F5`.

## Important limitation

The app can update itself only from a real GitHub repo that contains newer code. If you use a ZIP-only folder, there is no Git history, so the update button cannot know where to pull updates from.

## Data notes

- Drop chances are community loot-stat estimates from TibiaWiki/Fandom, not official CipSoft rates.
- Weekly source selection ignores NPCs, bosses, and non-monsters by requiring real creature HP and rejecting boss categories.
- Market prices depend on public price pages being available and parseable.
- Cached requests are stored in `.cache/` and are ignored by Git.


## Performance notes

`Load avg values + sources` is slow on the first full run because every weekly item may require multiple remote lookups: a market-price page, an item page, creature HP pages, and loot-statistics pages. This version adds:

- 8 parallel workers in the browser.
- 12-hour cached weekly source rows in `.cache/`.
- 12-hour cached price pages.
- 7-day cached TibiaWiki pages for HP/drop data.

The first full run can still take a while, but repeating it for the same world should be much faster. To force fresh data, delete the `.cache` folder while the server is stopped.

## NPC/source filtering fix

This build ignores NPC/non-monster pages when calculating the lowest-HP non-boss sources. HP is accepted only from creature-style infobox/table rows, and pages categorized as NPCs are excluded. Existing old cache entries are bypassed with a new weekly-row cache key.

## Notes in this build

- The world selector is limited to **Bona**, **Celesta**, and **Dia**.
- Price lookups only try those three worlds, which cuts useless fallback requests and should make failures finish faster.
- The loot-source parser is stricter: it only reads the actual Dropped By row/section and rejects NPC/spell/rune/boss pages.
- Weekly source rows use a new cache key so older cached bad rows are not reused.

## HP table fix
This version uses a stricter HP parser. It only accepts HP from creature infobox/table fields and ignores NPC/spell/item pages. If you used an older version and still see weird HP values, click **Clear cache** once, then run **Load avg values + sources** again.


## Quick prices bar

Quick price cards were replaced by the Imbuingi tab. Imbuingi includes material prices and Gold Token comparison.

## New tabs

### Grizzly Adams
Shows all Grizzly Adams task rows split into Tibia level ranges: 6-49, 50-79, 80-129 and 130+. Each row lists counted mobs and a practical set of valuable loot items to watch. Click an item chip to search it in the main item lookup.

### Imbuingi
Lists all imbuement material items from TibiaWiki's imbuing tables. Use **Download current prices + load imbuingi** to fetch average prices for the selected world: Bona, Celesta, Dia or Kalanta. The table can be filtered, sorted, and exported to CSV.

## Imbuingi: Gold Token comparison

The Imbuingi tab now includes a manual/editable Gold Token price field. You can load the Gold Token price automatically when the price source has it, or type your own current market price.

The comparison table groups imbuements only by level:

- Basic = 2 Gold Tokens
- Intricate = 4 Gold Tokens
- Powerful = 6 Gold Tokens

It compares the total market-material cost against the Gold Token cost and marks which option is cheaper.


## Weekly table source rules

The weekly table ignores NPCs, non-monsters, and boss pages when choosing farming sources. It displays up to two lowest-HP regular monsters as `Monster Name (HP)` and does not show separate HP or expected gp/kill columns.


## Weekly table layout update

The weekly table now shows up to two regular monsters per item in one column, formatted as `Monster Name (HP)`. It does not show separate HP or expected gp/kill columns, and bosses are excluded from weekly source suggestions.


## Imbuingi: ręczna cena itemu

W tabeli Imbuingi kolumna `Manual price` działa tak: `0` oznacza użyj ceny `Avg price`, a każda wartość większa od zera nadpisuje cenę avg. Kolumny `Used price`, `Total for max qty` oraz porównanie z Gold Token przeliczają się na podstawie tej wartości. Ręczne ceny są zapisywane lokalnie w przeglądarce.


## Update: TibiaMarket.top buy/sell offers

- Search summary no longer shows Demand/Availability/Current market price/Avg value used cards.
- It now shows Buy offer and Sell offer.
- Use the **Download current market prices** button to cache current market data from `https://www.tibiamarket.top/` via the local Python server.
- If TibiaMarket.top has no usable row for an item, the app falls back to TibiaPrices where possible.


## Fix note
Current buy/sell offers are downloaded from `https://api.tibiamarket.top/market_values?server=<WORLD>&limit=5000`. The app no longer uses TibiaPrices' stale `Last market check` card in the item summary.

## Update: Green Djinn tab

Added a **Green Djinn** tab with items bought by the green djinn NPCs **Alesar** and **Yaman**. The table shows:

- item name,
- NPC name,
- NPC sell price,
- current market buy offer,
- current market sell offer,
- market average,
- market price used,
- profit vs NPC price.

Use **Download current prices + load Green Djinn** after selecting Bona, Celesta, Dia, or Kalanta.


## Fix: TibiaMarket.top prices
This version parses TibiaMarket.top API fields named `buy_price` and `sell_price` as Buy offer and Sell offer. Use **Clear cache**, then **Download current prices**, then load Green Djinn/Imbuingi again.


## Delivery source data

Weekly Delivery rows now prefer Tibiopedia item pages (`https://tibiopedia.pl/items/...`) for `Wypada z` / drop-source data. If Tibiopedia cannot be reached or a page layout changes, the server falls back to the previous TibiaWiki/Fandom source parser and bundled `weekly_items.json`.
