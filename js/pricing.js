/**
 * Further Insights — pricing.js v2
 * Price history · Portfolio chart · Market movers · Live run tracker
 * Sparklines · Card detail modal · Team filter · CSV export
 */

const REPO_OWNER  = 'benjamin-cooper';
const REPO_NAME   = 'baseball-cards';
const WORKFLOW_ID = 'price_cards.yml';
const DATA_URL    = 'data/pricing_results.json';
const HISTORY_URL = 'data/price_history.json';
const SUMMARY_URL = 'data/pricing_summary.json';
const METADATA_URL = 'data/run_metadata.json';

// Clients-side ETag cache of the large results JSON. Stored as a single
// localStorage key; cleared automatically on 24-hour hard-cap.
const CACHE_KEY_ETAG = 'results_etag';
const CACHE_KEY_BODY = 'results_body';
const CACHE_KEY_TS   = 'results_cached_at';
const CACHE_HARD_CAP = 24 * 60 * 60 * 1000;   // 24 h

const POLL_MAX_TICKS = 40;   // 15s × 40 = 10 min hard cap on run polling
const FETCH_RETRY_MAX = 2;

// ─── State ────────────────────────────────────────────────────────────────────
let allCards      = [];
let filtered      = [];
let priceHistory  = {};
let summary       = null;   // pricing_summary.json (precomputed aggregates)
let runMetadata   = null;   // run_metadata.json (API-call counts, errors)
let sortCol       = 'avg_price';
let sortDir       = 'desc';
let runPollTimer  = null;
let runTickTimer  = null;
let runStartTime  = null;
let runPollTicks  = 0;
let activeRunId   = null;   // GitHub Actions run ID, set once the run is found
let clusterize    = null;   // Clusterize instance for virtual table rendering
let cardById      = new Map();   // card_id → card (for delegated click lookup)

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  bindUI();
});

// ─── Data Loading ─────────────────────────────────────────────────────────────
//
// Two-stage load: fetch the small pricing_summary.json first for a fast first
// paint of headline stats + player table, then hydrate the full results JSON
// (with ETag-based localStorage caching for repeat visits).
// ─────────────────────────────────────────────────────────────────────────────

async function fetchWithRetry(url, opts = {}, retries = FETCH_RETRY_MAX) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok && res.status >= 500 && i < retries) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr || new Error(`fetch failed: ${url}`);
}

