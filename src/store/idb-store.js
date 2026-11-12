// Guest storage in IndexedDB via the `idb` package. Stage C adds a Firestore
// backend and chooses between them by auth state behind the same API.
import { openDB } from 'idb';

const DB_NAME = 'chesshub';
const DB_VERSION = 1;

let dbp = null;
function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('games')) d.createObjectStore('games', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      },
    });
  }
  return dbp;
}

function newId() {
  return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export async function saveGame(game) {
  const now = Date.now();
  const record = { ...game };
  if (!record.id) record.id = newId();
  if (!record.createdAt) record.createdAt = now;
  record.updatedAt = now;
  await (await db()).put('games', record);
  return record.id;
}

export async function listGames() {
  const all = await (await db()).getAll('games');
  return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function deleteGame(id) {
  await (await db()).delete('games', id);
}

/** Remove all guest data (used on sign-out when the user declines a local copy). */
export async function clearAll() {
  const d = await db();
  await d.clear('games');
  await d.clear('kv');
}

export async function getProgress() {
  return (await (await db()).get('kv', 'progress')) || {};
}
export async function saveProgress(progress) {
  await (await db()).put('kv', progress, 'progress');
}

export async function getSettings() {
  return (await (await db()).get('kv', 'settings')) || {};
}
export async function saveSettings(settings) {
  await (await db()).put('kv', settings, 'settings');
}
