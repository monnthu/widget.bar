import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const base = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'AgenteHub')
  : path.join(os.homedir(), '.config', 'agente-hub');
const file = path.join(base, 'data.json');
const defaults = {
  events: [],
  settings: { theme: 'dark', side: 'right', visibleWidgets: ['working', 'done', 'needs_help'], notificationSeconds: 8, devinOrgId: '', devinApiKey: '' }
};

export function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      events: Array.isArray(saved.events) ? saved.events.slice(0, 200) : [],
      settings: { ...defaults.settings, ...(saved.settings || {}) }
    };
  } catch { return structuredClone(defaults); }
}

export function save(state) {
  fs.mkdirSync(base, { recursive: true });
  const safe = {
    ...state,
    settings: { ...state.settings, devinApiKey: state.settings.devinApiKey || '' }
  };
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(safe, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function dataPath() { return file; }