async function loadResultsWithETagCache() {
  const cachedBody = localStorage.getItem(CACHE_KEY_BODY);
  const cachedEtag = localStorage.getItem(CACHE_KEY_ETAG);
  const cachedTs   = parseInt(localStorage.getItem(CACHE_KEY_TS) || '0', 10);
  const fresh      = cachedBody && Date.now() - cachedTs < CACHE_HARD_CAP;

  const headers = {};
  if (cachedEtag && fresh) headers['If-None-Match'] = cachedEtag;

  const res = await fetchWithRetry(`${DATA_URL}?t=${Date.now()}`, { headers });
  if (res.status === 304 && cachedBody) {
    try { return JSON.parse(cachedBody); } catch { /* fall through */ }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const etag = res.headers.get('ETag');
  try {
    if (etag) localStorage.setItem(CACHE_KEY_ETAG, etag);
    localStorage.setItem(CACHE_KEY_BODY, text);
    localStorage.setItem(CACHE_KEY_TS, String(Date.now()));
  } catch { /* localStorage full — ignore */ }
  return JSON.parse(text);
}

async function loadData() {
  try {
    const t = Date.now();

    // Stage 1: small summary sidecar — fast first paint.
    try {
      const rs = await fetchWithRetry(`${SUMMARY_URL}?t=${t}`);
      if (rs.ok) summary = await rs.json();
    } catch { /* optional — fall back to client-side calc */ }

    // Kick off metadata fetch in parallel (non-blocking).
    fetchWithRetry(`${METADATA_URL}?t=${t}`).then(r => r.ok ? r.json() : null).then(m => {
      if (m) { runMetadata = m; renderRunBadge(m); }
    }).catch(() => {});

    // Stage 2: full results + history.
    const [data, r2] = await Promise.all([
      loadResultsWithETagCache(),
      fetchWithRetry(`${HISTORY_URL}?t=${t}`)
    ]);
    priceHistory = r2.ok ? await r2.json() : {};

    // Build per-player copy counts — every row is a distinct physical card.
    const rawPlayerCounts = {};
    (data.cards || []).forEach(c => {
      const p = c.player || '?';
      rawPlayerCounts[p] = (rawPlayerCounts[p] || 0) + 1;
    });

    // Dev-only drift check: verify a handful of card IDs line up with the
    // Python-generated history keys. Silent in release, warns in console.
    driftCheck(data.cards || []);

    render(data, rawPlayerCounts);
  } catch (e) {
    console.error('loadData failed:', e);
    showEmpty('No pricing data yet. Click ⚡ Update Prices to run the pricing agent.');
  }
}

function driftCheck(cards) {
  if (!cards.length || !Object.keys(priceHistory).length) return;
  const sample = [];
  for (let i = 0; i < Math.min(5, cards.length); i++) {
    sample.push(cards[Math.floor(Math.random() * cards.length)]);
  }
  let misses = 0;
  sample.forEach(c => {
    if (c.card_id && !priceHistory[c.card_id]) misses++;
  });
  if (misses >= 3) {
    console.warn('[drift] Possible cardId drift — ' + misses + '/' + sample.length + ' sampled cards have no history row.');
  }
}

// ─── Card ID — must match Python make_card_id() ───────────────────────────────
function cardId(c) {
  return `${c.year}_${c.brand||''}_${c.player||''}_${c.card_number||''}`
    .toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// ─── Shared pct-change helper (Phase 3.1) ─────────────────────────────────────
// Returns the latest-vs-previous % change for a card, or null if history is thin.
function pctChange(cOrId) {
  const id = typeof cOrId === 'string' ? cOrId : (cOrId.card_id || cardId(cOrId));
  const h  = priceHistory[id];
  if (!h || h.length < 2) return null;
  const prev = h[h.length - 2].price;
  const curr = h[h.length - 1].price;
  return prev ? (curr - prev) / prev * 100 : null;
}

// ─── Tiered % change over N days (Phase 4.1) ──────────────────────────────────
// Finds the nearest history snapshot at least `days` days old and returns the
// abs/pct change from that point to the current value. Null if no such point.
function pctChangeOver(c, days) {
  const id   = c.card_id || cardId(c);
  const h    = priceHistory[id];
  if (!h || h.length < 2) return null;
  const now  = Date.now();
  const curr = h[h.length - 1].price;
  if (!curr) return null;
  for (let i = h.length - 2; i >= 0; i--) {
    const t = new Date(h[i].date).getTime();
    if (!isNaN(t) && (now - t) >= days * 86400_000) {
      const prev = h[i].price;
      if (!prev) return null;
      return {
        pct: (curr - prev) / prev * 100,
        abs: curr - prev,
        fromDate: h[i].date,
      };
    }
  }
  return null;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(data, rawPlayerCounts = {}) {
  renderStats(data);
  // Top 25 — every row is a distinct physical card; no dedup.
  // Dedupe by card_id for display only — two physical copies of the same card
  // both count toward the total but should appear once in ranked lists.
  // Always recompute from cards so the precomputed top_cards list (which may
  // have been built before this dedup logic existed) doesn't sneak dupes in.
  const uniqueCards = [...(data.cards || [])
    .reduce((m, c) => {
      const id = c.card_id || cardId(c);
      if (!m.has(id) || c.avg_price > m.get(id).avg_price) m.set(id, c);
      return m;
    }, new Map()).values()];
  const top25 = uniqueCards
    .filter(c => c.avg_price > 0)
    .sort((a, b) => b.avg_price - a.avg_price)
    .slice(0, 25);
  renderTopCards(top25);
  renderMarketMovers(data.cards || []);
  renderPortfolioChart(data._portfolio || []);
  renderEraChart(data.by_era || {});
  renderBrandChart(data.by_brand || {}, data.cards || []);
  renderPlayerStats(data.cards || [], rawPlayerCounts);
  allCards = data.cards || [];
  // Rebuild the card lookup map for the delegated table click handler.
  cardById = new Map(allCards.filter(c => c.card_id).map(c => [c.card_id, c]));
  populateYearFilter(allCards);
  populateTeamFilter(allCards);
  applyFilters();
  set('last-updated', data.last_updated ? new Date(data.last_updated).toLocaleString() : '—');
}

// ─── Run metadata badge ────────────────────────────────────────────────────────
function renderRunBadge(m) {
  const el = document.getElementById('run-badge');
  if (!el || !m) return;
  const api = m.api_calls || {};
  const hits = api.ebay_hits || 0, misses = api.ebay_misses || 0;
  el.textContent = `Last run: ${m.cards_priced || 0}/${m.cards_processed || 0} cards • ${misses} eBay calls • ${hits} cache hits • ${api.claude || 0} Claude calls`;
}

function renderStats(data) {
  const fmt = n => n != null ? '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—';
  set('stat-total-value',  fmt(data.total_value));
  set('stat-cards-priced', data.cards_priced != null ? data.cards_priced.toLocaleString() : '—');
  set('stat-avg-value',    fmt(data.avg_value));
  set('stat-top-card', fmt(data.top_card_value));
  // Median: middle value of all priced cards sorted by avg_price
  const pricedVals = (data.cards || [])
    .map(c => parseFloat(c.avg_price))
    .filter(v => !isNaN(v) && v > 0)
    .sort((a, b) => a - b);
  const mid    = Math.floor(pricedVals.length / 2);
  const median = pricedVals.length
    ? (pricedVals.length % 2 ? pricedVals[mid] : (pricedVals[mid-1] + pricedVals[mid]) / 2)
    : null;
  set('stat-median-value', fmt(median));
}

function renderTopCards(cards) {
  const el = document.getElementById('top-cards-list');
  if (!cards.length) { el.innerHTML = '<div class="state-empty">No data yet</div>'; return; }
  el.innerHTML = cards.map((c, i) => {
    const sub = [c.brand, c.card_number ? `#${c.card_number}` : ''].filter(Boolean).join(' · ');
    return `
    <div class="top-card-row" data-card-id="${esc(c.card_id || cardId(c))}">
      <span class="top-card-rank">${i + 1}</span>
      <span class="top-card-name" title="${esc(c.player)} — ${esc(c.brand)}${c.card_number ? ' #' + esc(c.card_number) : ''}">
        ${esc(c.player)} <span class="top-card-sub">${esc(sub)}</span>
      </span>
      <span class="top-card-year">${c.year}</span>
      <span class="top-card-price">${fmt$(c.avg_price)}</span>
    </div>`;
  }).join('');
}

// ─── Market Movers ────────────────────────────────────────────────────────────
function renderMarketMovers(cards) {
  const el = document.getElementById('market-movers');
  // Dedupe by card_id — show each unique card once even if owned as duplicates.
  const seen = new Set();
  const unique = cards.filter(c => {
    const id = c.card_id || cardId(c);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const movers = unique
    .map(c => {
      const pct = pctChange(c);
      if (pct == null) return null;
      return { card: c, pct };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 10);

  if (!movers.length) {
    el.innerHTML = '<div class="state-empty">Run the agent at least twice to see movers</div>';
    return;
  }
  el.innerHTML = movers.map(({ card: c, pct }) => {
    const up = pct >= 0, sign = up ? '+' : '';
    const meta = [c.year, c.brand, c.card_number ? `#${c.card_number}` : ''].filter(Boolean).join(' ');
    return `
      <div class="mover-row" data-card-id="${esc(c.card_id || cardId(c))}">
        <div class="mover-info">
          <span class="mover-name">${esc(c.player)}</span>
          <span class="mover-meta">${esc(meta)}</span>
        </div>
        <span class="mover-price">${fmt$(c.avg_price)}</span>
        <span class="mover-delta ${up ? 'delta-up' : 'delta-down'}">${sign}${pct.toFixed(1)}%</span>
      </div>`;
  }).join('');
}

// ─── Portfolio Chart ──────────────────────────────────────────────────────────
function renderPortfolioChart(portfolio) {
  const el = document.getElementById('portfolio-chart');
  if (!portfolio || portfolio.length < 2) {
    el.innerHTML = '<div class="state-empty">Portfolio trend will appear after 2+ pricing runs</div>';
    return;
  }
  const W = Math.max(el.offsetWidth || 600, 300), H = 150;
  const P = { t: 16, r: 16, b: 28, l: 70 };
  const pw = W - P.l - P.r, ph = H - P.t - P.b;
  const vals = portfolio.map(p => p.total_value);
  const minV = Math.min(...vals) * 0.93, maxV = Math.max(...vals) * 1.07;
  const xS   = i => P.l + (i / (portfolio.length - 1)) * pw;
  const yS   = v => P.t + ph - ((v - minV) / ((maxV - minV) || 1)) * ph;
  const poly = portfolio.map((p, i) => `${xS(i).toFixed(1)},${yS(p.total_value).toFixed(1)}`).join(' ');
  const area = `M${xS(0).toFixed(1)},${(P.t+ph).toFixed(1)} ` +
    portfolio.map((p, i) => `L${xS(i).toFixed(1)},${yS(p.total_value).toFixed(1)}`).join(' ') +
    ` L${xS(portfolio.length-1).toFixed(1)},${(P.t+ph).toFixed(1)} Z`;

  const yLabels = [minV, (minV+maxV)/2, maxV].map(v =>
    `<text x="${P.l-8}" y="${yS(v)+4}" text-anchor="end" class="chart-label">${fmt$(v)}</text>`
  ).join('');
  const xi = portfolio.length <= 4 ? portfolio.map((_,i) => i) : [0, Math.floor((portfolio.length-1)/2), portfolio.length-1];
  const xLabels = xi.map(i =>
    `<text x="${xS(i).toFixed(1)}" y="${H-4}" text-anchor="middle" class="chart-label">${fmtDateShort(portfolio[i].date)}</text>`
  ).join('');

  el.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4CAF50" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#4CAF50" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${yLabels}${xLabels}
    <path d="${area}" fill="url(#pg)"/>
    <polyline points="${poly}" fill="none" stroke="#4CAF50" stroke-width="2" stroke-linejoin="round"/>
    ${portfolio.map((p,i) => `<circle cx="${xS(i).toFixed(1)}" cy="${yS(p.total_value).toFixed(1)}" r="3.5" fill="#4CAF50"/>`).join('')}
  </svg>`;
}

// ─── Era Chart ────────────────────────────────────────────────────────────────
let eraData = {};
let eraMode = 'total';   // 'total' | 'avg'
let eraSort = 'chron';   // 'chron' | 'total' | 'avg' | 'count'

const ERA_ORDER = [
  'Vintage (pre-1970)', '1970s', 'Early 80s', 'Junk Wax (1987\u201394)',
  'Late 90s', '2000s', '2010s', 'Modern (2020+)'
];

function renderEraChart(byEra) {
  eraData = byEra;
  drawEraChart();
}

function setEraMode(mode) {
  eraMode = mode;
  document.querySelectorAll('#era-toggle .chart-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  drawEraChart();
}

function drawEraChart() {
  const el = document.getElementById('era-chart');
  const entries = Object.entries(eraData);
  if (!entries.length) { el.innerHTML = '<div class="state-empty">No data yet</div>'; return; }

  let rows = entries.map(([era, s]) => ({
    era,
    count:       s.count || 0,
    total_value: s.total_value || 0,
    avg_value:   s.count ? (s.total_value / s.count) : 0,
  }));

  // Sort
  if (eraSort === 'chron') {
    rows.sort((a, b) => {
      const ai = ERA_ORDER.indexOf(a.era), bi = ERA_ORDER.indexOf(b.era);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  } else if (eraSort === 'total') {
    rows.sort((a, b) => b.total_value - a.total_value);
  } else if (eraSort === 'avg') {
    rows.sort((a, b) => b.avg_value - a.avg_value);
  } else if (eraSort === 'count') {
    rows.sort((a, b) => b.count - a.count);
  }

  const maxVal = Math.max(...rows.map(d => eraMode === 'avg' ? d.avg_value : d.total_value), 1);

  el.innerHTML = rows.map(d => {
    const barVal  = eraMode === 'avg' ? d.avg_value : d.total_value;
    const pct     = (barVal / maxVal * 100).toFixed(1);
    const sub     = eraMode === 'avg'
      ? `${d.count.toLocaleString()} cards · ${fmt$(d.total_value)} total`
      : `${d.count.toLocaleString()} cards · ${fmt$(d.avg_value)} avg`;
    return `<div class="era-row">
      <span class="era-label">${esc(d.era)}</span>
      <div class="era-col">
        <div class="era-bar-wrap"><div class="era-bar" style="width:${pct}%"></div></div>
        <span class="era-sub">${sub}</span>
      </div>
      <span class="era-value">${fmt$(barVal)}</span>
    </div>`;
  }).join('');
}

// ─── Brand Chart ─────────────────────────────────────────────────────────────
let brandData     = {};      // raw sub-brand map: { "Topps Chrome": {count, total_value}, ... }
let brandMode     = 'total'; // 'total' | 'avg'
let brandDrilldown = null;   // null = top level, string = parent being drilled into

// Known multi-word parent brands — checked before falling back to first word
const PARENT_BRAND_LIST = [
  'Upper Deck', 'Stadium Club', 'SP Authentic', 'SP Legendary',
  'Leaf Limited', 'Leaf Metal', 'Pacific Crown', 'Pacific Invincible',
  'Fleer Ultra', 'Fleer Flair', 'Donruss Studio', 'Bowman Chrome',
];

function parentBrand(brand) {
  const b = (brand || 'Unknown').trim();
  for (const p of PARENT_BRAND_LIST) {
    if (b.toLowerCase().startsWith(p.toLowerCase())) return p;
  }
  // Fall back to first word (handles Topps, Fleer, Donruss, Bowman, Score, etc.)
  return b.split(/[\s\-–]/)[0] || b;
}

function renderBrandChart(byBrand, cards) {
  // Build raw sub-brand map from cards (always recompute so we have full detail)
  const map = {};
  cards.filter(c => c.avg_price).forEach(c => {
    const b = (c.brand || 'Unknown').trim();
    if (!map[b]) map[b] = { count: 0, total_value: 0 };
    map[b].count++;
    map[b].total_value += parseFloat(c.avg_price);
  });
  // Merge in JSON-provided data for any brands not in cards (edge case)
  Object.entries(byBrand).forEach(([b, s]) => {
    if (!map[b]) map[b] = s;
  });
  brandData = map;
  brandDrilldown = null;
  drawBrandChart();
}

function setBrandMode(mode) {
  brandMode = mode;
  document.querySelectorAll('#brand-toggle .chart-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  drawBrandChart();
}

function drawBrandChart() {
  const el    = document.getElementById('brand-chart');
  const title = document.getElementById('brand-chart-title');
  const back  = document.getElementById('btn-brand-back');

  const allEntries = Object.entries(brandData);
  if (!allEntries.length) { el.innerHTML = '<div class="state-empty">No data yet</div>'; return; }

  let rows, drillable;

  if (brandDrilldown === null) {
    // ── Top level: aggregate by parent brand ─────────────────────────────────
    title.textContent = 'Value by Brand';
    back.classList.add('hidden');
    drillable = true;

    const parents = {};
    allEntries.forEach(([brand, s]) => {
      const p = parentBrand(brand);
      if (!parents[p]) parents[p] = { count: 0, total_value: 0, subs: 0 };
      parents[p].count       += s.count || 0;
      parents[p].total_value += s.total_value || 0;
      parents[p].subs++;
    });

    rows = Object.entries(parents).map(([brand, s]) => ({
      brand,
      count:       s.count,
      total_value: s.total_value,
      avg_value:   s.count ? s.total_value / s.count : 0,
      subs:        s.subs,
    }));
  } else {
    // ── Drill-down: show sub-brands for selected parent ───────────────────────
    title.textContent = brandDrilldown;
    back.classList.remove('hidden');
    drillable = false;

    rows = allEntries
      .filter(([brand]) => parentBrand(brand) === brandDrilldown)
      .map(([brand, s]) => ({
        brand,
        count:       s.count || 0,
        total_value: s.total_value || 0,
        avg_value:   s.count ? s.total_value / s.count : 0,
        subs:        0,
      }));
  }

  rows.sort((a, b) => brandMode === 'avg'
    ? b.avg_value   - a.avg_value
    : b.total_value - a.total_value);
  rows = rows.slice(0, 12);

  const maxVal = Math.max(...rows.map(d => brandMode === 'avg' ? d.avg_value : d.total_value), 1);

  el.innerHTML = rows.map(d => {
    const barVal  = brandMode === 'avg' ? d.avg_value : d.total_value;
    const pct     = (barVal / maxVal * 100).toFixed(1);
    const subLine = brandMode === 'avg'
      ? `${d.count.toLocaleString()} cards · ${fmt$(d.total_value)} total`
      : `${d.count.toLocaleString()} cards · ${fmt$(d.avg_value)} avg`;
    const drillHint = (drillable && d.subs > 1) ? ' brand-drillable' : '';
    const drillAttr = (drillable && d.subs > 1) ? `data-parent="${esc(d.brand)}"` : '';
    return `<div class="era-row brand-row${drillHint}" ${drillAttr}>
      <span class="era-label">${esc(d.brand)}</span>
      <div class="era-col">
        <div class="era-bar-wrap"><div class="era-bar brand-bar" style="width:${pct}%"></div></div>
        <span class="era-sub">${subLine}</span>
      </div>
      <span class="era-value">${fmt$(barVal)}</span>
    </div>`;
  }).join('');

  // Drill-down click handlers
  el.querySelectorAll('.brand-drillable').forEach(row => {
    row.addEventListener('click', () => {
      brandDrilldown = row.dataset.parent;
      drawBrandChart();
    });
  });
}

// ─── Player Stats ─────────────────────────────────────────────────────────────
let playerRows    = [];   // full computed list, re-filtered on search/sort
let playerSortCol = 'total_value';
let playerSortDir = -1;   // -1 = desc, 1 = asc

function renderPlayerStats(cards, rawPlayerCounts) {
  // unique  = distinct card_id values (different card designs)
  // copies  = total sheet rows including physical duplicates of the same card
  const map = {};
  cards.forEach(c => {
    const p = c.player || '?';
    if (!map[p]) map[p] = { player: p, seenIds: new Set(), copies: 0, total_value: 0, prices: [], top_card: null };
    const d = map[p];
    d.copies++;
    d.seenIds.add(c.card_id || cardId(c));
    const price = parseFloat(c.avg_price) || 0;
    if (price > 0) {
      d.total_value += price;
      d.prices.push(price);
      if (!d.top_card || price > d.top_card.price) {
        d.top_card = { price, label: [c.year, c.brand, c.card_number ? `#${c.card_number}` : ''].filter(Boolean).join(' ') };
      }
    }
  });

  // Phase 4.4: pull server-precomputed volatility when present.
  const volByPlayer = {};
  if (summary && Array.isArray(summary.player_stats)) {
    summary.player_stats.forEach(s => { if (s && s.player != null) volByPlayer[s.player] = s.volatility; });
  }

  playerRows = Object.values(map).map(d => ({
    ...d,
    unique:     d.seenIds.size,
    copies:     d.copies,
    avg_price:  d.prices.length ? d.total_value / d.prices.length : 0,
    volatility: volByPlayer[d.player] != null ? volByPlayer[d.player] : null,
  }));

  drawPlayerStats('');
}

function drawPlayerStats(query) {
  const tbody = document.getElementById('player-stats-tbody');
  if (!tbody) return;

  const q = query.toLowerCase().trim();
  let rows = q ? playerRows.filter(r => r.player.toLowerCase().includes(q)) : [...playerRows];

  rows.sort((a, b) => {
    const av = a[playerSortCol] ?? 0, bv = b[playerSortCol] ?? 0;
    if (typeof bv === 'string') return playerSortDir * av.localeCompare(bv);
    return playerSortDir * (bv - av);
  });

  document.getElementById('player-stats-count').textContent =
    `${rows.length.toLocaleString()} player${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#555;padding:20px">No players found</td></tr>`;
    return;
  }

  const fmtVol = v => (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(1) + '%';

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="ps-player">${esc(r.player)}</td>
      <td class="ps-num">${fmt$(r.total_value)}</td>
      <td class="ps-num">${r.unique.toLocaleString()}</td>
      <td class="ps-num">${r.copies.toLocaleString()}</td>
      <td class="ps-num">${r.avg_price > 0 ? fmt$(r.avg_price) : '—'}</td>
      <td class="ps-num ps-vol" title="Std-dev of per-card % change over recent history">${fmtVol(r.volatility)}</td>
      <td class="ps-top">${r.top_card ? `<span class="ps-top-label">${esc(r.top_card.label)}</span> <span class="ps-top-price">${fmt$(r.top_card.price)}</span>` : '—'}</td>
    </tr>`).join('');
}

function bindPlayerStats() {
  const search = document.getElementById('player-stats-search');
  if (search) search.addEventListener('input', e => drawPlayerStats(e.target.value));

  document.querySelectorAll('#player-stats-table th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (playerSortCol === col) {
        playerSortDir *= -1;
      } else {
        playerSortCol = col;
        playerSortDir = col === 'player' ? 1 : -1;
      }
      document.querySelectorAll('#player-stats-table th[data-col]').forEach(t => {
        t.classList.toggle('ps-sort-active', t.dataset.col === col);
        if (t.dataset.col === col) t.dataset.dir = playerSortDir === -1 ? 'desc' : 'asc';
      });
      drawPlayerStats(document.getElementById('player-stats-search')?.value || '');
    });
  });
}

// ─── Table ────────────────────────────────────────────────────────────────────
function applyFilters() {
  const q      = document.getElementById('table-search').value.toLowerCase();
  const yr     = document.getElementById('filter-year').value;
  const tm     = document.getElementById('filter-team').value;
  const conf   = document.getElementById('filter-confidence').value;
  const priced = document.getElementById('filter-priced').value;

  filtered = allCards.filter(c => {
    if (yr     && String(c.year) !== yr)                return false;
    if (tm     && c.team         !== tm)                return false;
    if (conf   && !((c.confidence||'').includes(conf))) return false;
    if (priced === 'priced'   && !c.avg_price)          return false;
    if (priced === 'unpriced' &&  c.avg_price)          return false;
    if (q) {
      if (!`${c.player} ${c.brand} ${c.year} ${c.card_number} ${c.team}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  sortTable();
}

function getChangePct(c) {
  const h = priceHistory[cardId(c)];
  if (!h || h.length < 2) return -Infinity;
  const prev = h[h.length-2].price, curr = parseFloat(c.avg_price);
  return (prev && curr) ? (curr - prev) / prev * 100 : -Infinity;
}

function sortTable() {
  filtered.sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (['avg_price','tcdb_price'].includes(sortCol)) {
      av = parseFloat(av)||0; bv = parseFloat(bv)||0;
    } else if (sortCol === 'change_pct') {
      av = getChangePct(a); bv = getChangePct(b);
    } else {
      av = (av??'').toString().toLowerCase(); bv = (bv??'').toString().toLowerCase();
    }
    if (av < bv) return sortDir === 'asc' ? -1 :  1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
  renderTable();
}

// ─── Staleness class (#9) ─────────────────────────────────────────────────────
function ageClass(lastUpdated) {
  if (!lastUpdated) return 'age-never';
  const days = (Date.now() - new Date(lastUpdated)) / (1000 * 60 * 60 * 24);
  if (days < 2)  return 'age-fresh';
  if (days < 7)  return 'age-recent';
  if (days < 30) return 'age-aging';
  return 'age-stale';
}

function buildRowHtml(c) {
  const id   = c.card_id || cardId(c);
  const pct  = pctChange(c);
  const changeTxt = pct == null
    ? '<span class="roi-na">—</span>'
    : `<span class="${pct>=0?'roi-pos':'roi-neg'}">${pct>=0?'+':''}${pct.toFixed(1)}%</span>`;
  // Lazy sparkline: render placeholder; fill when row enters the Clusterize buffer.
  const hist = priceHistory[id];
  const spark = hist && hist.length >= 2
    ? `<span class="sparkline" data-card-id="${esc(id)}"></span>`
    : '<span class="no-spark">—</span>';
  const ageCls = ageClass(c.last_updated);
  return `<tr class="card-row" data-card-id="${esc(id)}">
    <td>${esc(c.player)}</td>
    <td>${c.year}</td>
    <td>${esc(c.brand)}</td>
    <td style="color:#777">${esc(c.card_number||'—')}</td>
    <td style="color:#888;font-size:0.8em">${esc(c.team||'—')}</td>
    <td class="num" style="color:#4CAF50;font-weight:600">${fmt$(c.avg_price)}</td>
    <td class="num" style="color:#888">${fmt$(c.tcdb_price)}</td>
    <td class="num">${changeTxt}</td>
    <td class="spark-cell">${spark}</td>
    <td>${confidenceBadge(c.confidence)}</td>
    <td class="num ${ageCls}">${fmtDate(c.last_updated)}</td>
  </tr>`;
}

function hydrateVisibleSparklines() {
  const table = document.getElementById('cards-tbody');
  if (!table) return;
  table.querySelectorAll('span.sparkline[data-card-id]:empty').forEach(span => {
    const id = span.dataset.cardId;
    const h  = priceHistory[id];
    if (h && h.length >= 2) span.innerHTML = sparkline(h.map(r => r.price));
  });
}

function renderTable() {
  set('table-count', `${filtered.length.toLocaleString()} cards`);

  const emptyRow = `<tr><td colspan="11" class="state-empty">No cards match your filters</td></tr>`;
  const rows     = filtered.length ? filtered.map(buildRowHtml) : [emptyRow];

  if (clusterize) {
    clusterize.update(rows);
  } else {
    clusterize = new Clusterize({
      rows,
      scrollId:   'table-scroll-area',
      contentId:  'cards-tbody',
      no_data_text: emptyRow,
      callbacks: {
        // Fill the sparkline <span>s only when a row enters the viewport buffer.
        clusterChanged: hydrateVisibleSparklines,
      }
    });
  }
  hydrateVisibleSparklines();
  // Reset scroll so filtered results start at the top.
  const scroller = document.getElementById('table-scroll-area');
  if (scroller) scroller.scrollTop = 0;
}

function populateYearFilter(cards) {
  const sel = document.getElementById('filter-year');
  sel.innerHTML = '<option value="">All Years</option>';
  [...new Set(cards.map(c => c.year))].filter(Boolean).sort().forEach(yr => {
    const o = document.createElement('option'); o.value = o.textContent = yr; sel.appendChild(o);
  });
}
function populateTeamFilter(cards) {
  const sel = document.getElementById('filter-team');
  sel.innerHTML = '<option value="">All Teams</option>';
  [...new Set(cards.map(c => c.team))].filter(Boolean).sort().forEach(t => {
    const o = document.createElement('option'); o.value = o.textContent = t; sel.appendChild(o);
  });
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function sparkline(prices, w=60, h=22) {
  if (!prices || prices.length < 2) return '<span class="no-spark">—</span>';
  const min = Math.min(...prices), max = Math.max(...prices), rng = max-min||1;
  const pts = prices.map((p,i) => {
    return `${((i/(prices.length-1))*w).toFixed(1)},${(h-3-((p-min)/rng)*(h-6)).toFixed(1)}`;
  }).join(' ');
  const lastY = (h-3-((prices[prices.length-1]-min)/rng)*(h-6)).toFixed(1);
  const col   = prices[prices.length-1] >= prices[0] ? '#4CAF50' : '#EF5350';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible;display:block">
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${w}" cy="${lastY}" r="2.5" fill="${col}"/>
  </svg>`;
}

// ─── Card Detail Modal ────────────────────────────────────────────────────────
function openCardModal(card) {
  const id   = cardId(card);
  const hist = priceHistory[id] || [];
  const cp   = parseFloat(card.avg_price)||0;
  const tp   = parseFloat(card.tcdb_price)||0;

  set('modal-card-title', `${card.player} — ${card.year} ${card.brand}`);

  // Phase 4.1: tiered deltas.
  const tier = [7, 30, 365].map(days => {
    const d = pctChangeOver(card, days);
    const label = days === 365 ? 'YoY' : `${days}d`;
    if (!d) return `<div class="cd-tier"><span class="cd-tier-label">${label}</span><span class="cd-tier-value">—</span></div>`;
    const up = d.pct >= 0, sign = up ? '+' : '';
    return `<div class="cd-tier ${up ? 'delta-up' : 'delta-down'}"><span class="cd-tier-label">${label}</span>
      <span class="cd-tier-value">${sign}${fmt$(d.abs)} (${sign}${d.pct.toFixed(1)}%)</span></div>`;
  }).join('');

  document.getElementById('modal-card-body').innerHTML = `
    <div class="card-detail-grid">
      <div class="cd-item"><span class="cd-label">eBay Market Value</span><span class="cd-value" style="color:#4CAF50">${fmt$(cp||null)}</span></div>
      <div class="cd-item"><span class="cd-label">TCDB Reference</span><span class="cd-value">${fmt$(tp||null)}</span></div>
      <div class="cd-item"><span class="cd-label">Confidence</span><span class="cd-value">${esc(card.confidence||'—')}</span></div>
      <div class="cd-item"><span class="cd-label">Card #</span><span class="cd-value">${esc(card.card_number||'—')}</span></div>
      <div class="cd-item"><span class="cd-label">Team</span><span class="cd-value">${esc(card.team||'—')}</span></div>
      <div class="cd-item"><span class="cd-label">Updated</span><span class="cd-value">${fmtDate(card.last_updated)}</span></div>
    </div>
    <div class="card-detail-tiers">
      <div class="cd-tiers-title">Price change</div>
      <div class="cd-tiers">${tier}</div>
    </div>
    ${hist.length >= 2 ? cardHistoryChart(hist) : '<div class="state-empty" style="padding:18px 0">History appears after 2+ runs for this card</div>'}
    <div class="card-detail-links">
      <a href="https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(card.year+' '+card.brand+' '+card.player+' baseball')}&_sacat=212" target="_blank" class="card-link">🔍 Search eBay</a>
      <a href="https://mavin.io/search?q=${encodeURIComponent(card.year+' '+card.brand+' '+card.player)}" target="_blank" class="card-link">📊 Mavin Prices</a>
    </div>`;
  openModal('modal-card');
}

function cardHistoryChart(hist) {
  const W=400, H=110, P={t:12,r:12,b:26,l:58};
  const pw=W-P.l-P.r, ph=H-P.t-P.b;
  const vals=hist.map(h=>h.price), minV=Math.min(...vals)*0.88, maxV=Math.max(...vals)*1.12;
  const xS=i=>P.l+(i/(hist.length-1))*pw, yS=v=>P.t+ph-((v-minV)/((maxV-minV)||1))*ph;
  const pts=hist.map((h,i)=>`${xS(i).toFixed(1)},${yS(h.price).toFixed(1)}`).join(' ');
  const area=`M${xS(0).toFixed(1)},${(P.t+ph).toFixed(1)} `+
    hist.map((h,i)=>`L${xS(i).toFixed(1)},${yS(h.price).toFixed(1)}`).join(' ')+
    ` L${xS(hist.length-1).toFixed(1)},${(P.t+ph).toFixed(1)} Z`;
  return `<div class="card-history-chart">
    <div class="chart-section-title">Price History</div>
    <svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="ch-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4CAF50" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="#4CAF50" stop-opacity="0"/>
      </linearGradient></defs>
      <text x="${P.l-8}" y="${yS(minV)+4}" text-anchor="end" class="chart-label">${fmt$(minV)}</text>
      <text x="${P.l-8}" y="${yS(maxV)+4}" text-anchor="end" class="chart-label">${fmt$(maxV)}</text>
      <path d="${area}" fill="url(#ch-g)"/>
      <polyline points="${pts}" fill="none" stroke="#4CAF50" stroke-width="2" stroke-linejoin="round"/>
      ${hist.map((h,i)=>`
        <circle cx="${xS(i).toFixed(1)}" cy="${yS(h.price).toFixed(1)}" r="3.5" fill="#4CAF50"/>
        <text x="${xS(i).toFixed(1)}" y="${H-4}" text-anchor="middle" class="chart-label">${fmtDateShort(h.date)}</text>
      `).join('')}
    </svg>
  </div>`;
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
function exportCSV() {
  const headers = ['Player','Year','Brand','Card #','Team','eBay Value','TCDB Ref','Change %','Confidence','Last Updated'];
  const rows = filtered.map(c => {
    const pct = pctChange(c);
    return [
      c.player, c.year, c.brand, c.card_number||'', c.team||'',
      c.avg_price||'', c.tcdb_price||'',
      pct == null ? '' : pct.toFixed(1),
      c.confidence||'', c.last_updated||''
    ].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',');
  });
  const csv  = [headers.join(','),...rows].join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'),{href:url,download:'card_prices.csv'}).click();
  URL.revokeObjectURL(url);
}

// ─── Debounce helper ──────────────────────────────────────────────────────────
function debounce(fn, delay = 250) {
  // Slower debounce on slow connections for less jank while typing.
  const effectiveDelay = (navigator.connection && /2g|slow/i.test(navigator.connection.effectiveType || ''))
    ? delay + 150 : delay;
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), effectiveDelay); };
}

// ─── Delegated card-open handler ──────────────────────────────────────────────
function bindCardClickDelegation() {
  document.addEventListener('click', e => {
    const row = e.target.closest('[data-card-id]');
    if (!row) return;
    const id = row.dataset.cardId;
    const card = cardById.get(id);
    if (card) openCardModal(card);
  });
}

// ─── UI Bindings ──────────────────────────────────────────────────────────────
function bindUI() {
  document.getElementById('table-search').addEventListener('input', debounce(applyFilters, 350));
  document.getElementById('filter-year').addEventListener('change', applyFilters);
  document.getElementById('filter-team').addEventListener('change', applyFilters);
  document.getElementById('filter-confidence').addEventListener('change', applyFilters);
  document.getElementById('filter-priced').addEventListener('change', applyFilters);

  document.querySelectorAll('#cards-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) { sortDir = sortDir==='asc'?'desc':'asc'; }
      else { sortCol = col; sortDir = ['avg_price','tcdb_price','change_pct'].includes(col)?'desc':'asc'; }
      document.querySelectorAll('#cards-table th').forEach(t=>t.classList.remove('sort-asc','sort-desc'));
      th.classList.add(sortDir==='asc'?'sort-asc':'sort-desc');
      sortTable();
    });
  });

  document.getElementById('btn-update').addEventListener('click', () => { if (!getPAT()) { openSettings(); return; } openModal('modal-run'); });
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-cancel-settings').addEventListener('click', () => closeModal('modal-settings'));
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-cancel-run').addEventListener('click', cancelRun);
  document.getElementById('btn-abort-run').addEventListener('click', abortRun);
  document.getElementById('btn-confirm-run').addEventListener('click', triggerRun);
  document.getElementById('btn-export').addEventListener('click', exportCSV);
  document.getElementById('btn-close-card').addEventListener('click', () => closeModal('modal-card'));
  bindRunModeUI();
  bindPlayerStats();
  bindCardClickDelegation();

  const pat = getPAT();
  if (pat) document.getElementById('input-pat').value = pat;

  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) { cancelRun(); closeModal(m.id); } });
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────
function openSettings() {
  const pat = getPAT(); if (pat) document.getElementById('input-pat').value = pat;
  openModal('modal-settings');
}
function saveSettings() {
  const pat = document.getElementById('input-pat').value.trim();
  if (pat) { sessionStorage.setItem('gh_pat', pat); closeModal('modal-settings'); }
}

// ─── GitHub Actions Trigger + Live Tracker ────────────────────────────────────
function bindRunModeUI() {
  // Era chart toggle + sort
  document.querySelectorAll('#era-toggle .chart-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setEraMode(btn.dataset.mode));
  });
  document.getElementById('era-sort').addEventListener('change', e => {
    eraSort = e.target.value;
    drawEraChart();
  });
  // Brand chart toggle + back button
  document.querySelectorAll('#brand-toggle .chart-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setBrandMode(btn.dataset.mode));
  });
  document.getElementById('btn-brand-back').addEventListener('click', () => {
    brandDrilldown = null;
    drawBrandChart();
  });

  // Run mode radios
  const updateRunOpts = () => {
    const mode = document.querySelector('input[name="run_mode"]:checked').value;
    document.getElementById('run-opt-batch').style.display  = mode === 'batch'  ? '' : 'none';
    document.getElementById('run-opt-player').style.display = mode === 'player' ? '' : 'none';
    document.getElementById('run-opt-stale').style.display  = (mode === 'player' || mode === 'tcdb') ? 'none' : '';
  };
  document.querySelectorAll('input[name="run_mode"]').forEach(r => r.addEventListener('change', updateRunOpts));

  // Force checkbox disables stale-days input
  document.getElementById('input-force').addEventListener('change', e => {
    const staleDaysInput = document.getElementById('input-stale-days');
    staleDaysInput.disabled = e.target.checked;
    document.getElementById('stale-hint').textContent = e.target.checked ? '(ignored — forcing all)' : '';
  });

  // Start row hint
  document.getElementById('input-start-row').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('start-row-hint').textContent =
      (!v || v <= 0) ? 'row 0 = start from the beginning' : `skipping rows 2–${v - 1}`;
  });
}

async function triggerRun() {
  const pat  = getPAT();
  if (!pat) { openSettings(); return; }

  const mode   = document.querySelector('input[name="run_mode"]:checked')?.value || 'batch';
  const batch  = document.getElementById('input-batch').value  || '200';
  const player = document.getElementById('input-player').value.trim();
  const force  = document.getElementById('input-force').checked;
  const stale  = force ? '0' : (document.getElementById('input-stale-days').value || '30');

  if (mode === 'player' && !player) {
    setRunStatus('error', '❌ Enter a player name for Player Target mode.');
    return;
  }

  // Input validation (Phase 3.6).
  const batchN = parseInt(batch, 10);
  if (isNaN(batchN) || batchN < 10 || batchN > 500) {
    setRunStatus('error', '❌ Batch size must be between 10 and 500.');
    return;
  }
  const staleN = parseInt(document.getElementById('input-stale-days').value || '30', 10);
  if (!force && (isNaN(staleN) || staleN < 1 || staleN > 365)) {
    setRunStatus('error', '❌ Stale days must be between 1 and 365.');
    return;
  }
  const startN = parseInt(document.getElementById('input-start-row').value || '0', 10);
  if (isNaN(startN) || startN < 0 || startN > 10000) {
    setRunStatus('error', '❌ Start row must be between 0 and 10,000.');
    return;
  }

  const btn = document.getElementById('btn-confirm-run');
  btn.disabled = true; btn.textContent = 'Starting…';
  setRunStatus('', '');

  const startRow = document.getElementById('input-start-row').value || '0';
  const inputs = { run_mode: mode, batch_size: String(batch), target_player: player, stale_days: stale, start_row: startRow };

  try {
    const res = await fetchWithRetry(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_ID}/dispatches`,
      { method:'POST',
        headers:{ 'Authorization':`Bearer ${pat}`, 'Accept':'application/vnd.github+json',
          'X-GitHub-Api-Version':'2022-11-28', 'Content-Type':'application/json' },
        body: JSON.stringify({ ref:'main', inputs }) }
    );
    if (res.status === 204) {
      runStartTime = Date.now();
      document.getElementById('run-tracker').classList.remove('hidden');
      document.getElementById('btn-abort-run').classList.remove('hidden');
      updateTracker('queued', null, 0);
      startRunPoll(pat);
    } else if (res.status === 401 || res.status === 403) {
      setRunStatus('error', `❌ Token rejected (${res.status}) — check it has "workflow" scope.`);
      btn.disabled = false; btn.textContent = 'Start Run';
    } else {
      setRunStatus('error', `❌ GitHub API error ${res.status}: ${await res.text()}`);
      btn.disabled = false; btn.textContent = 'Start Run';
    }
  } catch(e) {
    setRunStatus('error', `❌ Network error: ${e.message}`);
    btn.disabled = false; btn.textContent = 'Start Run';
  }
}

function updateTracker(status, conclusion, elapsedSec) {
  const pct = Math.min((elapsedSec/600)*100, 95).toFixed(1);
  const m   = Math.floor(elapsedSec/60), s = String(elapsedSec%60).padStart(2,'0');
  set('tracker-icon',  { queued:'⏳', in_progress:'🔄', completed: conclusion==='success'?'✅':'❌' }[status]||'⏳');
  set('tracker-label', {
    queued:      'Queued on GitHub…',
    in_progress: `Running — ${m}m ${s}s  (est. ~10 min)`,
    completed:   conclusion==='success' ? `Done in ${m}m ${s}s — refreshing…` : `Failed after ${m}m ${s}s`
  }[status] || status);
  const bar = document.getElementById('tracker-bar');
  bar.style.width      = status==='completed' ? '100%' : pct+'%';
  bar.style.background = conclusion==='failure' ? '#EF5350' : 'linear-gradient(90deg,#2e7d32,#4CAF50)';
}

function startRunPoll(pat) {
  stopRunPoll();
  runPollTicks = 0;
  runTickTimer = setInterval(() => {
    if (!runStartTime) return;
    const e = Math.floor((Date.now()-runStartTime)/1000);
    const lbl = document.getElementById('tracker-label').textContent;
    if (lbl.includes('Running')||lbl.includes('Queued')) updateTracker(e>8?'in_progress':'queued', null, e);
  }, 1000);

  runPollTimer = setInterval(async () => {
    // Hard cap the poller so runaway/stuck runs don't spin forever.
    runPollTicks += 1;
    if (runPollTicks > POLL_MAX_TICKS) {
      stopRunPoll();
      setRunStatus('error', '⚠️ Stopped watching after 10 min — check GitHub Actions directly.');
      return;
    }
    try {
      const r = await fetchWithRetry(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?event=workflow_dispatch&per_page=5`,
        { headers:{ 'Authorization':`Bearer ${pat}`, 'Accept':'application/vnd.github+json' } }
      );
      if (!r.ok) return;
      const data = await r.json();
      const run  = data.workflow_runs?.find(w => new Date(w.created_at).getTime() >= runStartTime - 30_000);
      if (!run) return;
      if (!activeRunId) activeRunId = run.id;   // capture once found
      const elapsed = Math.floor((Date.now()-runStartTime)/1000);
      if (run.status === 'completed') {
        stopRunPoll();
        updateTracker('completed', run.conclusion, elapsed);
        if (run.conclusion === 'success') {
          setRunStatus('success', '✅ Pricing complete! Refreshing results…');
          setTimeout(() => { loadData(); closeModal('modal-run'); resetRunModal(); }, 3500);
        } else {
          setRunStatus('error', `❌ Run failed. <a href="https://github.com/${REPO_OWNER}/${REPO_NAME}/actions" target="_blank" style="color:#ef9a9a">View logs →</a>`);
          const btn = document.getElementById('btn-confirm-run'); btn.disabled=false; btn.textContent='Retry';
        }
      } else { updateTracker(run.status, null, elapsed); }
    } catch(_) {}
  }, 15_000);
}

function stopRunPoll() {
  if (runPollTimer) { clearInterval(runPollTimer); runPollTimer=null; }
  if (runTickTimer) { clearInterval(runTickTimer); runTickTimer=null; }
}
function cancelRun() { stopRunPoll(); resetRunModal(); closeModal('modal-run'); }
function resetRunModal() {
  activeRunId = null;
  const btn = document.getElementById('btn-confirm-run'); btn.disabled=false; btn.textContent='Start Run';
  document.getElementById('run-tracker').classList.add('hidden');
  document.getElementById('btn-abort-run').classList.add('hidden');
  document.getElementById('tracker-bar').style.width='0%';
  document.getElementById('input-force').checked = false;
  document.getElementById('input-stale-days').disabled = false;
  document.getElementById('stale-hint').textContent = '';
  document.getElementById('input-start-row').value = '0';
  document.getElementById('start-row-hint').textContent = 'row 0 = start from the beginning';
  setRunStatus('','');
}

async function abortRun() {
  const pat = getPAT();
  if (!pat) return;
  const btn = document.getElementById('btn-abort-run');
  btn.disabled = true; btn.textContent = 'Cancelling…';
  try {
    // activeRunId is set by the poll timer, which fires every 15s.
    // If the user clicks Cancel before the first poll, fetch the run ID now.
    if (!activeRunId) {
      const r = await fetchWithRetry(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?event=workflow_dispatch&per_page=5`,
        { headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json' } }
      );
      if (r.ok) {
        const data = await r.json();
        const run  = data.workflow_runs?.find(w => new Date(w.created_at).getTime() >= runStartTime - 30_000);
        if (run) activeRunId = run.id;
      }
    }

    if (!activeRunId) {
      // Run queued but not visible in the API yet — tell the user to retry
      setRunStatus('error', '⚠️ Run not visible in GitHub yet — wait a moment and try again.');
      btn.disabled = false; btn.textContent = '⛔ Cancel Run';
      return;
    }

    await fetchWithRetry(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs/${activeRunId}/cancel`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json' } }
    );
    setRunStatus('error', '⛔ Run cancelled.');
    stopRunPoll();
    resetRunModal();
    closeModal('modal-run');
  } catch(e) {
    btn.disabled = false; btn.textContent = '⛔ Cancel Run';
    setRunStatus('error', `❌ Could not cancel: ${e.message}`);
  }
}
function setRunStatus(type, msg) {
  const el = document.getElementById('run-status');
  el.className = type ? `run-status ${type}` : 'run-status hidden';
  el.innerHTML = msg;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getPAT()        {
  // Migrate legacy localStorage token to sessionStorage once, then clear the persistent copy.
  const legacy = localStorage.getItem('gh_pat');
  if (legacy) { sessionStorage.setItem('gh_pat', legacy); localStorage.removeItem('gh_pat'); }
  return sessionStorage.getItem('gh_pat') || '';
}
function openModal(id)   { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id)  { document.getElementById(id).classList.add('hidden'); }
function set(id, val)    { const el=document.getElementById(id); if(el) el.textContent=val; }
function esc(str)        { return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmt$(n)         { return n!=null&&n!=='' ? '$'+parseFloat(n).toFixed(2) : '—'; }
function fmtDate(iso)    { if(!iso) return '—'; try { return new Date(iso).toLocaleDateString(); } catch{return '—';} }
function fmtDateShort(d) { if(!d) return '—'; const p=String(d).split('-'); return p.length>=3?`${p[1]}/${String(p[0]).slice(2)}`:d; }
function safeJson(obj)   { return JSON.stringify(obj).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function confidenceBadge(conf) {
  const c=(conf||'').toLowerCase(); let cls='badge-floor';
  if(c.includes('very high')) cls='badge-very-high';
  else if(c.includes('high')) cls='badge-high';
  else if(c.includes('medium')) cls='badge-medium';
  else if(c.includes('low')) cls='badge-low';
  return `<span class="badge ${cls}">${esc((conf||'Floor').split('(')[0].trim())}</span>`;
}

function showEmpty(msg) {
  ['top-cards-list','market-movers','era-chart','brand-chart'].forEach(id => {
    const el=document.getElementById(id); if(el) el.innerHTML=`<div class="state-empty">${id==='top-cards-list'?msg:''}</div>`;
  });
  const pc=document.getElementById('portfolio-chart'); if(pc) pc.innerHTML='<div class="state-empty"></div>';
  const tb=document.getElementById('cards-tbody'); if(tb) tb.innerHTML=`<tr><td colspan="11" class="state-empty">${msg}</td></tr>`;
  set('last-updated','Never');
}
