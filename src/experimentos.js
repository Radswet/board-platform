'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let sessions      = [];
let groups        = {};   // id → {title, description}
let activeSession = null;
let lumChart = null, berChart = null, bitsChart = null;

const ROW_LIMIT = 8;                  // filas visibles antes de "ver más"
let collapsedGroups = {};             // key → bool (tabla oculta)
let expandedGroups  = {};             // key → bool (mostrar todas las filas)
let sortState       = {};             // key → {idx, dir:1|-1}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initExperimentos() {
  setupDropZone();
  document.getElementById('exp-file-input').addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('exp-search').addEventListener('input', renderList);
  document.getElementById('back-to-list').addEventListener('click', showList);
  document.getElementById('exp-save-notes').addEventListener('click', saveNotes);
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadSessions() {
  if (!sb) { renderList(); return; }
  const [sesRes, grpRes] = await Promise.all([
    sb.from('sesiones')
      .select('id,filename,uploaded_at,distancia_cm,iluminancia_lux,bit_ms,ber_mv,ber_m,ber_c,ber_y,ber_r,n_bits,etiqueta,notas,condicion_luz,data')
      .order('filename', { ascending: false }),
    sb.from('experiment_groups').select('*'),
  ]);
  sessions = sesRes.data || [];
  groups   = Object.fromEntries((grpRes.data || []).map(g => [g.id, g]));
  renderList();
}

// ── Type detection ────────────────────────────────────────────────────────────
function detectType(s) {
  const d = s.data || {};
  if (d.scan_time_ms != null || d.throughput_1ch != null) return 'caracterizacion';
  if (Array.isArray(d.records) && d.records.length && d.records[0].lum)  return 'ook';
  if (Array.isArray(d.records) && d.records.length) return 'bpsk';
  return 'unknown';
}

// Grupo = etiqueta completa "expXX / <subpath>" → cada folder/sweep es su grupo.
function groupKey(s) {
  return (s.etiqueta || '').trim() || 'otros';
}
// parte tras el primer "/" = código del folder (puede tener subcarpetas)
function sweepCode(key) {
  const i = key.indexOf('/');
  return i === -1 ? key.trim() : key.slice(i + 1).trim();
}

// ── Catálogo desde el README de datos ───────────────────────────────────────────
// code → {cat, ord, title?, res}.  Convención: <bps>bps_<lux>lux_b<brillo>_s<N>
const CATALOG = {
  // s1 — con repisa (datos principales de tesis)
  '2.5bps_260lux_b100_s1': { cat:'s1', ord:1, res:'Blooming a 20–25 cm; resto BER=0.' },
  '2.5bps_260lux_b75_s1':  { cat:'s1', ord:2, res:'BER=0 en todo el rango.' },
  '2.5bps_370lux_b100_s1': { cat:'s1', ord:3, res:'Revalidado (sin el bug de BER).' },
  '2.5bps_370lux_b75_s1':  { cat:'s1', ord:4, res:'BER=0; sin blooming.' },
  '2.5bps_900lux_b75_s1':  { cat:'s1', ord:5, res:'Blooming a 10–30 cm por alta lux.' },
  '3.3bps_260lux_b75_s1':  { cat:'s1', ord:6, res:'n=1 por punto.' },
  '3.3bps_370lux_b75_s1':  { cat:'s1', ord:7, res:'n=1 por punto.' },
  '5.0bps_260lux_b75_s1':  { cat:'s1', ord:8, res:'n=1 por punto; zona muerta a 50 cm (H10).' },
  '5.0bps_370lux_b75_s1':  { cat:'s1', ord:9, res:'n=1 por punto.' },
  // s2 — sin repisa (con AEC)
  '2.5bps_260lux_b100_s2': { cat:'s2', ord:1, res:'Validación: BER=0 a 15 cm ✅.' },
  '5.0bps_260lux_b75_s2':  { cat:'s2', ord:2, res:'BER≈0.5 (contaminación Y/R sin repisa) — H14.' },
  // especiales
  'especiales/prbs7_2.5bps_260lux_b100':      { cat:'special', ord:1, title:'PRBS7 · 2.5 bps · 260 lux · b100', res:'Secuencia PRBS7 — falló por DC wander (H9).' },
  'especiales/blooming_test_20cm_260lux_b75': { cat:'special', ord:2, title:'Blooming test · 20 cm · 260 lux · b75', res:'20 cm fijo, varias velocidades. Aísla blooming vs phase slipping (H11).' },
  // histórico
  'historico/legacy_sin_preamble':      { cat:'hist', ord:1, title:'Legacy sin preamble (14 may)', res:'Primeras pruebas, script sin preamble.' },
  'historico/velocidades_sin_lux':      { cat:'hist', ord:2, title:'Velocidades sin lux',          res:'Sweeps viejos sin lux registrada (1.25–5.6 bps, b100).' },
  'historico/pre_folders':              { cat:'hist', ord:3, title:'Pre-folders (18–19 may)',      res:'Archivos sueltos del período con bug de BER.' },
  'historico/2.5bps_400ms_370lux_b100': { cat:'hist', ord:4, title:'370 lux b100 · bug BER',       res:'V1 370 lux b100 con el bug de BER (reemplazado por s1).' },
};

