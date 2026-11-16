import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { makeEvent, upsertEvent } from '../server/hub.js';
import { mapCodexNotification } from '../connectors/codex-notify.mjs';

test('normalizes accepted event states and bounds user supplied text', () => {
  const event = makeEvent({ agent: ' Codex ', session: 't-1', status: 'needs_help', message: 'a'.repeat(600) });
  assert.equal(event.agent, 'Codex');
  assert.equal(event.status, 'needs_help');
  assert.equal(event.message.length, 500);
  assert.ok(event.id);
});

test('rejects missing agent/session and unknown states', () => {
  assert.throws(() => makeEvent({ session: 's', status: 'working' }), /agent/);
  assert.throws(() => makeEvent({ agent: 'Codex', status: 'working' }), /session/);
  assert.throws(() => makeEvent({ agent: 'Codex', session: 's', status: 'sleeping' }), /status/);
});

test('deduplicates a repeated status and replaces the prior status for a session', () => {
  const first = makeEvent({ agent: 'Codex', session: 'abc', status: 'working' });
  const inserted = upsertEvent([], first);
  const duplicate = upsertEvent(inserted.events, makeEvent({ agent: 'Codex', session: 'abc', status: 'working' }));
  assert.equal(duplicate.changed, false);
  const finished = upsertEvent(inserted.events, makeEvent({ agent: 'Codex', session: 'abc', status: 'done' }));
  assert.equal(finished.events.length, 1);
  assert.equal(finished.events[0].status, 'done');
});

test('maps Codex turn-complete notifications into hub events', () => {
  const event = mapCodexNotification({ type: 'agent-turn-complete', 'turn-id': 'turn-7', cwd: 'C:\\Projects\\demo', 'last-assistant-message': 'Listo' });
  assert.equal(event.agent, 'Codex');
  assert.equal(event.session, 'turn-7');
  assert.equal(event.status, 'done');
  assert.equal(event.project, 'demo');
  assert.equal(mapCodexNotification({ type: 'other' }), null);
});

test('local API requires its token, stores events and dismisses one item', async t => {
  const port = 45_000 + Math.floor(Math.random() * 10_000);
  const appData = await mkdtemp(path.join(tmpdir(), 'agente-hub-test-'));
  const child = spawn(process.execPath, [path.resolve('server/index.js')], {
    cwd: process.cwd(),
    env: { ...process.env, APPDATA: appData, PORT: String(port), AGENTE_HUB_TOKEN: 'test-token' },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let startupError = '';
  child.stderr.on('data', chunk => { startupError += chunk.toString(); });
  child.on('error', error => { startupError += error.message; });
  child.on('close', code => { if (code !== 0) startupError += ` child exited ${code}`; });
  t.after(async () => { child.kill(); await rm(appData, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.equal(ready, true, `server should become ready: ${startupError}`);
  const denied = await fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'Codex', session: 's1', status: 'working' }) });
  assert.equal(denied.status, 401);
  const headers = { 'content-type': 'application/json', authorization: 'Bearer test-token' };
  const posted = await fetch(`${base}/api/events`, { method: 'POST', headers, body: JSON.stringify({ agent: 'Codex', session: 's1', status: 'working' }) });
  assert.equal(posted.status, 201);
  const event = (await posted.json()).event;
  assert.equal((await (await fetch(`${base}/api/state`)).json()).events[0].agent, 'Codex');
  const dismissed = await fetch(`${base}/api/events/dismiss`, { method: 'POST', headers, body: JSON.stringify({ id: event.id }) });
  assert.equal((await dismissed.json()).events.length, 0);
});
