import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { load, save, dataPath } from './store.js';
import { makeEvent, upsertEvent } from './hub.js';

const host = '127.0.0.1';
const port = Number(process.env.PORT || 43821);
const token = process.env.AGENTE_HUB_TOKEN || randomBytes(24).toString('hex');
const state = load();
const clients = new Set();
const running = new Map();

function authorized(req) {
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(supplied), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function snapshot() {
  const { devinApiKey, ...settings } = state.settings;
  return { events: state.events, settings: { ...settings, hasDevinKey: Boolean(devinApiKey) } };
}
function publish() {
  const data = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const client of clients) client.write(data);
}
function addEvent(input) {
  const event = makeEvent(input);
  const result = upsertEvent(state.events, event);
  if (result.changed) {
    state.events = result.events;
    save(state);
    publish();
  }
  return result.event;
}
async function readJson(req, max = 64_000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > max) throw new Error('El cuerpo excede el límite permitido.');
  }
  return JSON.parse(body || '{}');
}
function safePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}`).pathname);
  if (pathname === '/') return '/index.html';
  if (pathname.includes('..') || pathname.includes('\\')) return null;
  return pathname;
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, snapshot());
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/info') return send(res, 200, { token, port, dataFile: dataPath() });
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (!authorized(req)) return send(res, 401, { error: 'Clave local inválida.' });
      const input = await readJson(req);
      if (url.pathname === '/api/events') return send(res, 201, { event: addEvent(input) });
      if (url.pathname === '/api/events/dismiss') {
        const id = String(input.id || '');
        const before = state.events.length;
        state.events = state.events.filter(event => event.id !== id);
        if (state.events.length !== before) { save(state); publish(); }
        return send(res, 200, snapshot());
      }
      if (url.pathname === '/api/settings') {
        const allowed = ['theme', 'side', 'visibleWidgets', 'notificationSeconds', 'devinOrgId', 'devinApiKey'];
        for (const key of allowed) if (key in input) state.settings[key] = input[key];
        state.settings.theme = state.settings.theme === 'light' ? 'light' : 'dark';
        state.settings.side = state.settings.side === 'left' ? 'left' : 'right';
        state.settings.notificationSeconds = Math.max(0, Math.min(60, Number(state.settings.notificationSeconds) || 0));
        state.settings.visibleWidgets = Array.isArray(state.settings.visibleWidgets) ? state.settings.visibleWidgets.filter(x => ['working', 'done', 'needs_help', 'failed'].includes(x)) : [];
        save(state); publish(); return send(res, 200, snapshot());
      }
      if (url.pathname === '/api/events/clear') { state.events = []; save(state); publish(); return send(res, 200, snapshot()); }
      if (url.pathname === '/api/cursor/run') return runCursor(input, res);
      return send(res, 404, { error: 'Ruta desconocida.' });
    }
    if (req.method === 'GET') {
      const file = safePath(req.url);
      if (!file) return send(res, 400, 'Ruta inválida.', 'text/plain; charset=utf-8');
      const fs = await import('node:fs/promises');
      try {
        const content = await fs.readFile(new URL(`../web${file}`, import.meta.url));
        return send(res, 200, content, mime[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream');
      } catch { return send(res, 404, 'No encontrado.', 'text/plain; charset=utf-8'); }
    }
    return send(res, 404, { error: 'Ruta desconocida.' });
  } catch (error) {
    return send(res, 400, { error: error.message || 'Solicitud inválida.' });
  }
});

function runCursor(input, res) {
  const cwd = typeof input.cwd === 'string' ? input.cwd : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!cwd || !prompt) return send(res, 400, { error: 'Se requieren cwd y prompt.' });
  if (running.has(input.session || 'cursor-active')) return send(res, 409, { error: 'Esa sesión ya está activa.' });
  const session = String(input.session || `cursor-${Date.now()}`).slice(0, 160);
  addEvent({ agent: input.agent || 'Cursor', project: input.project || cwd.split(/[\\/]/).filter(Boolean).at(-1), session, status: 'working', source: 'cursor-cli', message: 'Iniciando agente' });
  const proc = spawn('cursor-agent', ['-p', '--output-format', 'stream-json', prompt], { cwd, windowsHide: true, shell: process.platform === 'win32' });
  running.set(session, proc);
  let stderr = '';
  proc.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-1000); });
  proc.stdout.on('data', data => {
    for (const line of data.toString().split(/\r?\n/)) {
      if (!line) continue;
      try {
        const item = JSON.parse(line);
        if (item.type === 'result') addEvent({ agent: input.agent || 'Cursor', project: input.project || '', session, status: item.subtype === 'success' ? 'done' : 'failed', source: 'cursor-cli', message: item.subtype === 'success' ? 'Trabajo terminado' : 'El agente terminó con error' });
      } catch { /* Stream chunks may split a JSON line; terminal status is also inferred from exit. */ }
    }
  });
  proc.on('error', error => {
    running.delete(session);
    addEvent({ agent: input.agent || 'Cursor', project: input.project || '', session, status: 'failed', source: 'cursor-cli', message: error.message });
  });
  proc.on('close', code => {
    running.delete(session);
    addEvent({ agent: input.agent || 'Cursor', project: input.project || '', session, status: code === 0 ? 'done' : 'failed', source: 'cursor-cli', message: code === 0 ? 'Trabajo terminado' : (stderr.trim() || `Cursor CLI terminó con código ${code}`).slice(0, 500) });
  });
  return send(res, 202, { session, status: 'working' });
}

async function pollDevin() {
  const { devinApiKey, devinOrgId } = state.settings;
  if (!devinApiKey || !devinOrgId) return;
  try {
    const response = await fetch(`https://api.devin.ai/v3/organizations/${encodeURIComponent(devinOrgId)}/sessions`, { headers: { authorization: `Bearer ${devinApiKey}` }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`API Devin respondió ${response.status}`);
    const data = await response.json();
    const sessions = Array.isArray(data) ? data : data.sessions || data.items || [];
    for (const session of sessions.slice(0, 40)) {
      const raw = String(session.status || session.state || '').toLowerCase();
      const status = /running|working|active|in_progress/.test(raw) ? 'working' : /help|approval|input/.test(raw) ? 'needs_help' : /fail|error/.test(raw) ? 'failed' : /complete|finished|done/.test(raw) ? 'done' : null;
      if (!status || !(session.session_id || session.id)) continue;
      addEvent({ agent: 'Devin', session: String(session.session_id || session.id), status, message: String(session.status || session.state), project: String(session.title || session.name || 'Devin'), source: 'devin-api' });
    }
  } catch (error) {
    console.error(`No se pudo consultar Devin: ${error.message}`);
  }
}

server.listen(port, host, () => {
  console.log(`Agente Hub está listo: http://${host}:${port}`);
  console.log(`Clave local: ${token}`);
  console.log(`Datos locales: ${dataPath()}`);
  pollDevin(); setInterval(pollDevin, 30_000).unref();
});
