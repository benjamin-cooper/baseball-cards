/**
 * Further Insights — pricing.js
 * Loads pricing_results.json, renders the page, handles GitHub Actions trigger.
 */

const REPO_OWNER  = 'benjamin-cooper';
const REPO_NAME   = 'baseball-cards';
const WORKFLOW_ID = 'price_cards.yml';
const DATA_URL    = 'data/pricing_results.json';

// ─── State ────────────────────────────────────────────────────────────────────
let allCards    = [];
let filtered    = [];
let sortCol     = 'avg_price';
let sortDir     = 'desc';

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  bindUI();
});

// ─── Data Loading ─────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const res  = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
  } catch (e) {
    showEmpty('No pricing data yet. Click ⚡ Update Prices to run the pricing agent.');
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(data) {
  renderStats(data);
  renderTopCards(data.top_cards || []);
  renderEraChart(data.by_era  || {});
  allCards = data.cards || [];
  populateYearFilter(allCards);
  applyFilters();
  document.getElementById('last-updated').textContent =
    data.last_updated ? new Date(data.last_updated).toLocaleString() : '—';
}

function renderStats(data) {
  const fmt  = n => n != null ? '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—';
  const pct  = n => n != null ? (n > 0 ? '+' : '') + n.toFixed(1) + '%' : '—';

  set('stat-total-value',  fmt(data.total_value));
  set('stat-cards-priced', data.cards_priced != null ? data.cards_priced.toLocaleString() : '—');
  set('stat-avg-value',    fmt(data.avg_value));
  set('stat-winners',      data.winners != null ? data.winners.toLocaleString() : '—');
  set('stat-unrealized',   data.unrealized_gain != null
    ? (data.unrealized_gain >= 0 ? '+' : '') + fmt(data.unrealized_gain)
    : '—');
  set('stat-top-card',     fmt(data.top_card_value));

  // Colour unrealized gain/loss
  const el = document.getElementById('stat-unrealized');
  if (data.unrealized_gain != null) {
    el.style.color = data.unrealized_gain >= 0 ? '#4CAF50' : '#EF5350';
  }
}

function renderTopCards(cards) {
  const el = document.getElementById('top-cards-list');
  if (!cards.length) {
    el.innerHTML = '<div class="state-empty">No data yet</div>';
    return;
  }
  el.innerHTML = cards.map((c, i) => `
    <div class="top-card-row">
      <span class="top-card-rank">${i + 1}</span>
      <span class="top-card-name" title="${esc(c.player)} — ${esc(c.brand)}">${esc(c.player)}</span>
      <span class="top-card-year">${c.year}</span>
      <span class="top-card-price">${fmt$(c.avg_price)}</span>
    </div>`).join('');
}

function renderEraChart(byEra) {
  const el  = document.getElementById('era-chart');
  const entries = Object.entries(byEra).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    el.innerHTML = '<div class="state-empty">No data yet</div>';
    return;
  }
  const maxVal = Math.max(...entries.map(([, v]) => v.total_value || 0), 1);
  el.innerHTML = entries.map(([era, stats]) => {
    const pct = ((stats.total_value || 0) / maxVal * 100).toFixed(1);
    return `
      <div class="era-row">
        <span class="era-label">${esc(era)}</span>
        <div class="era-bar-wrap">
          <div class="era-bar" style="width:${pct}%"></div>
        </div>
        <span class="era-value">${fmt$(stats.total_value)}</span>
      </div>`;
  }).join('');
}

