# 📱 Phone Information Hub

A smartphone information website built around a **live data-provider abstraction** — not a fixed phone list. Search **any** phone (current or future) and the system discovers it automatically from GSMArena's public endpoints, open datasets and robots-compliant web research, then presents everything with **full source attribution, confidence levels and a strict no-fake-data policy**.

```
Search any phone
      ↓
Live AJAX suggestions (GSMArena device index, ~6,000 phones)
      ↓
Exact device page capture (m.gsmarena.com)
      ↓
Parse: full spec sheet · prices · images · 3D model · news · reviews
      ↓
Merge + dedupe + store with source & timestamp
      ↓
Beautiful animated page: 3D viewer · lightbox gallery · tests · benchmarks
```

---

## 🚀 Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

*(Full local setup guide above — prerequisites, production mode, config, troubleshooting.)*

Production:

```bash
npm run build
npm run start
```

**No API keys required** — the system runs fully on free/open sources. Optional settings live in `.env` (see `.env.example`).

---

## 📖 Full usage guide — how to use everything

### 1. Search for a phone

**Option A — live suggestions (recommended)**
1. Open `http://localhost:3000`
2. Start typing a phone name (e.g. `realme 8`, `samsung galaxy s25`)
3. A dropdown appears **while you type** with phone thumbnails, name and brand (live from the GSMArena device index)
4. Click the exact phone you want (or navigate with ↑ ↓ and press Enter) → the site fetches that **exact** device and opens its page

**Option B — free-text search**
1. Type the full name and press **Enter** or click **Search**
2. The pipeline runs through all providers (watch the staged progress: cache → providers → datasets → web)
3. If no source can verify the phone exists, you get an honest *"could not verify"* message — never wrong data

**Option C — example / recent chips**
- Click any example chip (iPhone 17 Pro Max, Galaxy S25 Ultra…)
- Your last 5 searches are remembered (⏱ chips) for one-click repeat lookups

### 2. Read a phone page (top → bottom)

| Section | What to do / what it means |
|---|---|
| **Hero** | Photo (moves in 3D under your cursor), colorway badges, RAM/storage variants, field count + last-updated date |
| **Highlight chips** | The 6 key specs at a glance (display, camera, RAM, battery, chipset, OS) — they tilt in 3D on hover |
| **🧊 3D view** | **Drag the phone** with mouse/finger to rotate it; it auto-spins when idle. Colorway chips re-tint it. If GSMArena has an official Binkies 3D model, click **"⚡ Load official interactive 3D model"** for the real interactive model with color swatches |
| **Spec cards** | Curated overview: Display, Performance, Memory, Battery, Cameras, Body… Every row shows a **confidence badge** (green Verified, yellow Estimated…), a **source link ↗** (click to open the original page) and the **retrieval date** |
| **📋 Full specification sheet** | Click to expand — **every single row** captured from GSMArena, grouped into the original sections (Network, Body, Display, Platform, Battery…). Nothing omitted |
| **🧪 Tests & endurance ratings** | Real measured results from the EU energy label: energy class, battery endurance (e.g. "70:44h, 1600 cycles"), free-fall class, repairability class |
| **🏁 Benchmarks** | Real measured scores from GSMArena's "Our Tests": AnTuTu, GeekBench, GFXBench, display brightness (nits), loudspeaker (LUFS). Only shown when real measurements exist |
| **💰 Prices** | Best offers per country/variant with retailer and date. Shows "Price unavailable" when no live offer exists |
| **🖼️ Photo gallery** | Official renders + hands-on photos. **Click any photo** → fullscreen viewer (← → arrows or keyboard, Esc to close, thumbnail strip) |
| **📰 News / 📝 Reviews** | Related articles with thumbnails, linking to the original source |
| **Data Sources panel** | Summary of every source used for this phone — click to open the original |
| **Update history** | Every field change ever made, with old → new value, source and timestamp |
| **⟳ Refresh data** | Re-queries all providers now and updates changed fields (history is kept) |
| **JSON ↗** | The complete raw record as JSON (for developers) |

