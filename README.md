# ⚾ Baseball Card Collection

Two-page static site deployed on GitHub Pages:

1. **Network Graph** (`index.html`) — D3 force-directed graph of player-to-player connections through shared teams.
2. **Further Insights** (`pricing.html`) — market valuations, portfolio analytics, biggest-mover diff, player-level volatility, and a trigger to kick off new pricing runs.

Pricing data is refreshed nightly by a Python GitHub Action (`scripts/price_cards.py`) that queries the eBay Browse API with Claude as a fallback for thin/high-value cards and TCDB as a reference-price safety net.

## 📁 Project structure

```
baseball-cards/
├── index.html                   ← Network graph page
├── pricing.html                 ← Insights / pricing page
├── sw.js                        ← Service worker (offline + asset cache)
├── css/
│   ├── style.css                ← Network-page styling
│   └── pricing.css              ← Insights / pricing styling
├── js/
│   ├── app.js                   ← Network graph main
│   ├── filters.js               ← Year / player filtering
│   ├── network.js               ← D3 force-directed rendering
│   ├── export.js                ← SVG / PNG export
│   ├── pricing.js               ← Insights page logic (tables, charts, GH trigger)
│   ├── clusterize.min.js        ← Virtualized-table lib for the pricing table
│   ├── chord-standalone.js      ← Optional chord-diagram view
│   ├── enhanced-search.js       ← Fuzzy search helpers
│   ├── keyboard.js              ← Keyboard nav
│   ├── history.js               ← Undo/redo on network state
│   ├── url-state.js             ← Shareable URLs for filter state
│   ├── lod.js                   ← Level-of-detail rendering
│   ├── optimizations.js         ← Render/IO perf helpers
│   └── preload-optimization.js  ← Asset preloading
├── data/
│   ├── network_data.json        ← Years and edges (~2.6 MB)
│   ├── players.json             ← Player list
│   ├── teams.json               ← Team list
│   ├── team_colors.json         ← MLB team colors
│   ├── pricing_results.json     ← Latest pricing snapshot (~1 MB)
│   ├── pricing_summary.json     ← Precomputed sidecar (~5 KB, read first on load)
│   ├── price_history.json       ← Time-series of per-card prices
│   ├── run_metadata.json        ← Last run stats (calls, cache hits, duration)
│   ├── ebay_cache.json          ← Persistent 24 h eBay-query cache
│   ├── pricecharting_cache.csv  ← Weekly PriceCharting reference (optional)
│   └── 130point_cache.json      ← Cached 130point sold comps (optional)
└── scripts/
    ├── price_cards.py           ← Pricing agent (nightly + on-demand)
    └── requirements.txt
```

## 🚀 Quick start

```bash
# Clone and serve locally
git clone https://github.com/benjamin-cooper/baseball-cards.git
cd baseball-cards
python3 -m http.server 8000
# Visit http://localhost:8000 (network) or http://localhost:8000/pricing.html (insights)
```

## 🎯 Features

### Network graph
- Multi-select player search, decade / year filters, min-connection slider
- Realistic MLB team colors, drag-to-pan, scroll-to-zoom, SVG/PNG export
- Shareable URLs encode filter state
- Offline support via service worker

### Insights & pricing
- Summary stat cards (total, avg, median, top, **weighted total**, **HHI concentration**)
- Portfolio value over time
- Top 25 cards + market movers + biggest-changes diff view
- Value-by-era / value-by-brand drilldown
- Per-player stats table with total value, copies, avg, **volatility**
- Full card table with server- and client-side sort + confidence filter
- Card detail modal: 7d / 30d / YoY deltas, price history chart, eBay/TCDB links
- In-page "Update Prices" button triggers a GitHub Actions run (requires PAT with `actions: write` scope)

## 🧠 Pricing logic (high level)

1. Read the source Google Sheet (or CSV export) for per-card inputs including a TCDB reference price (column F).
2. Determine which cards need repricing based on a tiered freshness threshold (cheap commons refresh less often; high-value cards refresh weekly).
3. For each card:
   - Query eBay Browse API with price-band filters (cached 24 h).
   - If eBay returns too few comps and the card is high-value, try 130point sold comps (if enabled) or Claude.
   - If still no signal, fall back to the TCDB reference price, then to a hard-coded era/brand floor.
4. Post-processing:
   - **Bayesian smoothing** with player- and set-level priors for thinly-priced cards.
   - **Median-of-last-3-runs smoothing** to reduce day-to-day noise.
   - **Anomaly floor** using the inputted TCDB reference (column F).
   - **Confidence recalibration** based on recent volatility (coefficient-of-variation).
5. Emit `pricing_results.json`, `pricing_summary.json` (small sidecar precomputed for the frontend), `price_history.json`, `run_metadata.json`, and the persistent caches.

## ⚙️ Configuration (environment variables)

Used by `scripts/price_cards.py` inside the GitHub Actions workflow:

- `EBAY_APP_ID`, `EBAY_CERT_ID` — eBay production credentials
- `ANTHROPIC_API_KEY` — Claude fallback
- `GOOGLE_SERVICE_ACCOUNT_JSON` — read the Pricing Sheet
- `RUN_MODE` — `batch` | `full` | `player` | `tcdb`
- `BATCH_SIZE`, `START_ROW`, `STALE_DAYS`, `FORCE_REPRICE`, `PLAYER_TARGET`
- `PRICECHARTING_ENABLED=1` + `PRICECHARTING_CSV_URL=...` — optional weekly PriceCharting reference
- `HUNDRED_THIRTY_POINT_ENABLED=1` — optional 130point sold-comps supplement for high-value cards

## 🛠️ Technology stack

- D3.js v7, vanilla ES2020 modules, Clusterize.js for virtualized tables
- Service worker (cache-first for assets, network-first for data)
- Python 3.11 + `requests` + `anthropic` + Google Sheets API for the pricing agent
- GitHub Actions for nightly + on-demand runs, GitHub Pages for hosting

## 📝 License

Open source — free for personal use.

## 👥 Credits

- Collection by Ben & Marty
- Visualization in D3.js, valuations via eBay + Claude + TCDB + PriceCharting