const NEW_SWEEP_RE = /^([\d.]+)bps_(\d+)lux_b(\d+)_s(\d+)$/;
function groupTitle(key) {
  const code = sweepCode(key);
  const m = code.match(NEW_SWEEP_RE);
  if (m) return `${m[1]} bps · ${m[2]} lux · b${m[3]} · s${m[4]}`;
  return CATALOG[code]?.title || code || key;
}
function groupDefaultDesc(key) {
  return CATALOG[sweepCode(key)]?.res || '';
}
function groupOrder(key) {
  const c = CATALOG[sweepCode(key)];
  return c ? c.ord : 999;
}

// ── Categorías (bandas) ─────────────────────────────────────────────────────────
const CAT_ORDER = ['caracterizacion','s1','s2','special','hist','other'];
const CAT_LABEL = {
  caracterizacion: 'Caracterización · Rolling Shutter',
  s1:              'Sweeps OOK válidos · s1 (con repisa) · datos de tesis',
  s2:              'Sweeps OOK · s2 (sin repisa, con AEC)',
  special:         'Experimentos especiales',
  hist:            'Histórico',
  other:           'Otros',
};
function groupCategory(key, list) {
  if (detectType(list[0]) === 'caracterizacion') return 'caracterizacion';
  return CATALOG[sweepCode(key)]?.cat || 'other';
}

// ── Column defs ────────────────────────────────────────────────────────────────
// val: HTML de la celda · sort: valor para ordenar · sortable:false desactiva orden
const NUM = v => (v == null ? -Infinity : v);
const COLUMNS = {
  caracterizacion: [
    { label: 'ID',  cls: 'session-id', val: s => sessionId(s),                 sort: s => s.filename || '' },
    { label: 'Fecha',                  val: s => dateFromFilename(s.filename) || '—', sort: s => s.filename || '' },
    { label: 'Dist.',                  val: s => s.distancia_cm != null ? s.distancia_cm + ' cm' : '—', sort: s => NUM(s.distancia_cm) },
    { label: 'Flash Hz',               val: s => s.data?.flash_hz != null ? s.data.flash_hz + ' Hz' : '—', sort: s => NUM(s.data?.flash_hz) },
    { label: 'Scan time',              val: s => s.data?.scan_time_ms != null ? s.data.scan_time_ms.toFixed(2) + ' ms' : '—', sort: s => NUM(s.data?.scan_time_ms) },
    { label: 'Throughput 1ch',         val: s => s.data?.throughput_1ch != null ? s.data.throughput_1ch.toFixed(1) + ' bps' : '—', sort: s => NUM(s.data?.throughput_1ch) },
    { label: 'Throughput 4ch',         val: s => s.data?.throughput_4ch != null ? s.data.throughput_4ch.toFixed(1) + ' bps' : '—', sort: s => NUM(s.data?.throughput_4ch) },
    { label: 'Nota', cls: 'session-label nota-cell', editable: true, val: s => notaHtml(s), sort: s => s.notas || '' },
  ],
  ook: [
    { label: 'ID',  cls: 'session-id', val: s => sessionId(s),                 sort: s => s.filename || '' },
    { label: 'Fecha',                  val: s => dateFromFilename(s.filename) || '—', sort: s => s.filename || '' },
    { label: 'Dist.',                  val: s => s.distancia_cm != null ? s.distancia_cm + ' cm' : '—', sort: s => NUM(s.distancia_cm) },
    { label: 'Lux',                    val: s => s.iluminancia_lux != null ? s.iluminancia_lux + ' lx' : '—', sort: s => NUM(s.iluminancia_lux) },
    { label: 'Bit ms',                 val: s => s.bit_ms != null ? s.bit_ms + ' ms' : '—', sort: s => NUM(s.bit_ms) },
    { label: 'Bits',                   val: s => s.n_bits ?? '—', sort: s => NUM(s.n_bits) },
    { label: 'BER',                    val: s => { const b = s.ber_mv != null ? (s.ber_mv*100).toFixed(1)+'%' : '—'; const c = s.ber_mv === 0 ? 'ber-ok' : s.ber_mv > 0.1 ? 'ber-bad' : 'ber-mid'; return `<span class="ber-badge ${c}">${b}</span>`; }, sort: s => s.ber_mv == null ? Infinity : s.ber_mv },
    { label: 'Por canal', cls: 'ber-channels', val: s => fmtChannelBer(s), sortable: false },
    { label: 'Nota', cls: 'session-label nota-cell', editable: true, val: s => notaHtml(s), sort: s => s.notas || '' },
  ],
};
const columnsFor = type => COLUMNS[type] || COLUMNS.ook;

