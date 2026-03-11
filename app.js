/* =============================================
   ANGÉLICO ADVOGADOS — AGENDA DE PRAZOS
   app.js
   ============================================= */

// =============================================
// CONFIGURAÇÃO DO FIREBASE
// Substitua estes valores pelos do seu projeto Firebase
// (Veja o README.md para instruções)
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
// Substitua pelos seus dados do EmailJS
// (Veja o README.md para instruções)
// =============================================
const EMAILJS_CONFIG = {
  serviceId:  "service_xlbb117",
  templateId: "template_mg7d4l6",
  publicKey:  "LhW6qGS5NdC7-quQY"
};

// =============================================
// ESTADO DA APLICAÇÃO
// =============================================
let db = null;
let tasks = [];
let currentUser = null;
let selectedPrio = 'low';
let currentFilter = 'all';
let notifiedKeys = new Set();

// =============================================
// INICIALIZAÇÃO
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  initClock();
  setDefaultDate();

  // Verifica se há usuário salvo na sessão
  const saved = sessionStorage.getItem('angelico-user');
  if (saved) {
    currentUser = JSON.parse(saved);
    showApp();
  }
});

function initFirebase() {
  // Carrega o SDK do Firebase dinamicamente
  const scripts = [
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js'
  ];

  let loaded = 0;
  scripts.forEach(src => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => {
      loaded++;
      if (loaded === scripts.length) connectFirebase();
    };
    document.head.appendChild(s);
  });
}

