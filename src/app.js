'use strict';

// ════════════════════════════════════════════════════════════════════════
//  ⚙️  CONFIG — Credenciales leídas desde config.js
// ════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = window.APP_CONFIG?.supabaseUrl || '';
const SUPABASE_KEY = window.APP_CONFIG?.supabaseKey || '';
// ════════════════════════════════════════════════════════════════════════

const COLORS = [
  '#f87171','#fb923c','#fbbf24','#facc15',
  '#a3e635','#4ade80','#34d399','#2dd4bf',
  '#22d3ee','#60a5fa','#818cf8','#a78bfa',
  '#c084fc','#f472b6','#fb7185','#e2e8f0',
];

let sb;
let links = [];
let currentUser = null;
let editingId = null;
let selectedColor = COLORS[0];
let isDragging = false;
let searchQuery = '';
let realtimeChannel = null;
let isSaving = false;
let selectedGroup = null;
let boards = [];
let currentBoard = null;

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
  const isConfigured = SUPABASE_URL && SUPABASE_KEY && SUPABASE_URL !== 'TU_SUPABASE_URL' && SUPABASE_KEY !== 'TU_SUPABASE_ANON_KEY';

  if (!isConfigured) {
    hide('loading-overlay');
    show('dash-view');
    show('config-banner');
    document.getElementById('user-badge').textContent = 'modo demo';
    links = getDemoLinks();
    render();
    return;
  }

  try {
    const { createClient } = supabase;
    sb = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data: { session } } = await sb.auth.getSession();
    hide('loading-overlay');

    if (session) {
      onAuth(session.user);
    } else {
      show('auth-view');
    }

    sb.auth.onAuthStateChange((_event, session) => {
      if (session) onAuth(session.user);
      else onSignOut();
    });
  } catch (err) {
    hide('loading-overlay');
    show('auth-view');
    showAuthMsg('Error de configuración: ' + err.message, 'error');
  }
}

async function onAuth(user) {
  currentUser = user;
  hide('auth-view');
  show('dash-view');
  document.getElementById('user-badge').textContent = user.email;

  await acceptPendingInvites();
  await loadBoards();
  await loadLinks();
  subscribeRealtime();
  checkUserLimit();
}

function onSignOut() {
  currentUser = null;
  links = [];
  boards = [];
  currentBoard = null;
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  hide('dash-view');
  show('auth-view');
  render();
}

// ── Auth ───────────────────────────────────────────────────────────────
async function login() {
  const email = val('login-email');
  const pass  = val('login-pass');
  if (!email || !pass) return;

  setDisabled('btn-login', true, 'Entrando...');
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  setDisabled('btn-login', false, 'Iniciar sesión');

  if (error) showAuthMsg(translateError(error.message), 'error');
}

async function signup() {
  const email = val('signup-email');
  const pass  = val('signup-pass');
  if (!email || !pass) return;
  if (pass.length < 6) { showAuthMsg('La contraseña debe tener al menos 6 caracteres', 'error'); return; }

  setDisabled('btn-signup', true, 'Creando cuenta...');
  const { error } = await sb.auth.signUp({ email, password: pass });
  setDisabled('btn-signup', false, 'Crear cuenta');

  if (error) showAuthMsg(translateError(error.message), 'error');
  else showAuthMsg('¡Cuenta creada! Revisa tu email para confirmarla.', 'success');
}

async function logout() {
  await sb.auth.signOut();
}

function translateError(msg) {
  if (msg.includes('Invalid login')) return 'Email o contraseña incorrectos';
  if (msg.includes('already registered')) return 'Este email ya está registrado';
  if (msg.includes('Email not confirmed')) return 'Confirma tu email antes de entrar';
  return msg;
}

// ── Auth UI ────────────────────────────────────────────────────────────
function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('login-panel').classList.toggle('hidden', !isLogin);
  document.getElementById('signup-panel').classList.toggle('hidden', isLogin);
  document.getElementById('tab-login-btn').classList.toggle('active', isLogin);
  document.getElementById('tab-signup-btn').classList.toggle('active', !isLogin);
  document.getElementById('auth-msg').classList.add('hidden');
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('auth-msg');
  el.textContent = msg;
  el.className = 'auth-msg ' + type;
  el.classList.remove('hidden');
}

