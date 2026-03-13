/* =============================================
   ANGÉLICO ADVOGADOS — AGENDA DE PRAZOS
   app.js — v4.0 (Kanban + Tratativa + Vista Semanal)
   ============================================= */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDMLC3yCK9K4zmI5LNLgevN7OTpDqm2hkY",
  authDomain:        "angelico-advogados.firebaseapp.com",
  databaseURL:       "https://angelico-advogados-default-rtdb.firebaseio.com",
  projectId:         "angelico-advogados",
  storageBucket:     "angelico-advogados.firebasestorage.app",
  messagingSenderId: "423621967651",
  appId:             "1:423621967651:web:3698c1739d5ad3f07fd696"
};

const EMAILJS_CONFIG = {
  serviceId:  "service_xlbb117",
  templateId: "template_mg7d4l6",
  publicKey:  "LhW6qGS5NdC7-quQY"
};

const AUTHORIZED_USERS = [
  { name: 'Andrea Angélico', email: 'andrea@anlema.com.br',        password: 'angelico@13', role: 'admin' },
  { name: 'Debora Pelogi',   email: 'debora.pelogi@anlema.com.br', password: 'angelico@13', role: 'user'  },
  { name: 'Larissa Lopes',   email: 'paralegal@anlema.com.br',     password: 'angelico@13', role: 'user'  },
  { name: 'Thiago Prado',    email: 'thiago.prado@anlema.com.br',  password: 'angelico@13', role: 'user'  },
  { name: 'Beatriz Amaro',   email: 'beatriz.amaro@anlema.com.br', password: 'angelico@13', role: 'user'  },
];

const ANDREA_EMAIL = 'andrea@anlema.com.br';

let db                = null;
let tasks             = [];
let currentUser       = null;
let selectedPrio      = 'low';
let currentFilter     = 'all';
let currentPrioFilter = 'all';
let currentRespFilter = 'all';
let notifiedKeys      = new Set();
let currentView       = 'list'; // 'list' | 'kanban'
let kanbanWeekOffset  = 0;
let draggedTaskId     = null;

// =============================================
// HELPERS
// =============================================
function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function isAndrea(email) {
  return normalizeEmail(email) === ANDREA_EMAIL;
}

function isAdmin(email) {
  const u = AUTHORIZED_USERS.find(x => normalizeEmail(x.email) === normalizeEmail(email));
  return !!(u && u.role === 'admin');
}

function getAssignableUsers() {
  if (currentUser && isAndrea(currentUser.email)) return AUTHORIZED_USERS;
  return AUTHORIZED_USERS.filter(u => !isAndrea(u.email));
}

function sanitizeResponsaveis(emails, includeCurrentUser = true) {
  let lista = Array.isArray(emails) ? emails.map(normalizeEmail) : [];
  if (!isAndrea(currentUser?.email)) lista = lista.filter(e => !isAndrea(e));
  lista = lista.filter(e => AUTHORIZED_USERS.some(u => normalizeEmail(u.email) === e));
  if (includeCurrentUser && currentUser?.email) {
    const me = normalizeEmail(currentUser.email);
    if (!lista.includes(me)) lista.unshift(me);
  }
  return [...new Set(lista)];
}

function canViewTask(task) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (normalizeEmail(task.ownerEmail) === normalizeEmail(currentUser.email)) return true;
  if (Array.isArray(task.responsaveis) && task.responsaveis.includes(normalizeEmail(currentUser.email))) return true;
  return false;
}

function canEditTask(task) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (normalizeEmail(task.ownerEmail) === normalizeEmail(currentUser.email)) return true;
  if (Array.isArray(task.responsaveis) && task.responsaveis.includes(normalizeEmail(currentUser.email))) return true;
  return false;
}

function getUserName(email) {
  const u = AUTHORIZED_USERS.find(x => normalizeEmail(x.email) === normalizeEmail(email));
  return u ? u.name.split(' ')[0] : email;
}

function getUserFullName(email) {
  const u = AUTHORIZED_USERS.find(x => normalizeEmail(x.email) === normalizeEmail(email));
  return u ? u.name : email;
}

// =============================================
// SEMANA UTILS
// =============================================
function getWeekDays(offset) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + (offset || 0) * 7);
  monday.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth()    === d2.getMonth() &&
         d1.getDate()     === d2.getDate();
}

function startOfDay(d) {
  const x = new Date(d); x.setHours(0,0,0,0); return x;
}

function fmtWeekRange(days) {
  const opts = { day: '2-digit', month: '2-digit' };
  return days[0].toLocaleDateString('pt-BR', opts) + ' – ' + days[4].toLocaleDateString('pt-BR', opts);
}

// =============================================
// INICIALIZAÇÃO
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  initClock();
  const saved = sessionStorage.getItem('angelico-user');
  if (saved) {
    currentUser = JSON.parse(saved);
    currentUser.email = normalizeEmail(currentUser.email);
    showApp();
  }
  populateTeamSelect('inp-responsaveis');
});

function populateTeamSelect(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const lista = getAssignableUsers();
  container.innerHTML = lista.map(u => `
    <label class="team-checkbox">
      <input type="checkbox" value="${normalizeEmail(u.email)}">
      <span class="team-check-name">${u.name}</span>
    </label>
  `).join('');
}

// =============================================
// FIREBASE
// =============================================
function initFirebase() {
  const scripts = [
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js'
  ];
  let loaded = 0;
  scripts.forEach(src => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { if (++loaded === scripts.length) connectFirebase(); };
    document.head.appendChild(s);
  });
}

