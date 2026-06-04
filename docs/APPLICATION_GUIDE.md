# Mr. Chartist Terminal — Application Guide

**Mr. Chartist Terminal** (also known as *India's Best Option Hub*) is a browser-based **Options & Futures analytics terminal** for the Indian stock market (NSE F&O). It runs locally on your machine, connects to live market data through a local proxy server, and provides dashboards, scanners, option chain tools, strategy analysis, and position tracking — without executing trades.

This document describes **what the application does**, **every major feature**, and **how each feature works in detail**.

---

## Table of Contents

1. [Application Overview](#1-application-overview)
2. [Architecture & Data Flow](#2-architecture--data-flow)
3. [Data Sources](#3-data-sources)
4. [Pages & Features](#4-pages--features)
   - [Dashboard](#41-dashboard-)
   - [Option Chain](#42-option-chain-option-chain)
   - [OI Analysis](#43-oi-analysis-oi-analysis)
   - [TA Scanner](#44-ta-scanner-ta-scanner)
   - [3-Candle Scanner](#45-3-candle-scanner-three-candle-scanner)
   - [Algo Strategy Scanner](#46-algo-strategy-scanner-strategy-scanner)
   - [F&O Intelligence](#47-fo-intelligence-fno-intelligence)
   - [Watchlist](#48-watchlist-watchlist)
   - [Strategy Builder](#49-strategy-builder-strategy-builder)
   - [Position Tracker](#410-position-tracker-position-tracker)
   - [Broker Settings](#411-broker-settings-broker-settings)
5. [Shared Components & Tools](#5-shared-components--tools)
   - [Stock Chart (TA Chart)](#51-stock-chart-ta-chart)
   - [Technical Analysis Engine](#52-technical-analysis-engine)
   - [Alert System](#53-alert-system)
   - [Command Palette](#54-command-palette)
   - [Local Database & Chart Downloader](#55-local-database--chart-downloader)
6. [Backend API (Python Proxy)](#6-backend-api-python-proxy)
7. [Keyboard Shortcuts](#7-keyboard-shortcuts)
8. [Configuration & Setup](#8-configuration--setup)
9. [Rules & Thresholds Reference](#9-rules--thresholds-reference)
10. [Known Limitations](#10-known-limitations)
11. [Related Documentation](#11-related-documentation)
12. [Disclaimer](#12-disclaimer)

---

## 1. Application Overview

| Property | Detail |
|----------|--------|
| **Name** | Mr. Chartist Terminal / Options Terminal |
| **Purpose** | F&O analytics, scanning, OI analysis, strategy planning, and portfolio tracking |
| **Market** | NSE F&O (indices + ~150+ F&O stocks), some MCX references on dashboard |
| **Frontend** | React 18 + TypeScript + Vite (port **4001**) |
| **Proxy** | Node.js (`proxy-server.mjs`) or Python (`proxy_server/`) on port **4002** |
| **Trade execution** | **No** — analytics and planning only |
| **Storage** | Browser localStorage + IndexedDB (watchlist, positions, broker keys, candle cache) |

### What problems it solves

- **Manual stock hunting** — F&O Intelligence and scanners automatically surface movers and setups across the F&O universe.
- **Systematic algo rules** — Algo Strategy Scanner implements BTST/STBT, multi-day Soldiers/CRT, and ORB+VWAP+Supertrend from the quantitative framework.
- **Option chain complexity** — Full strike-wise CE/PE data with OI, IV, Greeks, and unusual activity flags.
- **OI interpretation** — Deep open-interest analytics (max pain, PCR, heatmaps, buildup/unwinding signals).
- **Pre-trade planning** — Strategy Builder payoff charts and Position Tracker P&L simulation before risking capital.
- **Technical context** — Charts with VWAP, RSI, MACD, patterns, and multi-timeframe intervals.

---

## 2. Architecture & Data Flow

```
┌─────────────────┐     HTTP/WS      ┌──────────────────┐     API calls     ┌─────────────┐
│  React Browser  │ ◄──────────────► │  Local Proxy     │ ◄───────────────► │ Upstox API  │
│  (port 4001)    │                  │  (port 4002)     │                   │ (primary)   │
└─────────────────┘                  └──────────────────┘                   └─────────────┘
                                              │
                                              ├──► NSE India (fallback)
                                              ├──► TradingView scanner (fallback)
                                              ├──► Live scanner engine (Python)
                                              ├──► EOD playbook generator (Python)
                                              └──► Client-side algo strategy scanner (React)
                                                   BTST · Soldiers/CRT · ORB+VWAP+ST
```

1. The **React app** sends API requests to the **local proxy** (never directly to Upstox/NSE from the browser — avoids CORS and keeps keys local).
2. The proxy **caches** responses (typically 3–30 seconds) to reduce rate limits.
3. **Live data** flows via Upstox Market Quote API and WebSocket relay when credentials are configured.
4. **F&O Intelligence** runs a background polling loop in the Python proxy that maintains per-symbol rolling state (price, volume, VWAP).
5. **Algo Strategy Scanner** runs in the browser — fetches daily/intraday candles via the proxy and evaluates BTST, multi-day, and ORB rules client-side.
6. **User data** (watchlist, positions, broker keys) stays in the browser — not sent to external servers.

### Running the app

| Command | What it starts |
|---------|----------------|
| `npm run dev` | Vite frontend + Node proxy |
| `npm run dev:python` | Vite frontend + Python proxy (recommended for TA, scanners, F&O Intelligence, live momentum) |
| `npm run dev:vite` | Frontend only (limited live data) |

---

## 3. Data Sources

The terminal uses a **priority fallback chain**:

```
Upstox API (1st) → NSE India (2nd) → TradingView (3rd)
```

| Source | Provides | Auth required | Latency |
|--------|----------|---------------|---------|
| **Upstox API** | Option chain, Greeks, expiries, historical OHLCV, live LTP | Yes (OAuth token) | Real-time |
| **NSE India** | Indices, sectors, advance/decline, option chain fallback | No | ~3–5 sec |
| **TradingView** | F&O stock prices, volume, sector data | No | ~15–30 sec |
| **WebSocket relay** | Index LTP, India VIX ticks | Upstox token preferred | Real-time |

The **Data Sources Bar** on the dashboard shows live connection status for each pipeline. Hover over indicators for tick counts, cache age, and connection details.

---

## 4. Pages & Features

| Page | Route | Shortcut | Description |
|------|-------|----------|-------------|
| Dashboard | `/` | ⌘1 | Market overview widgets |
| Option Chain | `/option-chain` | ⌘2 | Full CE/PE chain |
| OI Analysis | `/oi-analysis` | ⌘3 | Open interest analytics |
| Watchlist | `/watchlist` | ⌘4 | Saved symbols |
| Strategy Builder | `/strategy-builder` | ⌘5 | Payoff diagrams |
| Position Tracker | `/position-tracker` | ⌘6 | Manual P&L tracking |
| TA Scanner | `/ta-scanner` | ⌘7 | RSI/MACD/ADX screen |
| 3-Candle Scanner | `/three-candle-scanner` | ⌘8 | Conviction/consolidation/breakout |
| **Algo Strategies** | `/strategy-scanner` | **⌘0** | BTST · Soldiers/CRT · ORB |
| **F&O Intelligence** | `/fno-intelligence` | ⌘9 | Live movers + next-day playbook |
| Broker Settings | `/broker-settings` | — | API keys & data health |

Legacy alias: `/live-scanner` → F&O Intelligence.

---

### 4.1 Dashboard (`/`)

**Purpose:** Central market overview — everything important at a glance during the trading session.

**Route:** `/`  
**Keyboard shortcut:** `⌘1` / `Ctrl+1`

#### Sections (top to bottom)

| Section | What it does |
|---------|--------------|
| **Market Header** | Shows market open/closed status (NSE hours: Mon–Fri, 9:15 AM – 3:30 PM IST). |
| **Ticker Tape** | Scrolling strip of live index and key symbol prices. |
| **Index Cards** | NIFTY 50, BANK NIFTY, FIN NIFTY, MIDCAP NIFTY with LTP, change %, and intraday mini sparkline. Click any card → opens Option Chain for that symbol. |
| **Data Sources Bar** | Real-time health of Upstox, WebSocket, NSE, TradingView, and VIX feeds. |
| **Key Metrics** | PCR (Put-Call Ratio), India VIX, Max Pain for NIFTY and BANKNIFTY. PCR > 1 suggests bullish positioning; < 0.7 bearish. |
| **F&O Intelligence Widget** | Compact live view: bullish/bearish signal counts, top mover from each side, link to full hub. Polls every ~2.5s during market hours. |
| **Technical Snapshot** | Row of TA cards (RSI, ADX, ATR, MACD, trend) for major indices via TA-Lib-style computation. Click → chart with overlays. |
| **Expected Move** | Probable price range for NIFTY/BANKNIFTY before expiry based on current IV and days to expiry. |
| **IV Rank Cards** | IV Rank per symbol — high rank (>70) favors selling premium; low rank (<30) favors buying premium. |
| **Expiry & Derivatives** | GIFT Nifty indicative direction, nearest expiry countdown for NSE/MCX contracts. |
| **Top Movers** | Today's biggest F&O gainers and losers. Click row → Option Chain. |
| **Futures & VIX** | Futures premium/discount vs spot (sentiment) and 30-day VIX trend chart. |
| **IV Rank Scanner** | Multi-symbol IV rank table with buy/sell premium signals. |
| **Sector Performance** | Color-coded heatmap — green sectors up, red down; intensity = magnitude. |
| **Most Active F&O** | Highest volume/OI activity with interpretation labels: Long Buildup, Short Buildup, Short Covering, Long Unwinding. |
| **Market Breadth** | Composite sentiment score (0–100), advance/decline ratio, VIX regime, F&O breadth. |

**Refresh behavior:** Widgets auto-refresh during market hours via React Query (intervals vary per data type, typically 3–30 seconds).

---

### 4.2 Option Chain (`/option-chain`)

**Purpose:** Full interactive option chain for any F&O symbol — the core derivatives data view.

**Route:** `/option-chain` (optional `?symbol=NIFTY`)  
**Keyboard shortcut:** `⌘2` / `Ctrl+2`

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Symbol picker** | Search and browse 150+ symbols organized by category (Indices, Nifty 50, Banking, IT, Pharma, Auto, Metals, etc.). |
| **Expiry selection** | Switch between available weekly/monthly expiries. |
| **View modes** | **By expiration** (standard chain) or **By strike** (multi-expiry comparison per strike). |
| **Column toggles** | Show/hide IV, Delta, Gamma, Theta, Vega, Bid/Ask, Volume, OI, OI Change, Intrinsic/Time Value. |
| **ATM highlighting** | At-the-money strike auto-detected and highlighted; sticky ATM bar while scrolling. |
| **Max Pain** | Strike with minimum total option writer loss highlighted. |
| **Unusual activity** | Flags strikes where volume > **3× average OI** AND volume > **50,000**. |
| **PCR header** | Aggregate put-call ratio with bullish/bearish coloring. |
| **Context menu** | Right-click strike → Buy/Sell CE/PE, straddle, set alert, open strategy builder. |
| **Inline chart** | Embedded Stock Chart with TA overlays for the selected symbol. |
| **CSV export** | Download current chain data. |
| **Past expiry download** | Fetch historical option chain via Upstox (requires token). |
| **Keyboard navigation** | J/K row navigation, G to jump to ATM. |
| **After-hours mode** | Shows last cached snapshot when market is closed. |

#### Data & refresh

- Primary: Upstox option chain API via proxy.
- Fallback: NSE option chain.
- Live refresh: **every 3 seconds** during market hours; **every 2 minutes** after hours.

#### Important notes

- **By-strike multi-expiry view** uses approximation factors for non-active expiries (not live multi-expiry API for every cell).
- ATM strike = `round(spot / stepSize) × stepSize`.

---

### 4.3 OI Analysis (`/oi-analysis`)

**Purpose:** Deep open-interest analytics to understand where writers and buyers are positioned.

**Route:** `/oi-analysis`  
**Keyboard shortcut:** `⌘3` / `Ctrl+3`

#### Summary cards

- **Max Pain** — strike where option sellers face minimum payout at expiry.
- **PCR** — aggregate put-call ratio with signal label.
- **Total CE/PE OI** and **OI Change** — directional positioning shift.

#### Analysis modules

| Module | What it shows |
|--------|---------------|
| **ATM Zone** | Concentrated OI and activity within 5 or 10 strikes around ATM. |
| **OI Heatmap** | Visual grid of OI intensity by strike. |
| **Support / Resistance** | Strikes with heavy put OI (support) and call OI (resistance). |
| **Multi-Expiry OI** | Weekly vs monthly OI context. |
| **IV Percentile Gauge** | Current IV vs historical range with smile chart. |

#### Analysis tabs (10 tabs)

| Tab | Description |
|-----|-------------|
| **Delta OI** | Directional exposure (delta-weighted OI) at each strike. |
| **Strike PCR** | Put-call ratio per strike — >1 put-heavy (support), <1 call-heavy (resistance). |
| **OI Correlation** | Relationship between OI, OI change, and volume. |
| **OI Distribution** | Where call vs put writers are concentrated. |
| **OI Change** | Strike-wise change in open interest. |
| **Multi-Expiry** | Weekly vs monthly OI comparison. |
| **IV Smile** | Implied volatility skew across strikes. |
| **PCR Trend** | Live PCR gauge with OI breakdown. |
| **OI Interpretation** | Buildup, unwinding, short covering, long unwinding labels. |
| **Top Strikes** | Highest call and put OI strikes. |

#### PCR signal thresholds

| PCR value | Signal |
|-----------|--------|
| > 1.3 | Strong Bullish |
| > 1.0 | Bullish |
| > 0.7 | Neutral |
| > 0.5 | Bearish |
| ≤ 0.5 | Strong Bearish |

#### Chart filters

- OI distribution: show strikes with OI > **50,000**
- OI change: show changes > **5,000**
- OI interpretation: show strikes with OI > **100,000**

**Refresh:** Auto every **3 seconds** when market is live.

---

### 4.4 TA Scanner (`/ta-scanner`)

**Purpose:** Screen the F&O universe for technical indicator setups (RSI, MACD, ADX, trend).

**Route:** `/ta-scanner`  
**Keyboard shortcut:** `⌘7` / `Ctrl+7`

#### How it works

1. Fetches TA snapshot for F&O symbols via `/api/ta/scanner` (server-side, TA-Lib compatible).
2. Falls back to client-side scan (up to **25 symbols**) if server unavailable.
3. Displays filterable table: symbol, LTP, change %, RSI, ADX, MACD, composite signal.
4. Click any row → Option Chain for that symbol.

#### Filter rules

| Filter | Condition |
|--------|-----------|
| RSI overbought | RSI > **70** |
| RSI oversold | RSI < **30** |
| MACD bullish/bearish | MACD line vs signal line |
| Trending | ADX > **25** |

#### Composite signal logic

- **Overbought/Oversold** from RSI extremes.
- **Bullish/Bearish + Trend** when MACD direction aligns and ADX > 25.

**Default indicator periods:** RSI 14, MACD 12/26/9, ADX 14, EMA 20, SMA 50.  
**Cache stale time:** 5 minutes.

---

### 4.5 3-Candle Scanner (`/three-candle-scanner`)

**Purpose:** Daily pattern scanner based on a **3-candle rule** — conviction → consolidation → breakout.

**Route:** `/three-candle-scanner`  
**Keyboard shortcut:** `⌘8` / `Ctrl+8`

#### Pattern logic

**Bullish setup (3-day rule):**

1. **Day 1 (conviction):** Strong bullish candle — close near high (within **15%** of candle range from high).
2. **Day 2 (consolidation):** Inside day — high < D1 high AND low > D1 midpoint.
3. **Day 3 (breakout):** Close above D1 high (confirmed) or intraday break above D1 high (triggered).

**Bearish setup:** Mirror logic — D1 close near low, D2 inside D1, D3 break below D1 low.

#### Stages

| Stage | Meaning |
|-------|---------|
| **Setup** | D1 + D2 pattern formed; waiting for D3 break. |
| **Triggered** | Intraday price broke entry level. |
| **Confirmed** | D3 closed beyond breakout level. |

#### Display

- Entry, stop-loss, D1 high/low, D3 levels.
- Filters: Popular (15 symbols) / All F&O / Bullish only / Bearish only.
- Stage filter: all / confirmed / triggered / setup.

**Data source:** Daily OHLCV candles via Upstox historical API.

> **Note:** This scanner uses a **conviction → consolidation → breakout** rule (D1 near high/low, D2 inside day, D3 break). For **Three White Soldiers / Black Crows** and **Candle Range Theory (CRT)**, use the [Algo Strategy Scanner](#46-algo-strategy-scanner-strategy-scanner) Multi-Day tab instead.

---

### 4.6 Algo Strategy Scanner (`/strategy-scanner`)

**Purpose:** Automated scanners implementing the three strategic horizons from the [Indian F&O Trading Strategy Generation](./Indian%20F%26O%20Trading%20Strategy%20Generation.md) quantitative framework — overnight momentum, multi-day continuation, and intraday precision.

**Route:** `/strategy-scanner`  
**Keyboard shortcut:** `⌘0` / `Ctrl+0`  
**Code:** `src/lib/fnoStrategies.ts` · **Tests:** `src/lib/fnoStrategies.test.ts` · **Summary:** [Strategy.md](./Strategy.md)

Analytics only — **no broker order execution** (NRML/MIS product types are shown as guidance).

#### Universe

- **Popular F&O** — ~15 indices + liquid names (fast scan)
- **All F&O** — full NSE F&O list from Upstox instrument master (slower)

Click any row → Option Chain for that symbol.

---

#### Tab 1: BTST / STBT (Strategy I — Next-Day Directional Bias)

Captures **overnight momentum** — buy/sell today, exit next session. Evaluated best **3:00–3:30 PM IST**. Product: **NRML**.

##### Bullish BTST (Buy Today, Sell Tomorrow)

| Condition | Rule |
|-----------|------|
| Previous day (T-1) | Red candle with **small body** (< 10-day rolling average body size) |
| Current day (T) | **Strong green** candle (body ≥ rolling average) |
| Price confirmation | Close(T) **>** High(T-1) |
| Volume | Volume(T) **>** Volume(T-1) |

##### Bearish STBT (Sell Today, Buy Tomorrow)

| Condition | Rule |
|-----------|------|
| Previous day (T-1) | Green candle with **small body** |
| Current day (T) | **Strong red** candle |
| Price confirmation | Close(T) **<** Low(T-1) |
| Volume | Volume expansion vs T-1 |

**Live evaluation:** Combines daily history with **today's intraday 5m candles** aggregated into a virtual daily bar before market close.

**Refresh:** Auto every **2 minutes** when tab is active.

---

#### Tab 2: Multi-Day (Strategy II — Soldiers / CRT)

Multi-session trend continuation patterns. Hold target: **2–3 sessions**. Product: **NRML**.

| Pattern | Logic | Bias |
|---------|-------|------|
| **Three White Soldiers** | 3 consecutive green candles; each opens inside prior body; each closes higher; small upper wicks (≤25% of range) | Bullish |
| **Three Black Crows** | 3 consecutive red candles; mirror geometry; small lower wicks | Bearish |
| **CRT Bullish** | C1 establishes range → C2 sweeps **below** C1 low (liquidity grab) → C3 closes **back inside** C1 range (green) | Bullish |
| **CRT Bearish** | C1 range → C2 sweeps **above** C1 high → C3 closes back inside range (red) | Bearish |

**CRT** (Candle Range Theory) follows the AMD cycle: Accumulation (C1 range) → Manipulation (C2 sweep) → Distribution (C3 reversal toward opposite extreme).

Output per match: entry, stop-loss, target, hold period, action text.

**Refresh:** Manual or on page load; stale time **5 minutes**.

---

#### Tab 3: ORB + VWAP + Supertrend (Strategy III — Intraday Precision)

High-selectivity intraday entries after the opening range. Product: **MIS**. Uses **5-minute** intraday candles.

##### Opening range

- Window: **09:15–09:45 IST**
- ORB High = max high in window; ORB Low = min low in window
- Signals only valid **after 09:45**

##### Long signal (all required)

| Check | Rule |
|-------|------|
| ORB break | Close **>** ORB High |
| VWAP filter | Close **>** session VWAP |
| Supertrend | Direction **bullish** (green) |

##### Short signal (all required)

| Check | Rule |
|-------|------|
| ORB break | Close **<** ORB Low |
| VWAP filter | Close **<** session VWAP |
| Supertrend | Direction **bearish** (red) |

##### Watch states

Partial alignment (ORB break + VWAP **or** Supertrend) → **Watch Long / Watch Short** until all three confirm.

##### Exit rule

**Supertrend flip** — when direction reverses, treat as trailing stop exit (ATR-based, not fixed %).

##### Supertrend parameters

- ATR period: **10**
- Multiplier: **3**

**Refresh:** Auto every **60 seconds** when tab is active.

---

### 4.7 F&O Intelligence (`/fno-intelligence`)

**Purpose:** **Automated F&O scanning** — no manual stock hunting. Surfaces live movers during the session and generates a **next-day playbook** after market close.

**Route:** `/fno-intelligence` (alias: `/live-scanner`)  
**Keyboard shortcut:** `⌘9` / `Ctrl+9`

This is the unified intelligence hub replacing the older Live Momentum Scanner page.

---

#### Tab 1: Live Movers

Continuously scans the **full F&O universe** (~2s LTP polling via Python proxy).

##### Bullish signal (4/4 criteria)

| Rule | Threshold |
|------|-----------|
| 15-second price move | ≥ **+0.4%** |
| 1-minute price move | ≥ **+0.8%** |
| Volume spike | Current minute volume > **3×** 20-minute average (min 5 bars for baseline) |
| VWAP position | Price **above** session VWAP |

##### Bearish signal (4/4 criteria)

Same rules mirrored for downside: ≤ **−0.4%** (15s), ≤ **−0.8%** (1m), volume spike, price **below** VWAP.

##### Watch lists

Stocks scoring **2–3 of 4** criteria — building momentum before a full signal fires.

##### UI sections

- **Bullish signals** — full 4/4 long setups.
- **Bearish signals** — full 4/4 short setups.
- **Watch — long** — 2–3/4 bullish criteria.
- **Watch — short** — 2–3/4 bearish criteria.

Click any row → Option Chain for that symbol.

##### Technical notes

- **15s moves** are approximated from ~2s LTP polls (Upstox minimum candle interval is 1 minute).
- Scanner needs ~**15 seconds** after startup to accumulate 15s history (“warming up”).
- Volume baselines are seeded from 1-minute historical data + live minute buckets.

**Refresh:** Auto every **2.5 seconds** when market is open; **30 seconds** after hours.

---

#### Tab 2: Next-Day Playbook

End-of-day analysis that produces trade ideas for the **next session**.

##### How playbook rows are scored

Each symbol's intraday 1-minute candles are analyzed. Scoring factors:

| Factor | Long +1 | Short +1 |
|--------|---------|----------|
| Close vs session VWAP | Close above VWAP | Close below VWAP |
| Day change | ≥ **+0.6%** | ≤ **−0.6%** |
| Intraday trend (EMA) | Uptrend | Downtrend |
| MACD | Bullish | Bearish |
| Close position in day range | Upper third (≥ **72%**) | Lower third (≤ **28%**) |
| RSI | > **60** | < **40** |

##### Bias assignment

| Condition | Bias | Confidence |
|-----------|------|------------|
| `scoreLong ≥ scoreShort + 2` and score ≥ 4 | **LONG** | High |
| `scoreLong ≥ scoreShort + 2` | **LONG** | Medium |
| `scoreShort ≥ scoreLong + 2` and score ≥ 4 | **SHORT** | High |
| `scoreShort ≥ scoreLong + 2` | **SHORT** | Medium |
| Otherwise | **RANGE** | Low |

##### Output per stock

- Bias (LONG / SHORT / RANGE)
- Confidence (high / medium / low)
- Close price and day change %
- **Trigger Up / Trigger Down** — levels to watch next session
- Stop-loss suggestion
- Plain-English **action plan**
- Reasons list (why the bias was assigned)

##### Generation & caching

- Manual: click **Generate / refresh playbook**.
- Automatic: after **3:45 PM IST** if no cache exists for the day.
- Cached in memory + `.cache/fno-playbook-{date}.json` on disk.
- Default universe: **popular** (~46 liquid F&O names) for speed; live scanner uses **all** F&O symbols.

**API:** `GET /api/fno-intelligence/playbook?generate=1&universe=popular`

---

### 4.8 Watchlist (`/watchlist`)

**Purpose:** Personal symbol tracker for quick access to favorites.

**Route:** `/watchlist`  
**Keyboard shortcut:** `⌘4` / `Ctrl+4`

#### Features

- Add/remove F&O symbols from searchable list.
- Live LTP, change %, day high/low range visualization.
- Mini intraday sparkline per symbol.
- Expand to full **Stock Chart** in a side sheet.
- Jump to Option Chain.
- Summary row: count of stocks up/down, average change %.

**Storage:** Browser `localStorage` (`optionsdesk_watchlist`). Default list includes 15 popular F&O names.

---

### 4.9 Strategy Builder (`/strategy-builder`)

**Purpose:** Build multi-leg option strategies and visualize payoff before trading.

**Route:** `/strategy-builder`  
**Keyboard shortcut:** `⌘5` / `Ctrl+5`

#### Pre-built strategies

Long/Short Straddle, Strangle, Bull Call Spread, Bear Put Spread, Iron Condor, Butterfly, Collar, and more.

#### Custom legs

Each leg: CE/PE, BUY/SELL, strike, lots, premium.

#### Analytics displayed

| Metric | Description |
|--------|-------------|
| **Payoff chart** | P&L at expiry across spot prices (ATM ± 25 steps). |
| **Max profit / Max loss** | Strategy bounds. |
| **Breakeven(s)** | Spot levels where P&L = 0. |
| **Net premium** | Total debit/credit. |
| **Margin estimate** | Approximate margin requirement. |
| **Probability of profit** | Estimated from IV/DTE assumptions. |
| **Aggregate Greeks** | Net delta, theta, vega. |
| **Multi-DTE view** | Payoff at different days-to-expiry (`PayoffMultiDTE`). |

#### Deep linking

Option Chain context menu can send strike/type/action via URL params — Strategy Builder pre-fills a single leg.

#### Important note

Premiums and Greeks use **model estimates** (Black-Scholes-style), not live option chain prices. DTE defaults: **14 days** for payoff, **7 days** for Greeks.

---

### 4.10 Position Tracker (`/position-tracker`)

**Purpose:** Manual portfolio tracking for F&O positions with P&L and scenario analysis.

**Route:** `/position-tracker`  
**Keyboard shortcut:** `⌘6` / `Ctrl+6`

#### Features

| Feature | Detail |
|---------|--------|
| **Add / edit / close positions** | Manual entry — no broker sync. |
| **Grouped by symbol** | Positions organized per underlying. |
| **Inline CMP edit** | Update current market price and lots. |
| **Aggregate stats** | Total P&L, delta, theta, vega, margin, win rate. |
| **P&L simulator** | What-if P&L if spot moves ±**5%**. |
| **Greeks decay chart** | Theta decay projection over 7 days. |
| **Closed history** | Past closed positions. |
| **Import / export** | JSON backup of positions. |
| **What-If Simulator** | Advanced scenario testing component. |

**Storage:** Browser `localStorage` via `positionStore.ts`.  
**Margin estimate (sell):** entry × lots × lotSize × **3**.

---

### 4.11 Broker Settings (`/broker-settings`)

**Purpose:** Configure broker API credentials and monitor data pipeline health.

**Route:** `/broker-settings`

#### Broker support

| Broker | Status |
|--------|--------|
| **Upstox** | Fully integrated — option chain, Greeks, live LTP, historical candles |
| Zerodha, Angel One, Dhan, Fyers, 5paisa, Alice Blue | UI forms ready; backend connectors pending |

#### Features

- Save/edit/remove API keys (stored in **browser localStorage only**).
- Set active broker.
- **Connection status panel** — Upstox test, WebSocket, NSE fallback, TradingView, proxy uptime.
- **Database Manager** — IndexedDB stats, bulk candle download.
- **Chart Data Downloader** — Batch OHLCV fetch for indices and top F&O stocks.

**Security:** Keys never leave your machine. The proxy reads Upstox token from `.env` or forwarded headers.

---

## 5. Shared Components & Tools

### 5.1 Stock Chart (TA Chart)

**Used in:** Option Chain, Watchlist, Technical Snapshot  
**Library:** lightweight-charts

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Ranges** | 1D, 1W, 1M, 3M, 6M, 1Y |
| **Intervals** | 1m, 3m, 5m, 15m, 30m, 1h, Daily (1m is Upstox minimum) |
| **Overlays** | EMA, SMA, Bollinger Bands, **session VWAP** (resets each trading day, no overnight connectors) |
| **Volume** | Histogram below price pane |
| **Oscillators** | RSI, MACD, Stochastic in separate pane |
| **Patterns** | Candlestick pattern markers (doji, hammer, engulfing, etc. — last 8 detected) |
| **Summary badges** | RSI value, VWAP deviation (±0.15% for above/below label) |
| **Display modes** | Inline, card, bottom sheet |

**Default for 1D:** 1-minute candles (VWAP-friendly intraday view).

---

### 5.2 Technical Analysis Engine

**Files:** `src/lib/taCompute.ts` (client), `proxy_server/ta_indicators.py` (server)

#### Indicators computed

RSI, MACD, Bollinger Bands, ATR, ADX, EMA, SMA, Stochastic, OBV, **session VWAP**, **Supertrend**.

#### Supertrend (used by ORB strategy)

| Parameter | Default |
|-----------|---------|
| ATR period | 10 |
| Multiplier | 3 |
| Direction | +1 bullish (line below price), −1 bearish (line above price) |

Computed in `src/lib/taCompute.ts` via `supertrend()`. Used as a volatility-adjusted trailing stop — exit when direction flips.

#### Default periods

| Indicator | Period |
|-----------|--------|
| RSI, MACD, ATR, ADX | 14 |
| Bollinger Bands | 20, 2σ |
| EMA | 20 |
| SMA | 50 |
| Stochastic | 14, 3 |

#### Signal thresholds

| Indicator | Bullish / Bearish / Neutral |
|-----------|----------------------------|
| RSI | >70 overbought, <30 oversold |
| ADX | >25 strong trend, >20 trending |
| BB width | <4% squeeze, >8% expanded |
| Trend vs EMA20 | ±0.5% band |
| VWAP | Session reset on intraday; uses typical price × volume; fallback to equal-weight if zero volume |

#### Pattern detection

Doji (body/range < 0.1), hammer/shooting star (wick ratios), bullish/bearish engulfing.

---

### 5.3 Alert System

**Access:** Bell icon / dashboard header

#### Alert types

| Type | Triggers when |
|------|---------------|
| **Price** | Symbol crosses above/below target price |
| **OI Spike** | Open interest change exceeds threshold |
| **IV Spike** | Implied volatility exceeds threshold |
| **PCR** | Put-call ratio crosses level |
| **VIX** | India VIX crosses level |

Features: enable/disable per alert, optional sound notification, live data from indices/VIX hooks.

---

### 5.4 Command Palette

**Shortcut:** `⌘K` / `Ctrl+K`

Quick navigation to any page (including **Algo Strategy Scanner** and **F&O Intelligence**), symbol search, and common actions without using the sidebar.

---

### 5.5 Local Database & Chart Downloader

**Access:** Broker Settings → Database Manager

#### IndexedDB stores

- Instrument master
- Price snapshots
- Candle history (indices + top F&O stocks)

#### Bulk download phases

1. Instruments
2. Price snapshots
3. Index candles (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, INDIAVIX)
4. F&O stock candles

Used for offline analysis, faster chart loads, and reducing API calls during repeated scans.

---

## 6. Backend API (Python Proxy)

When running `npm run dev:python`, these endpoints are available on port **4002**:

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Proxy health, WebSocket status, cache info |
| `GET /api/upstox-proxy` | Upstox API relay (option chain, candles, quotes) |
| `GET /api/nse-proxy` | NSE India relay |
| `GET /api/tv-scan` | TradingView scanner relay |
| `GET /api/fno-symbols` | Full F&O symbol list |
| `GET /api/test-connection` | Test Upstox credentials |
| `GET /api/ta/indicators` | TA indicators for a symbol |
| `GET /api/ta/snapshot` | TA snapshot for indices |
| `GET /api/ta/scanner` | Bulk TA scanner results |
| `GET /api/live-scanner` | Legacy live momentum endpoint |
| `GET /api/fno-intelligence/live` | Unified live intelligence (bullish/bearish/watch) |
| `GET /api/fno-intelligence/playbook` | EOD next-day playbook (`?generate=1` to rebuild) |
| `GET /ws` | WebSocket relay for live ticks |

### Background services (Python)

| Service | File | Behavior |
|---------|------|----------|
| **Live momentum engine** | `live_scanner.py` | Rolling per-symbol state; evaluates 4-rule signals |
| **Live scanner feed** | `live_scanner_feed.py` | Batch LTP polling ~2s; seeds volume from 1m history |
| **EOD playbook** | `eod_playbook.py` | Post-market analysis; caches daily playbook |
| **F&O intelligence hub** | `fno_intelligence.py` | Unified handlers; schedules EOD generation |

> **Note:** Algo Strategy Scanner logic runs **client-side** (`src/lib/fnoStrategies.ts`) — no dedicated proxy endpoint. It uses `/api/upstox-proxy` for historical candles.

---

## 7. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘0` / `Ctrl+0` | Algo Strategy Scanner |
| `⌘1` / `Ctrl+1` | Dashboard |
| `⌘2` / `Ctrl+2` | Option Chain |
| `⌘3` / `Ctrl+3` | OI Analysis |
| `⌘4` / `Ctrl+4` | Watchlist |
| `⌘5` / `Ctrl+5` | Strategy Builder |
| `⌘6` / `Ctrl+6` | Position Tracker |
| `⌘7` / `Ctrl+7` | TA Scanner |
| `⌘8` / `Ctrl+8` | 3-Candle Scanner |
| `⌘9` / `Ctrl+9` | F&O Intelligence |
| `⌘K` / `Ctrl+K` | Command Palette |
| `J` / `K` | Navigate option chain rows |
| `G` | Jump to ATM strike (Option Chain) |

---

## 8. Configuration & Setup

### Minimum setup (no API key)

```bash
npm install
npm run dev
# Open http://localhost:4001
```

Works: dashboard overview, watchlist, strategy builder, position tracker, some fallback data via NSE/TradingView.

### Full setup (recommended)

1. Create Upstox developer app and obtain OAuth access token.
2. Add to `.env`:
   ```env
   UPSTOX_ACCESS_TOKEN=your_token_here
   PROXY_PORT=4002
   ```
3. Run with Python proxy:
   ```bash
   npm run dev:python
   ```
4. Or enter token in **Broker Settings** UI (stored in localStorage).

### Environment variables

| Variable | Purpose |
|----------|---------|
| `UPSTOX_ACCESS_TOKEN` | Upstox OAuth token for live data |
| `PROXY_PORT` | Proxy server port (default 4002) |
| `VITE_PROXY_URL` | Override proxy URL for production deploy |

---

## 9. Rules & Thresholds Reference

Quick reference for all automated rules in the application:

### F&O Intelligence — Live

| Parameter | Default |
|-----------|---------|
| 15s move | ±0.4% |
| 1m move | ±0.8% |
| Volume multiplier | 3× 20-min average |
| VWAP | Above (long) / Below (short) |
| Watch threshold | 2–3 of 4 criteria |

### F&O Intelligence — Playbook

| Parameter | Value |
|-----------|-------|
| Min intraday candles | 5 |
| Strong day move | ±0.6% |
| Range position (long) | Close in upper 28%+ (≥72%) |
| Range position (short) | Close in lower 28% (≤28%) |
| RSI long/short | >60 / <40 |
| Bias margin | ±2 score points |

### Option Chain

| Parameter | Value |
|-----------|-------|
| Unusual activity volume | >3× avg OI AND >50,000 |
| PCR bullish | >1 |
| PCR bearish | <0.7 |

### TA Scanner

| Parameter | Value |
|-----------|-------|
| RSI overbought | >70 |
| RSI oversold | <30 |
| ADX trending | >25 |

### 3-Candle Scanner

| Parameter | Value |
|-----------|-------|
| Close tolerance | 15% of candle range |

### Algo Strategies — BTST / STBT

| Parameter | Value |
|-----------|-------|
| Body avg window | 10 days |
| T-1 body | Smaller than rolling average |
| T body | ≥ rolling average (strong) |
| BTST price rule | Close(T) > High(T-1) |
| STBT price rule | Close(T) < Low(T-1) |
| Volume | T > T-1 |
| Eval window | 3:00–3:30 PM IST |
| Product | NRML |

### Algo Strategies — Multi-Day

| Pattern | Key rule |
|---------|----------|
| Three White Soldiers | 3 green, higher closes, open in prior body, wick ≤25% |
| Three Black Crows | 3 red, lower closes, mirror geometry |
| CRT Bullish | C2 low < C1 low; C3 close inside C1 range (green) |
| CRT Bearish | C2 high > C1 high; C3 close inside C1 range (red) |
| Hold target | 2–3 sessions |

### Algo Strategies — ORB + VWAP + Supertrend

| Parameter | Value |
|-----------|-------|
| Opening range | 09:15–09:45 IST |
| Signal window | After 09:45 |
| Long | Close > ORB high, above VWAP, ST bullish |
| Short | Close < ORB low, below VWAP, ST bearish |
| Supertrend | ATR(10) × 3 |
| Exit | Supertrend direction flip |
| Candle interval | 5 minutes |
| Product | MIS |

### IV Rank (Dashboard)

| IV Rank | Signal |
|---------|--------|
| >70 | Sell premium |
| <30 | Buy premium |

---

## 10. Known Limitations

| Area | Limitation |
|------|------------|
| **Sub-minute candles** | Upstox minimum interval is 1 minute; 15s moves use LTP poll approximation |
| **Algo Strategy Scanner** | Runs client-side in browser; no automated order routing (NRML/MIS labels are guidance only) |
| **ORB tab** | Requires market past 09:45 IST and sufficient 5m candles; empty before opening range completes |
| **BTST live mode** | Uses aggregated intraday bar before close — less precise than end-of-day daily candle |
| **Strategy Builder** | Uses model premiums/Greeks, not live chain prices |
| **Multi-expiry views** | Some OI/option chain views use approximations, not live API for every expiry |
| **Off-market hours** | Most live feeds return empty or cached data — expected behavior |
| **Broker integrations** | Only Upstox fully wired; other brokers are UI-only |
| **Node proxy** | F&O Intelligence endpoints require Python proxy (`dev:python`) |
| **Playbook universe** | Default "popular" subset for speed; "all" is slower |
| **No trade execution** | Analytics only — cannot place orders via Kite Connect or other brokers |

---

## 11. Related Documentation

| Document | Description |
|----------|-------------|
| [Strategy.md](./Strategy.md) | Quick reference for the three algo strategies |
| [Indian F&O Trading Strategy Generation.md](./Indian%20F%26O%20Trading%20Strategy%20Generation.md) | Full quantitative research framework (BTST, CRT, ORB, cost modeling) |
| [README.md](../README.md) | Setup, quick start, troubleshooting |

### Scanner comparison

| Page | Route | Focus |
|------|-------|-------|
| **TA Scanner** | `/ta-scanner` | RSI / MACD / ADX indicator filters |
| **3-Candle Scanner** | `/three-candle-scanner` | D1 conviction → D2 inside → D3 breakout |
| **Algo Strategy Scanner** | `/strategy-scanner` | BTST/STBT, Soldiers/Crows/CRT, ORB+VWAP+ST |
| **F&O Intelligence** | `/fno-intelligence` | Live 4-rule momentum + EOD next-day playbook |

---

## 12. Disclaimer

This application is for **educational and analytical purposes only**. It is **not financial advice**.

- Trading in derivatives involves significant risk and may result in loss of capital.
- Always do your own research and consult a SEBI-registered financial advisor.
- The developers are not responsible for any financial losses.
- This tool does not execute trades.
- API keys are stored locally and are never transmitted to external servers.

---

*Document version: 1.1 — aligned with Mr. Chartist Terminal v1.0.0 (includes Algo Strategy Scanner, F&O Intelligence, Supertrend)*
