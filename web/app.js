const byId = id => document.getElementById(id);
const labels = { working: 'Trabajando', done: 'Terminado', needs_help: 'Necesita ayuda', failed: 'Con error' };
const demoMode = new URLSearchParams(location.search).get('demo') === '1';
let state = { events: [], settings: {} };
let token = '';
let filter = 'all';
let previous = new Map();
let nativePosition = '';

const iconFor = name => {
  const value = (name || '?').toLowerCase();
  const key = value.includes('cursor') ? 'cursor' : value.includes('devin') ? 'devin' : value.includes('grok') ? 'grok' : '';
  return { key, text: value.includes('codex') ? 'C' : value.includes('cursor') ? '⌁' : value.includes('devin') ? 'D' : value.includes('grok') ? '𝕏' : (name || '?').slice(0, 1).toUpperCase() };
};
const ago = iso => {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 10) return 'ahora';
  if (seconds < 60) return `hace ${seconds}s`;
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  return `hace ${Math.floor(seconds / 3600)} h`;
};

async function api(path, body) {
  if (demoMode) {
    if (path === '/api/events/clear') state.events = [];
    if (path === '/api/events/dismiss') state.events = state.events.filter(item => item.id !== body.id);
    if (path === '/api/settings') state.settings = { ...state.settings, ...body };
    return state;
  }
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json', authorization: `Bearer ${token}` } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}
function render() {
  const events = state.events || [];
  const active = events.filter(e => e.status === 'working').length;
  const needs = events.filter(e => e.status === 'needs_help').length;
  const done = events.filter(e => e.status === 'done').length;
  byId('summary').innerHTML = `<div class="summary-box"><strong>${active}</strong><span>Trabajando</span></div><div class="summary-box help"><strong>${needs}</strong><span>Necesita ayuda</span></div><div class="summary-box done"><strong>${done}</strong><span>Terminaron</span></div>`;
  byId('event-total').textContent = events.length;
  byId('rail-count').textContent = needs ? `!${needs}` : String(active);
  byId('dock').classList.toggle('left', state.settings.side === 'left');
  document.body.classList.toggle('light', state.settings.theme === 'light');
  const side = state.settings.side || 'right';
  if (nativePosition !== side) {
    nativePosition = side;
    window.__TAURI__?.core?.invoke('set_dock_position', { side }).catch(() => {});
  }
  const widgets = state.settings.visibleWidgets || ['working', 'done', 'needs_help', 'failed'];
  const visible = events.filter(e => widgets.includes(e.status) && (filter === 'all' || filter === e.status));
  byId('event-list').innerHTML = visible.length ? visible.map(event => {
    const icon = iconFor(event.agent);
    return `<article class="event-card" data-id="${escapeHtml(event.id)}"><div class="event-top"><div class="agent-icon ${icon.key}">${escapeHtml(icon.text)}</div><div class="agent-meta"><div class="agent-name">${escapeHtml(event.agent)}</div><div class="project-name">${escapeHtml(event.project || event.source)} · ${escapeHtml(event.session)}</div></div><span class="status-pill ${event.status}">${labels[event.status] || event.status}</span></div>${event.message ? `<p class="event-message">${escapeHtml(event.message)}</p>` : ''}<div class="event-bottom"><span>${ago(event.updatedAt)}</span><button class="dismiss" data-dismiss="${escapeHtml(event.id)}">Descartar</button></div></article>`;
  }).join('') : `<div class="empty"><div><div class="empty-icon">${events.length ? '◌' : '⌁'}</div><b>${events.length ? 'Sin actividad en este filtro' : 'Tu hub está listo'}</b><span>${events.length ? 'Prueba otro estado para ver tus sesiones.' : 'Cuando un agente envíe un evento, aparecerá aquí.'}</span></div></div>`;
  byId('filters').querySelectorAll('.filter').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(event) {
  const item = document.createElement('div');
  item.className = 'toast';
  item.innerHTML = `<b>${escapeHtml(event.agent)} · <span class="toast-status">${labels[event.status]}</span></b><span>${escapeHtml(event.message || event.project || 'La sesión cambió de estado.')}</span>`;
  byId('toast-stack').append(item);
  const duration = Number(state.settings.notificationSeconds ?? 8);
  if (duration > 0) setTimeout(() => item.remove(), duration * 1000);
  byId('dock').classList.add('open');
  setTimeout(() => byId('dock').classList.remove('open'), 3800);
}
function accept(data) {
  const old = previous;
  const next = new Map((data.events || []).map(event => [`${event.agent}/${event.session}`, event]));
  if (old.size) for (const [key, event] of next) {
    const before = old.get(key);
    if (before && before.status !== event.status && ['done', 'needs_help', 'failed'].includes(event.status)) toast(event);
  }
  previous = next;
  state = data;
  render();
}
function openSettings() {
  const form = byId('settings-form');
  const s = state.settings;
  form.elements.theme.value = s.theme || 'dark';
  form.elements.side.value = s.side || 'right';
  form.elements.notificationSeconds.value = s.notificationSeconds ?? 8;
  form.querySelectorAll('[name="widget"]').forEach(input => { input.checked = (s.visibleWidgets || []).includes(input.value); });
  form.elements.devinOrgId.value = s.devinOrgId || '';
  form.elements.devinApiKey.value = '';
  byId('key-note').textContent = s.hasDevinKey ? 'Ya hay una clave guardada. Déjala vacía para conservarla.' : 'La clave se guarda localmente en este equipo.';
  byId('settings-backdrop').hidden = false;
}

byId('rail').addEventListener('click', () => byId('dock').classList.toggle('open'));
byId('collapse').addEventListener('click', () => byId('dock').classList.remove('open'));
byId('settings-open').addEventListener('click', openSettings);
byId('settings-close').addEventListener('click', () => byId('settings-backdrop').hidden = true);
byId('settings-cancel').addEventListener('click', () => byId('settings-backdrop').hidden = true);
byId('settings-backdrop').addEventListener('click', event => { if (event.target === byId('settings-backdrop')) byId('settings-backdrop').hidden = true; });
byId('filters').addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) { filter = button.dataset.filter; render(); } });
byId('event-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-dismiss]');
  if (!button) return;
  try { accept(await api('/api/events/dismiss', { id: button.dataset.dismiss })); } catch (error) { console.error(error); }
});
byId('clear-events').addEventListener('click', async () => {
  try { await api('/api/events/clear', {}); accept(await api('/api/state')); } catch (error) { alert(error.message); }
});
byId('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {
    theme: form.elements.theme.value,
    side: form.elements.side.value,
    notificationSeconds: Number(form.elements.notificationSeconds.value),
    visibleWidgets: [...form.querySelectorAll('[name="widget"]:checked')].map(input => input.value),
    devinOrgId: form.elements.devinOrgId.value.trim()
  };
  if (form.elements.devinApiKey.value) body.devinApiKey = form.elements.devinApiKey.value;
  try { accept(await api('/api/settings', body)); byId('settings-backdrop').hidden = true; } catch (error) { byId('key-note').textContent = error.message; }
});