// ── User limit check ───────────────────────────────────────────────────
async function checkUserLimit() {
  if (!sb) return;
  const { count } = await sb.from('profiles').select('*', { count: 'exact', head: true });
  if (count === null) return;

  const badge = document.getElementById('user-limit-badge');
  const MAX = 5;
  badge.textContent = `👤 ${count}/${MAX} usuarios`;
  badge.classList.remove('hidden', 'warn', 'full');

  if (count >= MAX) {
    badge.classList.add('full');
    showToast(`⚠️ Límite alcanzado: ${MAX}/${MAX} usuarios registrados`);
  } else if (count >= MAX - 1) {
    badge.classList.add('warn');
  }
}

// ── Data ───────────────────────────────────────────────────────────────
async function loadLinks() {
  if (!sb || !currentBoard) return;
  const { data, error } = await sb
    .from('links')
    .select('*')
    .eq('board_id', currentBoard.id)
    .order('position', { ascending: true });

  if (error) { showToast('Error al cargar links'); return; }
  links = data || [];
  render();
}

async function upsertLink(payload) {
  if (!sb) return;
  isSaving = true;

  if (payload.id) {
    const { id, ...rest } = payload;
    const { error } = await sb.from('links').update(rest).eq('id', id);
    if (error) showToast('Error al actualizar: ' + error.message);
  } else {
    const maxPos = links.length ? Math.max(...links.map(l => l.position ?? 0)) + 1 : 0;
    const { error } = await sb.from('links').insert({
      ...payload,
      position: maxPos,
      created_by: currentUser.id,
      board_id: currentBoard.id,
    });
    if (error) showToast('Error al guardar: ' + error.message);
  }

  isSaving = false;
  await loadLinks();
}

async function removeLink(id) {
  if (!sb) return;
  const { error } = await sb.from('links').delete().eq('id', id);
  if (error) showToast('Error al eliminar');
  else await loadLinks();
}

async function saveOrder() {
  if (!sb || links.length === 0) return;
  await Promise.all(
    links.map((l, i) => sb.from('links').update({ position: i }).eq('id', l.id))
  );
}

// ── Realtime ───────────────────────────────────────────────────────────
function subscribeRealtime() {
  if (!sb) return;
  if (realtimeChannel) sb.removeChannel(realtimeChannel);

  realtimeChannel = sb.channel('links-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'links' }, () => {
      if (!isSaving && !isDragging) loadLinks();
    })
    .subscribe();
}


// ── Boards ─────────────────────────────────────────────────────────────
async function acceptPendingInvites() {
  if (!sb) return;
  const { data: invites } = await sb
    .from('board_invites')
    .select('id, board_id, role')
    .eq('invited_email', currentUser.email)
    .eq('status', 'pending');
  if (!invites?.length) return;
  for (const inv of invites) {
    await sb.from('board_members').upsert(
      { board_id: inv.board_id, user_id: currentUser.id, role: inv.role },
      { onConflict: 'board_id,user_id', ignoreDuplicates: true }
    );
    await sb.from('board_invites').update({ status: 'accepted' }).eq('id', inv.id);
  }
}

async function loadBoards() {
  if (!sb) return;
  const { data } = await sb
    .from('board_members')
    .select('role, board:boards(id, name, created_by)')
    .eq('user_id', currentUser.id);
  boards = (data || []).map(m => ({ ...m.board, role: m.role }));

  if (boards.length === 0) {
    await createBoard('Mi Tablero', true);
    return;
  }
  const prev = currentBoard ? boards.find(b => b.id === currentBoard.id) : null;
  currentBoard = prev || boards[0];
  renderBoardSwitcher();
}

async function createBoard(name, isDefault = false) {
  if (!sb) return;
  const { data: board, error } = await sb
    .from('boards').insert({ name, created_by: currentUser.id }).select().single();
  if (error) { showToast('Error al crear tablero'); return; }
  await sb.from('board_members').insert({ board_id: board.id, user_id: currentUser.id, role: 'owner' });
  if (isDefault) {
    await sb.from('links').update({ board_id: board.id }).is('board_id', null);
  }
  await loadBoards();
  currentBoard = boards.find(b => b.id === board.id) || boards[0];
  renderBoardSwitcher();
}

async function switchBoard(board) {
  currentBoard = board;
  selectedGroup = null;
  renderBoardSwitcher();
  closeBoardDropdown();
  await loadLinks();
  subscribeRealtime();
}

function renderBoardSwitcher() {
  const nameEl = document.getElementById('board-current-name');
  if (nameEl && currentBoard) nameEl.textContent = currentBoard.name;
  const addBtn = document.getElementById('btn-add');
  if (addBtn) addBtn.style.display = currentBoard?.role === 'viewer' ? 'none' : '';
}