### 3. Refresh data

- **One phone**: open its page → click **⟳ Refresh data**
- **Everything**: go to `/admin` → click **⟳ Refresh all phones**
- Or via API:
  ```bash
  curl -X POST http://localhost:3000/api/phones/realme-8/refresh
  curl -X POST "http://localhost:3000/api/phones/refresh?q=pixel+9"
  ```

Data is also refreshed automatically when a cached record is older than its TTL (7 days for specs, 12h for prices — configurable).

### 4. Import your own dataset (admin)

1. Go to `/admin` → **Open dataset import**
2. Choose a **JSON, CSV or XML** file
3. Fill in:
   - **Name** — e.g. "MyPhoneDB 2026"
   - **Record path** — where the array lives (e.g. `data.devices` for nested JSON)
   - **Field mapping** — JSON mapping external columns → internal fields:
     ```json
     {"external_name": "general.model", "brand": "general.brand", "battery_capacity": "battery.capacity"}
     ```
   - **Model / Brand field** — which columns identify the phone
4. Click **Import dataset** — the file is stored in `data/datasets/` and immediately used by the `open_dataset` provider during searches

### 5. Manage providers (admin)

| Control | Effect |
|---|---|
| **Enabled/Disabled** | Turn any provider on/off instantly |
| **Priority** | Lower number = tried first (5 = GSMArena, 90 = web fallback) |
| **Rate/min** | Max requests per minute to that source |
| **Key env var** | Name of the environment variable holding an API key (the key itself stays in `.env`, never in the database) |
| **Status** | Shows whether the provider is actually configured and usable |
| **Recent provider requests** | Live log of OK/ERR calls with errors |
| **Source conflicts** | When two sources disagree on a value, both are recorded here |

### 6. Use the JSON API directly

```bash
# Live suggestions while typing
curl "http://localhost:3000/api/suggest?q=realme"

# Full discovery (exact, via suggestion slug)
curl "http://localhost:3000/api/phones/search?q=Realme%208&gsm=realme_8-10810"

# Full record: specs + prices + media + history
curl "http://localhost:3000/api/phones/realme-8"

# Refresh
curl -X POST http://localhost:3000/api/phones/realme-8/refresh
```

### 7. Deploy to a real domain

```bash
npm run build
npm run start        # serves on port 3000; put a reverse proxy (nginx) in front
```

- Set the TTL env vars as desired (see table above)
- Add provider keys to `.env` if you enable keyed providers
- **Back up `data/phones.db`** — it contains your entire cached database
- Note: the official Binkies 3D models are licensed to GSMArena's domain; on your own domain the CSS-3D phone viewer is used (everything else works identically)

---

## 🚀 Run it locally — complete guide

### Prerequisites
- **Node.js 18+** (20/24 recommended) — check with `node --version`
- **npm** — comes with Node
- Internet connection (data is fetched live)
- ~200 MB free disk space (project + SQLite database)

### 1. Install
```bash
# open a terminal in the project folder, then:
npm install
```
This installs Next.js, React, Tailwind, better-sqlite3 and the parsers. On Windows, `better-sqlite3` downloads a prebuilt binary automatically — no compiler needed.

### 2. Run in development mode (hot reload)
```bash
npm run dev
```
Then open **http://localhost:3000** in your browser.
- Code changes reload instantly
- The SQLite database is created automatically at `data/phones.db` on first search

### 3. Run in production mode (faster, no hot reload)
```bash
npm run build
npm run start
```
Then open **http://localhost:3000**.

### 4. Optional configuration
```bash
copy .env.example .env        # Windows
# cp .env.example .env        # macOS/Linux
```
Everything works with **no keys at all**. The `.env` only tunes things:
```env
TTL_SPECS_HOURS=168        # cache: specs valid for 7 days
TTL_PRICE_HOURS=12         # cache: prices valid for 12 hours
WEB_RESEARCH_ENABLED=true  # enable the web fallback provider
GSMARENA_API_BASE=         # optional community API (not required)
```