if (demoMode) {
  const agoIso = seconds => new Date(Date.now() - seconds * 1000).toISOString();
  accept({
    settings: { theme: 'dark', side: 'right', visibleWidgets: ['working', 'done', 'needs_help', 'failed'], notificationSeconds: 8 },
    events: [
      { id: 'demo-codex', agent: 'Codex', session: 'turn-demo-01', status: 'done', message: 'Preparé el resumen del proyecto y dejé los cambios listos para revisar.', project: 'widget.bar · DEMO', source: 'demo', updatedAt: agoIso(18) },
      { id: 'demo-cursor', agent: 'Cursor', session: 'cursor-demo-02', status: 'working', message: 'Ajustando el panel y probando el diseño adaptable.', project: 'Agente Hub · DEMO', source: 'demo', updatedAt: agoIso(72) },
      { id: 'demo-devin', agent: 'Devin', session: 'devin-demo-03', status: 'needs_help', message: 'Necesito que confirmes los permisos del repositorio para continuar.', project: 'widget.bar · DEMO', source: 'demo', updatedAt: agoIso(130) }
    ]
  });
  byId('live-label').textContent = 'vista demo · no guarda eventos';
  byId('connection-label').textContent = 'Demo local · cambios temporales';
  setInterval(render, 10_000);
} else {
  try {
    const info = await api('/api/info'); token = info.token;
    accept(await api('/api/state'));
    const stream = new EventSource('/api/stream');
    stream.onmessage = event => { try { accept(JSON.parse(event.data)); } catch (error) { console.error(error); } };
    stream.onerror = () => { byId('live-label').textContent = 'reconectando…'; };
    stream.onopen = () => { byId('live-label').textContent = 'en tu equipo'; };
    setInterval(render, 10_000);
  } catch (error) {
    byId('event-list').innerHTML = `<div class="empty"><div><b>No se pudo conectar</b><span>${escapeHtml(error.message)}</span></div></div>`;
  }
}