function toggleBoardDropdown() {
  const dd = document.getElementById('board-dropdown');
  dd.classList.contains('hidden') ? openBoardDropdown() : closeBoardDropdown();
}

function openBoardDropdown() {
  const dd = document.getElementById('board-dropdown');
  dd.innerHTML = '';
  dd.classList.remove('hidden');

  const ROLE_LABEL = { owner: 'Dueño', editor: 'Editor', viewer: 'Solo ver' };

  boards.forEach(b => {
    const item = document.createElement('div');
    item.className = 'board-item' + (b.id === currentBoard?.id ? ' active' : '');
    item.innerHTML = `<span class="board-item-name">${esc(b.name)}</span><span class="board-item-role">${ROLE_LABEL[b.role] || ''}</span>`;
    item.addEventListener('click', () => switchBoard(b));
    dd.appendChild(item);
  });

  const sep = document.createElement('div');
  sep.className = 'board-dropdown-sep';
  dd.appendChild(sep);

  if (currentBoard?.role === 'owner') {
    const renameBtn = document.createElement('button');
    renameBtn.className = 'board-action-btn';
    renameBtn.textContent = '✏ Renombrar';
    renameBtn.addEventListener('click', () => { closeBoardDropdown(); startBoardRename(); });
    dd.appendChild(renameBtn);

    const membersBtn = document.createElement('button');
    membersBtn.className = 'board-action-btn';
    membersBtn.textContent = '👥 Miembros';
    membersBtn.addEventListener('click', () => { closeBoardDropdown(); openMembersModal(); });
    dd.appendChild(membersBtn);
  }

  const newBtn = document.createElement('button');
  newBtn.className = 'board-action-btn board-new-btn';
  newBtn.textContent = '+ Nuevo tablero';
  newBtn.addEventListener('click', () => {
    closeBoardDropdown();
    const name = prompt('Nombre del tablero:');
    if (name?.trim()) createBoard(name.trim());
  });
  dd.appendChild(newBtn);

  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!document.getElementById('board-switcher')?.contains(e.target)) {
        closeBoardDropdown();
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
}

function closeBoardDropdown() {
  document.getElementById('board-dropdown')?.classList.add('hidden');
}

function startBoardRename() {
  const nameEl = document.getElementById('board-current-name');
  const currentName = nameEl.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'board-rename-input';
  input.value = currentName;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  async function commit() {
    const newName = input.value.trim() || currentName;
    if (newName !== currentName) {
      await sb.from('boards').update({ name: newName }).eq('id', currentBoard.id);
      currentBoard.name = newName;
      boards = boards.map(b => b.id === currentBoard.id ? { ...b, name: newName } : b);
    }
    const span = document.createElement('span');
    span.id = 'board-current-name';
    span.textContent = newName;
    input.replaceWith(span);
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { input.value = currentName; commit(); }
  });
  input.addEventListener('blur', commit);
}

// ── Members modal ───────────────────────────────────────────────────────
async function openMembersModal() {
  document.getElementById('members-overlay').classList.remove('hidden');
  document.getElementById('members-board-name').textContent = currentBoard.name;
  document.getElementById('invite-email').value = '';
  await loadMembers();
}

function closeMembersModal() {
  document.getElementById('members-overlay').classList.add('hidden');
}

async function loadMembers() {
  if (!sb) return;
  const { data: members } = await sb
    .from('board_members')
    .select('user_id, role, profile:profiles(email)')
    .eq('board_id', currentBoard.id);

  const { data: invites } = await sb
    .from('board_invites')
    .select('id, invited_email, role')
    .eq('board_id', currentBoard.id)
    .eq('status', 'pending');

  const list = document.getElementById('members-list');
  list.innerHTML = '';

  (members || []).forEach(m => {
    const email = m.profile?.email || '(usuario)';
    const row = document.createElement('div');
    row.className = 'member-row';

    if (m.role === 'owner') {
      row.innerHTML = `<span class="member-email">${esc(email)}</span><span class="member-role-badge">Dueño</span>`;
    } else {
      row.innerHTML = `
        <span class="member-email">${esc(email)}</span>
        <select class="member-role-select" data-uid="${m.user_id}">
          <option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Editor</option>
          <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>Solo ver</option>
        </select>
        <button class="member-remove-btn" data-uid="${m.user_id}" title="Quitar">✕</button>`;
    }
    list.appendChild(row);
  });

  list.querySelectorAll('.member-role-select').forEach(sel => {
    sel.addEventListener('change', async e => {
      await sb.from('board_members').update({ role: e.target.value })
        .eq('board_id', currentBoard.id).eq('user_id', e.target.dataset.uid);
      showToast('Rol actualizado');
    });
  });

  list.querySelectorAll('.member-remove-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      await sb.from('board_members').delete()
        .eq('board_id', currentBoard.id).eq('user_id', e.target.dataset.uid);
      await loadMembers();
      showToast('Miembro eliminado');
    });
  });

  const pendingSection = document.getElementById('pending-invites-section');
  const pendingList = document.getElementById('pending-invites-list');
  pendingList.innerHTML = '';

  if (invites?.length) {
    pendingSection.classList.remove('hidden');
    invites.forEach(inv => {
      const row = document.createElement('div');
      row.className = 'member-row';
      row.innerHTML = `
        <span class="member-email muted">${esc(inv.invited_email)}</span>
        <span class="member-role-badge muted">${inv.role === 'editor' ? 'Editor' : 'Solo ver'}</span>
        <button class="member-remove-btn" data-id="${inv.id}" title="Cancelar">✕</button>`;
      row.querySelector('.member-remove-btn').addEventListener('click', async e => {
        await sb.from('board_invites').delete().eq('id', e.target.dataset.id);
        await loadMembers();
      });
      pendingList.appendChild(row);
    });
  } else {
    pendingSection.classList.add('hidden');
  }
}

