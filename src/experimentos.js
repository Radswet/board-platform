'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let sessions     = [];
let activeSession = null;
let lumChart = null, berChart = null, bitsChart = null;

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
  await loadSessions();
}

// ── Load from Supabase ────────────────────────────────────────────────────────
async function loadSessions() {
  if (!sb) { renderList(); return; }
  const { data, error } = await sb.from('sesiones')
    .select('id,filename,uploaded_at,distancia_cm,iluminancia_lux,bit_ms,ber_mv,ber_M,ber_C,ber_Y,ber_R,n_bits,etiqueta,notas,condicion_luz')
    .order('uploaded_at', { ascending: false });
  if (!error) sessions = data || [];
  renderList();
}

// ── Render list ───────────────────────────────────────────────────────────────
function renderList() {
  const q = (document.getElementById('exp-search')?.value || '').toLowerCase();
  const filtered = sessions.filter(s => {
    const label = (s.etiqueta || s.filename || '').toLowerCase();
    const notas = (s.notas || '').toLowerCase();
    return !q || label.includes(q) || notas.includes(q);
  });

  const tbody = document.getElementById('sessions-tbody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="exp-empty">Sin sesiones. Sube un JSON para empezar.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const fecha = s.uploaded_at ? new Date(s.uploaded_at).toLocaleDateString('es-CL') : '—';
    const ber   = s.ber_mv != null ? (s.ber_mv * 100).toFixed(1) + '%' : '—';
    const berClass = s.ber_mv === 0 ? 'ber-ok' : s.ber_mv > 0.1 ? 'ber-bad' : 'ber-mid';
    return `
      <tr class="session-row" data-id="${s.id}">
        <td>${fecha}</td>
        <td class="session-label">${s.etiqueta || s.filename || '—'}</td>
        <td>${s.distancia_cm != null ? s.distancia_cm + ' cm' : '—'}</td>
        <td>${s.iluminancia_lux != null ? s.iluminancia_lux + ' lx' : '—'}</td>
        <td>${s.bit_ms != null ? s.bit_ms + ' ms' : '—'}</td>
        <td>${s.n_bits ?? '—'}</td>
        <td><span class="ber-badge ${berClass}">${ber}</span></td>
        <td class="ber-channels">${fmtChannelBer(s)}</td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.session-row').forEach(row => {
    row.addEventListener('click', () => openSession(row.dataset.id));
  });
}

function fmtChannelBer(s) {
  return ['M','C','Y','R'].map(ch => {
    const v = s[`ber_${ch}`];
    return v != null ? `<span class="ch-ber ch-${ch.toLowerCase()}">${ch}:${(v*100).toFixed(0)}%</span>` : '';
  }).join('');
}

// ── Open detail ───────────────────────────────────────────────────────────────
async function openSession(id) {
  const { data, error } = await sb.from('sesiones')
    .select('*').eq('id', id).single();
  if (error || !data) return;
  activeSession = data;

  document.getElementById('exp-list-section').classList.add('hidden');
  document.getElementById('exp-detail-section').classList.remove('hidden');

  renderMetaCards(data);
  renderCharts(data);
  document.getElementById('exp-notes-input').value = data.notas || '';
  document.getElementById('exp-etiqueta-input').value = data.etiqueta || '';
}

function renderMetaCards(s) {
  const ber = s.ber_mv != null ? `${(s.ber_mv*100).toFixed(2)}%` : '—';
  document.getElementById('meta-cards').innerHTML = `
    <div class="meta-card"><div class="meta-val">${s.distancia_cm ?? '—'}<span class="meta-unit">cm</span></div><div class="meta-key">Distancia</div></div>
    <div class="meta-card"><div class="meta-val">${s.iluminancia_lux ?? '—'}<span class="meta-unit">lux</span></div><div class="meta-key">Iluminancia</div></div>
    <div class="meta-card"><div class="meta-val">${s.bit_ms ?? '—'}<span class="meta-unit">ms</span></div><div class="meta-key">Bit period</div></div>
    <div class="meta-card"><div class="meta-val">${s.actual_fps ?? '—'}<span class="meta-unit">fps</span></div><div class="meta-key">FPS real</div></div>
    <div class="meta-card"><div class="meta-val ${s.ber_mv === 0 ? 'ber-ok' : s.ber_mv > 0.1 ? 'ber-bad' : 'ber-mid'}">${ber}</div><div class="meta-key">BER mayoría</div></div>
    <div class="meta-card"><div class="meta-val">${s.n_bits ?? '—'}</div><div class="meta-key">Bits totales</div></div>
    <div class="meta-card"><div class="meta-val">${s.tx ?? '—'}</div><div class="meta-key">TX</div></div>
    <div class="meta-card"><div class="meta-val">${s.rx ?? '—'}</div><div class="meta-key">RX</div></div>
  `;
}

function renderCharts(s) {
  const records = s.data?.records || [];
  const expBits = (s.expected_bits || s.data?.expected_bits || '').split('').map(Number);

  destroyCharts();

  // ── Luminancia en el tiempo ──
  const ctxLum = document.getElementById('chart-lum').getContext('2d');
  lumChart = new Chart(ctxLum, {
    type: 'line',
    data: {
      labels: records.map((_, i) => i),
      datasets: [
        { label: 'Magenta',  data: records.map(r => r.lum?.M), borderColor: '#ff00ff', backgroundColor: 'transparent', pointRadius: 1.5, borderWidth: 1.5 },
        { label: 'Cyan',     data: records.map(r => r.lum?.C), borderColor: '#00ffff', backgroundColor: 'transparent', pointRadius: 1.5, borderWidth: 1.5 },
        { label: 'Amarillo', data: records.map(r => r.lum?.Y), borderColor: '#ffff00', backgroundColor: 'transparent', pointRadius: 1.5, borderWidth: 1.5 },
        { label: 'Rojo',     data: records.map(r => r.lum?.R), borderColor: '#ff4444', backgroundColor: 'transparent', pointRadius: 1.5, borderWidth: 1.5 },
      ],
    },
    options: chartOpts('Luminancia por canal en el tiempo', 'Bit #', 'Luminancia'),
  });

  // ── BER por canal ──
  const channels = ['M','C','Y','R'];
  const ctxBer = document.getElementById('chart-ber').getContext('2d');
  berChart = new Chart(ctxBer, {
    type: 'bar',
    data: {
      labels: ['Magenta','Cyan','Amarillo','Rojo','Mayoría'],
      datasets: [{
        data: [...channels.map(ch => (s[`ber_${ch}`] ?? 0) * 100), (s.ber_mv ?? 0) * 100],
        backgroundColor: ['#ff00ff88','#00ffff88','#ffff0088','#ff444488','#ffffff55'],
        borderColor:     ['#ff00ff','#00ffff','#ffff00','#ff4444','#ffffff'],
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      ...chartOpts('BER por canal (%)', 'Canal', 'BER (%)'),
      plugins: { legend: { display: false } },
    },
  });

  // ── Bits: enviados vs recibidos ──
  const n = records.length;
  const expRep = n ? Array.from({length: n}, (_, i) => expBits[i % expBits.length]) : [];
  const ctxBits = document.getElementById('chart-bits').getContext('2d');
  bitsChart = new Chart(ctxBits, {
    type: 'line',
    data: {
      labels: records.map((_, i) => i),
      datasets: [
        { label: 'Esperado', data: expRep,                         borderColor: '#f97316', backgroundColor: 'transparent', stepped: true, pointRadius: 0, borderWidth: 1.5, borderDash: [4,4] },
        { label: 'Recibido', data: records.map(r => r.bit_mv),     borderColor: '#22d3ee', backgroundColor: 'transparent', stepped: true, pointRadius: 2,  borderWidth: 1.5 },
      ],
    },
    options: { ...chartOpts('Bits enviados vs recibidos', 'Bit #', 'Valor'), scales: { y: { min: -0.2, max: 1.3, ticks: { stepSize: 1 } } } },
  });
}

function chartOpts(title, xLabel, yLabel) {
  return {
    responsive: true,
    animation: false,
    plugins: {
      legend: { labels: { color: '#aaa', boxWidth: 12, font: { size: 11 } } },
      title:  { display: true, text: title, color: '#ddd', font: { size: 13, weight: '600' } },
    },
    scales: {
      x: { ticks: { color: '#666', maxTicksLimit: 12 }, grid: { color: '#1a1a2a' }, title: { display: true, text: xLabel, color: '#555', font: { size: 10 } } },
      y: { ticks: { color: '#666' },                    grid: { color: '#1a1a2a' }, title: { display: true, text: yLabel, color: '#555', font: { size: 10 } } },
    },
  };
}

function destroyCharts() {
  [lumChart, berChart, bitsChart].forEach(c => c?.destroy());
  lumChart = berChart = bitsChart = null;
}

// ── Back to list ──────────────────────────────────────────────────────────────
function showList() {
  destroyCharts();
  activeSession = null;
  document.getElementById('exp-detail-section').classList.add('hidden');
  document.getElementById('exp-list-section').classList.remove('hidden');
}

// ── Save notes ────────────────────────────────────────────────────────────────
async function saveNotes() {
  if (!activeSession) return;
  const notas    = document.getElementById('exp-notes-input').value.trim();
  const etiqueta = document.getElementById('exp-etiqueta-input').value.trim();
  const { error } = await sb.from('sesiones')
    .update({ notas, etiqueta })
    .eq('id', activeSession.id);
  if (!error) {
    activeSession.notas    = notas;
    activeSession.etiqueta = etiqueta;
    const s = sessions.find(x => x.id === activeSession.id);
    if (s) { s.notas = notas; s.etiqueta = etiqueta; }
    showToast('Guardado ✓');
  }
}

// ── Drop zone ─────────────────────────────────────────────────────────────────
function setupDropZone() {
  const zone = document.getElementById('drop-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.json')) handleFile(file);
  });
  zone.addEventListener('click', () => document.getElementById('exp-file-input').click());
}

// ── File handling ─────────────────────────────────────────────────────────────
function handleFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const json = JSON.parse(e.target.result);
      showUploadModal(json, file.name);
    } catch {
      showToast('Error: archivo JSON inválido');
    }
  };
  reader.readAsText(file);
}

function calcBer(bits, expBits) {
  const n = bits.length;
  if (!n) return null;
  const err = bits.reduce((acc, b, i) => acc + (b !== expBits[i % expBits.length] ? 1 : 0), 0);
  return parseFloat((err / n).toFixed(4));
}

function showUploadModal(json, filename) {
  const records  = json.records || [];
  const expStr   = json.expected_bits || '';
  const expBits  = expStr.split('').map(Number);
  const channels = ['M','C','Y','R'];

  const bers = {};
  channels.forEach(ch => {
    bers[ch] = calcBer(records.map(r => r.bits?.[ch] ?? 0), expBits);
  });
  bers.mv = calcBer(records.map(r => r.bit_mv ?? 0), expBits);

  const mo = document.getElementById('upload-modal');
  document.getElementById('um-filename').textContent = filename;
  document.getElementById('um-dist').textContent  = json.distancia_cm ?? '—';
  document.getElementById('um-lux').textContent   = json.iluminancia_lux ?? '—';
  document.getElementById('um-bitms').textContent = json.bit_ms ?? '—';
  document.getElementById('um-bits').textContent  = records.length;
  document.getElementById('um-ber').textContent   = bers.mv != null ? (bers.mv * 100).toFixed(2) + '%' : '—';
  document.getElementById('um-etiqueta').value    = '';
  document.getElementById('um-notas').value       = '';

  mo.classList.remove('hidden');

  document.getElementById('um-cancel').onclick = () => mo.classList.add('hidden');
  document.getElementById('um-confirm').onclick = async () => {
    mo.classList.add('hidden');
    await doUpload(json, filename, bers, records);
  };
}

async function doUpload(json, filename, bers, records) {
  showToast('Subiendo...');
  const etiqueta = document.getElementById('um-etiqueta').value.trim();
  const notas    = document.getElementById('um-notas').value.trim();

  const payload = {
    filename,
    etiqueta:       etiqueta || null,
    notas:          notas    || null,
    distancia_cm:   json.distancia_cm    ?? null,
    iluminancia_lux:json.iluminancia_lux ?? null,
    brillo_tx_pct:  json.brillo_tx_pct   ?? null,
    bit_ms:         json.bit_ms          ?? null,
    actual_fps:     json.actual_fps      ?? null,
    frames_per_bit: json.frames_per_bit  ?? null,
    tx:             json.tx              ?? null,
    rx:             json.rx              ?? null,
    condicion_luz:  json.condicion_luz   ?? null,
    expected_bits:  json.expected_bits   ?? null,
    n_bits:         records.length,
    n_preambles:    (json.preambles || []).length,
    ber_mv: bers.mv,
    ber_M:  bers.M,  ber_C: bers.C,
    ber_Y:  bers.Y,  ber_R: bers.R,
    data: json,
  };

  const { error } = await sb.from('sesiones').insert(payload);
  if (error) { showToast('Error al subir: ' + error.message); return; }
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
