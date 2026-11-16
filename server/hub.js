import { randomUUID } from 'node:crypto';

const validStatuses = new Set(['working', 'done', 'needs_help', 'failed']);

export function makeEvent(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('El evento debe ser un objeto JSON.');
  const agent = String(input.agent || '').trim().slice(0, 80);
  const session = String(input.session || '').trim().slice(0, 160);
  const status = String(input.status || 'working');
  if (!agent) throw new Error('Falta el campo agent.');
  if (!session) throw new Error('Falta el campo session.');
  if (!validStatuses.has(status)) throw new Error('status debe ser working, done, needs_help o failed.');
  return {
    id: randomUUID(), agent, session, status,
    message: String(input.message || '').slice(0, 500),
    project: String(input.project || '').slice(0, 120),
    source: String(input.source || 'webhook').slice(0, 60),
    updatedAt: now.toISOString()
  };
}

export function upsertEvent(events, event) {
  const duplicate = events.find(e => e.agent === event.agent && e.session === event.session && e.status === event.status && e.message === event.message);
  if (duplicate && Date.now() - Date.parse(duplicate.updatedAt) < 60_000) return { events, changed: false, event: duplicate };
  const next = [event, ...events.filter(e => !(e.agent === event.agent && e.session === event.session))].slice(0, 200);
  return { events: next, changed: true, event };
}
