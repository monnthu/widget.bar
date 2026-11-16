import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function mapCodexNotification(notification) {
  if (!notification || notification.type !== 'agent-turn-complete') return null;
  const turnId = String(notification['turn-id'] || '').trim();
  const threadId = String(notification['thread-id'] || '').trim();
  const cwd = String(notification.cwd || '');
  return {
    agent: 'Codex',
    session: turnId || threadId || `codex-${Date.now()}`,
    status: 'done',
    message: String(notification['last-assistant-message'] || 'Turn terminado').slice(0, 500),
    project: cwd ? path.basename(cwd) : '',
    source: 'codex-notify'
  };
}

async function main() {
  try {
    const notification = JSON.parse(process.argv[2] || '{}');
    const event = mapCodexNotification(notification);
    if (!event) return;
    const base = process.env.AGENTE_HUB_URL || 'http://127.0.0.1:43821';
    const infoResponse = await fetch(`${base}/api/info`, { signal: AbortSignal.timeout(2500) });
    if (!infoResponse.ok) return;
    const { token } = await infoResponse.json();
    await fetch(`${base}/api/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2500)
    });
  } catch {
    // Notifications are best effort and must not interrupt the Codex turn.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