function connectFirebase() {
  try {
    if (FIREBASE_CONFIG.apiKey === "COLE_AQUI_SUA_API_KEY") {
      console.warn("Firebase não configurado — usando modo local.");
      loadLocalTasks();
      return;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    listenTasks();
  } catch (e) {
    console.warn("Erro Firebase, usando modo local:", e);
    loadLocalTasks();
  }
}

// =============================================
// FIREBASE — TAREFAS EM TEMPO REAL
// =============================================
function listenTasks() {
  if (!db) return;
  db.ref('tasks').on('value', snapshot => {
    tasks = [];
    snapshot.forEach(child => {
      tasks.push({ id: child.key, ...child.val() });
    });
    // Ordena por data
    tasks.sort((a, b) => new Date(a.date) - new Date(b.date));
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
  db.ref('tasks/' + id).update(data);
}

function deleteTaskFirebase(id) {
  if (!db) { deleteLocalTask(id); return; }
  db.ref('tasks/' + id).remove();
}

// =============================================
// FALLBACK — MODO LOCAL (sem Firebase)
// =============================================
function loadLocalTasks() {
  tasks = JSON.parse(localStorage.getItem('angelico-tasks') || '[]');
  notifiedKeys = new Set(JSON.parse(localStorage.getItem('angelico-notified') || '[]'));
  render();
  checkAlerts();
}

function saveLocalTask(task) {
  task.id = Date.now().toString();
  tasks.unshift(task);
  localStorage.setItem('angelico-tasks', JSON.stringify(tasks));
  render();
}

function updateLocalTask(id, data) {
  const t = tasks.find(x => x.id == id);
  if (t) Object.assign(t, data);
  localStorage.setItem('angelico-tasks', JSON.stringify(tasks));
  render();
}

function deleteLocalTask(id) {
  tasks = tasks.filter(x => x.id != id);
  localStorage.setItem('angelico-tasks', JSON.stringify(tasks));
  render();
}

// =============================================
// LOGIN
// =============================================
function login() {
  const name  = document.getElementById('login-name').value.trim();
  const email = document.getElementById('login-email').value.trim();
  if (!name)  { showToast('⚠️', 'Campo obrigatório', 'Informe seu nome.', 'warn'); return; }
  if (!email) { showToast('⚠️', 'Campo obrigatório', 'Informe seu e-mail.', 'warn'); return; }
  if (!email.includes('@')) { showToast('⚠️', 'E-mail inválido', 'Informe um e-mail válido.', 'warn'); return; }

  currentUser = { name, email };
  sessionStorage.setItem('angelico-user', JSON.stringify(currentUser));
  showApp();
}

function logout() {
  currentUser = null;
  sessionStorage.removeItem('angelico-user');
  document.getElementById('screenLogin').style.display = 'flex';
  document.getElementById('screenApp').style.display = 'none';
  document.getElementById('userInfo').style.display = 'none';
}

function showApp() {
  document.getElementById('screenLogin').style.display = 'none';
  document.getElementById('screenApp').style.display = 'block';
  document.getElementById('userInfo').style.display = 'flex';
  document.getElementById('userName').textContent = currentUser.name;
  // Pré-preenche o campo de e-mail de notificação
  document.getElementById('inp-emails').value = currentUser.email;
}

// =============================================
// ADICIONAR TAREFA
// =============================================
function addTask() {
  const title = document.getElementById('inp-title').value.trim();
  const date  = document.getElementById('inp-date').value;
  if (!title) { showToast('⚠️', 'Campo obrigatório', 'Informe o título do prazo.', 'warn'); return; }
  if (!date)  { showToast('⚠️', 'Campo obrigatório', 'Informe a data do prazo.', 'warn');  return; }

  const emailsRaw = document.getElementById('inp-emails').value;
  const emails = emailsRaw.split(',').map(e => e.trim()).filter(Boolean);

  const task = {
    title,
    desc:      document.getElementById('inp-desc').value.trim(),
    date,
    resp:      document.getElementById('inp-resp').value.trim(),
    proc:      document.getElementById('inp-proc').value.trim(),
    cat:       document.getElementById('inp-cat').value,
    prio:      selectedPrio,
    alertMin:  parseInt(document.getElementById('inp-alert').value),
    emails,
    done:      false,
    createdBy: currentUser ? currentUser.name : 'Sistema',
    createdAt: new Date().toISOString()
  };

  saveTaskFirebase(task);
  showToast('✅', 'Prazo adicionado', `"${title}" cadastrado para ${fmtDate(date)}.`, 'ok');
  resetForm();
}

function resetForm() {
  document.getElementById('inp-title').value = '';
  document.getElementById('inp-desc').value = '';
  document.getElementById('inp-resp').value = '';
  document.getElementById('inp-proc').value = '';
  setDefaultDate();
}

// =============================================
// TOGGLE CONCLUÍDO / EXCLUIR
// =============================================
function toggleDone(id) {
  const t = tasks.find(x => x.id == id);
  if (!t) return;
  updateTaskFirebase(id, { done: !t.done });
}

function deleteTask(id) {
  if (!confirm('Excluir este prazo?')) return;
  deleteTaskFirebase(id);
}

// =============================================
// FILTRO E BUSCA
// =============================================
function setFilter(btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  render();
}

function selectPrio(btn) {
  document.querySelectorAll('.prio-btn').forEach(b => b.className = 'prio-btn');
  selectedPrio = btn.dataset.prio;
  btn.classList.add('active-' + selectedPrio);
}

// =============================================
// RENDER
// =============================================
function render() {
  const list   = document.getElementById('taskList');
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();

  let filtered = [...tasks];

  // Filtro de status
  if (currentFilter === 'active')  filtered = filtered.filter(t => !t.done);
  if (currentFilter === 'overdue') filtered = filtered.filter(t => !t.done && new Date(t.date) < new Date());
  if (currentFilter === 'done')    filtered = filtered.filter(t => t.done);

  // Busca por texto
  if (search) {
    filtered = filtered.filter(t =>
      t.title.toLowerCase().includes(search) ||
      (t.proc  && t.proc.toLowerCase().includes(search))  ||
      (t.resp  && t.resp.toLowerCase().includes(search))  ||
      (t.desc  && t.desc.toLowerCase().includes(search))
    );
  }

  // Ordenação: atrasados primeiro, depois por data
  filtered.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return new Date(a.date) - new Date(b.date);
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚖</div>
        <p>Nenhum prazo encontrado.</p>
      </div>`;
  } else {
    list.innerHTML = filtered.map(t => renderCard(t)).join('');
  }

  // Atualiza stats
  const active = tasks.filter(t => !t.done);
  const now = new Date();
  document.getElementById('stat-overdue').textContent = active.filter(t => new Date(t.date) < now).length;
  document.getElementById('stat-today').textContent   = active.filter(t => {
    const d = new Date(t.date) - now;
    return d >= 0 && d < 86400000;
  }).length;
  document.getElementById('stat-total').textContent = active.length;

  // Banner de atraso
  const overdueCount = active.filter(t => new Date(t.date) < now).length;
  const banner = document.getElementById('alertBanner');
  if (overdueCount > 0) {
    document.getElementById('alertText').textContent =
      `${overdueCount} prazo${overdueCount > 1 ? 's' : ''} em atraso! Verifique imediatamente.`;
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}

function renderCard(t) {
  const status = getStatus(t);
  const tl = timeLeft(t);
  const catLabel = {
    peticao:'Petição', audiencia:'Audiência', recurso:'Recurso',
    prazo_fatal:'Prazo Fatal', protocolo:'Protocolo',
    reuniao:'Reunião', pagamento:'Pagamento', outro:'Outro'
  }[t.cat] || t.cat;

  return `
    <div class="task-card prio-${t.prio} ${status === 'overdue' ? 'overdue' : ''} ${t.done ? 'done' : ''}">
      <div class="task-info">
        <div class="task-header">
          <span class="task-title">${esc(t.title)}</span>
          ${statusBadge(status)}
        </div>
        ${t.desc ? `<div class="task-desc">${esc(t.desc)}</div>` : ''}
        <div class="task-meta">
          <span>📁 ${catLabel}</span>
          <span>📅 ${fmtDate(t.date)}</span>
          ${tl ? `<span class="highlight">→ ${tl}</span>` : ''}
          ${t.proc ? `<span>⚖ ${esc(t.proc)}</span>` : ''}
          ${t.resp ? `<span>👤 ${esc(t.resp)}</span>` : ''}
          ${t.createdBy ? `<span>✍ ${esc(t.createdBy)}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="icon-btn done-btn" title="${t.done ? 'Reabrir' : 'Concluir'}" onclick="toggleDone('${t.id}')">
          ${t.done ? '↩' : '✓'}
        </button>
        <button class="icon-btn del-btn" title="Excluir" onclick="deleteTask('${t.id}')">✕</button>
      </div>
    </div>
  `;
}

// =============================================
// VERIFICAR ALERTAS E ENVIAR E-MAIL
// =============================================
function checkAlerts() {
  const now = new Date();
  tasks.forEach(t => {
    if (t.done) return;

    const deadline   = new Date(t.date);
    const alertKey   = t.id + '-alert';
    const overdueKey = t.id + '-overdue';

    // Aviso antecipado
    if (t.alertMin > 0 && !notifiedKeys.has(alertKey)) {
      const alertTime = new Date(deadline - t.alertMin * 60000);
      if (now >= alertTime && now < deadline) {
        const mins = Math.round((deadline - now) / 60000);
        const msg  = mins >= 60 ? `${Math.round(mins/60)}h restantes` : `${mins}min restantes`;
        showToast('🔔', `Prazo se aproximando`, `${t.title} — ${msg}`, 'warn');
        notifiedKeys.add(alertKey);
        saveNotified();
        sendEmailAlert(t, msg);
      }
    }

    // Prazo vencido
    if (!notifiedKeys.has(overdueKey) && now > deadline) {
      showToast('🚨', `Prazo vencido!`, `${t.title} — venceu em ${fmtDate(t.date)}`, 'danger');
      notifiedKeys.add(overdueKey);
      saveNotified();
      sendEmailOverdue(t);
    }
  });
}

function saveNotified() {
  localStorage.setItem('angelico-notified', JSON.stringify([...notifiedKeys]));
}

// =============================================
// ENVIO DE E-MAIL VIA EMAILJS
// =============================================
function loadEmailJS() {
  if (window.emailjs) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
    s.onload = () => {
      emailjs.init(EMAILJS_CONFIG.publicKey);
      resolve();
    };
    document.head.appendChild(s);
  });
}

async function sendEmailAlert(task, timeMsg) {
  if (EMAILJS_CONFIG.publicKey === "COLE_AQUI_PUBLIC_KEY") return; // Não configurado
  if (!task.emails || task.emails.length === 0) return;

  await loadEmailJS();

  for (const email of task.emails) {
    try {
      await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
        to_email:  email,
        to_name:   task.resp || 'Equipe',
        subject:   `⏰ Prazo se aproximando: ${task.title}`,
        task_name: task.title,
        task_date: fmtDate(task.date),
        task_proc: task.proc || '—',
        task_resp: task.resp || '—',
        time_msg:  timeMsg,
        message:   `O prazo "${task.title}" vence em ${fmtDate(task.date)} (${timeMsg}).`
      });
    } catch (e) {
      console.warn('Erro ao enviar e-mail:', e);
    }
  }
}