// Nota libre por sesión (campo notas)
function notaHtml(s) {
  const v = (s.notas || '').trim();
  return v ? `<span class="nota-text">${v}</span>` : `<span class="nota-empty">+ nota</span>`;
}

// ── Render list ───────────────────────────────────────────────────────────────
function renderList() {
  const q = (document.getElementById('exp-search')?.value || '').toLowerCase();
  const filtered = sessions.filter(s => {
    const label = (s.etiqueta || s.filename || '').toLowerCase();
    const notas = (s.notas || '').toLowerCase();
    return !q || label.includes(q) || notas.includes(q);
  });

  const container = document.getElementById('sessions-container');
  if (!filtered.length) {
    container.innerHTML = `<p class="exp-empty">Sin sesiones. Sube un JSON para empezar.</p>`;
    return;
  }

  // Agrupar por folder
  const grouped = {};
  for (const s of filtered) {
    const key = groupKey(s);
    (grouped[key] ||= []).push(s);
  }

  // Repartir en categorías (bandas)
  const byCat = {};
  for (const [key, list] of Object.entries(grouped)) {
    const cat = groupCategory(key, list);
    (byCat[cat] ||= []).push([key, list]);
  }

  let html = '';
  for (const cat of CAT_ORDER) {
    const inCat = byCat[cat];
    if (!inCat) continue;
    inCat.sort((a, b) => (groupOrder(a[0]) - groupOrder(b[0])) || groupTitle(a[0]).localeCompare(groupTitle(b[0]), 'es', { numeric: true }));
    const totalSes = inCat.reduce((n, [, l]) => n + l.length, 0);
    html += `<div class="cat-band"><span class="cat-name">${CAT_LABEL[cat] || cat}</span><span class="cat-count">${inCat.length} grupos · ${totalSes} sesiones</span></div>`;
    html += inCat.map(([key, list]) => renderGroupBlock(key, list)).join('');
  }
  container.innerHTML = html;

  container.querySelectorAll('.session-row').forEach(row => {
    row.addEventListener('click', () => openSession(row.dataset.id));
  });
  // edición inline de la nota (sin abrir el detalle)
  container.querySelectorAll('.nota-cell').forEach(cell => {
    cell.addEventListener('click', e => { e.stopPropagation(); startNotaEdit(cell); });
  });
}