async function sendInvite() {
  const email = document.getElementById('invite-email').value.trim().toLowerCase();
  const role  = document.getElementById('invite-role').value;
  if (!email) return;

  const { error } = await sb.from('board_invites').upsert({
    board_id: currentBoard.id, invited_email: email,
    invited_by: currentUser.id, role, status: 'pending'
  }, { onConflict: 'board_id,invited_email' });

  if (error) { showToast('Error: ' + error.message); return; }
  document.getElementById('invite-email').value = '';
  showToast(`Invitación enviada a ${email}`);
  await loadMembers();
}

let deleteBoardConfirming = false;
let deleteBoardTimer = null;

async function confirmDeleteBoard() {
  const btn = document.getElementById('btn-delete-board');
  if (!deleteBoardConfirming) {
    deleteBoardConfirming = true;
    btn.textContent = '¿Confirmar?';
    deleteBoardTimer = setTimeout(() => {
      deleteBoardConfirming = false;
      btn.textContent = 'Eliminar tablero';
    }, 3000);
    return;
  }
  clearTimeout(deleteBoardTimer);
  deleteBoardConfirming = false;
  btn.textContent = 'Eliminar tablero';
  await sb.from('boards').delete().eq('id', currentBoard.id);
  closeMembersModal();
  currentBoard = null;
  await loadBoards();
  if (boards.length > 0) await switchBoard(boards[0]);
  else { links = []; render(); }
  showToast('Tablero eliminado');
}

// ── Render ─────────────────────────────────────────────────────────────
const TILE_W = 158, TILE_H = 130, TILE_GAP = 20;

function autoPos(index) {
  const cols = Math.max(1, Math.floor((window.innerWidth - 60) / (TILE_W + TILE_GAP)));
  return {
    x: (index % cols) * (TILE_W + TILE_GAP) + 20,
    y: Math.floor(index / cols) * (TILE_H + TILE_GAP) + 20,
  };
}

function render() {
  const canvas = document.getElementById('canvas');
  canvas.innerHTML = '';

  let visible = selectedGroup
    ? links.filter(l => (l.group_name || '') === selectedGroup)
    : links;

  if (searchQuery) {
    visible = visible.filter(l =>
      l.name.toLowerCase().includes(searchQuery) ||
      (l.description || '').toLowerCase().includes(searchQuery)
    );
  }

  if (visible.length === 0) {
    const empty = document.createElement('div');
    if (searchQuery) {
      empty.className = 'empty empty-search';
      empty.textContent = `Sin resultados para "${searchQuery}"`;
    } else if (selectedGroup) {
      empty.className = 'empty empty-search';
      empty.textContent = `Sin accesos en "${selectedGroup}"`;
    } else {
      empty.className = 'empty-state';
      empty.innerHTML = `
        <div class="empty-state-icon">✦</div>
        <p class="empty-state-title">Tu tablero está vacío</p>
        <p class="empty-state-sub">Agrega tu primer acceso rápido o nota</p>
        <button class="primary empty-state-btn" id="empty-add-btn">+ Agregar</button>
      `;
    }
    canvas.appendChild(empty);
    document.getElementById('empty-add-btn')?.addEventListener('click', () => openModal(null));
    return;
  }

  visible.forEach((link, i) => canvas.appendChild(createTile(link, i)));
  renderGroupTabs();
}

