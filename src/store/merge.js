// Moving data between guest (IndexedDB) and account (Firestore).
import * as idb from './idb-store.js';
import * as fs from './firestore-store.js';
import { mergeProgress } from '../training/progress.js';

/**
 * On sign-in, copy guest games into the account without duplicating. Each
 * guest game keeps its stable id, so re-running this is idempotent.
 * @returns {Promise<number>} how many games were newly added.
 */
export async function mergeGuestIntoAccount(uid) {
  const guestGames = await idb.listGames();
  let added = 0;
  for (const game of guestGames) {
    try {
      if (await fs.saveIfAbsent(uid, game)) added += 1;
    } catch (err) {
      console.error('merge game failed', game.id, err);
    }
  }
  return added;
}

/**
 * On sign-in, fold this device's guest training progress into the account's
 * (union of solved/seen, higher path level, combined stats). Idempotent.
 */
export async function mergeTrainingProgress(uid) {
  const guest = await idb.getProgress();
  if (!guest || !Object.keys(guest).length) return; // nothing local to merge
  const account = await fs.getProgress(uid);
  await fs.saveProgress(uid, mergeProgress(account, guest));
}

/** On sign-out "keep a copy": copy the account's games + progress down to this device. */
export async function copyAccountToDevice(uid) {
  const games = await fs.listGames(uid);
  for (const game of games) {
    try { await idb.saveGame(game); } catch (err) { console.error('copy game failed', game.id, err); }
  }
  try {
    const progress = await fs.getProgress(uid);
    if (progress && Object.keys(progress).length) await idb.saveProgress(progress);
  } catch (err) { console.error('copy progress failed', err); }
  return games.length;
}

/** On sign-out "don't keep": remove all local guest data. */
export async function clearLocal() {
  await idb.clearAll();
}