function renderGroupBlock(key, list) {
  const grp       = groups[key] || {};
  const type      = detectType(list[0]);
  const collapsed = !!collapsedGroups[key];
  const desc      = grp.description || groupDefaultDesc(key);
  return `
    <div class="exp-group">
      <div class="group-header">
        <div class="group-header-top">
          <button class="group-collapse-btn" onclick="toggleGroup('${key}')" title="Mostrar/ocultar">${collapsed ? '▸' : '▾'}</button>
          <span class="group-title">${grp.title || groupTitle(key)}</span>
          <span class="group-count">${list.length} sesiones</span>
          <button class="btn group-edit-btn" onclick="openGroupEditor('${key}')">✏️ Editar contexto</button>
        </div>
        ${desc ? `<div class="group-description">${desc}</div>` : ''}
      </div>
      ${collapsed ? '' : renderGroupTable(key, list, type)}
    </div>`;
}

function renderGroupTable(key, list, type) {
  const cols = columnsFor(type);
  const st   = sortState[key];

  // Orden
  let ordered = list.slice();
  if (st && cols[st.idx]?.sort) {
    const get = cols[st.idx].sort;
    ordered.sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va < vb) return -st.dir;
      if (va > vb) return  st.dir;
      return 0;
    });
  }

  const expanded = !!expandedGroups[key];
  const visible  = expanded ? ordered : ordered.slice(0, ROW_LIMIT);
  const hidden   = ordered.length - visible.length;

  const head = cols.map((c, i) => {
    if (c.sortable === false) return `<th>${c.label}</th>`;
    const active = st && st.idx === i;
    const arrow  = active ? (st.dir === 1 ? ' ▲' : ' ▼') : '';
    return `<th class="sortable${active ? ' sorted' : ''}" onclick="sortGroup('${key}',${i})">${c.label}${arrow}</th>`;
  }).join('');

  const rows = visible.map(s =>
    `<tr class="session-row" data-id="${s.id}">${
      cols.map(c => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.val(s)}</td>`).join('')
    }</tr>`
  ).join('');

  const moreBtn = (hidden > 0 || expanded)
    ? `<button class="exp-more-btn" onclick="toggleExpand('${key}')">${
        expanded ? '▲ Ver menos' : `▾ Ver más (${hidden})`
      }</button>`
    : '';

  return `<div class="exp-table-wrap"><table class="exp-table">
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${moreBtn}`;
}

// ── Edición inline de nota ──────────────────────────────────────────────────────
function startNotaEdit(cell) {
  if (cell.querySelector('input')) return;               // ya en edición
  const id = cell.closest('.session-row').dataset.id;
  const s  = sessions.find(x => x.id === id);
  if (!s) return;

  const input = document.createElement('input');
  input.className = 'variante-input';
  input.value = (s.notas || '').trim();
  input.placeholder = 'nota de esta sesión...';
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus(); input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    if (save) {
      const v = input.value.trim();
      if (v !== (s.notas || '').trim()) {
        const { error } = await sb.from('sesiones').update({ notas: v || null }).eq('id', id);
        if (error) { showToast('Error al guardar'); }
        else { s.notas = v; showToast('Guardado ✓'); }
      }
    }
    renderList();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); finish(true);  }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

// ── Interacciones tabla ─────────────────────────────────────────────────────────
function toggleGroup(key)  { collapsedGroups[key] = !collapsedGroups[key]; renderList(); }
function toggleExpand(key) { expandedGroups[key]  = !expandedGroups[key];  renderList(); }
function sortGroup(key, idx) {
  const cur = sortState[key];
  // mismo col → invierte; nuevo col → asc
  sortState[key] = (cur && cur.idx === idx) ? { idx, dir: -cur.dir } : { idx, dir: 1 };
  renderList();
}

// ── Group editor ──────────────────────────────────────────────────────────────
function openGroupEditor(key) {
  const grp = groups[key] || {};
  document.getElementById('ge-key').value         = key;
  document.getElementById('ge-title').value       = grp.title || groupTitle(key);
  document.getElementById('ge-description').value = grp.description || groupDefaultDesc(key);
  document.getElementById('group-editor-modal').classList.remove('hidden');
}

async function saveGroupEditor() {
  const key   = document.getElementById('ge-key').value;
  const title = document.getElementById('ge-title').value.trim();
  const desc  = document.getElementById('ge-description').value.trim();

  const { error } = await sb.from('experiment_groups')
    .upsert({ id: key, title, description: desc, updated_at: new Date().toISOString() });
  if (error) { showToast('Error al guardar'); return; }

  groups[key] = { id: key, title, description: desc };
  document.getElementById('group-editor-modal').classList.add('hidden');
  renderList();
  showToast('Contexto guardado ✓');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sessionId(s) {
  const m6 = (s.filename || '').match(/(\d{8})_(\d{6})/);   // con segundos
  if (m6) return `${m6[1]}_${m6[2]}`;
  const m4 = (s.filename || '').match(/(\d{8})_(\d{4})/);
  return m4 ? `${m4[1]}_${m4[2]}` : s.id?.slice(0, 8) || '—';
}

function dateFromFilename(filename) {
  const m = (filename || '').match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function fmtChannelBer(s) {
  return ['m','c','y','r'].map(ch => {
    const v = s[`ber_${ch}`];
    return v != null ? `<span class="ch-ber ch-${ch}">${ch.toUpperCase()}:${(v*100).toFixed(0)}%</span>` : '';
  }).join('');
}

// ── Open detail ───────────────────────────────────────────────────────────────
async function openSession(id) {
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  activeSession = s;

  document.getElementById('exp-list-section').classList.add('hidden');
  document.getElementById('exp-detail-section').classList.remove('hidden');

  const type = detectType(s);
  renderMetaCards(s, type);
  renderCharts(s, type);
  document.getElementById('exp-notes-input').value    = s.notas || '';
  document.getElementById('exp-etiqueta-input').value = s.etiqueta || '';
}

const dv   = v => (v == null || v === '') ? '—' : v;
const card = (val, unit, key, cls = '') =>
  `<div class="meta-card"><div class="meta-val ${cls}">${dv(val)}${unit && val != null ? `<span class="meta-unit">${unit}</span>` : ''}</div><div class="meta-key">${key}</div></div>`;
const section = (title, cards) => `<div class="meta-section"><div class="meta-section-title">${title}</div><div class="meta-cards-row">${cards}</div></div>`;

// Con/sin repisa según la fecha del archivo (ver README de datos)
function setupRepisa(s) {
  const m = (s.filename || '').match(/(\d{8})_/);
  if (!m) return null;
  return +m[1] >= 20260601 ? 'Sin repisa · 45 cm' : 'Con repisa · 55 cm';
}

function renderMetaCards(s, type) {
  const d = s.data || {};
  let html = '';

  if (type === 'caracterizacion') {
    html =
      section('📡 Transmisor (TX)',
        card(d.tx_dispositivo || d.tx, '', 'Dispositivo') +
        card(d.flash_hz, 'Hz', 'Flash')) +
      section('📷 Receptor · Muestreo',
        card(d.rx_dispositivo || d.rx, '', 'Cámara') +
        card(d.cam_fps, 'fps', 'FPS cámara') +
        card(d.scan_time_ms != null ? d.scan_time_ms.toFixed(2) : null, 'ms', 'Scan time') +
        card(d.roi_x0 != null ? `${d.roi_x0}–${d.roi_x1}` : null, 'px', 'ROI x') +
        card(d.threshold != null ? d.threshold.toFixed(1) : null, '', 'Umbral')) +
      section('💡 Condiciones',
        card(s.distancia_cm, 'cm', 'Distancia') +
        card(s.iluminancia_lux, 'lux', 'Iluminancia')) +
      section('📊 Resultado',
        card(d.throughput_1ch != null ? d.throughput_1ch.toFixed(1) : null, 'bps', 'Throughput 1ch') +
        card(d.throughput_4ch != null ? d.throughput_4ch.toFixed(1) : null, 'bps', 'Throughput 4ch') +
        card(d.num_cycles, '', 'Ciclos') +
        card(d.num_crossings, '', 'Crossings'));
  } else {
    const ber    = s.ber_mv != null ? `${(s.ber_mv*100).toFixed(2)}%` : '—';
    const berCls = s.ber_mv === 0 ? 'ber-ok' : s.ber_mv > 0.1 ? 'ber-bad' : 'ber-mid';
    const bps    = s.bit_ms ? (1000 / s.bit_ms).toFixed(2) : null;
    const scanFr = d.actual_fps ? (1000 / d.actual_fps).toFixed(1) : null;
    const nPre   = d.preambles?.length ?? s.n_preambles;

    html =
      section('📡 Transmisor (TX)',
        card(d.tx, '', 'Dispositivo') +
        card(s.brillo_tx_pct ?? d.brillo_tx_pct, '%', 'Brillo pantalla') +
        card(s.bit_ms, 'ms', 'Bit period') +
        card(bps, 'bps', 'Velocidad') +
        card(d.expected_bits, '', 'Patrón', 'meta-mono')) +
      section('📷 Receptor · Muestreo',
        card(d.rx, '', 'Cámara') +
        card(d.actual_fps, 'fps', 'FPS real') +
        card(d.frames_per_bit, '', 'Frames/bit') +
        card(scanFr, 'ms', 'Scan/frame') +
        card(d.cam_exposure_us, 'µs', 'Exposición') +
        card(d.cam_gain, '', 'Ganancia') +
        card(d.aec_locked != null ? (d.aec_locked ? 'Sí' : 'No') : null, '', 'AEC lock')) +
      section('💡 Condiciones',
        card(s.distancia_cm, 'cm', 'Distancia') +
        card(s.iluminancia_lux, 'lux', 'Iluminancia') +
        card(setupRepisa(s), '', 'Setup físico') +
        card(d.condicion_luz, '', 'Nota de luz', 'meta-mono')) +
      section('📊 Resultado',
        card(ber, '', 'BER mayoría', berCls) +
        card(s.n_bits, '', 'Bits totales') +
        card(d.n_sequences, '', 'Secuencias') +
        card(nPre, '', 'Preámbulos'));
  }
  document.getElementById('meta-cards').innerHTML = html;
}

function renderCharts(s, type) {
  destroyCharts();
  const records = s.data?.records || [];
  const expBits = (s.data?.expected_bits || '').split('').map(Number);

  if (type === 'caracterizacion') {
    const d = s.data || {};
    // Gráfico del perfil de intensidad
    const ctxLum = document.getElementById('chart-lum').getContext('2d');
    const profile = d.profile_smooth || d.profile_raw || [];
    lumChart = new Chart(ctxLum, {
      type: 'line',
      data: {
        labels: profile.map((_, i) => i),
        datasets: [{ label: 'Perfil de intensidad', data: profile, borderColor: '#22d3ee', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5 }],
      },
      options: chartOpts('Perfil de intensidad (rolling shutter)', 'Línea', 'Intensidad'),
    });
    // Gráfico de crossings
    const crossings = d.crossings || [];
    const ctxBits = document.getElementById('chart-bits').getContext('2d');
    bitsChart = new Chart(ctxBits, {
      type: 'scatter',
      data: { datasets: [{ label: 'Crossings', data: crossings.map((x, i) => ({ x, y: i })), borderColor: '#f97316', backgroundColor: '#f97316', pointRadius: 3 }] },
      options: chartOpts('Crossings detectados', 'Línea', '#'),
    });
    document.getElementById('chart-ber').closest('.chart-box').style.display = 'none';
    return;
  }

  document.getElementById('chart-ber').closest('.chart-box').style.display = '';

  // OOK / BPSK
  const ctxLum = document.getElementById('chart-lum').getContext('2d');
  lumChart = new Chart(ctxLum, {
    type: 'line',
    data: {
      labels: records.map((_, i) => i),
      datasets: [
        { label: 'M', data: records.map(r => r.lum?.M), borderColor: '#ff00ff', backgroundColor: 'transparent', pointRadius: 1, borderWidth: 1.5 },
        { label: 'C', data: records.map(r => r.lum?.C), borderColor: '#00ffff', backgroundColor: 'transparent', pointRadius: 1, borderWidth: 1.5 },
        { label: 'Y', data: records.map(r => r.lum?.Y), borderColor: '#ffff00', backgroundColor: 'transparent', pointRadius: 1, borderWidth: 1.5 },
        { label: 'R', data: records.map(r => r.lum?.R), borderColor: '#ff4444', backgroundColor: 'transparent', pointRadius: 1, borderWidth: 1.5 },
      ],
    },
    options: chartOpts('Luminancia por canal', 'Bit #', 'Luminancia'),
  });

  const ctxBer = document.getElementById('chart-ber').getContext('2d');
  berChart = new Chart(ctxBer, {
    type: 'bar',
    data: {
      labels: ['M','C','Y','R','MV'],
      datasets: [{ data: ['m','c','y','r'].map(ch => (s[`ber_${ch}`] ?? 0)*100).concat([(s.ber_mv ?? 0)*100]), backgroundColor: ['#ff00ff88','#00ffff88','#ffff0088','#ff444488','#ffffff44'], borderColor: ['#ff00ff','#00ffff','#ffff00','#ff4444','#ffffff'], borderWidth: 1.5, borderRadius: 6 }],
    },
    options: { ...chartOpts('BER por canal (%)', 'Canal', 'BER (%)'), plugins: { legend: { display: false } } },
  });

  const n = records.length;
  const expRep = n ? Array.from({length: n}, (_, i) => expBits[i % expBits.length]) : [];
  const ctxBits = document.getElementById('chart-bits').getContext('2d');
  bitsChart = new Chart(ctxBits, {
    type: 'line',
    data: {
      labels: records.map((_, i) => i),
      datasets: [
        { label: 'Esperado', data: expRep, borderColor: '#f97316', backgroundColor: 'transparent', stepped: true, pointRadius: 0, borderWidth: 1.5, borderDash: [4,4] },
        { label: 'Recibido', data: records.map(r => r.bit_mv), borderColor: '#22d3ee', backgroundColor: 'transparent', stepped: true, pointRadius: 2, borderWidth: 1.5 },
      ],
    },
    options: { ...chartOpts('Bits: enviados vs recibidos', 'Bit #', 'Valor'), scales: { y: { min: -0.2, max: 1.3, ticks: { stepSize: 1 } } } },
  });
}

function chartOpts(title, xLabel, yLabel) {
  return {
    responsive: true, animation: false,
    plugins: {
      legend: { labels: { color: '#aaa', boxWidth: 12, font: { size: 11 } } },
      title:  { display: true, text: title, color: '#ddd', font: { size: 13, weight: '600' } },
    },
    scales: {
      x: { ticks: { color: '#666', maxTicksLimit: 12 }, grid: { color: '#1a1a2a' }, title: { display: true, text: xLabel, color: '#555', font: { size: 10 } } },
      y: { ticks: { color: '#666' }, grid: { color: '#1a1a2a' }, title: { display: true, text: yLabel, color: '#555', font: { size: 10 } } },
    },
  };
}

function destroyCharts() {
  [lumChart, berChart, bitsChart].forEach(c => c?.destroy());
  lumChart = berChart = bitsChart = null;
}

function showList() {
  destroyCharts();
  activeSession = null;
  document.getElementById('exp-detail-section').classList.add('hidden');
  document.getElementById('exp-list-section').classList.remove('hidden');
}

async function saveNotes() {
  if (!activeSession) return;
  const notas    = document.getElementById('exp-notes-input').value.trim();
  const etiqueta = document.getElementById('exp-etiqueta-input').value.trim();
  const { error } = await sb.from('sesiones').update({ notas, etiqueta }).eq('id', activeSession.id);
  if (!error) {
    activeSession.notas = notas; activeSession.etiqueta = etiqueta;
    const s = sessions.find(x => x.id === activeSession.id);
    if (s) { s.notas = notas; s.etiqueta = etiqueta; }
    showToast('Guardado ✓');
  }
}

// ── Drop zone & upload ────────────────────────────────────────────────────────
function setupDropZone() {
  const zone = document.getElementById('drop-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.json')) handleFile(file);
  });
  zone.addEventListener('click', () => document.getElementById('exp-file-input').click());
}

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try { showUploadModal(JSON.parse(e.target.result), file.name); }
    catch { showToast('Error: JSON inválido'); }
  };
  reader.readAsText(file);
}

function calcBer(bits, exp) {
  const n = bits.length;
  if (!n) return null;
  return parseFloat((bits.reduce((a, b, i) => a + (b !== exp[i % exp.length] ? 1 : 0), 0) / n).toFixed(4));
}

function showUploadModal(json, filename) {
  const records = json.records || [];
  const expBits = (json.expected_bits || '').split('').map(Number);
  const bers = {
    mv: calcBer(records.map(r => r.bit_mv ?? 0), expBits),
    M:  calcBer(records.map(r => r.bits?.M ?? 0), expBits),
    C:  calcBer(records.map(r => r.bits?.C ?? 0), expBits),
    Y:  calcBer(records.map(r => r.bits?.Y ?? 0), expBits),
    R:  calcBer(records.map(r => r.bits?.R ?? 0), expBits),
  };
  const mo = document.getElementById('upload-modal');
  document.getElementById('um-filename').textContent = filename;
  document.getElementById('um-dist').textContent     = json.distancia_cm ?? '—';
  document.getElementById('um-lux').textContent      = json.iluminancia_lux ?? '—';
  document.getElementById('um-bitms').textContent    = json.bit_ms ?? '—';
  document.getElementById('um-bits').textContent     = records.length;
  document.getElementById('um-ber').textContent      = bers.mv != null ? (bers.mv*100).toFixed(2)+'%' : '—';
  document.getElementById('um-etiqueta').value       = '';
  document.getElementById('um-notas').value          = '';
  mo.classList.remove('hidden');
  document.getElementById('um-cancel').onclick  = () => mo.classList.add('hidden');
  document.getElementById('um-confirm').onclick = async () => { mo.classList.add('hidden'); await doUpload(json, filename, bers, records); };
}

async function doUpload(json, filename, bers, records) {
  showToast('Subiendo...');
  const payload = {
    filename,
    etiqueta:        document.getElementById('um-etiqueta').value.trim() || null,
    notas:           document.getElementById('um-notas').value.trim()    || null,
    distancia_cm:    json.distancia_cm    ?? null,
    iluminancia_lux: json.iluminancia_lux ?? null,
    brillo_tx_pct:   json.brillo_tx_pct   ?? null,
    bit_ms:          json.bit_ms          ?? null,
    actual_fps:      json.actual_fps      ?? null,
    frames_per_bit:  json.frames_per_bit  ?? null,
    tx:              json.tx              ?? null,
    rx:              json.rx              ?? null,
    condicion_luz:   json.condicion_luz   ?? null,
    expected_bits:   json.expected_bits   ?? null,
    n_bits:          records.length,
    n_preambles:     (json.preambles || []).length,
    ber_mv: bers.mv, ber_m: bers.M, ber_c: bers.C, ber_y: bers.Y, ber_r: bers.R,
    data: json,
  };
  const { error } = await sb.from('sesiones').insert(payload);
  if (error) { showToast('Error: ' + error.message); return; }
  showToast('Sesión subida ✓');
  await loadSessions();
}

// ── Nav toggle ────────────────────────────────────────────────────────────────
function showExperimentos() {
  document.getElementById('tablero-section').classList.add('hidden');
  document.getElementById('exp-section').classList.remove('hidden');
  document.getElementById('nav-tablero').classList.remove('active');
  document.getElementById('nav-exp').classList.add('active');
  document.getElementById('btn-add').classList.add('hidden');
  document.getElementById('search').closest('.search-wrap')?.classList.add('hidden');
  document.getElementById('group-tabs').classList.add('hidden');
  loadSessions();
}

function showTablero() {
  document.getElementById('exp-section').classList.add('hidden');
  document.getElementById('tablero-section').classList.remove('hidden');
  document.getElementById('nav-exp').classList.remove('active');
  document.getElementById('nav-tablero').classList.add('active');
  document.getElementById('btn-add').classList.remove('hidden');
  document.getElementById('search').closest('.search-wrap')?.classList.remove('hidden');
  document.getElementById('group-tabs').classList.remove('hidden');
  destroyCharts();
}