// ─── Table ────────────────────────────────────────────────────────────────────
function applyFilters() {
  const q    = document.getElementById('table-search').value.toLowerCase();
  const yr   = document.getElementById('filter-year').value;
  const conf = document.getElementById('filter-confidence').value;
  const win  = document.getElementById('filter-winner').value;

  filtered = allCards.filter(c => {
    if (yr   && String(c.year)   !== yr)                       return false;
    if (win  && c.is_winner      !== win)                      return false;
    if (conf && !((c.confidence || '').includes(conf)))        return false;
    if (q) {
      const hay = `${c.player} ${c.brand} ${c.year} ${c.card_number} ${c.team}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  sortTable();
}

function sortTable() {
  filtered.sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    // Numeric cols
    if (['avg_price','purchase_price','roi'].includes(sortCol)) {
      av = parseFloat(av) || 0;
      bv = parseFloat(bv) || 0;
    } else {
      av = (av ?? '').toString().toLowerCase();
      bv = (bv ?? '').toString().toLowerCase();
    }
    if (av < bv) return sortDir === 'asc' ?  -1 : 1;
    if (av > bv) return sortDir === 'asc' ?   1 : -1;
    return 0;
  });
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('cards-tbody');
  document.getElementById('table-count').textContent = `${filtered.length.toLocaleString()} cards`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="state-empty">No cards match your filters</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const roi     = parseFloat(c.roi);
    const roiTxt  = isNaN(roi) ? '<span class="roi-na">—</span>' :
                    `<span class="${roi >= 0 ? 'roi-pos' : 'roi-neg'}">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</span>`;
    return `<tr>
      <td>${esc(c.player)}</td>
      <td>${c.year}</td>
      <td>${esc(c.brand)}</td>
      <td style="color:#777">${esc(c.card_number || '—')}</td>
      <td class="num" style="color:#4CAF50;font-weight:600">${fmt$(c.avg_price)}</td>
      <td class="num" style="color:#888">${fmt$(c.purchase_price)}</td>
      <td class="num">${roiTxt}</td>
      <td>${confidenceBadge(c.confidence)}</td>
      <td><span class="scarcity-${(c.scarcity || 'base').toLowerCase().replace(' ','-')}">${esc(c.scarcity || '—')}</span></td>
      <td style="color:#666;font-size:0.8em">${fmtDate(c.last_updated)}</td>
    </tr>`;
  }).join('');
}

function populateYearFilter(cards) {
  const years = [...new Set(cards.map(c => c.year))].filter(Boolean).sort();
  const sel   = document.getElementById('filter-year');
  years.forEach(yr => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = yr;
    sel.appendChild(opt);
  });
}

// ─── UI Bindings ──────────────────────────────────────────────────────────────
function bindUI() {
  // Search + filters
  document.getElementById('table-search').addEventListener('input', applyFilters);
  document.getElementById('filter-year').addEventListener('change', applyFilters);
  document.getElementById('filter-confidence').addEventListener('change', applyFilters);
  document.getElementById('filter-winner').addEventListener('change', applyFilters);

  // Column sort
  document.querySelectorAll('#cards-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = col === 'avg_price' ? 'desc' : 'asc';
      }
      document.querySelectorAll('#cards-table th').forEach(t => {
        t.classList.remove('sort-asc','sort-desc');
      });
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      sortTable();
    });
  });

  // Update button → run modal
  document.getElementById('btn-update').addEventListener('click', () => {
    if (!getPAT()) {
      openSettings();
      return;
    }
    openModal('modal-run');
  });

  // Settings
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-cancel-settings').addEventListener('click', () => closeModal('modal-settings'));
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-cancel-run').addEventListener('click', () => closeModal('modal-run'));
  document.getElementById('btn-confirm-run').addEventListener('click', triggerRun);

  // Pre-fill PAT if stored
  const pat = getPAT();
  if (pat) document.getElementById('input-pat').value = pat;

  // Close modals on backdrop click
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
function openSettings() {
  const pat = getPAT();
  if (pat) document.getElementById('input-pat').value = pat;
  openModal('modal-settings');
}

function saveSettings() {
  const pat = document.getElementById('input-pat').value.trim();
  if (pat) {
    localStorage.setItem('gh_pat', pat);
    closeModal('modal-settings');
  }
}

// ─── GitHub Actions Trigger ───────────────────────────────────────────────────
async function triggerRun() {
  const pat   = getPAT();
  const batch = document.getElementById('input-batch').value || '50';
  if (!pat) { openSettings(); return; }

  const btn    = document.getElementById('btn-confirm-run');
  const status = document.getElementById('run-status');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  status.className = 'run-status hidden';

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_ID}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: { batch_size: String(batch) }
        })
      }
    );

    if (res.status === 204) {
      status.className = 'run-status success';
      status.textContent = '✅ Pricing run queued! Results will appear here in ~10 minutes. You can track progress in the Actions tab on GitHub.';
    } else if (res.status === 401 || res.status === 403) {
      status.className = 'run-status error';
      status.textContent = `❌ GitHub token rejected (${res.status}). Check it has "workflow" scope and hasn't expired.`;
    } else {
      const body = await res.text();
      status.className = 'run-status error';
      status.textContent = `❌ GitHub API error ${res.status}: ${body}`;
    }
  } catch (e) {
    status.className = 'run-status error';
    status.textContent = `❌ Network error: ${e.message}`;
  }

  status.classList.remove('hidden');
  btn.disabled    = false;
  btn.textContent = 'Start Run';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getPAT()              { return localStorage.getItem('gh_pat') || ''; }
function openModal(id)         { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id)        { document.getElementById(id).classList.add('hidden'); }
function set(id, val)          { const el = document.getElementById(id); if (el) el.textContent = val; }
function esc(str)              { return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmt$(n)               { return n != null && n !== '' ? '$' + parseFloat(n).toFixed(2) : '—'; }
function fmtDate(iso)          { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(); } catch { return '—'; } }

function confidenceBadge(conf) {
  const c = (conf || '').toLowerCase();
  let cls = 'badge-floor';
  if (c.includes('very high')) cls = 'badge-very-high';
  else if (c.includes('high')) cls = 'badge-high';
  else if (c.includes('medium')) cls = 'badge-medium';
  else if (c.includes('low'))  cls = 'badge-low';
  const label = (conf || 'Floor').split('(')[0].trim(); // strip "(sold)" suffix
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function showEmpty(msg) {
  document.getElementById('top-cards-list').innerHTML = `<div class="state-empty">${msg}</div>`;
  document.getElementById('era-chart').innerHTML      = `<div class="state-empty"></div>`;
  document.getElementById('cards-tbody').innerHTML    = `<tr><td colspan="10" class="state-empty">${msg}</td></tr>`;
  document.getElementById('last-updated').textContent = 'Never';
}
