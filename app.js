const state = { weeklyItems: [], weeklyRows: [], sourceRows: [], enriching: false, stopEnrich: false };
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const summaryEl = $('summary');
const sourcesPanel = $('sourcesPanel');
const weeklyPanel = $('weeklyPanel');
const sourcesBody = document.querySelector('#sourcesTable tbody');
const weeklyBody = document.querySelector('#weeklyTable tbody');

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
  const names = new Set(state.weeklyItems.map(x => x.name));
  ['Tarantula Egg','Vampire Teeth','Spider Silk','Honeycomb','Broken Shamanic Staff','Dragon Ham','Demon Horn'].forEach(x => names.add(x));
  $('itemSuggestions').innerHTML = [...names].filter(Boolean).sort((a,b)=>a.localeCompare(b)).map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}

async function loadPrice(itemName) {
  const world = $('worldInput').value.trim() || 'Antica';
  return fetchJson(`/api/price?world=${encodeURIComponent(world)}&item=${encodeURIComponent(itemName)}`);
}
async function loadLootSources(itemName) { return fetchJson(`/api/loot_sources?item=${encodeURIComponent(itemName)}`); }
async function loadWeeklyRow(itemName) {
  const world = $('worldInput').value.trim() || 'Antica';
  return fetchJson(`/api/weekly_row?world=${encodeURIComponent(world)}&item=${encodeURIComponent(itemName)}`);
}

function renderSummary(itemName, price, weekly) {
  summaryEl.classList.remove('hidden');
  const cards = [
    ['Item', itemName],
    ['World', $('worldInput').value.trim() || 'Antica'],
    ['Current market price', fmtGp(price.current_market_price)],
    ['Global average', fmtGp(price.global_average_price)],
    ['Avg value used', fmtGp(price.avg_value_used)],
    ['Last market check', price.last_market_check || '—'],
    ['Availability', price.availability || '—'],
    ['Demand', price.demand || '—'],
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
  else if (sort === 'efficiency') rows.sort((a,b)=> nval(b,'efficiency') - nval(a,'efficiency') || a.name.localeCompare(b.name));
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
    <td>${escapeHtml(r.lowestSource || '—')}</td>
    <td data-num="${r.lowestHp ?? ''}">${fmtNum(r.lowestHp)}</td>
    <td data-num="${r.efficiency ?? ''}">${fmtGp(r.efficiency)}</td>
    <td>${r.priceUrl ? `<a href="${escapeHtml(r.priceUrl)}" target="_blank" rel="noopener">Price</a>` : '—'}</td>
    <td><a href="${escapeHtml(r.wikiUrl || wikiPageLink(r.name))}" target="_blank" rel="noopener">Wiki</a></td>
  </tr>`).join('');
}
function showWeeklyProfit() { weeklyPanel.classList.remove('hidden'); renderWeeklyTable(); setStatus(`Loaded ${state.weeklyItems.length} weekly items. Click “Load avg values + efficiency” to fill price/drop/HP columns for the selected world.`, 'ok'); }

async function enrichVisibleWeeklyRows() {
  if (state.enriching) return;
  state.enriching = true; state.stopEnrich = false;
  const rows = getFilteredWeeklyRows();
  const total = rows.length;
  let done = 0, failed = 0;
  $('loadWeeklyValuesBtn').disabled = true;
  $('stopWeeklyValuesBtn').disabled = false;
  setStatus(`Loading avg value, drop %, and lowest monster HP for ${total} visible weekly row(s)… Using 8 workers + local cache`, 'warn');

  const queue = rows.filter(r => !r.enriched || r.enrichWorld !== ($('worldInput').value.trim() || 'Antica'));
  queue.forEach(r => { r.loading = true; });
  renderWeeklyTable();

  async function worker() {
    while (queue.length && !state.stopEnrich) {
      const row = queue.shift();
      try {
        const data = await loadWeeklyRow(row.name);
        Object.assign(row, data, { enriched: true, loading: false, enrichWorld: ($('worldInput').value.trim() || 'Antica') });
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
  setStatus(state.stopEnrich ? `Stopped after ${done}/${total} rows.` : `Finished weekly enrichment: ${done}/${total} rows. Sort by efficiency or avg value now.`, state.stopEnrich ? 'warn' : 'ok');
}

$('searchBtn').addEventListener('click', searchItem);
$('itemInput').addEventListener('keydown', e => { if (e.key === 'Enter') searchItem(); });
$('weeklyBtn').addEventListener('click', showWeeklyProfit);
$('clearBtn').addEventListener('click', () => { $('itemInput').value=''; summaryEl.classList.add('hidden'); sourcesPanel.classList.add('hidden'); setStatus('Cleared.'); });
$('weeklyFilter').addEventListener('input', renderWeeklyTable);
$('weeklySort').addEventListener('change', renderWeeklyTable);
$('themeBtn').addEventListener('click', () => document.documentElement.classList.toggle('light'));
$('loadWeeklyValuesBtn').addEventListener('click', enrichVisibleWeeklyRows);
$('stopWeeklyValuesBtn').addEventListener('click', () => { state.stopEnrich = true; setStatus('Stopping after current requests finish…', 'warn'); });
$('exportSourcesBtn').addEventListener('click', () => downloadCsv('tibia_item_sources.csv', [['Creature / source','HP','Drop chance','Drop chance %','Avg / kill','Sample count','Source URL'], ...state.sourceRows.map(r => [r.source, r.hp ?? '', r.chance, r.chancePercent ?? '', r.average, r.sample, r.url])]))
$('exportWeeklyBtn').addEventListener('click', () => downloadCsv('tibia_weekly_items_enriched.csv', [['Item','Category','Avg value gp','Drop chance %','Drop chance text','Lowest monster source','Lowest monster HP','Expected gp/kill','Price URL','Wiki URL'], ...state.weeklyRows.map(r => [r.name, r.category, r.avgValue ?? '', r.dropChancePercent ?? '', r.dropChanceText ?? '', r.lowestSource ?? '', r.lowestHp ?? '', r.efficiency ?? '', r.priceUrl ?? '', r.wikiUrl ?? wikiPageLink(r.name)])]));

loadWeeklyItems().then(() => setStatus('Ready. Type an item, for example Tarantula Egg.')).catch(e => setStatus(`Could not load weekly_items.json: ${escapeHtml(e.message)}. Run via py server.py.`, 'bad'));

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
