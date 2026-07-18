const state = { weeklyItems: [], weeklyRows: [], sourceRows: [], grizzlyTasks: [], imbuingItems: [], imbuingRows: [], imbuingCompareRows: [], greenDjinnItems: [], greenDjinnRows: [], enriching: false, stopEnrich: false, loadingImbuing: false, loadingGreenDjinn: false };
const QUICK_ITEMS = [];
const TOKEN_COUNTS = { Basic: 2, Intricate: 4, Powerful: 6 };
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const summaryEl = $('summary');
const sourcesPanel = $('sourcesPanel');
const weeklyPanel = $('weeklyPanel');
const grizzlyPanel = $('grizzlyPanel');
const imbuingPanel = $('imbuingPanel');
const greenDjinnPanel = $('greenDjinnPanel');
const sourcesBody = document.querySelector('#sourcesTable tbody');
const weeklyBody = document.querySelector('#weeklyTable tbody');
const grizzlyBody = document.querySelector('#grizzlyTable tbody');
const imbuingBody = document.querySelector('#imbuingTable tbody');
const imbuingCompareBody = document.querySelector('#imbuingCompareTable tbody');
const greenDjinnBody = document.querySelector('#greenDjinnTable tbody');

function norm(s) { return String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim(); }
function fmtGp(v) { if (v === undefined || v === null || v === '' || Number.isNaN(Number(v))) return '—'; return Number(v).toLocaleString() + ' gp'; }
function fmtNum(v) { if (v === undefined || v === null || v === '' || Number.isNaN(Number(v))) return '—'; return Number(v).toLocaleString(); }
function fmtPct(v) { if (v === undefined || v === null || v === '' || Number.isNaN(Number(v))) return '—'; return Number(v).toFixed(Number(v) < 1 ? 2 : 1) + '%'; }
function setStatus(msg, klass='') { statusEl.innerHTML = `<span class="${klass}">${msg}</span>`; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function csvEscape(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function downloadCsv(name, rows) { const blob = new Blob([rows.map(r => r.map(csvEscape).join(',')).join('\n')], {type:'text/csv;charset=utf-8'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function fetchJson(url) { const res = await fetch(url); const txt = await res.text(); if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${txt.slice(0,160)}`); try { return JSON.parse(txt); } catch(e) { throw new Error(`Server returned non-JSON: ${txt.slice(0,160)}`); } }
function wikiPageLink(title) { return `https://tibia.fandom.com/wiki/${encodeURIComponent(String(title).trim().replace(/ /g, '_'))}`; }
function nval(row, key, highForBlank=false) { const v = Number(row[key]); return Number.isFinite(v) ? v : (highForBlank ? 1e15 : -1e15); }

async function loadWeeklyItems() {
  state.weeklyItems = await fetchJson('weekly_items.json');
  await loadReferenceData();
  const names = new Set(state.weeklyItems.map(x => x.name));
  state.imbuingItems.forEach(x => names.add(x.name));
  state.greenDjinnItems.forEach(x => names.add(x.item));
  state.grizzlyTasks.forEach(t => { (t.valuables || []).forEach(x => names.add(x)); (t.mobs || []).forEach(x => names.add(x)); });
  ['Tarantula Egg','Vampire Teeth','Spider Silk','Honeycomb','Broken Shamanic Staff','Dragon Ham','Demon Horn','Gold Token'].forEach(x => names.add(x));
  $('itemSuggestions').innerHTML = [...names].filter(Boolean).sort((a,b)=>a.localeCompare(b)).map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}

async function loadReferenceData() {
  const [g, i, gd] = await Promise.all([fetchJson('grizzly_tasks.json'), fetchJson('imbuement_items.json'), fetchJson('green_djinn_items.json')]);
  state.grizzlyTasks = g;
  state.imbuingItems = i.map(x => ({...x}));
  state.greenDjinnItems = gd.map(x => ({...x}));
}

async function loadPrice(itemName) {
  const world = $('worldInput').value.trim() || 'Bona';
  return fetchJson(`/api/price?world=${encodeURIComponent(world)}&item=${encodeURIComponent(itemName)}`);
}
async function loadLootSources(itemName) { return fetchJson(`/api/loot_sources?item=${encodeURIComponent(itemName)}`); }
async function loadWeeklyRow(itemName) {
  const world = $('worldInput').value.trim() || 'Bona';
  return fetchJson(`/api/weekly_row?world=${encodeURIComponent(world)}&item=${encodeURIComponent(itemName)}`);
}


function itemIconUrl(itemName) {
  return `https://tibia.fandom.com/wiki/Special:Redirect/file/${encodeURIComponent(String(itemName).trim().replace(/ /g, '_'))}.gif`;
}
function renderQuickSkeleton() {
  const el = $('quickItems');
  if (!el) return;
  el.innerHTML = QUICK_ITEMS.map(item => `<div class="quickCard loading" data-item="${escapeHtml(item)}">
    <img src="${escapeHtml(itemIconUrl(item))}" alt="" onerror="this.style.visibility='hidden'" />
    <div><div class="qName">${escapeHtml(item)}</div><div class="qPrice">Loading…</div><div class="qSub">${escapeHtml($('worldInput')?.value || 'Bona')}</div></div>
  </div>`).join('');
}
async function loadQuickPrices() {
  const el = $('quickItems');
  if (!el) return;
  renderQuickSkeleton();
  const world = $('worldInput')?.value || 'Bona';
  await Promise.allSettled(QUICK_ITEMS.map(async (item) => {
    const card = el.querySelector(`.quickCard[data-item="${CSS.escape(item)}"]`);
    try {
      const p = await loadPrice(item);
      const value = p.avg_value_used ?? p.current_market_price ?? p.global_average_price;
      if (card) {
        card.classList.remove('loading');
        if (value == null) card.classList.add('error');
        const priceEl = card.querySelector('.qPrice');
        const subEl = card.querySelector('.qSub');
        if (priceEl) priceEl.textContent = value == null ? 'No price' : fmtGp(value);
        if (subEl) subEl.textContent = p.error ? 'Price lookup failed' : world;
        card.title = p.error || `${item} price on ${world}`;
      }
    } catch (e) {
      if (card) {
        card.classList.remove('loading'); card.classList.add('error');
        const priceEl = card.querySelector('.qPrice');
        const subEl = card.querySelector('.qSub');
        if (priceEl) priceEl.textContent = 'No price';
        if (subEl) subEl.textContent = 'Lookup failed';
        card.title = e.message;
      }
    }
  }));
}

function renderSummary(itemName, price, weekly) {
  summaryEl.classList.remove('hidden');
  const cards = [
    ['Item', itemName],
    ['World', $('worldInput').value.trim() || 'Bona'],
    ['Buy offer', fmtGp(price.buy_offer)],
    ['Sell offer', fmtGp(price.sell_offer ?? price.current_market_price)],
    ['Global / monthly avg', fmtGp(price.global_average_price ?? price.month_average_sell)],
    ['Weekly Delivery Task', weekly ? 'Yes' : 'No / not in bundled weekly list'],
    ['Price source', price.url ? `<a href="${escapeHtml(price.url)}" target="_blank" rel="noopener">Open</a>` : (price.source || '—')]
  ];
  summaryEl.innerHTML = cards.map(([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${String(value).startsWith('<a ') ? value : escapeHtml(value)}</div></div>`).join('');
}
function renderSources(rows) {
  state.sourceRows = rows;
  sourcesPanel.classList.remove('hidden');
  const first = rows[0] || {};
  const extra = first.totalParsedSources > rows.length ? `<p class="hint">Showing the ${rows.length} lowest-HP monster source(s) out of ${first.totalParsedSources} parsed source(s). NPCs/non-monsters are ignored for HP sorting.</p>` : '';
  sourcesBody.innerHTML = rows.map(r => `<tr>
    <td>${escapeHtml(r.source)}</td>
    <td data-num="${r.hp ?? ''}">${escapeHtml(r.hpText || (r.hp ? fmtNum(r.hp) : '—'))}</td>
    <td data-num="${r.chancePercent ?? ''}">${escapeHtml(r.chance || '—')}</td>
    <td>${escapeHtml(r.average || '—')}</td>
    <td>${escapeHtml(r.sample || '—')}</td>
    <td>${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">Open</a>` : '—'}</td>
  </tr>`).join('');
  const existing = sourcesPanel.querySelector('.sourceLimitNote'); if (existing) existing.remove();
  if (extra) { const note = document.createElement('div'); note.className='sourceLimitNote'; note.innerHTML=extra; sourcesPanel.insertBefore(note, sourcesPanel.querySelector('.tableWrap')); }
}

async function searchItem() {
  const raw = $('itemInput').value.trim();
  if (!raw) return setStatus('Type an item name first.', 'warn');
  try {
    summaryEl.classList.add('hidden'); sourcesPanel.classList.add('hidden');
    const weekly = state.weeklyItems.find(x => norm(x.name) === norm(raw));
    setStatus('Loading market price from local server…');
    const price = await loadPrice(raw).catch(e => ({error: e.message, source: 'Price lookup failed'}));
    renderSummary(raw, price, Boolean(weekly));
    setStatus('Looking up monster loot sources, HP and drop chance…');
    const lootRows = await loadLootSources(raw);
    renderSources(lootRows);
    if (price.error) setStatus(`Done with loot data, but price lookup failed: ${escapeHtml(price.error)}`, 'warn');
    else setStatus(`Done: ${escapeHtml(raw)}.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${escapeHtml(err.message)}. Check the Python server window for details.`, 'bad');
  }
}

function getFilteredWeeklyRows() {
  const filter = norm($('weeklyFilter').value);
  const rows = [...state.weeklyItems].filter(r => !filter || norm(`${r.name} ${r.category} ${r.dropSources} ${r.lowestSource || ''}`).includes(filter));
  const sort = $('weeklySort').value;
  if (sort === 'avgValue') rows.sort((a,b)=> nval(b,'avgValue') - nval(a,'avgValue') || a.name.localeCompare(b.name));
  else if (sort === 'lowestHp') rows.sort((a,b)=> nval(a,'lowestHp', true) - nval(b,'lowestHp', true) || a.name.localeCompare(b.name));
  else if (sort === 'dropChancePercent') rows.sort((a,b)=> nval(b,'dropChancePercent') - nval(a,'dropChancePercent') || a.name.localeCompare(b.name));
  else rows.sort((a,b) => String(a[sort] || '').localeCompare(String(b[sort] || '')));
  return rows;
}

function renderWeeklyTable() {
  const rows = getFilteredWeeklyRows();
  state.weeklyRows = rows;
  weeklyBody.innerHTML = rows.map(r => `<tr>
    <td>${escapeHtml(r.name)}</td>
    <td>${escapeHtml(r.category)}</td>
    <td data-num="${r.avgValue ?? ''}">${r.loading ? 'Loading…' : fmtGp(r.avgValue)}</td>
    <td data-num="${r.dropChancePercent ?? ''}">${r.loading ? 'Loading…' : (r.dropChanceText || fmtPct(r.dropChancePercent))}</td>
    <td>${escapeHtml(r.monsterSourcesText || r.lowestSource || '—')}</td>
    <td>${r.priceUrl ? `<a href="${escapeHtml(r.priceUrl)}" target="_blank" rel="noopener">Price</a>` : '—'}</td>
    <td><a href="${escapeHtml(r.wikiUrl || wikiPageLink(r.name))}" target="_blank" rel="noopener">Tibiopedia</a></td>
  </tr>`).join('');
}
function showWeeklyProfit() { weeklyPanel.classList.remove('hidden'); renderWeeklyTable(); setStatus(`Loaded ${state.weeklyItems.length} weekly items. Click “Load avg values + sources” to fill price, drop %, and 2 lowest-HP non-boss monster sources.`, 'ok'); }

async function enrichVisibleWeeklyRows() {
  if (state.enriching) return;
  state.enriching = true; state.stopEnrich = false;
  const rows = getFilteredWeeklyRows();
  const total = rows.length;
  let done = 0, failed = 0;
  $('loadWeeklyValuesBtn').disabled = true;
  $('stopWeeklyValuesBtn').disabled = false;
  setStatus(`Loading avg value, drop %, and 2 lowest-HP monster sources for ${total} visible weekly row(s)… Using 8 workers + local cache; worlds limited to Bona/Celesta/Dia/Kalanta`, 'warn');

  const queue = rows.filter(r => !r.enriched || r.enrichWorld !== ($('worldInput').value.trim() || 'Bona'));
  queue.forEach(r => { r.loading = true; });
  renderWeeklyTable();

  async function worker() {
    while (queue.length && !state.stopEnrich) {
      const row = queue.shift();
      try {
        const data = await loadWeeklyRow(row.name);
        Object.assign(row, data, { enriched: true, loading: false, enrichWorld: ($('worldInput').value.trim() || 'Bona') });
      } catch (e) {
        row.loading = false; row.enrichError = e.message; failed++;
      } finally {
        done++;
        if (done % 10 === 0 || done === total) renderWeeklyTable();
        const cached = row.fromCache ? ' cached' : '';
        setStatus(`Weekly enrichment: ${done}/${total} processed${cached}${failed ? `, ${failed} failed` : ''}. First full run is slow; cached reruns are much faster.`, failed ? 'warn' : 'ok');
      }
    }
  }
  const workerCount = Math.min(8, Math.max(1, queue.length));
  const workers = Array.from({length: workerCount}, () => worker());
  await Promise.all(workers);
  state.enriching = false;
  $('loadWeeklyValuesBtn').disabled = false;
  $('stopWeeklyValuesBtn').disabled = true;
  queue.forEach(r => { r.loading = false; });
  renderWeeklyTable();
  setStatus(state.stopEnrich ? `Stopped after ${done}/${total} rows.` : `Finished weekly enrichment: ${done}/${total} rows. Sort by avg value, drop chance, or monster HP now.`, state.stopEnrich ? 'warn' : 'ok');
}


function hideDataPanelsExcept(panel) {
  [weeklyPanel, grizzlyPanel, imbuingPanel, greenDjinnPanel].forEach(p => { if (p && p !== panel) p.classList.add('hidden'); });
}

function renderItemChips(items) {
  return (items || []).map(item => `<a class="chip" href="#" data-search-item="${escapeHtml(item)}">${escapeHtml(item)}</a>`).join(' ');
}

function getFilteredGrizzlyRows() {
  const range = $('grizzlyRange')?.value || '';
  const filter = norm($('grizzlyFilter')?.value || '');
  return state.grizzlyTasks.filter(t => {
    if (range && t.levelRange !== range) return false;
    const hay = norm(`${t.levelRange} ${t.task} ${(t.mobs||[]).join(' ')} ${(t.valuables||[]).join(' ')}`);
    return !filter || hay.includes(filter);
  });
}

function renderGrizzlyTable() {
  if (!grizzlyBody) return;
  const rows = getFilteredGrizzlyRows();
  grizzlyBody.innerHTML = rows.map(t => `<tr>
    <td>${escapeHtml(t.levelRange)}</td>
    <td>${escapeHtml(t.task)}</td>
    <td data-num="${t.count ?? ''}">${fmtNum(t.count)}</td>
    <td>${renderItemChips(t.mobs)}</td>
    <td>${renderItemChips(t.valuables)}</td>
    <td><a href="https://tibia.fandom.com/wiki/Killing_in_the_Name_of..._Quest/Spoiler#Level_${encodeURIComponent(String(t.levelRange).replace('+','+'))}_Tasks" target="_blank" rel="noopener">Wiki</a></td>
  </tr>`).join('');
}

function showGrizzly() {
  hideDataPanelsExcept(grizzlyPanel);
  grizzlyPanel.classList.remove('hidden');
  renderGrizzlyTable();
  setStatus(`Grizzly Adams: ${state.grizzlyTasks.length} task rows loaded.`, 'ok');
}


function getGreenDjinnMarketPrice(row) {
  return row.sellOffer ?? row.marketAvg ?? row.buyOffer ?? null;
}
function getGreenDjinnProfit(row) {
  const market = getGreenDjinnMarketPrice(row);
  if (market == null || row.npcPrice == null) return null;
  return Number(row.npcPrice) - Number(market);
}
function getFilteredGreenDjinnRows() {
  const filter = norm($('greenDjinnFilter')?.value || '');
  const rows = state.greenDjinnItems.filter(r => !filter || norm(`${r.item} ${r.npc}`).includes(filter));
  const sort = $('greenDjinnSort')?.value || 'profit';
  if (sort === 'profit') rows.sort((a,b)=> (getGreenDjinnProfit(b) ?? -1e15) - (getGreenDjinnProfit(a) ?? -1e15) || a.item.localeCompare(b.item));
  else if (sort === 'marketPrice') rows.sort((a,b)=> (getGreenDjinnMarketPrice(b) ?? -1e15) - (getGreenDjinnMarketPrice(a) ?? -1e15) || a.item.localeCompare(b.item));
  else if (sort === 'npcPrice') rows.sort((a,b)=> Number(b.npcPrice||0) - Number(a.npcPrice||0) || a.item.localeCompare(b.item));
  else rows.sort((a,b)=> String(a[sort]||'').localeCompare(String(b[sort]||'')) || a.item.localeCompare(b.item));
  return rows;
}
function renderGreenDjinnTable() {
  if (!greenDjinnBody) return;
  const rows = getFilteredGreenDjinnRows();
  state.greenDjinnRows = rows;
  greenDjinnBody.innerHTML = rows.map(r => {
    const marketUsed = getGreenDjinnMarketPrice(r);
    const profit = getGreenDjinnProfit(r);
    const cls = profit == null ? '' : (profit >= 0 ? 'good' : 'bad');
    return `<tr>
      <td>${escapeHtml(r.item)}</td>
      <td>${escapeHtml(r.npc)}</td>
      <td data-num="${r.npcPrice ?? ''}">${fmtGp(r.npcPrice)}</td>
      <td data-num="${r.buyOffer ?? ''}">${r.loading ? 'Loading…' : fmtGp(r.buyOffer)}</td>
      <td data-num="${r.sellOffer ?? ''}">${r.loading ? 'Loading…' : fmtGp(r.sellOffer)}</td>
      <td data-num="${r.marketAvg ?? ''}">${r.loading ? 'Loading…' : fmtGp(r.marketAvg)}</td>
      <td data-num="${marketUsed ?? ''}">${r.loading ? 'Loading…' : fmtGp(marketUsed)}</td>
      <td class="${cls}" data-num="${profit ?? ''}">${profit == null ? '—' : fmtGp(profit)}</td>
      <td>${r.priceUrl ? `<a href="${escapeHtml(r.priceUrl)}" target="_blank" rel="noopener">Price</a>` : '—'}</td>
      <td><a href="${escapeHtml(wikiPageLink(r.item))}" target="_blank" rel="noopener">Wiki</a></td>
    </tr>`;
  }).join('');
}
function showGreenDjinn() {
  hideDataPanelsExcept(greenDjinnPanel);
  greenDjinnPanel.classList.remove('hidden');
  renderGreenDjinnTable();
  setStatus(`Green Djinn: ${state.greenDjinnItems.length} itemów. Kliknij “Download current prices + load Green Djinn”, żeby pobrać ceny dla ${escapeHtml($('worldInput').value)}.`, 'ok');
}
async function loadGreenDjinnPrices() {
  if (state.loadingGreenDjinn) return;
  state.loadingGreenDjinn = true;
  const btn = $('loadGreenDjinnPricesBtn');
  if (btn) btn.disabled = true;
  const world = $('worldInput').value || 'Bona';
  try {
    const dl = await ensureMarketTopDownloaded(world, 'Green Djinn prices');
    setStatus(`${escapeHtml(dl.message || 'Market prices downloaded.')} Loading Green Djinn items…`, 'ok');
    state.greenDjinnItems.forEach(r => { if (r.priceWorld !== world) { delete r.buyOffer; delete r.sellOffer; delete r.marketAvg; delete r.priceUrl; delete r.priceWorld; delete r.priceError; } });
  } catch (e) {
    setStatus(`Could not download fresh TibiaMarket.top data: ${escapeHtml(e.message)}. Trying cached/fallback prices…`, 'warn');
  }
  const queue = state.greenDjinnItems.filter(r => !r.priceWorld || r.priceWorld !== world || (r.buyOffer === undefined && r.sellOffer === undefined && r.marketAvg === undefined));
  queue.forEach(r => r.loading = true);
  renderGreenDjinnTable();
  let done = 0, failed = 0;
  setStatus(`Loading Green Djinn market prices for ${queue.length} item(s) on ${world}…`, 'warn');
  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      try {
        const price = await loadPrice(row.item);
        row.buyOffer = price.buy_offer ?? null;
        row.sellOffer = price.sell_offer ?? price.current_market_price ?? null;
        row.marketAvg = price.month_average_sell ?? price.global_average_price ?? null;
        row.priceUrl = price.url || '';
        row.priceWorld = world;
        row.priceError = price.error || '';
      } catch(e) {
        row.buyOffer = null; row.sellOffer = null; row.marketAvg = null; row.priceError = e.message; failed++;
      } finally {
        row.loading = false; done++;
        if (done % 6 === 0 || done === state.greenDjinnItems.length) renderGreenDjinnTable();
        setStatus(`Green Djinn prices: ${done}/${state.greenDjinnItems.length}${failed ? `, ${failed} failed` : ''}.`, failed ? 'warn' : 'ok');
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(8, Math.max(1, queue.length))}, () => worker()));
  state.loadingGreenDjinn = false;
  if (btn) btn.disabled = false;
  renderGreenDjinnTable();
  setStatus(`Finished Green Djinn prices for ${world}.`, failed ? 'warn' : 'ok');
}


function parseManualGp(s) {
  const cleaned = String(s || '').replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}


function manualKey(itemName) {
  return 'imbuingManualPrice:' + String(itemName || '').trim().toLowerCase();
}

function getManualItemPrice(row) {
  const direct = parseManualGp(row.manualPrice);
  if (direct) return direct;
  try {
    const saved = localStorage.getItem(manualKey(row.name));
    const v = parseManualGp(saved);
    if (v) {
      row.manualPrice = v;
      return v;
    }
  } catch (_) {}
  return null;
}

function effectiveImbuingUnitPrice(row) {
  const manual = getManualItemPrice(row);
  if (manual && manual > 0) return manual;
  const avg = Number(row.avgValue);
  return Number.isFinite(avg) && avg > 0 ? avg : null;
}

function effectiveImbuingTotal(row) {
  const price = effectiveImbuingUnitPrice(row);
  const qty = Number(row.maxQty);
  return Number.isFinite(price) && Number.isFinite(qty) ? price * qty : null;
}

function setManualImbuingPrice(itemName, value) {
  const row = state.imbuingItems.find(x => x.name === itemName);
  if (!row) return;
  const n = parseManualGp(value);
  row.manualPrice = n || 0;
  try {
    if (n && n > 0) localStorage.setItem(manualKey(itemName), String(Math.round(n)));
    else localStorage.removeItem(manualKey(itemName));
  } catch (_) {}
  renderImbuingTable();
}

function loadSavedManualImbuingPrices() {
  for (const row of state.imbuingItems) getManualItemPrice(row);
}

function imbuingBaseName(usedIn) {
  return String(usedIn || '').replace(/^Powerful\s+/i, '').trim();
}

function imbuingMaterialIndex(row, groupRows) {
  const base = imbuingBaseName(row.usedIn);
  const same = groupRows.filter(x => imbuingBaseName(x.usedIn) === base);
  return same.indexOf(row);
}

function getGoldTokenPrice() {
  return parseManualGp($('goldTokenPrice')?.value);
}

function setGoldTokenPrice(v) {
  if ($('goldTokenPrice') && Number.isFinite(Number(v)) && Number(v) > 0) $('goldTokenPrice').value = Math.round(Number(v));
}

function getImbuingGroups() {
  const groups = new Map();
  for (const row of state.imbuingItems) {
    const base = imbuingBaseName(row.usedIn);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(row);
  }
  return [...groups.entries()].map(([name, rows]) => ({name, rows}));
}

function rowCost(row) {
  return effectiveImbuingTotal(row);
}

function buildImbuingCompareRows() {
  const tokenPrice = getGoldTokenPrice();
  const levelFilter = $('imbuingCompareLevel')?.value || 'all';
  const out = [];
  for (const group of getImbuingGroups()) {
    const rows = group.rows;
    const levels = [
      {level:'Basic', count:1},
      {level:'Intricate', count:2},
      {level:'Powerful', count:3},
    ];
    for (const l of levels) {
      if (levelFilter !== 'all' && levelFilter !== l.level) continue;
      const needed = rows.slice(0, l.count);
      if (!needed.length) continue;
      const costs = needed.map(rowCost);
      const known = costs.every(x => x !== null);
      const marketTotal = known ? costs.reduce((a,b)=>a+b, 0) : null;
      const tokenCount = TOKEN_COUNTS[l.level];
      const tokenTotal = tokenPrice ? tokenPrice * tokenCount : null;
      let better = '—', diff = null;
      if (marketTotal !== null && tokenTotal !== null) {
        diff = Math.abs(marketTotal - tokenTotal);
        if (Math.round(marketTotal) === Math.round(tokenTotal)) better = 'Same';
        else better = marketTotal < tokenTotal ? 'Market items' : 'Gold Token';
      } else if (marketTotal !== null) better = 'Need token price';
      else if (tokenTotal !== null) better = 'Need item prices';
      out.push({level:l.level, imbuing:group.name, marketTotal, tokenCount, tokenTotal, better, diff});
    }
  }
  const order = {Basic: 1, Intricate: 2, Powerful: 3};
  out.sort((a,b) => order[a.level] - order[b.level] || a.imbuing.localeCompare(b.imbuing));
  return out;
}

function renderImbuingCompareTable() {
  if (!imbuingCompareBody) return;
  const rows = buildImbuingCompareRows();
  state.imbuingCompareRows = rows;
  let marketWins = 0, tokenWins = 0, unknown = 0;
  imbuingCompareBody.innerHTML = rows.map(r => {
    if (r.better === 'Market items') marketWins++;
    else if (r.better === 'Gold Token') tokenWins++;
    else unknown++;
    const cls = r.better === 'Gold Token' ? 'ok' : (r.better === 'Market items' ? 'warn' : '');
    return `<tr>
      <td>${escapeHtml(r.level)}</td>
      <td>${escapeHtml(r.imbuing)}</td>
      <td data-num="${r.marketTotal ?? ''}">${fmtGp(r.marketTotal)}</td>
      <td data-num="${r.tokenCount}">${fmtNum(r.tokenCount)}</td>
      <td data-num="${r.tokenTotal ?? ''}">${fmtGp(r.tokenTotal)}</td>
      <td class="${cls}">${escapeHtml(r.better)}</td>
      <td data-num="${r.diff ?? ''}">${fmtGp(r.diff)}</td>
    </tr>`;
  }).join('');
  const el = $('imbuingCompareSummary');
  if (el) el.textContent = `Market cheaper: ${marketWins}; Gold Token cheaper: ${tokenWins}; incomplete: ${unknown}.`;
}

async function loadGoldTokenPrice() {
  const btn = $('loadGoldTokenBtn');
  if (btn) btn.disabled = true;
  try {
    const p = await loadPrice('Gold Token');
    const value = p.avg_value_used ?? p.current_market_price ?? p.global_average_price ?? null;
    if (value) setGoldTokenPrice(value);
    renderImbuingCompareTable();
    setStatus(value ? `Gold Token price loaded: ${fmtGp(value)}.` : 'Gold Token price not found. Type it manually in the Imbuingi tab.', value ? 'ok' : 'warn');
  } catch (e) {
    setStatus(`Gold Token price lookup failed: ${escapeHtml(e.message)}. Type it manually.`, 'warn');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function getFilteredImbuingRows() {
  const filter = norm($('imbuingFilter')?.value || '');
  const rows = state.imbuingItems.filter(r => !filter || norm(`${r.name} ${r.usedIn}`).includes(filter));
  const sort = $('imbuingSort')?.value || 'avgValue';
  if (sort === 'avgValue') rows.sort((a,b)=> nval(b,'avgValue') - nval(a,'avgValue') || a.name.localeCompare(b.name));
  else if (sort === 'maxQty') rows.sort((a,b)=> nval(b,'maxQty') - nval(a,'maxQty') || a.name.localeCompare(b.name));
  else rows.sort((a,b)=> String(a[sort]||'').localeCompare(String(b[sort]||'')) || a.name.localeCompare(b.name));
  return rows;
}

function renderImbuingTable() {
  if (!imbuingBody) return;
  const rows = getFilteredImbuingRows();
  state.imbuingRows = rows;
  imbuingBody.innerHTML = rows.map(r => {
    const manual = getManualItemPrice(r) || 0;
    const effective = effectiveImbuingUnitPrice(r);
    const total = effectiveImbuingTotal(r);
    return `<tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.usedIn)}</td>
      <td data-num="${r.maxQty ?? ''}">${fmtNum(r.maxQty)}</td>
      <td data-num="${r.avgValue ?? ''}">${r.loading ? 'Loading…' : fmtGp(r.avgValue)}</td>
      <td data-num="${manual || ''}"><input class="manualPriceInput" inputmode="numeric" data-manual-price-item="${escapeHtml(r.name)}" value="${manual ? Math.round(manual) : 0}" title="0 = use avg price; any other value overrides avg price" /></td>
      <td data-num="${effective ?? ''}">${fmtGp(effective)}</td>
      <td data-num="${total ?? ''}">${fmtGp(total)}</td>
      <td>${r.priceUrl ? `<a href="${escapeHtml(r.priceUrl)}" target="_blank" rel="noopener">Price</a>` : '—'}</td>
      <td><a href="${escapeHtml(wikiPageLink(r.name))}" target="_blank" rel="noopener">Wiki</a></td>
    </tr>`;
  }).join('');
  renderImbuingCompareTable();
}

function showImbuing() {
  hideDataPanelsExcept(imbuingPanel);
  imbuingPanel.classList.remove('hidden');
  loadSavedManualImbuingPrices();
  renderImbuingTable();
  setStatus(`Imbuingi: ${state.imbuingItems.length} material rows loaded. Click “Download current prices + load imbuingi” to fill prices for ${escapeHtml($('worldInput').value)}.`, 'ok');
}

async function ensureMarketTopDownloaded(world, reason='market prices') {
  setStatus(`Downloading current ${escapeHtml(reason)} from TibiaMarket.top for ${escapeHtml(world)}…`, 'warn');
  const res = await fetchJson(`/api/download_market_top?world=${encodeURIComponent(world)}`);
  if (!res.ok) throw new Error(res.error || res.message || 'TibiaMarket.top download failed');
  return res;
}

async function loadImbuingPrices() {
  if (state.loadingImbuing) return;
  state.loadingImbuing = true;
  const btn = $('loadImbuingPricesBtn');
  if (btn) btn.disabled = true;
  const world = $('worldInput').value || 'Bona';
  try {
    const dl = await ensureMarketTopDownloaded(world, 'imbuing prices');
    setStatus(`${escapeHtml(dl.message || 'Market prices downloaded.')} Loading imbuing materials…`, 'ok');
    state.imbuingItems.forEach(r => { if (r.priceWorld !== world) { delete r.avgValue; delete r.priceUrl; delete r.priceError; } });
  } catch (e) {
    setStatus(`Could not download fresh TibiaMarket.top data: ${escapeHtml(e.message)}. Trying cached/fallback prices…`, 'warn');
  }
  const queue = state.imbuingItems.filter(r => !r.priceWorld || r.priceWorld !== world || r.avgValue === undefined);
  queue.forEach(r => r.loading = true);
  renderImbuingTable();
  let done = 0, failed = 0;
  setStatus(`Loading avg prices for ${queue.length} imbuing items on ${world}…`, 'warn');
  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      try {
        const price = await loadPrice(row.name);
        row.avgValue = price.avg_value_used ?? price.current_market_price ?? price.global_average_price ?? null;
        row.priceUrl = price.url || '';
        row.priceWorld = world;
        row.priceError = price.error || '';
      } catch (e) {
        row.avgValue = null; row.priceError = e.message; failed++;
      } finally {
        row.loading = false; done++;
        if (done % 6 === 0 || done === state.imbuingItems.length) renderImbuingTable();
        setStatus(`Imbuing prices: ${done}/${state.imbuingItems.length}${failed ? `, ${failed} failed` : ''}.`, failed ? 'warn' : 'ok');
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(8, Math.max(1, queue.length))}, () => worker()));
  state.loadingImbuing = false;
  if (btn) btn.disabled = false;
  renderImbuingTable();
  setStatus(`Finished imbuing prices for ${world}.`, failed ? 'warn' : 'ok');
}

function searchClickedItem(item) {
  $('itemInput').value = item;
  searchItem();
  window.scrollTo({top: 0, behavior: 'smooth'});
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-search-item]');
  if (!a) return;
  e.preventDefault();
  searchClickedItem(a.getAttribute('data-search-item'));
});


document.addEventListener('change', (e) => {
  const input = e.target.closest('[data-manual-price-item]');
  if (!input) return;
  setManualImbuingPrice(input.getAttribute('data-manual-price-item'), input.value);
});

document.addEventListener('keydown', (e) => {
  const input = e.target.closest('[data-manual-price-item]');
  if (input && e.key === 'Enter') input.blur();
});

$('searchBtn').addEventListener('click', searchItem);
$('itemInput').addEventListener('keydown', e => { if (e.key === 'Enter') searchItem(); });
$('weeklyBtn').addEventListener('click', () => { hideDataPanelsExcept(weeklyPanel); showWeeklyProfit(); });
$('grizzlyBtn')?.addEventListener('click', showGrizzly);
$('imbuingBtn')?.addEventListener('click', showImbuing);
$('greenDjinnBtn')?.addEventListener('click', showGreenDjinn);
$('clearBtn').addEventListener('click', () => { $('itemInput').value=''; summaryEl.classList.add('hidden'); sourcesPanel.classList.add('hidden'); setStatus('Cleared.'); });
$('weeklyFilter').addEventListener('input', renderWeeklyTable);
$('weeklySort').addEventListener('change', renderWeeklyTable);
$('grizzlyRange')?.addEventListener('change', renderGrizzlyTable);
$('grizzlyFilter')?.addEventListener('input', renderGrizzlyTable);
$('imbuingFilter')?.addEventListener('input', renderImbuingTable);
$('imbuingSort')?.addEventListener('change', renderImbuingTable);
$('loadImbuingPricesBtn')?.addEventListener('click', loadImbuingPrices);
$('loadGoldTokenBtn')?.addEventListener('click', loadGoldTokenPrice);
$('goldTokenPrice')?.addEventListener('input', renderImbuingCompareTable);
$('imbuingCompareLevel')?.addEventListener('change', renderImbuingCompareTable);
$('greenDjinnFilter')?.addEventListener('input', renderGreenDjinnTable);
$('greenDjinnSort')?.addEventListener('change', renderGreenDjinnTable);
$('loadGreenDjinnPricesBtn')?.addEventListener('click', loadGreenDjinnPrices);
$('themeBtn').addEventListener('click', () => document.documentElement.classList.toggle('light'));
$('loadWeeklyValuesBtn').addEventListener('click', enrichVisibleWeeklyRows);
$('stopWeeklyValuesBtn').addEventListener('click', () => { state.stopEnrich = true; setStatus('Stopping after current requests finish…', 'warn'); });
$('exportSourcesBtn').addEventListener('click', () => downloadCsv('tibia_item_sources.csv', [['Creature / source','HP','Drop chance','Drop chance %','Avg / kill','Sample count','Source URL'], ...state.sourceRows.map(r => [r.source, r.hp ?? '', r.chance, r.chancePercent ?? '', r.average, r.sample, r.url])]))
$('exportWeeklyBtn').addEventListener('click', () => downloadCsv('tibia_weekly_items_enriched.csv', [['Item','Category','Avg value gp','Drop chance %','Drop chance text','Monster sources','Price URL','Tibiopedia URL'], ...state.weeklyRows.map(r => [r.name, r.category, r.avgValue ?? '', r.dropChancePercent ?? '', r.dropChanceText ?? '', r.monsterSourcesText || r.lowestSource || '', r.priceUrl ?? '', r.wikiUrl ?? wikiPageLink(r.name)])]));
$('exportGrizzlyBtn')?.addEventListener('click', () => downloadCsv('tibia_grizzly_adams_tasks.csv', [['Level range','Task','Kills','Mobs counted','Valuable items'], ...getFilteredGrizzlyRows().map(r => [r.levelRange, r.task, r.count, (r.mobs||[]).join('; '), (r.valuables||[]).join('; ')])]));
$('exportImbuingBtn')?.addEventListener('click', () => downloadCsv('tibia_imbuing_items_prices.csv', [['Item','Used in','Required qty','Avg price gp','Manual price gp','Used unit price gp','Total max qty gp','Price URL','Tibiopedia URL'], ...state.imbuingRows.map(r => [r.name, r.usedIn, r.maxQty ?? '', r.avgValue ?? '', getManualItemPrice(r) || 0, effectiveImbuingUnitPrice(r) ?? '', effectiveImbuingTotal(r) ?? '', r.priceUrl ?? '', wikiPageLink(r.name)])]));
$('exportImbuingCompareBtn')?.addEventListener('click', () => downloadCsv('tibia_imbuing_gold_token_comparison.csv', [['Level','Imbuing','Market materials total gp','Gold Tokens','Gold Token total gp','Better option','Difference gp'], ...state.imbuingCompareRows.map(r => [r.level, r.imbuing, r.marketTotal ?? '', r.tokenCount, r.tokenTotal ?? '', r.better, r.diff ?? ''])]));
$('exportGreenDjinnBtn')?.addEventListener('click', () => downloadCsv('tibia_green_djinn_items_prices.csv', [['Item','NPC','NPC sell price gp','Buy offer gp','Sell offer gp','Market avg gp','Market price used gp','Profit vs NPC gp','Price URL','Tibiopedia URL'], ...state.greenDjinnRows.map(r => [r.item, r.npc, r.npcPrice ?? '', r.buyOffer ?? '', r.sellOffer ?? '', r.marketAvg ?? '', getGreenDjinnMarketPrice(r) ?? '', getGreenDjinnProfit(r) ?? '', r.priceUrl ?? '', wikiPageLink(r.item)])]));


const refreshQuickBtn = $('refreshQuickBtn');
if (refreshQuickBtn) refreshQuickBtn.addEventListener('click', loadQuickPrices);
if ($('worldInput')) $('worldInput').addEventListener('change', () => { loadQuickPrices(); renderWeeklyTable(); renderGreenDjinnTable(); });

loadWeeklyItems().then(() => { setStatus('Ready. Type an item, for example Tarantula Egg.'); loadQuickPrices(); }).catch(e => setStatus(`Could not load weekly_items.json: ${escapeHtml(e.message)}. Run via py server.py.`, 'bad'));


async function downloadMarketTopPrices() {
  const btn = $('downloadMarketTopBtn');
  const world = $('worldInput').value || 'Bona';
  if (btn) btn.disabled = true;
  setStatus(`Downloading current market prices from TibiaMarket.top for ${escapeHtml(world)}…`, 'warn');
  try {
    const res = await fetchJson(`/api/download_market_top?world=${encodeURIComponent(world)}`);
    if (res.ok) {
      setStatus(`${escapeHtml(res.message || 'Market prices downloaded.')} New searches and tables will use TibiaMarket.top buy/sell offers when available.`, 'ok');
      // Clear only in-memory price values so visible tables can be recalculated from the new cache.
      state.weeklyItems.forEach(r => {
        delete r.enriched; delete r.enrichWorld; delete r.avgValue; delete r.priceUrl; delete r.priceError; delete r.loading;
      });
      state.imbuingItems.forEach(r => { delete r.avgValue; delete r.priceUrl; delete r.priceWorld; delete r.priceError; });
      state.greenDjinnItems.forEach(r => { delete r.buyOffer; delete r.sellOffer; delete r.marketAvg; delete r.priceUrl; delete r.priceWorld; delete r.priceError; });
      renderWeeklyTable();
      renderImbuingTable();
      renderGreenDjinnTable();
    } else {
      setStatus(`Download failed: ${escapeHtml(res.error || res.message || 'Unknown error')}`, 'bad');
    }
  } catch (e) {
    setStatus(`Download failed: ${escapeHtml(e.message)}. The API may be down or blocked.`, 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}

const downloadMarketTopBtn = $('downloadMarketTopBtn');
if (downloadMarketTopBtn) downloadMarketTopBtn.addEventListener('click', downloadMarketTopPrices);

async function updateFromGithub() {
  const btn = $('updateBtn');
  if (!btn) return;
  btn.disabled = true;
  setStatus('Checking GitHub for updates…', 'warn');
  try {
    const res = await fetchJson('/api/update');
    if (res.ok) {
      const out = [res.message || 'Update completed.', res.stdout || '', res.stderr || ''].filter(Boolean).join(' ');
      setStatus(`${escapeHtml(out)} Restart the server, then refresh this page with Ctrl+F5.`, 'ok');
    } else {
      const msg = res.error || res.stderr || res.message || 'Update failed.';
      setStatus(`Update failed: ${escapeHtml(msg)}`, 'bad');
    }
  } catch (e) {
    setStatus(`Update failed: ${escapeHtml(e.message)}`, 'bad');
  } finally {
    btn.disabled = false;
  }
}
const updateBtn = $('updateBtn');
if (updateBtn) updateBtn.addEventListener('click', updateFromGithub);


async function clearCache() {
  const btn = $('clearCacheBtn');
  if (btn) btn.disabled = true;
  setStatus('Clearing local cache…', 'warn');
  try {
    const res = await fetchJson('/api/clear_cache');
    state.weeklyItems.forEach(r => {
      delete r.enriched; delete r.enrichWorld; delete r.avgValue; delete r.dropChancePercent;
      delete r.dropChanceText; delete r.lowestSource; delete r.lowestHp; delete r.monsterSources; delete r.monsterSourcesText;
      delete r.priceUrl; delete r.loading;
    });
    renderWeeklyTable();
    setStatus(res.message || 'Cache cleared. Run Load avg values + sources again.', 'ok');
  } catch (e) {
    setStatus(`Could not clear cache: ${escapeHtml(e.message)}`, 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}
const clearCacheBtn = $('clearCacheBtn');
if (clearCacheBtn) clearCacheBtn.addEventListener('click', clearCache);