function connectFirebase() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    if (currentUser) { listenTasks(); loadAvatar(); }
  } catch (e) {
    console.warn('Firebase erro:', e);
    loadLocalTasks();
  }
}

function listenTasks() {
  if (!db) { loadLocalTasks(); return; }
  db.ref('tasks').on('value', snapshot => {
    tasks = [];
    snapshot.forEach(child => {
      const val = child.val() || {};
      tasks.push({
        id: child.key, ...val,
        ownerEmail:   normalizeEmail(val.ownerEmail),
        responsaveis: Array.isArray(val.responsaveis) ? val.responsaveis.map(normalizeEmail) : []
      });
    });
    tasks.sort((a, b) => new Date(a.date) - new Date(b.date));
    renderCurrentView();
    checkAlerts();
  });
}

function saveTaskFirebase(task) {
  if (!db) { saveLocalTask(task); return; }
  const ref = db.ref('tasks').push();
  task.id = ref.key; ref.set(task);
}

function updateTaskFirebase(id, data) {
  if (!db) { updateLocalTask(id, data); return; }
  db.ref('tasks/' + id).update(data);
}

function deleteTaskFirebase(id) {
  if (!db) { deleteLocalTask(id); return; }
  db.ref('tasks/' + id).remove();
}

// =============================================
// FALLBACK LOCAL
// =============================================
function loadLocalTasks() {
  tasks = JSON.parse(localStorage.getItem('angelico-tasks') || '[]').map(task => ({
    ...task,
    ownerEmail:   normalizeEmail(task.ownerEmail),
    responsaveis: Array.isArray(task.responsaveis) ? task.responsaveis.map(normalizeEmail) : []
  }));
  notifiedKeys = new Set(JSON.parse(localStorage.getItem('angelico-notified') || '[]'));
  renderCurrentView(); checkAlerts();
}
function saveLocalTask(task) {
  task.id = Date.now().toString(); tasks.unshift(task);
  localStorage.setItem('angelico-tasks', JSON.stringify(tasks)); renderCurrentView();
}
function updateLocalTask(id, data) {
  const t = tasks.find(x => x.id == id);
  if (t) Object.assign(t, data);
  localStorage.setItem('angelico-tasks', JSON.stringify(tasks)); renderCurrentView();
}
function deleteLocalTask(id) {
  tasks = tasks.filter(x => x.id != id);
  localStorage.setItem('angelico-tasks', JSON.stringify(tasks)); renderCurrentView();
}

// =============================================
// LOGIN / LOGOUT
// =============================================
function login() {
  const email    = normalizeEmail(document.getElementById('login-email').value);
  const password = document.getElementById('login-password').value;
  const user     = AUTHORIZED_USERS.find(u => normalizeEmail(u.email) === email);
  if (!user) { showLoginError('E-mail não autorizado.'); return; }
  if (user.password !== password) { showLoginError('Senha incorreta.'); return; }
  currentUser = { name: user.name, email: normalizeEmail(user.email), role: user.role };
  sessionStorage.setItem('angelico-user', JSON.stringify(currentUser));
  document.getElementById('login-error').style.display = 'none';
  showApp();
  populateTeamSelect('inp-responsaveis');
  if (db) listenTasks(); else loadLocalTasks();
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; el.style.display = 'block';
}

function logout() {
  currentUser = null;
  sessionStorage.removeItem('angelico-user');
  document.getElementById('screenLogin').style.display = 'flex';
  document.getElementById('screenApp').style.display   = 'none';
  document.getElementById('login-email').value    = '';
  document.getElementById('login-password').value = '';
  populateTeamSelect('inp-responsaveis');
}

function showApp() {
  document.getElementById('screenLogin').style.display = 'none';
  document.getElementById('screenApp').style.display   = 'block';
  document.getElementById('userInfo').style.display    = 'flex';
  updateSidebarProfile();
  populateTeamSelect('inp-responsaveis');
  const el = document.getElementById('inp-emails');
  if (el) el.value = currentUser.email;
  const privField = document.getElementById('field-privado');
  if (privField) privField.style.display = currentUser.role === 'admin' ? 'flex' : 'none';

  // Filtro de responsável — só ADM
  const respFilterWrap = document.getElementById('admin-resp-filter');
  if (respFilterWrap) {
    if (currentUser.role === 'admin') {
      respFilterWrap.style.display = 'flex';
      const sel = document.getElementById('filter-resp');
      if (sel) {
        sel.innerHTML = '<option value="all">👥 Todos os responsáveis</option>';
        AUTHORIZED_USERS.forEach(u => {
          const opt = document.createElement('option');
          opt.value = normalizeEmail(u.email);
          opt.textContent = u.name;
          sel.appendChild(opt);
        });
      }
    } else {
      respFilterWrap.style.display = 'none';
    }
  }
}

// =============================================
// PERFIL SIDEBAR
// =============================================
function updateSidebarProfile() {
  const nameEl = document.getElementById('sidebar-username');
  const roleEl = document.getElementById('sidebar-role');
  if (nameEl) nameEl.textContent = currentUser.name;
  if (roleEl) roleEl.textContent = currentUser.role === 'admin' ? 'Administrador' : 'Usuário';
  loadAvatar();
  updateStats();
}

function handleAvatarUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const data = e.target.result;
    if (db) db.ref('avatars/' + currentUser.email.replace(/[.#$\[\]]/g, '_')).set(data);
    else localStorage.setItem('avatar-' + currentUser.email, data);
    const avatarEl = document.getElementById('sidebar-avatar');
    if (avatarEl) avatarEl.src = data;
  };
  reader.readAsDataURL(file);
}

function loadAvatar() {
  if (!currentUser) return;
  const avatarEl = document.getElementById('sidebar-avatar');
  if (!avatarEl) return;
  if (db) {
    db.ref('avatars/' + currentUser.email.replace(/[.#$\[\]]/g, '_')).once('value', snap => {
      if (snap.val()) avatarEl.src = snap.val();
    });
  } else {
    const saved = localStorage.getItem('avatar-' + currentUser.email);
    if (saved) avatarEl.src = saved;
  }
}

// =============================================
// VIEW SWITCHER
// =============================================
function setView(view) {
  currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.view-btn[data-view="${view}"]`);
  if (btn) btn.classList.add('active');
  const listArea    = document.getElementById('listArea');
  const kanbanArea  = document.getElementById('kanbanArea');
  const listToolbar = document.getElementById('listToolbar');
  if (view === 'list') {
    listArea.style.display   = 'block';
    kanbanArea.style.display = 'none';
    listToolbar.style.display = 'flex';
    render();
  } else {
    listArea.style.display   = 'none';
    kanbanArea.style.display = 'block';
    listToolbar.style.display = 'none';
    renderKanban();
  }
}

function renderCurrentView() {
  if (currentView === 'list') render();
  else renderKanban();
  updateStats();
}

// =============================================
// MODAL NOVA TAREFA
// =============================================
function openNewTaskModal() {
  document.getElementById('modalNewTask').style.display = 'flex';
  setDefaultDate();
  populateTeamSelect('inp-responsaveis');
  const container = document.getElementById('inp-responsaveis');
  if (container) {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = normalizeEmail(cb.value) === normalizeEmail(currentUser.email);
    });
  }
  const privField = document.getElementById('field-privado');
  if (privField) privField.style.display = currentUser.role === 'admin' ? 'flex' : 'none';
}

function closeNewTaskModal() {
  document.getElementById('modalNewTask').style.display = 'none';
  resetForm();
}

function toggleCustomAlert(sel) {
  const field = document.getElementById('field-custom-alert');
  if (field) field.style.display = sel.value === 'custom' ? 'block' : 'none';
}

// =============================================
// ADICIONAR TAREFA
// =============================================
function addTask() {
  const title     = document.getElementById('inp-title').value.trim();
  const date      = document.getElementById('inp-date').value;
  const tratativa = document.getElementById('inp-tratativa').value;

  if (!title) { showToast('⚠️', 'Campo obrigatório', 'Informe o título.', 'warn'); return; }
  if (!date)  { showToast('⚠️', 'Campo obrigatório', 'Informe o prazo fatal.', 'warn'); return; }

  const container = document.getElementById('inp-responsaveis');
  let responsaveis = container
    ? Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => normalizeEmail(cb.value))
    : [];
  responsaveis = sanitizeResponsaveis(responsaveis, true);

  const emailsRaw = document.getElementById('inp-emails').value;
  const emails    = emailsRaw.split(',').map(e => e.trim()).filter(Boolean);
  const privCheck = document.getElementById('inp-privado');
  const visibility = (currentUser.role === 'admin' && privCheck && privCheck.checked) ? 'private' : 'shared';

  const task = {
    title,
    desc:      document.getElementById('inp-desc').value.trim(),
    date,
    tratativa: tratativa || null,
    responsaveis,
    proc:      document.getElementById('inp-proc').value.trim(),
    cat:       document.getElementById('inp-cat').value,
    prio:      selectedPrio,
    alertMin:  (() => {
      const sel = document.getElementById('inp-alert');
      if (sel.value === 'custom') {
        const customDt = document.getElementById('inp-alert-custom').value;
        const taskDt   = document.getElementById('inp-date').value;
        if (customDt && taskDt) {
          const diff = Math.round((new Date(taskDt) - new Date(customDt)) / 60000);
          return diff > 0 ? diff : 0;
        }
        return 0;
      }
      return parseInt(sel.value);
    })(),
    emails,
    visibility,
    ownerEmail: normalizeEmail(currentUser.email),
    done:       false,
    createdBy:  currentUser.name,
    createdAt:  new Date().toISOString(),
    historico:  []
  };

  saveTaskFirebase(task);
  showToast('✅', 'Prazo adicionado', '"' + title + '" cadastrado para ' + fmtDate(date) + '.', 'ok');
  closeNewTaskModal();
}

function resetForm() {
  ['inp-title','inp-desc','inp-proc','inp-tratativa'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const container = document.getElementById('inp-responsaveis');
  if (container) container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  const priv = document.getElementById('inp-privado');
  if (priv) priv.checked = false;
  document.querySelectorAll('.prio-btn').forEach(b => b.className = 'prio-btn');
  const low = document.querySelector('.prio-btn[data-prio="low"]');
  if (low) low.classList.add('active-low');
  selectedPrio = 'low';
}

// =============================================
// EDITAR / ESTENDER PRAZO
// =============================================
function openEditModal(id) {
  const t = tasks.find(x => x.id == id);
  if (!t || !canEditTask(t)) return;
  document.getElementById('edit-id').value        = id;
  document.getElementById('edit-title').value     = t.title;
  document.getElementById('edit-date').value      = t.date;
  document.getElementById('edit-tratativa').value = t.tratativa || '';
  document.getElementById('edit-desc').value      = t.desc || '';
  document.getElementById('edit-justif').value    = '';

  const container = document.getElementById('edit-responsaveis');
  if (container) {
    const lista = getAssignableUsers();
    container.innerHTML = lista.map(u => `
      <label class="team-checkbox">
        <input type="checkbox" value="${normalizeEmail(u.email)}" ${Array.isArray(t.responsaveis) && t.responsaveis.includes(normalizeEmail(u.email)) ? 'checked' : ''}>
        <span class="team-check-name">${u.name}</span>
      </label>
    `).join('');
  }

  const hist = document.getElementById('edit-historico');
  if (t.historico && t.historico.length > 0) {
    hist.innerHTML = t.historico.map(h =>
      '<div class="hist-item"><span class="hist-date">' + h.data + '</span><span class="hist-msg">' + esc(h.justificativa) + '</span><span class="hist-by">por ' + esc(h.por) + '</span></div>'
    ).join('');
  } else {
    hist.innerHTML = '<p style="color:var(--muted);font-size:0.72rem;padding:8px 0">Nenhuma alteração anterior.</p>';
  }

  document.getElementById('modalEditTask').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('modalEditTask').style.display = 'none';
}

function saveEdit() {
  const id        = document.getElementById('edit-id').value;
  const title     = document.getElementById('edit-title').value.trim();
  const date      = document.getElementById('edit-date').value;
  const tratativa = document.getElementById('edit-tratativa').value;
  const desc      = document.getElementById('edit-desc').value.trim();
  const justif    = document.getElementById('edit-justif').value.trim();

  if (!title)  { showToast('⚠️', 'Obrigatório', 'Informe o título.', 'warn'); return; }
  if (!date)   { showToast('⚠️', 'Obrigatório', 'Informe o prazo.', 'warn');  return; }
  if (!justif) { showToast('⚠️', 'Justificativa obrigatória', 'Explique o motivo da alteração.', 'warn'); return; }

  const t = tasks.find(x => x.id == id);
  const historico = [...(t.historico || []), {
    data: fmtDate(new Date().toISOString()),
    prazoAnterior: t.date,
    prazoNovo: date,
    justificativa: justif,
    por: currentUser.name
  }];

  const editContainer = document.getElementById('edit-responsaveis');
  let responsaveis = editContainer
    ? Array.from(editContainer.querySelectorAll('input[type="checkbox"]:checked')).map(cb => normalizeEmail(cb.value))
    : ((tasks.find(x => x.id == id) || {}).responsaveis || []);
  responsaveis = sanitizeResponsaveis(responsaveis, true);

  updateTaskFirebase(id, { title, date, tratativa: tratativa || null, desc, historico, responsaveis });
  showToast('✅', 'Prazo atualizado', 'Alteração salva com sucesso.', 'ok');
  closeEditModal();
}

// =============================================
// TRANSFERIR RESPONSÁVEL
// =============================================
function openTransferModal(id) {
  const t = tasks.find(x => x.id == id);
  if (!t || !canEditTask(t)) return;
  document.getElementById('transfer-id').value = id;
  const sel = document.getElementById('transfer-resp');
  sel.innerHTML = '';
  getAssignableUsers().forEach(u => {
    const opt = document.createElement('option');
    opt.value = normalizeEmail(u.email);
    opt.textContent = u.name;
    if (normalizeEmail(t.ownerEmail) === normalizeEmail(u.email)) opt.selected = true;
    sel.appendChild(opt);
  });
  document.getElementById('modalTransfer').style.display = 'flex';
}

function closeTransferModal() {
  document.getElementById('modalTransfer').style.display = 'none';
}

function saveTransfer() {
  const id    = document.getElementById('transfer-id').value;
  const email = normalizeEmail(document.getElementById('transfer-resp').value);
  if (isAndrea(email) && !isAndrea(currentUser?.email)) {
    showToast('🚫', 'Sem permissão', 'Somente a Dra. Andrea pode atribuir tarefa para ela mesma.', 'warn');
    return;
  }
  updateTaskFirebase(id, { ownerEmail: email, responsaveis: [email] });
  showToast('✅', 'Transferido', 'Demanda transferida para ' + getUserFullName(email) + '.', 'ok');
  closeTransferModal();
}

// =============================================
// AÇÕES NOS CARDS
// =============================================
function toggleDone(id) {
  const t = tasks.find(x => x.id == id);
  if (!t || !canEditTask(t)) return;
  updateTaskFirebase(id, { done: !t.done });
}

function deleteTask(id) {
  const t = tasks.find(x => x.id == id);
  if (!t) return;
  if (currentUser.role !== 'admin' && normalizeEmail(t.ownerEmail) !== normalizeEmail(currentUser.email)) {
    showToast('🚫', 'Sem permissão', 'Apenas o criador ou ADM pode excluir.', 'warn');
    return;
  }
  if (!confirm('Excluir este prazo permanentemente?')) return;
  deleteTaskFirebase(id);
}

// =============================================
// FILTROS (LISTA)
// =============================================
function setFilter(btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  render();
}

function setPrioFilter(btn) {
  document.querySelectorAll('.prio-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentPrioFilter = btn.dataset.prio;
  render();
}

function selectPrio(btn) {
  document.querySelectorAll('.prio-btn').forEach(b => b.className = 'prio-btn');
  selectedPrio = btn.dataset.prio;
  btn.classList.add('active-' + selectedPrio);
}

// =============================================
// RENDER LISTA
// =============================================
function render() {
  const list = document.getElementById('taskList');
  if (!list || !currentUser) return;
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();

  let filtered = tasks.filter(t => canViewTask(t));
  if (currentFilter === 'active')  filtered = filtered.filter(t => !t.done);
  if (currentFilter === 'overdue') filtered = filtered.filter(t => !t.done && new Date(t.date) < new Date());
  if (currentFilter === 'done')    filtered = filtered.filter(t => t.done);
  if (currentPrioFilter !== 'all') filtered = filtered.filter(t => t.prio === currentPrioFilter);

  // Filtro de responsável (só ADM vê o select)
  const respSel = document.getElementById('filter-resp');
  const respVal = respSel ? normalizeEmail(respSel.value) : 'all';
  if (respVal && respVal !== 'all') {
    filtered = filtered.filter(t =>
      normalizeEmail(t.ownerEmail) === respVal ||
      (Array.isArray(t.responsaveis) && t.responsaveis.includes(respVal))
    );
  }

  if (search) {
    filtered = filtered.filter(t =>
      t.title.toLowerCase().includes(search) ||
      (t.proc && t.proc.toLowerCase().includes(search)) ||
      (t.desc && t.desc.toLowerCase().includes(search))
    );
  }

  filtered.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return new Date(a.date) - new Date(b.date);
  });

  list.innerHTML = filtered.length === 0
    ? '<div class="empty-state"><div class="icon">⚖</div><p>Nenhum prazo encontrado.</p></div>'
    : filtered.map(renderCard).join('');

  updateStats();
}

function renderCard(t) {
  const status    = getStatus(t);
  const tl        = timeLeft(t);
  const canEdit   = canEditTask(t);
  const canDelete = currentUser.role === 'admin' || normalizeEmail(t.ownerEmail) === normalizeEmail(currentUser.email);
  const respNames = Array.isArray(t.responsaveis) ? t.responsaveis.map(e => getUserName(e)).join(', ') : '';
  const catLabel  = { email:'E-mail','prazo-marca':'Prazo Marcas',reuniao:'Reunião',outro:'Outro' }[t.cat] || t.cat;
  const histBadge = t.historico && t.historico.length > 0
    ? '<span class="badge badge-hist" title="' + t.historico.length + ' alteração(ões)">↺ ' + t.historico.length + '</span>' : '';
  const tratBadge = t.tratativa
    ? '<span class="badge badge-tratativa">📋 ' + fmtDateShort(t.tratativa) + '</span>' : '';

  return '<div class="task-card prio-' + t.prio + (status === 'overdue' ? ' overdue' : '') + (t.done ? ' done' : '') + '" onclick="openDetail(\'' + t.id + '\')">' +
    '<div class="task-info">' +
      '<div class="task-header">' +
        '<span class="task-title">' + esc(t.title) + '</span>' +
        statusBadge(status) +
        (t.visibility === 'private' ? '<span class="badge badge-private">🔒 Privado</span>' : '') +
        histBadge + tratBadge +
      '</div>' +
      (t.desc ? '<div class="task-desc">' + esc(t.desc) + '</div>' : '') +
      '<div class="task-meta">' +
        '<span>📁 ' + catLabel + '</span>' +
        '<span>⚠️ Prazo fatal: ' + fmtDate(t.date) + '</span>' +
        (t.tratativa ? '<span class="highlight">📋 Tratativa: ' + fmtDate(t.tratativa) + '</span>' : '') +
        (tl ? '<span class="highlight">→ ' + tl + '</span>' : '') +
        (t.proc ? '<span>📎 ' + esc(t.proc) + '</span>' : '') +
        (respNames ? '<span>👥 ' + esc(respNames) + '</span>' : '') +
        '<span>✍ ' + esc(t.createdBy || '') + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="task-actions">' +
      (canEdit ? '<button class="icon-btn done-btn" title="' + (t.done ? 'Reabrir' : 'Concluir') + '" onclick="event.stopPropagation();toggleDone(\'' + t.id + '\')">' + (t.done ? '↩' : '✓') + '</button>' +
        '<button class="icon-btn edit-btn" title="Editar / Estender prazo" onclick="event.stopPropagation();openEditModal(\'' + t.id + '\')">✎</button>' +
        '<button class="icon-btn transfer-btn" title="Transferir responsável" onclick="event.stopPropagation();openTransferModal(\'' + t.id + '\')">⇄</button>' : '') +
      (canDelete ? '<button class="icon-btn del-btn" title="Excluir" onclick="event.stopPropagation();deleteTask(\'' + t.id + '\')">✕</button>' : '') +
    '</div></div>';
}

// =============================================
// KANBAN SEMANAL
// =============================================
function renderKanban() {
  const area = document.getElementById('kanbanArea');
  if (!area || !currentUser) return;

  // Lê textos configuráveis do HTML
  const cfg = document.getElementById('kanban-config');
  const KT = {
    backlogTitle : cfg ? cfg.dataset.backlogTitle  : '📥 Backlog',
    backlogEmpty : cfg ? cfg.dataset.backlogEmpty  : 'Sem tarefas pendentes',
    colEmpty     : cfg ? cfg.dataset.colEmpty      : 'Arraste aqui',
    weekCurrent  : cfg ? cfg.dataset.weekCurrent   : 'Semana atual',
    dayNames     : cfg ? [0,1,2,3,4].map(i => cfg.dataset['day'+i]) : ['Segunda','Terça','Quarta','Quinta','Sexta'],
  };

  const days    = getWeekDays(kanbanWeekOffset);
  const weekStr = fmtWeekRange(days);
  const now     = new Date();

  const visibleTasks  = tasks.filter(t => canViewTask(t) && !t.done);
  const backlogTasks  = visibleTasks.filter(t => !t.tratativa);
  const tasksInWeek   = [[], [], [], [], []];

  visibleTasks.filter(t => t.tratativa).forEach(t => {
    const td  = new Date(t.tratativa);
    const idx = days.findIndex(d => isSameDay(d, td));
    if (idx >= 0) tasksInWeek[idx].push(t);
  });

  let html = '<div class="kanban-header">' +
    '<button class="kanban-nav-btn" onclick="kanbanWeek(-1)">‹</button>' +
    '<div class="kanban-week-label">' +
      '<span class="kanban-week-range">' + weekStr + '</span>' +
      (kanbanWeekOffset === 0 ? '<span class="kanban-current-badge">' + KT.weekCurrent + '</span>' : '') +
      (kanbanWeekOffset !== 0 ? '<button class="kanban-today-btn" onclick="kanbanWeek(0)">' + KT.weekCurrent + '</button>' : '') +
    '</div>' +
    '<button class="kanban-nav-btn" onclick="kanbanWeek(1)">›</button>' +
  '</div>' +
  '<div class="kanban-board">';

  // Coluna Backlog
  html += '<div class="kanban-col kanban-backlog" ' +
    'ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ' +
    'ondragleave="this.classList.remove(\'drag-over\')" ' +
    'ondrop="onDropColumn(event,null)">' +
    '<div class="kanban-col-header">' +
      '<span class="kanban-col-title">' + KT.backlogTitle + '</span>' +
      '<span class="kanban-col-count">' + backlogTasks.length + '</span>' +
    '</div>' +
    '<div class="kanban-col-body">' +
      backlogTasks.map(t => renderKanbanCard(t, now)).join('') +
      (backlogTasks.length === 0 ? '<div class="kanban-empty">' + KT.backlogEmpty + '</div>' : '') +
    '</div></div>';

  days.forEach((d, i) => {
    const isToday  = isSameDay(d, now);
    const isPast   = d < startOfDay(now) && !isToday;
    const dayTasks = tasksInWeek[i];
    const overdueCount = dayTasks.filter(() => isPast).length;

    html += '<div class="kanban-col' + (isToday ? ' kanban-today' : '') + (isPast ? ' kanban-past' : '') + '" ' +
      'ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ' +
      'ondragleave="this.classList.remove(\'drag-over\')" ' +
      'ondrop="onDropColumn(event,\'' + d.toISOString().slice(0,10) + '\')">' +
      '<div class="kanban-col-header">' +
        '<div>' +
          '<div class="kanban-col-dayname">' + KT.dayNames[i] + '</div>' +
          '<div class="kanban-col-date' + (isToday ? ' kanban-col-date-today' : '') + '">' +
            d.getDate().toString().padStart(2,'0') + '/' + (d.getMonth()+1).toString().padStart(2,'0') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          (overdueCount > 0 ? '<span class="kanban-col-overdue-badge" title="Tratativas não realizadas">!</span>' : '') +
          '<span class="kanban-col-count">' + dayTasks.length + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="kanban-col-body">' +
        dayTasks.map(t => renderKanbanCard(t, now)).join('') +
        (dayTasks.length === 0 ? '<div class="kanban-empty">' + KT.colEmpty + '</div>' : '') +
      '</div></div>';
  });

  html += '</div>'; // fecha kanban-board
  area.innerHTML = html;
}

function renderKanbanCard(t, now) {
  const deadline  = new Date(t.date);
  const daysLeft  = Math.ceil((deadline - now) / 86400000);
  const isOverdue = deadline < now;
  const prioColor = { low:'var(--ok)', medium:'var(--warn)', high:'var(--danger)' }[t.prio] || 'var(--muted)';
  const respNames = Array.isArray(t.responsaveis) ? t.responsaveis.map(e => getUserName(e)).join(', ') : '';

  let dlClass = '';
  if (isOverdue) dlClass = 'kcard-deadline-overdue';
  else if (daysLeft <= 1) dlClass = 'kcard-deadline-soon';
  else if (daysLeft <= 3) dlClass = 'kcard-deadline-warn';

  return '<div class="kanban-card kprio-' + t.prio + (isOverdue ? ' kcard-overdue' : '') + '" ' +
    'draggable="true" ' +
    'ondragstart="onDragStart(event,\'' + t.id + '\')" ' +
    'ondragend="onDragEnd(event)" ' +
    'onclick="openDetail(\'' + t.id + '\')">' +
    '<div class="kcard-prio-bar" style="background:' + prioColor + '"></div>' +
    '<div class="kcard-body">' +
      '<div class="kcard-title">' + esc(t.title) + '</div>' +
      (t.proc ? '<div class="kcard-proc">📎 ' + esc(t.proc) + '</div>' : '') +
      '<div class="kcard-footer">' +
        '<span class="kcard-deadline ' + dlClass + '">⚠️ ' + fmtDateShort(t.date) + '</span>' +
        (respNames ? '<span class="kcard-resp">👤 ' + esc(respNames) + '</span>' : '') +
      '</div>' +
    '</div></div>';
}

function kanbanWeek(val) {
  if (val === 0) kanbanWeekOffset = 0;
  else kanbanWeekOffset += val;
  renderKanban();
}

// =============================================
// DRAG & DROP KANBAN
// =============================================
function onDragStart(event, taskId) {
  draggedTaskId = taskId;
  event.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { if (event.target) event.target.style.opacity = '0.4'; }, 0);
}

function onDragEnd(event) {
  if (event.target) event.target.style.opacity = '';
  document.querySelectorAll('.kanban-col').forEach(col => col.classList.remove('drag-over'));
}

function onDropColumn(event, dateStr) {
  event.preventDefault();
  document.querySelectorAll('.kanban-col').forEach(col => col.classList.remove('drag-over'));
  if (!draggedTaskId) return;

  const t = tasks.find(x => x.id == draggedTaskId);
  if (!t || !canEditTask(t)) {
    showToast('🚫', 'Sem permissão', 'Você não pode mover esta tarefa.', 'warn');
    draggedTaskId = null;
    return;
  }

  const tratativa = dateStr ? dateStr + 'T12:00' : null;
  updateTaskFirebase(draggedTaskId, { tratativa });
  draggedTaskId = null;

  const msg = dateStr ? 'Tratativa agendada para ' + fmtDateShort(tratativa) : 'Tarefa movida para Backlog';
  showToast('📋', 'Tratativa atualizada', msg, 'ok');
}

// =============================================
// STATS
// =============================================
function updateStats() {
  const now  = new Date();
  const mine = tasks.filter(t => canViewTask(t) && !t.done);
  const over  = mine.filter(t => new Date(t.date) < now).length;
  const today = mine.filter(t => { const d = new Date(t.date) - now; return d >= 0 && d < 86400000; }).length;
  const total = mine.length;
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el('stat-overdue', over); el('stat-today', today); el('stat-total', total);
  const banner = document.getElementById('alertBanner');
  if (banner) {
    if (over > 0) {
      document.getElementById('alertText').textContent = over + ' prazo' + (over > 1 ? 's' : '') + ' em atraso!';
      banner.classList.add('show');
    } else banner.classList.remove('show');
  }
}

// =============================================
// ALERTAS
// =============================================
function checkAlerts() {
  const now = new Date();
  tasks.filter(t => canViewTask(t)).forEach(t => {
    if (t.done) return;
    const deadline   = new Date(t.date);
    const alertKey   = t.id + '-alert';
    const overdueKey = t.id + '-overdue';
    if (t.alertMin > 0 && !notifiedKeys.has(alertKey)) {
      const alertTime = new Date(deadline - t.alertMin * 60000);
      if (now >= alertTime && now < deadline) {
        const mins = Math.round((deadline - now) / 60000);
        const msg = mins >= 60 ? Math.round(mins / 60) + 'h restantes' : mins + 'min restantes';
        showToast('🔔', 'Prazo se aproximando', t.title + ' — ' + msg, 'warn');
        notifiedKeys.add(alertKey); saveNotified(); sendEmailAlert(t, msg);
      }
    }
    if (!notifiedKeys.has(overdueKey) && now > deadline) {
      showToast('🚨', 'Prazo vencido!', t.title + ' — venceu em ' + fmtDate(t.date), 'danger');
      notifiedKeys.add(overdueKey); saveNotified(); sendEmailOverdue(t);
    }
  });
}

function saveNotified() {
  localStorage.setItem('angelico-notified', JSON.stringify([...notifiedKeys]));
}

// =============================================
// EMAILJS
// =============================================
function loadEmailJS() {
  if (window.emailjs) return Promise.resolve();
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
    s.onload = () => { emailjs.init(EMAILJS_CONFIG.publicKey); resolve(); };
    document.head.appendChild(s);
  });
}

async function sendEmailAlert(task, timeMsg) {
  if (!task.emails || task.emails.length === 0) return;
  await loadEmailJS();
  for (const email of task.emails) {
    try {
      await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
        to_email: email, to_name: getUserFullName(email),
        subject: '⏰ Prazo se aproximando: ' + task.title,
        task_name: task.title, task_date: fmtDate(task.date),
        task_proc: task.proc || '—',
        task_resp: Array.isArray(task.responsaveis) ? task.responsaveis.map(getUserFullName).join(', ') : '—',
        time_msg: timeMsg,
        message: 'O prazo "' + task.title + '" vence em ' + fmtDate(task.date) + ' (' + timeMsg + ').'
      });
    } catch (e) { console.warn('E-mail erro:', e); }
  }
}

async function sendEmailOverdue(task) {
  if (!task.emails || task.emails.length === 0) return;
  await loadEmailJS();
  for (const email of task.emails) {
    try {
      await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
        to_email: email, to_name: getUserFullName(email),
        subject: '🚨 PRAZO VENCIDO: ' + task.title,
        task_name: task.title, task_date: fmtDate(task.date),
        task_proc: task.proc || '—',
        task_resp: Array.isArray(task.responsaveis) ? task.responsaveis.map(getUserFullName).join(', ') : '—',
        time_msg: 'PRAZO VENCIDO',
        message: 'ATENÇÃO: O prazo "' + task.title + '" venceu em ' + fmtDate(task.date) + ' e não foi concluído!'
      });
    } catch (e) { console.warn('E-mail erro:', e); }
  }
}

// =============================================
// UTILITÁRIOS
// =============================================
function getStatus(task) {
  if (task.done) return 'done';
  const diff = new Date(task.date) - new Date();
  if (diff < 0) return 'overdue';
  if (diff < 86400000)  return 'today';
  if (diff < 259200000) return 'soon';
  return 'ok';
}

function statusBadge(status) {
  const map = {
    overdue:['badge-overdue','⚑ Atrasado'], today:['badge-today','◉ Hoje'],
    soon:['badge-soon','◎ Em breve'], ok:['badge-ok','○ No prazo'], done:['badge-done','✓ Concluído']
  };
  const [cls, lbl] = map[status];
  return '<span class="badge ' + cls + '">' + lbl + '</span>';
}

function fmtDate(d) {
  return new Date(d).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function fmtDateShort(d) {
  return new Date(d).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
}

function timeLeft(task) {
  if (task.done) return '';
  const diff = new Date(task.date) - new Date();
  if (diff < 0) {
    const abs = Math.abs(diff), h = Math.floor(abs/3600000), m = Math.floor((abs%3600000)/60000);
    return h > 48 ? Math.floor(h/24) + 'd atrás' : h > 0 ? h + 'h ' + m + 'm atrás' : m + 'm atrás';
  }
  const h = Math.floor(diff/3600000), m = Math.floor((diff%3600000)/60000);
  return h > 48 ? 'em ' + Math.floor(h/24) + 'd' : h > 0 ? 'em ' + h + 'h ' + m + 'm' : 'em ' + m + 'm';
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setDefaultDate() {
  const el = document.getElementById('inp-date');
  if (!el) return;
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  el.value = d.toISOString().slice(0, 16);
}

function initClock() {
  const el = document.getElementById('clock');
  const update = () => { if (el) el.textContent = new Date().toLocaleTimeString('pt-BR'); };
  update();
  setInterval(update, 1000);
}

// =============================================
// POPUP DE DETALHE DA TAREFA
// =============================================
function openDetail(id) {
  const t = tasks.find(x => x.id == id);
  if (!t) return;

  const status  = getStatus(t);
  const tl      = timeLeft(t);
  const canEdit = canEditTask(t);
  const canDel  = currentUser.role === 'admin' || normalizeEmail(t.ownerEmail) === normalizeEmail(currentUser.email);

  const catLabel  = { email:'E-mail','prazo-marca':'Prazo Marcas',reuniao:'Reunião',outro:'Outro' }[t.cat] || t.cat;
  const prioLabel = { low:'Baixa', medium:'Média', high:'Alta' }[t.prio] || t.prio;
  const prioColor = { low:'var(--ok)', medium:'var(--warn)', high:'var(--danger)' }[t.prio];
  const respNames = Array.isArray(t.responsaveis) ? t.responsaveis.map(e => getUserFullName(e)).join(', ') : (t.responsaveis || '—');

  document.getElementById('detail-title').textContent = t.title;
  document.getElementById('detail-status-badge').outerHTML =
    '<span id="detail-status-badge">' + statusBadge(status) + (t.visibility === 'private' ? '<span class="badge badge-private">🔒 Privado</span>' : '') + '</span>';
  document.getElementById('detail-date').textContent      = fmtDate(t.date);
  document.getElementById('detail-tratativa').textContent = t.tratativa ? fmtDate(t.tratativa) : '—';

  const tlColor = status === 'overdue' ? 'var(--danger)' : status === 'today' ? 'var(--warn)' : 'var(--ok)';
  document.getElementById('detail-timeleft').innerHTML = tl ? '<span style="color:' + tlColor + '">' + tl + '</span>' : '—';
  document.getElementById('detail-cat').textContent  = catLabel;
  document.getElementById('detail-prio').innerHTML   = '<span style="color:' + prioColor + ';font-weight:700">' + prioLabel + '</span>';
  document.getElementById('detail-proc').textContent = t.proc || '—';
  document.getElementById('detail-resp').textContent = respNames;
  document.getElementById('detail-created-by').textContent = t.createdBy || '—';
  document.getElementById('detail-created-at').textContent = t.createdAt ? fmtDate(t.createdAt) : '—';
  document.getElementById('detail-prio-bar').style.background = prioColor;

  const descSection = document.getElementById('detail-desc-section');
  const descEl      = document.getElementById('detail-desc');
  if (t.desc) { descEl.textContent = t.desc; descSection.style.display = 'block'; }
  else descSection.style.display = 'none';

  const hist = document.getElementById('detail-historico');
  if (t.historico && t.historico.length > 0) {
    hist.innerHTML = t.historico.map(h =>
      '<div class="hist-item"><span class="hist-date">' + h.data + '</span><span class="hist-msg">' + esc(h.justificativa) + '</span><span class="hist-by">por ' + esc(h.por) + '</span>' +
      (h.prazoAnterior ? '<div style="font-size:0.65rem;color:var(--muted);margin-top:3px">Prazo: ' + fmtDate(h.prazoAnterior) + ' → ' + fmtDate(h.prazoNovo) + '</div>' : '') +
      '</div>'
    ).join('');
  } else {
    hist.innerHTML = '<p style="color:var(--muted);font-size:0.72rem;padding:8px 0">Nenhuma alteração registrada.</p>';
  }

  const actions = document.getElementById('detail-actions');
  actions.innerHTML = '';
  if (canEdit) {
    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn-detail-action';
    btnEdit.innerHTML = '✎ Editar / Estender Prazo';
    btnEdit.onclick = () => { closeDetail(); openEditModal(id); };
    actions.appendChild(btnEdit);

    const btnTransfer = document.createElement('button');
    btnTransfer.className = 'btn-detail-action btn-detail-secondary';
    btnTransfer.innerHTML = '⇄ Transferir Responsável';
    btnTransfer.onclick = () => { closeDetail(); openTransferModal(id); };
    actions.appendChild(btnTransfer);

    const btnDone = document.createElement('button');
    btnDone.className = 'btn-detail-action btn-detail-secondary';
    btnDone.innerHTML = t.done ? '↩ Reabrir' : '✓ Marcar Concluído';
    btnDone.onclick = () => { toggleDone(id); closeDetail(); };
    actions.appendChild(btnDone);
  }
  if (canDel) {
    const btnDel = document.createElement('button');
    btnDel.className = 'btn-detail-action btn-detail-danger';
    btnDel.innerHTML = '✕ Excluir';
    btnDel.onclick = () => { closeDetail(); deleteTask(id); };
    actions.appendChild(btnDel);
  }

  document.getElementById('detailOverlay').style.display = 'flex';
}

function closeDetail() {
  document.getElementById('detailOverlay').style.display = 'none';
}

function showToast(icon, title, msg, type) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast toast-' + (type || 'info');
  t.innerHTML = '<div class="toast-icon">' + icon + '</div><div><div class="toast-title">' + title + '</div><div class="toast-msg">' + msg + '</div></div>';
  c.appendChild(t);
  setTimeout(() => { t.style.animation = 'toastOut 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, 5000);
}

setInterval(checkAlerts, 60000);