### 5. First test
1. Open http://localhost:3000
2. Type `realme 8` — live suggestions appear with photos
3. Click **Realme 8** → the full phone page loads with specs, prices, gallery, 3D view, tests and benchmarks
4. Open http://localhost:3000/admin to see providers, logs and imports

### Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE :3000` | Port taken — run `npm run start -- -p 3001` or kill the other process |
| `ENOSPC: no space left on device` | Free up disk space (builds need a few GB of temp space) |
| Search returns "could not verify" | The phone may not exist, or all sources were unreachable — check `/admin` → recent provider requests for errors |
| `better-sqlite3` install error | `npm install better-sqlite3 --force` or update Node to a current LTS |
| Data looks stale | Click **⟳ Refresh data** on the phone page, or `POST /api/phones/refresh` |
| Start from scratch | Delete `data/phones.db` and search again (everything re-fetches live) |

> The SQLite DB lives in `data/phones.db` — delete it anytime for a clean slate; everything re-captures automatically from the live sources.

---

## 🏗️ Architecture

```
src/
├── app/
│   ├── page.tsx                      # Home + live AJAX search
│   ├── phone/[slug]/page.tsx         # Phone detail page (server-rendered)
│   ├── admin/page.tsx                # Provider management UI
│   └── api/
│       ├── phones/search/route.ts    # Full discovery pipeline (?q= &gsm=)
│       ├── phones/[id]/route.ts      # Full record (specs, media, prices…)
│       ├── phones/[id]/refresh/route.ts
│       ├── phones/refresh/route.ts   # Refresh all / by query
│       ├── suggest/route.ts          # Live search suggestions
│       ├── import/route.ts           # Open dataset import (JSON/CSV/XML)
│       └── admin/providers/route.ts  # Provider config, logs, conflicts
├── components/
│   ├── SearchBar.tsx                 # Debounced live suggestions + staged loading
│   ├── PhoneViewer3D.tsx             # CSS-3D phone + official Binkies 3D embed
│   ├── GalleryGrid.tsx               # Gallery with official/hands-on grouping
│   ├── Lightbox.tsx                  # Fullscreen image viewer (← → Esc keys)
│   ├── Tilt3D.tsx                    # Pointer-tracked 3D tilt wrapper
│   ├── Reveal.tsx                    # Scroll-reveal (IntersectionObserver)
│   ├── ScrollProgress.tsx            # Gradient scroll progress bar
│   └── source-ui.tsx                 # Field rows, confidence badges, source panel
└── lib/
    ├── aggregator.ts                 # ⭐ The pipeline: cache → providers → merge → store
    ├── providers/
    │   ├── gsmarena-mobile.ts        # ⭐ GSMArena: index search + full page capture
    │   ├── wikipedia.ts              # MediaWiki API infobox parser
    │   ├── wikidata.ts               # Structured open data (CC0)
    │   ├── opendataset.ts            # JSON/CSV/XML datasets with field mapping
    │   ├── gsmarena.ts               # Optional community API adapter
    │   ├── websearch.ts              # DuckDuckGo→Bing research fallback
    │   └── base.ts                   # Shared helpers
    ├── fetch-compliance.ts           # Rate limiting + robots.txt enforcement
    ├── cache.ts                      # TTL-based freshness
    ├── db.ts                         # SQLite schema
    └── types.ts                      # Universal extensible schema
```

---

## 🔍 The discovery pipeline

`src/lib/aggregator.ts` — `resolvePhone()`:

1. **Exact identity** — if the request carries a GSMArena slug (`?gsm=realme_8-10810`, from a suggestion click), that exact device is fetched. No fuzzy matching can interfere.
2. **Cache first** — fresh data (configurable TTLs) is returned instantly.
3. **Providers in priority order** — if one lacks the phone, the next is tried:

| Priority | Provider | Source | Notes |
|---|---|---|---|
| 5 | `gsmarena_mobile` | m.gsmarena.com | Full capture: specs, prices, media, 3D |
| 10 | `gsmarena_community` | Optional API | Enable via `GSMARENA_API_BASE` |
| 15 | `wikipedia` | MediaWiki API | Infobox parser, strict title identity guard |
| 20 | `wikidata` | Wikidata API | Structured claims (CC0) |
| 30 | `open_dataset` | Your datasets | JSON/CSV/XML + field mapping |
| 90 | `web_search` | DuckDuckGo/Bing | Heuristic fallback, always `estimated` |

4. **Merge** — higher confidence wins; disagreements are recorded in a `conflicts` table (visible in `/admin`).
5. **Store** — every field saved with value + unit + confidence + source + source URL + retrieval time, plus full update history.

---

## 📡 GSMArena mobile provider (the primary source)

Keyless, robots.txt-compliant (device pages and the used endpoints are not disallowed):

| What | How |
|---|---|
| **Search** | Public autocomplete index (`quicksearch-*.jpg`): a JSON catalog of every device `[brandId, id, name, keywords, image]`, cached 24h. Fuzzy token + compact matching ("gt 8" ≈ "GT8"). Every query token is mandatory — "iPhone 30 Ultra Max" can never match "Edge 30 Ultra". |
| **Specs** | Device pages expose their full table via `data-spec` attributes — **every row** is captured (including rows without `data-spec`, like Loudspeaker and EU label), grouped by the original section headers. |
| **Prices** | The embedded pricing widget + the dedicated `-price-<id>.php` page → per-country offers (variant, retailer, currency, price, link). |
| **Images** | Pictures page → official renders (`/vv/pics/`) and hands-on photos, all captured. |
| **3D model** | Binkies 3D integration id + color swatch content-ids, replicated exactly (see below). |
| **News & reviews** | Live `search-json.php3` with brand-aware fallback terms. |

---

## 🧊 3D view

Two layers:

1. **CSS-3D phone (always works)** — the official product image inside a 3D frame: drag to rotate (pointer + touch), idle auto-spin, floating animation, glare, side buttons, pulsing floor shadow. Colorway chips tint the device.
2. **Official Binkies 3D model** — when GSMArena exposes one, the integration is replicated *exactly*: same `<script>` tags, same `swatchClicked()` / `load3D()` functions, same `binkies-container-waiting-on-click` → `binkies-container` id flip that triggers their loader, same swatch DOM. Styled to match (pill swatches, light stage).
   > Note: Binkies locks models to licensed domains server-side. On other domains the canvas may stay empty — the CSS-3D phone always works.

---

## 🚫 No-fake-data guarantees (Requirement #12)

- Missing values render as **"Not available"** — never invented.
- **No placeholder sections**: Benchmarks, Gaming, Prices only render when real sourced data exists.
- Web-research heuristics are tagged `estimated` / `multiple_sources`, never `official`/`verified`.
- **Identity guards everywhere**:
  - GSMArena index: every query token must be found (word-boundary + compact matching)
  - Wikipedia: article title must contain model-number tokens (word-bounded — "30" never matches "300")
  - Web research: all tokens must appear on the page + brand-adjacency checks
- **Variant guard**: matching a family article (e.g. "Galaxy S25" for "S25 Ultra") downgrades fields to `estimated` with an explanatory note.
- A record is only created if at least one **authoritative provider confirmed the device exists** — fictional phones return **404**.
- Unit-bound number parsing (a model number like "S25" can never become "25 GB").

## 🏷️ Confidence levels

`official` · `verified` · `multiple_sources` · `estimated` · `user_submitted` · `unavailable`