async function sendEmailOverdue(task) {
  if (EMAILJS_CONFIG.publicKey === "COLE_AQUI_PUBLIC_KEY") return;
  if (!task.emails || task.emails.length === 0) return;

  await loadEmailJS();

  for (const email of task.emails) {
    try {
      await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
        to_email:  email,
        to_name:   task.resp || 'Equipe',
        subject:   `🚨 PRAZO VENCIDO: ${task.title}`,
        task_name: task.title,
        task_date: fmtDate(task.date),
        task_proc: task.proc || '—',
        task_resp: task.resp || '—',
        time_msg:  'PRAZO VENCIDO',
        message:   `ATENÇÃO: O prazo "${task.title}" venceu em ${fmtDate(task.date)} e ainda não foi concluído!`
      });
    } catch (e) {
      console.warn('Erro ao enviar e-mail:', e);
    }
  }
}

// =============================================
// UTILITÁRIOS
// =============================================
function getStatus(task) {
  if (task.done) return 'done';
  const diff = new Date(task.date) - new Date();
  if (diff < 0) return 'overdue';
  if (diff < 86400000)  return 'today'; // < 1 dia
  if (diff < 259200000) return 'soon';  // < 3 dias
  return 'ok';
}

function statusBadge(status) {
  const map = {
    overdue: ['badge-overdue', '⚑ Atrasado'],
    today:   ['badge-today',   '◉ Hoje'],
    soon:    ['badge-soon',    '◎ Em breve'],
    ok:      ['badge-ok',      '○ No prazo'],
    done:    ['badge-done',    '✓ Concluído'],
  };
  const [cls, lbl] = map[status];
  return `<span class="badge ${cls}">${lbl}</span>`;
}

function fmtDate(d) {
  return new Date(d).toLocaleString('pt-BR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}

function timeLeft(task) {
  if (task.done) return '';
  const diff = new Date(task.date) - new Date();
  if (diff < 0) {
    const abs = Math.abs(diff);
    const h   = Math.floor(abs / 3600000);
    const m   = Math.floor((abs % 3600000) / 60000);
    return h > 48 ? `${Math.floor(h/24)}d atrás` : h > 0 ? `${h}h ${m}m atrás` : `${m}m atrás`;
  }
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 48 ? `em ${Math.floor(h/24)}d` : h > 0 ? `em ${h}h ${m}m` : `em ${m}m`;
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setDefaultDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  document.getElementById('inp-date').value = d.toISOString().slice(0, 16);
}

function initClock() {
  const el = document.getElementById('clock');
  const update = () => el.textContent = new Date().toLocaleTimeString('pt-BR');
  update();
  setInterval(update, 1000);
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================
function showToast(icon, title, msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div>
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${msg}</div>
    </div>`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, 5000);
}

// Verifica alertas a cada 60 segundos
setInterval(checkAlerts, 60000);
