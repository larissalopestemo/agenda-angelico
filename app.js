/* =============================================
   ANGÉLICO ADVOGADOS — AGENDA DE PRAZOS
   app.js — v3
   ============================================= */

// =============================================
// CONFIGURAÇÃO DO FIREBASE
// =============================================
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDMLC3yCK9K4zmI5LNLgevN7OTpDqm2hkY",
  authDomain:        "angelico-advogados.firebaseapp.com",
  databaseURL:       "https://angelico-advogados-default-rtdb.firebaseio.com",
  projectId:         "angelico-advogados",
  storageBucket:     "angelico-advogados.firebasestorage.app",
  messagingSenderId: "423621967651",
  appId:             "1:423621967651:web:3698c1739d5ad3f07fd696"
};

// =============================================
// CONFIGURAÇÃO DO EMAILJS
// =============================================
const EMAILJS_CONFIG = {
  serviceId:  "service_xlbb117",
  templateId: "template_mg7d4l6",
  publicKey:  "LhW6qGS5NdC7-quQY"
};

// =============================================
// USUÁRIOS AUTORIZADOS
// Para adicionar novos usuários, inclua um novo objeto
// nesta lista seguindo o mesmo formato abaixo.
// A senha padrão é angelico@13 — pode ser alterada individualmente.
// IMPORTANTE: role 'admin' tem acesso total; role 'user' acesso restrito.
// =============================================
const AUTHORIZED_USERS = [
  { name: 'Andrea Angélico', email: 'andrea@anlema.com.br', password: 'angelico@13', role: 'admin' },
  { name: 'Debora Pelogi',  email: 'debora.pelogi@anlema.com.br', password: 'angelico@13', role: 'user'  },
  { name: 'Larissa Lopes',  email: 'paralegal@anlema.com.br',     password: 'angelico@13', role: 'user'  },
  { name: 'Thiago Prado',   email: 'thiago.prado@anlema.com.br',  password: 'angelico@13', role: 'user'  },
  { name: 'Beatriz Amaro',  email: 'beatriz.amaro@anlema.com.br', password: 'angelico@13', role: 'user'  },
];

// =============================================
// ESTADO
// =============================================
let db               = null;
let tasks            = [];
let currentUser      = null;
let selectedPrio     = 'low';
let currentFilter    = 'all';
let currentPrioFilter = 'all';
let notifiedKeys     = new Set();

// =============================================
// HELPERS
// =============================================
function isAdmin(email) {
  const u = AUTHORIZED_USERS.find(x => x.email === (email||'').toLowerCase().trim());
  return u && u.role === 'admin';
}

function canViewTask(task) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (task.ownerEmail === currentUser.email) return true;
  if (Array.isArray(task.responsaveis) && task.responsaveis.includes(currentUser.email)) return true;
  return false;
}

function canEditTask(task) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (task.ownerEmail === currentUser.email) return true;
  if (Array.isArray(task.responsaveis) && task.responsaveis.includes(currentUser.email)) return true;
  return false;
}

function getUserName(email) {
  const u = AUTHORIZED_USERS.find(x => x.email === email);
  return u ? u.name : email;
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
    showApp();
  }

  populateTeamSelect();
});

