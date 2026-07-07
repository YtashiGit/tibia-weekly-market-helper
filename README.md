# Tibia Weekly Market Helper

Local web app for Tibia weekly Delivery Task items.

It can:

- search any item by name,
- load market value where a public price page is available,
- show whether the item is in the weekly Delivery Task pool,
- list up to 6 lowest-HP monster sources,
- show HP and TibiaWiki/Fandom loot-stat drop chance when available,
- enrich the weekly table with avg value, drop chance %, lowest monster HP, and expected gp/kill,
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
- Lowest-HP source ignores NPCs/non-monsters by requiring a parsed HP value.
- Market prices depend on public price pages being available and parseable.
- Cached requests are stored in `.cache/` and are ignored by Git.


## Performance notes

`Load avg values + efficiency` is slow on the first full run because every weekly item may require multiple remote lookups: a market-price page, an item page, creature HP pages, and loot-statistics pages. This version adds:

- 8 parallel workers in the browser.
- 12-hour cached weekly efficiency rows in `.cache/`.
- 12-hour cached price pages.
- 7-day cached TibiaWiki pages for HP/drop data.

The first full run can still take a while, but repeating it for the same world should be much faster. To force fresh data, delete the `.cache` folder while the server is stopped.