function renderGroupTabs() {
  const container = document.getElementById('group-tabs');
  if (!container) return;

  const groups = [...new Set(links.map(l => l.group_name || '').filter(Boolean))].sort();

  if (groups.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';

  const all = document.createElement('button');
  all.className = 'group-tab' + (selectedGroup === null ? ' active' : '');
  all.textContent = 'Todos';
  all.addEventListener('click', () => { selectedGroup = null; render(); });
  container.appendChild(all);

  groups.forEach(g => {
    const wrap = document.createElement('div');
    wrap.className = 'group-tab-wrap';

    const btn = document.createElement('button');
    btn.className = 'group-tab' + (selectedGroup === g ? ' active' : '');
    btn.innerHTML = `<span class="group-tab-label">${esc(g)}</span><svg class="group-edit-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><svg class="group-delete-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
    btn.addEventListener('click', e => {
      if (e.target.closest('.group-edit-icon')) {
        startGroupRename(wrap, btn, g);
      } else if (e.target.closest('.group-delete-icon')) {
        confirmDeleteGroup(btn, g);
      } else {
        selectedGroup = g; render();
      }
    });

    wrap.appendChild(btn);
    container.appendChild(wrap);
  });
}

function startGroupRename(wrap, btn, oldName) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'group-tab group-tab-input';
  input.value = oldName;

  wrap.replaceChild(input, btn);
  input.focus();
  input.select();

  async function commit() {
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      await renameGroup(oldName, newName);
      if (selectedGroup === oldName) selectedGroup = newName;
    }
    await loadLinks();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { wrap.replaceChild(btn, input); }
  });
  input.addEventListener('blur', commit);
}

function confirmDeleteGroup(btn, groupName) {
  document.querySelectorAll('.group-delete-popup').forEach(p => p.remove());

  const popup = document.createElement('div');
  popup.className = 'group-delete-popup';
  popup.innerHTML = `<span>¿Eliminar etiqueta?</span><button class="group-delete-confirm">Sí</button>`;

  btn.parentElement.appendChild(popup);

  popup.querySelector('.group-delete-confirm').addEventListener('click', e => {
    e.stopPropagation();
    popup.remove();
    deleteGroup(groupName);
  });

  setTimeout(() => {
    document.addEventListener('click', function handler() {
      popup.remove();
      document.removeEventListener('click', handler);
    });
  }, 0);
}

async function deleteGroup(groupName) {
  if (!sb) return;
  const targets = links.filter(l => l.group_name === groupName).map(l => l.id);
  await Promise.all(targets.map(id => sb.from('links').update({ group_name: '' }).eq('id', id)));
  if (selectedGroup === groupName) selectedGroup = null;
  await loadLinks();
}

async function renameGroup(oldName, newName) {
  if (!sb) return;
  const targets = links.filter(l => l.group_name === oldName).map(l => l.id);
  if (targets.length === 0) return;
  await Promise.all(
    targets.map(id => sb.from('links').update({ group_name: newName }).eq('id', id))
  );
}

function createTile(link, index = 0) {
  const isNote = !link.url;
  const bg = link.color || COLORS[0];
  const pos = (link.pos_x != null && link.pos_y != null)
    ? { x: link.pos_x, y: link.pos_y }
    : autoPos(index);

  const tile = document.createElement('div');
  tile.className = 'tile' + (isNote ? ' tile-note' : '');
  tile.dataset.id = link.id;
  tile.style.background = bg;
  tile.style.color = isLight(bg) ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)';
  tile.style.left = pos.x + 'px';
  tile.style.top  = pos.y + 'px';

  const canEdit = currentBoard?.role !== 'viewer';
  tile.innerHTML = isNote ? `
    <div class="tile-actions">
      ${canEdit ? '<button class="tile-btn" title="Editar" tabindex="-1">✏️</button>' : ''}
    </div>
    <div class="tile-pin">📌</div>
    <div class="tile-name">${esc(link.name)}</div>
    ${link.description ? `<div class="tile-note-body">${esc(link.description)}</div>` : ''}
  ` : `
    <div class="tile-actions">
      ${canEdit ? '<button class="tile-btn" title="Editar" tabindex="-1">✏️</button>' : ''}
    </div>
    <div class="tile-icon">${renderIcon(link.icon)}</div>
    <div class="tile-name">${esc(link.name)}</div>
    ${link.description ? `<div class="tile-desc">${esc(link.description)}</div>` : ''}
  `;

  tile.querySelector('.tile-btn')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    openModal(link.id);
  });

  initTileDrag(tile, link, isNote);
  return tile;
}

function showNote(link) {
  document.getElementById('note-popup-title').textContent = link.name;
  document.getElementById('note-popup-body').textContent = link.description || '(sin contenido)';
  document.getElementById('note-popup-edit').dataset.id = link.id;
  document.getElementById('note-overlay').classList.remove('hidden');
}

function closeNote() {
  document.getElementById('note-overlay').classList.add('hidden');
}

// ── Modal ──────────────────────────────────────────────────────────────
function openModal(id) {
  editingId = id;
  const delBtn = document.getElementById('btn-delete');

  if (id) {
    const link = links.find(l => l.id === id);
    document.getElementById('modal-title').textContent = 'Editar acceso';
    document.getElementById('f-icon').value = link.icon || '';
    document.getElementById('f-name').value = link.name;
    document.getElementById('f-url').value = link.url;
    document.getElementById('f-desc').value = link.description || '';
    selectedColor = link.color || COLORS[0];
    document.getElementById('f-group').value = link.group_name || '';
    delBtn.classList.remove('hidden');
  } else {
    document.getElementById('modal-title').textContent = 'Nuevo acceso';
    document.getElementById('f-icon').value = '';
    document.getElementById('f-name').value = '';
    document.getElementById('f-url').value = '';
    document.getElementById('f-desc').value = '';
    selectedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    document.getElementById('f-group').value = '';
    delBtn.classList.add('hidden');
  }

  document.getElementById('favicon-row').classList.add('hidden');
  document.getElementById('favicon-preview').innerHTML = '';
  document.getElementById('f-icon').dataset.userSet = '0';

  buildPalette();

  // Populate group suggestions
  const dl = document.getElementById('group-suggestions');
  dl.innerHTML = '';
  [...new Set(links.map(l => l.group_name || '').filter(Boolean))].forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    dl.appendChild(opt);
  });

  document.getElementById('overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('f-name').focus(), 60);
}

function closeModal() {
  document.getElementById('overlay').classList.add('hidden');
  editingId = null;
  resetDeleteBtn();
}

function buildPalette() {
  const palette = document.getElementById('color-palette');
  palette.innerHTML = '';

  const isCustom = !COLORS.includes(selectedColor);

  COLORS.forEach(c => {
    const el = document.createElement('div');
    el.className = 'color-opt' + (c === selectedColor ? ' selected' : '');
    el.style.background = c;
    el.addEventListener('click', () => {
      selectedColor = c;
      palette.querySelectorAll('.color-opt').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
    });
    palette.appendChild(el);
  });

  // Custom color swatch
  const label = document.createElement('label');
  label.className = 'color-opt color-custom' + (isCustom ? ' selected' : '');
  label.title = 'Color personalizado';
  if (isCustom) label.style.background = selectedColor;

  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'color-picker-input';
  input.value = isCustom ? selectedColor : '#60a5fa';

  input.addEventListener('input', e => {
    selectedColor = e.target.value;
    label.style.background = selectedColor;
    palette.querySelectorAll('.color-opt').forEach(x => x.classList.remove('selected'));
    label.classList.add('selected');
  });

  label.appendChild(input);
  palette.appendChild(label);
}

async function saveLink() {
  const icon  = val('f-icon') || '🔗';
  const name  = val('f-name');
  const url   = val('f-url');
  const desc  = val('f-desc');
  if (!name) { document.getElementById('f-name').focus(); showToast('El nombre es obligatorio'); return; }

  setDisabled('btn-save', true, 'Guardando...');

  const group = val('f-group');
  const payload = { icon, name, url, description: desc, color: selectedColor, group_name: group };
  if (editingId) payload.id = editingId;

  await upsertLink(payload);

  setDisabled('btn-save', false, 'Guardar');
  showToast(editingId ? 'Acceso actualizado' : 'Acceso agregado');
  closeModal();
}

let deleteConfirmTimer = null;

async function deleteLink() {
  if (!editingId) return;

  const btn = document.getElementById('btn-delete');

  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    btn.textContent = '¿Confirmar?';
    btn.style.background = '#5a1a1a';
    btn.style.borderColor = '#8a2a2a';
    btn.style.color = '#ff9090';
    deleteConfirmTimer = setTimeout(() => resetDeleteBtn(), 3000);
    return;
  }

  clearTimeout(deleteConfirmTimer);
  const link = links.find(l => l.id === editingId);
  setDisabled('btn-delete', true, '...');
  await removeLink(editingId);
  resetDeleteBtn();
  showToast(`"${link.name}" eliminado`);
  closeModal();
}

function resetDeleteBtn() {
  const btn = document.getElementById('btn-delete');
  if (!btn) return;
  delete btn.dataset.confirming;
  btn.textContent = 'Eliminar';
  btn.style.background = '';
  btn.style.borderColor = '';
  btn.style.color = '';
  btn.disabled = false;
  clearTimeout(deleteConfirmTimer);
}

// ── Drag libre ─────────────────────────────────────────────────────────
function initTileDrag(tile, link, isNote) {
  if (isMobile()) return;
  let startMX, startMY, startLeft, startTop, moved;

  function pointerDown(e) {
    if (e.target.closest('.tile-btn')) return;
    if (e.button !== undefined && e.button !== 0) return;

    const isTouch = e.type === 'touchstart';
    const pt = isTouch ? e.touches[0] : e;

    startMX   = pt.clientX;
    startMY   = pt.clientY;
    startLeft = parseInt(tile.style.left) || 0;
    startTop  = parseInt(tile.style.top)  || 0;
    moved     = false;

    document.addEventListener(isTouch ? 'touchmove' : 'mousemove', pointerMove, { passive: false });
    document.addEventListener(isTouch ? 'touchend'  : 'mouseup',   pointerUp);
  }

  function pointerMove(e) {
    e.preventDefault();
    const isTouch = e.type === 'touchmove';
    const pt = isTouch ? e.touches[0] : e;

    const dx = pt.clientX - startMX;
    const dy = pt.clientY - startMY;

    if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      moved = true;
      isDragging = true;
      tile.classList.add('is-dragging');
    }

    if (moved) {
      tile.style.left = Math.max(0, startLeft + dx) + 'px';
      tile.style.top  = Math.max(0, startTop  + dy) + 'px';
    }
  }

  async function pointerUp(e) {
    const isTouch = e.type === 'touchend';
    document.removeEventListener(isTouch ? 'touchmove' : 'mousemove', pointerMove);
    document.removeEventListener(isTouch ? 'touchend'  : 'mouseup',   pointerUp);

    tile.classList.remove('is-dragging');

    if (moved) {
      isDragging = false;
      const x = Math.max(0, parseInt(tile.style.left));
      const y = Math.max(0, parseInt(tile.style.top));
      link.pos_x = x;
      link.pos_y = y;
      await savePosition(link.id, x, y);
    } else {
      isDragging = false;
      if (isNote) {
        showNote(link);
      } else if (link.url) {
        window.open(link.url, '_blank', 'noopener,noreferrer');
      }
    }
  }

  tile.addEventListener('mousedown',  pointerDown);
  tile.addEventListener('touchstart', pointerDown, { passive: true });
}

async function savePosition(id, x, y) {
  if (!sb || currentBoard?.role === 'viewer') return;
  await sb.from('links').update({ pos_x: x, pos_y: y }).eq('id', id);
}

// ── Toast ──────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Helpers ────────────────────────────────────────────────────────────
// ── Color helpers ──────────────────────────────────────────────────────
function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}
function mixColor(hex, target, amount) {
  const [r,g,b] = hexToRgb(hex);
  const nr = Math.round(r + (target[0]-r)*amount);
  const ng = Math.round(g + (target[1]-g)*amount);
  const nb = Math.round(b + (target[2]-b)*amount);
  return '#'+[nr,ng,nb].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function deriveIconBg(cardColor) {
  if (!cardColor || cardColor.length < 7) return 'rgba(255,255,255,0.18)';
  return isLight(cardColor)
    ? mixColor(cardColor, [0,0,0], 0.13)
    : mixColor(cardColor, [255,255,255], 0.22);
}

function isMobile() { return window.matchMedia('(max-width: 640px)').matches; }

function val(id) { return document.getElementById(id).value.trim(); }
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function setDisabled(id, disabled, text) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = disabled;
  if (text) btn.textContent = text;
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderIcon(icon) {
  if (icon && icon.startsWith('http')) {
    return `<img src="${esc(icon)}" alt="" onerror="this.parentElement.textContent='🔗'">`;
  }
  return esc(icon || '🔗');
}

function getFaviconUrl(urlStr) {
  try {
    const { hostname } = new URL(urlStr);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch { return null; }
}

function isLight(hex) {
  if (!hex || hex.length < 7) return true;
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return (0.299*r + 0.587*g + 0.114*b) > 155;
}

function getDemoLinks() {
  return [
    { id:'d1', name:'GitHub', url:'https://github.com', icon:'🐙', color:'#34d399', description:'Repositorios', position:0 },
    { id:'d2', name:'Figma', url:'https://figma.com', icon:'🎨', color:'#a78bfa', description:'Diseño', position:1 },
    { id:'d3', name:'Notion', url:'https://notion.so', icon:'📝', color:'#e2e8f0', description:'Notas', position:2 },
    { id:'d4', name:'YouTube', url:'https://youtube.com', icon:'▶️', color:'#f87171', description:'', position:3 },
    { id:'d5', name:'Spotify', url:'https://spotify.com', icon:'🎵', color:'#4ade80', description:'', position:4 },
  ];
}

// ── Event Listeners ────────────────────────────────────────────────────

// Auth
document.getElementById('tab-login-btn').addEventListener('click', () => switchTab('login'));
document.getElementById('tab-signup-btn').addEventListener('click', () => switchTab('signup'));
document.getElementById('login-panel').addEventListener('submit', e => { e.preventDefault(); login(); });
document.getElementById('signup-panel').addEventListener('submit', e => { e.preventDefault(); signup(); });
document.getElementById('btn-logout').addEventListener('click', logout);



// Dashboard
document.getElementById('btn-add').addEventListener('click', () => openModal(null));
document.getElementById('btn-cancel').addEventListener('click', closeModal);
document.getElementById('btn-save').addEventListener('click', saveLink);
document.getElementById('btn-delete').addEventListener('click', deleteLink);

document.getElementById('overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('overlay')) closeModal();
});
document.querySelector('.modal').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) saveLink();
  if (e.key === 'Escape') closeModal();
});

// Note popup
document.getElementById('note-popup-close').addEventListener('click', closeNote);
document.getElementById('note-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('note-overlay')) closeNote();
});
document.getElementById('note-popup-edit').addEventListener('click', e => {
  closeNote();
  openModal(e.currentTarget.dataset.id);
});

// URL field: label + favicon preview
document.getElementById('f-url').addEventListener('input', e => {
  const hasUrl = e.target.value.trim().length > 0;
  document.getElementById('desc-label').textContent = hasUrl ? 'Descripción (opcional)' : 'Contenido de la nota';
  document.getElementById('f-desc').rows = hasUrl ? 2 : 5;

  const faviconUrl = getFaviconUrl(e.target.value);
  const row = document.getElementById('favicon-row');
  const preview = document.getElementById('favicon-preview');

  const iconField = document.getElementById('f-icon');
  const userSetIcon = iconField.dataset.userSet === '1';

  if (faviconUrl) {
    preview.innerHTML = `<img src="${faviconUrl}" alt="">`;
    row.classList.remove('hidden');
    if (!userSetIcon) {
      iconField.value = faviconUrl;
    }
  } else {
    row.classList.add('hidden');
    preview.innerHTML = '';
    if (!userSetIcon) iconField.value = '';
  }
});

document.getElementById('f-icon').addEventListener('input', () => {
  document.getElementById('f-icon').dataset.userSet = '1';
});

document.getElementById('favicon-use-btn').addEventListener('click', () => {
  const faviconUrl = getFaviconUrl(document.getElementById('f-url').value);
  if (faviconUrl) {
    document.getElementById('f-icon').value = faviconUrl;
    document.getElementById('f-icon').dataset.userSet = '1';
    showToast('Favicon aplicado como ícono');
  }
});

document.getElementById('search').addEventListener('input', e => {
  searchQuery = e.target.value.trim().toLowerCase();
  render();
});

// Password toggle
const EYE_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF  = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

document.querySelectorAll('.pass-toggle').forEach(btn => {
  btn.innerHTML = EYE_OPEN;
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF : EYE_OPEN;
  });
});

// Cmd+K / Ctrl+K → abrir modal
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    if (!document.getElementById('overlay').classList.contains('hidden')) return;
    openModal(null);
  }
});

// Board switcher
document.getElementById('board-current-btn').addEventListener('click', e => {
  e.stopPropagation();
  toggleBoardDropdown();
});

// Members modal
document.getElementById('btn-send-invite').addEventListener('click', sendInvite);
document.getElementById('invite-email').addEventListener('keydown', e => { if (e.key === 'Enter') sendInvite(); });
document.getElementById('btn-close-members').addEventListener('click', closeMembersModal);
document.getElementById('members-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('members-overlay')) closeMembersModal();
});
document.getElementById('btn-delete-board').addEventListener('click', confirmDeleteBoard);

// ── Start ──────────────────────────────────────────────────────────────
init();