Every field shows a badge, clickable source link and retrieval date. The **Data Sources** panel at the bottom of each phone page summarizes all sources used (requirement #16).

---

## 🧪 Sections on a phone page

| Section | Content |
|---|---|
| Hero | Image (3D tilt), colorways, RAM/storage variants, quick-highlight cards |
| 🧊 3D view | Drag-rotate phone + official Binkies model when available |
| Spec cards | Curated overview (display, performance, battery…) |
| 📋 Full specification sheet | **Every** captured row, grouped by original section |
| 🧪 Tests & endurance ratings | EU label: energy class, battery endurance, free fall, repairability |
| 🏁 Benchmarks | GSMArena "Our Tests": AnTuTu, GeekBench, GFXBench, display brightness, loudspeaker — real measured scores |
| 💰 Prices | Per-country best offers with retailer links |
| 🖼️ Photo gallery | Official + hands-on images with fullscreen lightbox (← → Esc) |
| 📰 News / 📝 Reviews | Live-related articles with thumbnails |

---

## 🛠️ Admin panel (`/admin`)

- Enable/disable providers, set priority and rate limits
- Configure env-var names for keyed providers (keys **never** stored in the DB or exposed to the frontend)
- View failed requests, source conflicts
- Refresh all phones or trigger imports

### Open dataset import (requirement #14)

Upload JSON/CSV/XML with a field mapping:

```json
{ "external_name": "general.model", "brand": "general.brand", "battery_capacity": "battery.capacity" }
```

Datasets are stored in `data/datasets/` and registered in `data/datasets.json`; the `open_dataset` provider serves them during live lookups.

---

## ⚖️ Legal & robot compliance (Requirement #13)

- Per-provider token-bucket **rate limits** (admin-configurable)
- **robots.txt** fetched, cached and enforced for page scraping — fail-closed on unknown hosts
- The MediaWiki Action API is exempted (`apiExempt`) because the Wikimedia Foundation provides it explicitly for programmatic access; this never applies to ordinary page scraping
- No CAPTCHA/auth/paywall bypassing. Unconfigured providers are simply skipped.

## 💾 Caching (Requirement #10)

| Category | Default TTL | Env var |
|---|---|---|
| Specs | 7 days | `TTL_SPECS_HOURS` |
| Benchmarks | 7 days | `TTL_BENCHMARK_HOURS` |
| Prices | 12 hours | `TTL_PRICE_HOURS` |
| Release info | 30 days | `TTL_RELEASE_HOURS` |

Plus an in-flight request deduplicator so concurrent identical lookups hit providers once.

## 🗄️ Database (SQLite, `data/phones.db`)

`phones` · `fields` (EAV with JSON values — supports any future spec) · `variants` · `benchmarks` · `gaming_results` · `prices` · `media` (news/reviews/gallery/3D) · `update_history` · `providers` · `provider_logs` · `conflicts`

## 🔌 API reference

| Endpoint | Description |
|---|---|
| `GET /api/suggest?q=` | Live search suggestions |
| `GET /api/phones/search?q=…[&gsm=slug]` | Full discovery pipeline |
| `GET /api/phones` | List cached phones |
| `GET /api/phones/[idOrSlug]` | Full record + benchmarks + prices + media + history |
| `POST /api/phones/[idOrSlug]/refresh` | Re-query providers, keep history |
| `POST /api/phones/refresh[?q=]` | Refresh all / one |
| `POST /api/import` | Import dataset (multipart) |
| `GET/PUT /api/admin/providers` | Provider management |

## 🎨 UI/UX

- **Mobile-first**: ≥16px inputs (no iOS zoom), 44px touch targets, visible focus rings, scrollable tables
- **Animated**: scroll-progress bar, IntersectionObserver reveals, ambient drifting orbs, staged search loading, skeleton shimmer, 3D tilt cards
- **Accessible**: `aria` labels/roles, `prefers-reduced-motion` support, keyboard navigation (suggestions ↑↓ Enter Esc, lightbox ←→ Esc)
- Design guidance from the `ui-ux-pro-max` and `scroll-experience` skills (`.claude/skills/`)

## 🧰 Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · better-sqlite3 · papaparse + fast-xml-parser (imports)

## 📜 License & data attribution

Device data © GSMArena (linked, not rehosted), Wikipedia/Wikidata (CC BY-SA / CC0), EU label data as published by manufacturers. This project links to sources and always attributes them; it stores captured facts with provenance for personal/non-commercial use — respect each source's terms when deploying publicly.