function populateTeamSelect() {
  const container = document.getElementById('inp-responsaveis');
  if (!container) return;

  // Andrea (admin) não aparece na lista de responsáveis
  const lista = AUTHORIZED_USERS.filter(u => u.role !== 'admin');

  container.innerHTML = lista.map(u => `
    <label class="team-checkbox">
      <input type="checkbox" value="${u.email}">
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
    if (currentUser) listenTasks();
  } catch(e) {
    console.warn('Firebase erro:', e);
    loadLocalTasks();
  }
}

function listenTasks() {
  if (!db) { loadLocalTasks(); return; }
  db.ref('tasks').on('value', snapshot => {
    tasks = [];
    snapshot.forEach(child => tasks.push({ id: child.key, ...child.val() }));
    tasks.sort((a,b) => new Date(a.date) - new Date(b.date));
    render();
    checkAlerts();
  });
}

function saveTaskFirebase(task) {
  if (!db) { saveLocalTask(task); return; }
  const ref = db.ref('tasks').push();
  task.id = ref.key;
  ref.set(task);
}

function updateTaskFirebase(id, data) {
  if (!db) { updateLocalTask(id, data); return; }
  db.ref('tasks/'+id).update(data);
}

function deleteTaskFirebase(id) {
  if (!db) { deleteLocalTask(id); return; }
  db.ref('tasks/'+id).remove();
}

// =============================================
// FALLBACK LOCAL
// =============================================
function loadLocalTasks() {
  tasks = JSON.parse(localStorage.getItem('angelico-tasks')||'[]');
  notifiedKeys = new Set(JSON.parse(localStorage.getItem('angelico-notified')||'[]'));
  render(); checkAlerts();
}
function saveLocalTask(task) {
  task.id = Date.now().toString();
  tasks.unshift(task);
  localStorage.setItem('angelico-tasks', JSON.stringify(tasks));
  render();
}
function updateLocalTask(id, data) {
  const t = tasks.find(x => x.id==id);
  if (t) Object.assign(t, data);
  localStorage.setItem('angelico-tasks', JSON.stringify(tasks));
  render();
}
function deleteLocalTask(id) {
  tasks = tasks.filter(x => x.id!=id);
  localStorage.setItem('angelico-tasks', JSON.stringify(tasks));
  render();
}

// =============================================
// LOGIN / LOGOUT
// =============================================
function login() {
  const email    = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const user     = AUTHORIZED_USERS.find(u => u.email === email);

  if (!user) { showLoginError('E-mail não autorizado. Solicite acesso ao administrador.'); return; }
  if (user.password !== password) { showLoginError('Senha incorreta.'); return; }

  currentUser = { name: user.name, email: user.email, role: user.role };
  sessionStorage.setItem('angelico-user', JSON.stringify(currentUser));
  document.getElementById('login-error').style.display = 'none';
  showApp();
  if (db) listenTasks(); else loadLocalTasks();
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function logout() {
  currentUser = null;
  sessionStorage.removeItem('angelico-user');
  document.getElementById('screenLogin').style.display = 'flex';
  document.getElementById('screenApp').style.display   = 'none';
  document.getElementById('login-email').value    = '';
  document.getElementById('login-password').value = '';
}

function showApp() {
  document.getElementById('screenLogin').style.display = 'none';
  document.getElementById('screenApp').style.display   = 'block';
  document.getElementById('userInfo').style.display    = 'flex';
  updateSidebarProfile();
  const el = document.getElementById('inp-emails');
  if (el) el.value = currentUser.email;
  const privField = document.getElementById('field-privado');
  if (privField) privField.style.display = currentUser.role === 'admin' ? 'flex' : 'none';
}

// =============================================
// PERFIL SIDEBAR
// =============================================
function updateSidebarProfile() {
  const nameEl   = document.getElementById('sidebar-username');
  const roleEl   = document.getElementById('sidebar-role');
  const avatarEl = document.getElementById('sidebar-avatar');
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
    // Salva no Firebase para sincronizar entre dispositivos
    if (db) {
      db.ref('avatars/' + currentUser.email.replace(/[.#$\[\]]/g,'_')).set(data);
    } else {
      localStorage.setItem('avatar-' + currentUser.email, data);
    }
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
    db.ref('avatars/' + currentUser.email.replace(/[.#$\[\]]/g,'_')).once('value', snap => {
      if (snap.val()) avatarEl.src = snap.val();
    });
  } else {
    const saved = localStorage.getItem('avatar-' + currentUser.email);
    if (saved) avatarEl.src = saved;
  }
}

// =============================================
// MODAL NOVA TAREFA
// =============================================
function openNewTaskModal() {
  document.getElementById('modalNewTask').style.display = 'flex';
  setDefaultDate();
  // Pre-seleciona o próprio usuário como responsável
  const container = document.getElementById('inp-responsaveis');
  if (container) {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = cb.value === currentUser.email;
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
  const title = document.getElementById('inp-title').value.trim();
  const date  = document.getElementById('inp-date').value;
  if (!title) { showToast('⚠️','Campo obrigatório','Informe o título.','warn'); return; }
  if (!date)  { showToast('⚠️','Campo obrigatório','Informe o prazo.','warn');  return; }

  const container = document.getElementById('inp-responsaveis');
  let responsaveis = container
    ? Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value)
    : [];
  if (!responsaveis.includes(currentUser.email)) responsaveis.unshift(currentUser.email);

  const emailsRaw = document.getElementById('inp-emails').value;
  const emails = emailsRaw.split(',').map(e => e.trim()).filter(Boolean);

  const privCheck = document.getElementById('inp-privado');
  const visibility = (currentUser.role === 'admin' && privCheck && privCheck.checked) ? 'private' : 'shared';

  const task = {
    title,
    desc:        document.getElementById('inp-desc').value.trim(),
    date,
    responsaveis,
    proc:        document.getElementById('inp-proc').value.trim(),
    cat:         document.getElementById('inp-cat').value,
    prio:        selectedPrio,
    alertMin:    (() => {
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
    ownerEmail:  currentUser.email,
    done:        false,
    createdBy:   currentUser.name,
    createdAt:   new Date().toISOString(),
    historico:   []
  };

  saveTaskFirebase(task);
  showToast('✅','Prazo adicionado',`"${title}" cadastrado para ${fmtDate(date)}.`,'ok');
  closeNewTaskModal();
}

function resetForm() {
  ['inp-title','inp-desc','inp-proc'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const container = document.getElementById('inp-responsaveis');
  if (container) container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  const priv = document.getElementById('inp-privado');
  if (priv) priv.checked = false;
  document.querySelectorAll('.prio-btn').forEach(b => b.className='prio-btn');
  const low = document.querySelector('.prio-btn[data-prio="low"]');
  if (low) low.classList.add('active-low');
  selectedPrio = 'low';
}

// =============================================
// EDITAR / ESTENDER PRAZO
// =============================================
function openEditModal(id) {
  const t = tasks.find(x => x.id==id);
  if (!t || !canEditTask(t)) return;

  document.getElementById('edit-id').value    = id;
  document.getElementById('edit-title').value = t.title;
  document.getElementById('edit-date').value  = t.date;
  document.getElementById('edit-desc').value  = t.desc || '';
  document.getElementById('edit-justif').value = '';

  // Preenche checkboxes de responsáveis
  const container = document.getElementById('edit-responsaveis');
  if (container) {
    const lista = AUTHORIZED_USERS.filter(u => u.role !== 'admin');

    container.innerHTML = lista.map(u => `
      <label class="team-checkbox">
        <input type="checkbox" value="${u.email}" ${Array.isArray(t.responsaveis) && t.responsaveis.includes(u.email) ? 'checked' : ''}>
        <span class="team-check-name">${u.name}</span>
      </label>
    `).join('');
  }

  const hist = document.getElementById('edit-historico');
  if (t.historico && t.historico.length > 0) {
    hist.innerHTML = t.historico.map(h =>
      `<div class="hist-item">
        <span class="hist-date">${h.data}</span>
        <span class="hist-msg">${esc(h.justificativa)}</span>
        <span class="hist-by">por ${esc(h.por)}</span>
      </div>`
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
  const id    = document.getElementById('edit-id').value;
  const title = document.getElementById('edit-title').value.trim();
  const date  = document.getElementById('edit-date').value;
  const desc  = document.getElementById('edit-desc').value.trim();
  const justif= document.getElementById('edit-justif').value.trim();

  if (!title)  { showToast('⚠️','Obrigatório','Informe o título.','warn'); return; }
  if (!date)   { showToast('⚠️','Obrigatório','Informe o prazo.','warn');  return; }
  if (!justif) { showToast('⚠️','Justificativa obrigatória','Explique o motivo da alteração.','warn'); return; }

  const t = tasks.find(x => x.id==id);
  const historico = [...(t.historico||[]), {
    data:          fmtDate(new Date().toISOString()),
    prazoAnterior: t.date,
    prazoNovo:     date,
    justificativa: justif,
    por:           currentUser.name
  }];

  const editContainer = document.getElementById('edit-responsaveis');
  const responsaveis = editContainer
    ? Array.from(editContainer.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value)
    : (tasks.find(x=>x.id==id)||{}).responsaveis || [];

  updateTaskFirebase(id, { title, date, desc, historico, responsaveis });
  showToast('✅','Prazo atualizado','Alteração salva com sucesso.','ok');
  closeEditModal();
}

// =============================================
// TRANSFERIR RESPONSÁVEL
// =============================================
function openTransferModal(id) {
  const t = tasks.find(x => x.id==id);
  if (!t || !canEditTask(t)) return;
  document.getElementById('transfer-id').value = id;

  const sel = document.getElementById('transfer-resp');
  sel.innerHTML = '';
  AUTHORIZED_USERS.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.email;
    opt.textContent = u.name;
    if (t.ownerEmail === u.email) opt.selected = true;
    sel.appendChild(opt);
  });

  document.getElementById('modalTransfer').style.display = 'flex';
}

function closeTransferModal() {
  document.getElementById('modalTransfer').style.display = 'none';
}

function saveTransfer() {
  const id    = document.getElementById('transfer-id').value;
  const email = document.getElementById('transfer-resp').value;
  updateTaskFirebase(id, { ownerEmail: email, responsaveis: [email] });
  showToast('✅','Transferido',`Demanda transferida para ${getUserName(email)}.`,'ok');
  closeTransferModal();
}

// =============================================
// AÇÕES NOS CARDS
// =============================================
function toggleDone(id) {
  const t = tasks.find(x => x.id==id);
  if (!t || !canEditTask(t)) return;
  updateTaskFirebase(id, { done: !t.done });
}

function deleteTask(id) {
  const t = tasks.find(x => x.id==id);
  if (!t) return;
  if (currentUser.role !== 'admin' && t.ownerEmail !== currentUser.email) {
    showToast('🚫','Sem permissão','Apenas o criador ou ADM pode excluir.','warn');
    return;
  }
  if (!confirm('Excluir este prazo permanentemente?')) return;
  deleteTaskFirebase(id);
}

// =============================================
// FILTROS
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
  document.querySelectorAll('.prio-btn').forEach(b => b.className='prio-btn');
  selectedPrio = btn.dataset.prio;
  btn.classList.add('active-'+selectedPrio);
}

// =============================================
// RENDER
// =============================================
function render() {
  const list = document.getElementById('taskList');
  if (!list || !currentUser) return;
  const search = (document.getElementById('searchInput')?.value||'').toLowerCase();

  let filtered = tasks.filter(t => canViewTask(t));

  if (currentFilter === 'active')  filtered = filtered.filter(t => !t.done);
  if (currentFilter === 'overdue') filtered = filtered.filter(t => !t.done && new Date(t.date) < new Date());
  if (currentFilter === 'done')    filtered = filtered.filter(t => t.done);
  if (currentPrioFilter !== 'all') filtered = filtered.filter(t => t.prio === currentPrioFilter);

  if (search) {
    filtered = filtered.filter(t =>
      t.title.toLowerCase().includes(search) ||
      (t.proc && t.proc.toLowerCase().includes(search)) ||
      (t.desc && t.desc.toLowerCase().includes(search))
    );
  }

  filtered.sort((a,b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return new Date(a.date) - new Date(b.date);
  });

  list.innerHTML = filtered.length === 0
    ? `<div class="empty-state"><div class="icon">⚖</div><p>Nenhum prazo encontrado.</p></div>`
    : filtered.map(renderCard).join('');

  updateStats();
}

function renderCard(t) {
  const status    = getStatus(t);
  const tl        = timeLeft(t);
  const canEdit   = canEditTask(t);
  const canDelete = currentUser.role === 'admin' || t.ownerEmail === currentUser.email;

  const respNames = Array.isArray(t.responsaveis)
    ? t.responsaveis.map(e => getUserName(e)).join(', ')
    : '';

  const catLabel = {
    email:'E-mail','prazo-marca':'Prazo Marcas',reuniao:'Reunião',outro:'Outro'
  }[t.cat] || t.cat;

  const histBadge = t.historico && t.historico.length > 0
    ? `<span class="badge badge-hist" title="${t.historico.length} alteração(ões)">↺ ${t.historico.length}</span>` : '';

  return `
    <div class="task-card prio-${t.prio} ${status==='overdue'?'overdue':''} ${t.done?'done':''}" onclick="openDetail('${t.id}')">
      <div class="task-info">
        <div class="task-header">
          <span class="task-title">${esc(t.title)}</span>
          ${statusBadge(status)}
          ${t.visibility==='private'?'<span class="badge badge-private">🔒 Privado</span>':''}
          ${histBadge}
        </div>
        ${t.desc?`<div class="task-desc">${esc(t.desc)}</div>`:''}
        <div class="task-meta">
          <span>📁 ${catLabel}</span>
          <span>📅 ${fmtDate(t.date)}</span>
          ${tl?`<span class="highlight">→ ${tl}</span>`:''}
          ${t.proc?`<span>📎 ${esc(t.proc)}</span>`:''}
          ${respNames?`<span>👥 ${esc(respNames)}</span>`:''}
          <span>✍ ${esc(t.createdBy||'')}</span>
        </div>
      </div>
      <div class="task-actions">
        ${canEdit?`
          <button class="icon-btn done-btn" title="${t.done?'Reabrir':'Concluir'}" onclick="event.stopPropagation();toggleDone('${t.id}')">${t.done?'↩':'✓'}</button>
          <button class="icon-btn edit-btn" title="Editar / Estender prazo" onclick="event.stopPropagation();openEditModal('${t.id}')">✎</button>
          <button class="icon-btn transfer-btn" title="Transferir responsável" onclick="event.stopPropagation();openTransferModal('${t.id}')">⇄</button>
        `:''}
        ${canDelete?`<button class="icon-btn del-btn" title="Excluir" onclick="event.stopPropagation();deleteTask('${t.id}')">✕</button>`:''}
      </div>
    </div>`;
}

// =============================================
// STATS
// =============================================
function updateStats() {
  const now   = new Date();
  const mine  = tasks.filter(t => canViewTask(t) && !t.done);
  const over  = mine.filter(t => new Date(t.date) < now).length;
  const today = mine.filter(t => { const d=new Date(t.date)-now; return d>=0&&d<86400000; }).length;
  const total = mine.length;
  const el = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  el('stat-overdue',over); el('stat-today',today); el('stat-total',total);

  const banner = document.getElementById('alertBanner');
  if (banner) {
    if (over > 0) {
      document.getElementById('alertText').textContent = `${over} prazo${over>1?'s':''} em atraso!`;
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
    const deadline = new Date(t.date);
    const alertKey = t.id+'-alert', overdueKey = t.id+'-overdue';

    if (t.alertMin > 0 && !notifiedKeys.has(alertKey)) {
      const alertTime = new Date(deadline - t.alertMin*60000);
      if (now >= alertTime && now < deadline) {
        const mins = Math.round((deadline-now)/60000);
        const msg = mins>=60?`${Math.round(mins/60)}h restantes`:`${mins}min restantes`;
        showToast('🔔','Prazo se aproximando',`${t.title} — ${msg}`,'warn');
        notifiedKeys.add(alertKey); saveNotified(); sendEmailAlert(t, msg);
      }
    }
    if (!notifiedKeys.has(overdueKey) && now > deadline) {
      showToast('🚨','Prazo vencido!',`${t.title} — venceu em ${fmtDate(t.date)}`,'danger');
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
  if (!task.emails||task.emails.length===0) return;
  await loadEmailJS();
  for (const email of task.emails) {
    try {
      await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
        to_email: email, to_name: getUserName(email),
        subject: `⏰ Prazo se aproximando: ${task.title}`,
        task_name: task.title, task_date: fmtDate(task.date),
        task_proc: task.proc||'—',
        task_resp: Array.isArray(task.responsaveis)?task.responsaveis.map(getUserName).join(', '):'—',
        time_msg: timeMsg,
        message: `O prazo "${task.title}" vence em ${fmtDate(task.date)} (${timeMsg}).`
      });
    } catch(e) { console.warn('E-mail erro:',e); }
  }
}

async function sendEmailOverdue(task) {
  if (!task.emails||task.emails.length===0) return;
  await loadEmailJS();
  for (const email of task.emails) {
    try {
      await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
        to_email: email, to_name: getUserName(email),
        subject: `🚨 PRAZO VENCIDO: ${task.title}`,
        task_name: task.title, task_date: fmtDate(task.date),
        task_proc: task.proc||'—',
        task_resp: Array.isArray(task.responsaveis)?task.responsaveis.map(getUserName).join(', '):'—',
        time_msg: 'PRAZO VENCIDO',
        message: `ATENÇÃO: O prazo "${task.title}" venceu em ${fmtDate(task.date)} e não foi concluído!`
      });
    } catch(e) { console.warn('E-mail erro:',e); }
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
  const [cls,lbl] = map[status];
  return `<span class="badge ${cls}">${lbl}</span>`;
}

function fmtDate(d) {
  return new Date(d).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function timeLeft(task) {
  if (task.done) return '';
  const diff = new Date(task.date) - new Date();
  if (diff < 0) {
    const abs=Math.abs(diff), h=Math.floor(abs/3600000), m=Math.floor((abs%3600000)/60000);
    return h>48?`${Math.floor(h/24)}d atrás`:h>0?`${h}h ${m}m atrás`:`${m}m atrás`;
  }
  const h=Math.floor(diff/3600000), m=Math.floor((diff%3600000)/60000);
  return h>48?`em ${Math.floor(h/24)}d`:h>0?`em ${h}h ${m}m`:`em ${m}m`;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setDefaultDate() {
  const el = document.getElementById('inp-date');
  if (!el) return;
  const d = new Date();
  d.setDate(d.getDate()+1);
  d.setHours(18,0,0,0);
  el.value = d.toISOString().slice(0,16);
}

function initClock() {
  const el = document.getElementById('clock');
  const update = () => { if(el) el.textContent = new Date().toLocaleTimeString('pt-BR'); };
  update();
  setInterval(update, 1000);
}


// =============================================
// PAINEL DE DETALHE DA TAREFA
// =============================================
function openDetail(id) {
  const t = tasks.find(x => x.id == id);
  if (!t) return;

  const status   = getStatus(t);
  const tl       = timeLeft(t);
  const canEdit  = canEditTask(t);
  const canDel   = currentUser.role === 'admin' || t.ownerEmail === currentUser.email;

  const catLabel = {
    email:'E-mail','prazo-marca':'Prazo Marcas',reuniao:'Reunião',outro:'Outro'
  }[t.cat] || t.cat;

  const prioLabel = { low:'Baixa', medium:'Média', high:'Alta' }[t.prio] || t.prio;
  const prioColor = { low:'var(--ok)', medium:'var(--warn)', high:'var(--danger)' }[t.prio];

  const respNames = Array.isArray(t.responsaveis)
    ? t.responsaveis.map(e => getUserName(e)).join(', ')
    : (t.responsaveis || '—');

  // Preenche campos
  document.getElementById('detail-title').textContent        = t.title;
  document.getElementById('detail-status-badge').outerHTML   =
    `<span id="detail-status-badge">${statusBadge(status)}${t.visibility==='private'?'<span class="badge badge-private">🔒 Privado</span>':''}</span>`;
  document.getElementById('detail-date').textContent         = fmtDate(t.date);
  const tlColor = status==='overdue' ? 'var(--danger)' : status==='today' ? 'var(--warn)' : 'var(--ok)';
  document.getElementById('detail-timeleft').innerHTML = tl
    ? `<span style="color:${tlColor}">${tl}</span>`
    : '—';
  document.getElementById('detail-cat').textContent          = catLabel;
  document.getElementById('detail-prio').innerHTML           = `<span style="color:${prioColor};font-weight:700">${prioLabel}</span>`;
  document.getElementById('detail-proc').textContent         = t.proc || '—';
  document.getElementById('detail-resp').textContent         = respNames;
  document.getElementById('detail-created-by').textContent   = t.createdBy || '—';
  document.getElementById('detail-created-at').textContent   = t.createdAt ? fmtDate(t.createdAt) : '—';

  // Barra de prioridade
  document.getElementById('detail-prio-bar').style.background = prioColor;

  // Descrição
  const descSection = document.getElementById('detail-desc-section');
  const descEl      = document.getElementById('detail-desc');
  if (t.desc) {
    descEl.textContent = t.desc;
    descSection.style.display = 'block';
  } else {
    descSection.style.display = 'none';
  }

  // Histórico
  const hist = document.getElementById('detail-historico');
  if (t.historico && t.historico.length > 0) {
    hist.innerHTML = t.historico.map(h => `
      <div class="hist-item">
        <span class="hist-date">${h.data}</span>
        <span class="hist-msg">${esc(h.justificativa)}</span>
        <span class="hist-by">por ${esc(h.por)}</span>
        ${h.prazoAnterior ? `<div style="font-size:0.65rem;color:var(--muted);margin-top:3px">Prazo: ${fmtDate(h.prazoAnterior)} → ${fmtDate(h.prazoNovo)}</div>` : ''}
      </div>`).join('');
  } else {
    hist.innerHTML = '<p style="color:var(--muted);font-size:0.72rem;padding:8px 0">Nenhuma alteração registrada.</p>';
  }

  // Botões de ação
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

  // Abre o popup
  document.getElementById('detailOverlay').style.display = 'flex';
}

function closeDetail() {
  document.getElementById('detailOverlay').style.display = 'none';
}

function showToast(icon, title, msg, type='info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<div class="toast-icon">${icon}</div><div><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div>`;
  c.appendChild(t);
  setTimeout(() => { t.style.animation='toastOut 0.3s ease forwards'; setTimeout(()=>t.remove(),300); }, 5000);
}

setInterval(checkAlerts, 60000);
