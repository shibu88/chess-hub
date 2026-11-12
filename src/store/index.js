// Unified storage API. One set of functions for guests and signed-in users;
// the active backend is chosen by auth state. Callers never change.
//   - Guest (activeUid === null): IndexedDB.
//   - Signed-in + verified: Firestore under users/{uid}/...
import * as idb from './idb-store.js';
import * as fs from './firestore-store.js';

let activeUid = null;
let liveGames = null;        // latest snapshot cache when subscribed
let liveProgress = null;     // latest training-progress snapshot when subscribed
let unsubscribe = null;
let unsubscribeProgress = null;

/** Switch the active backend. Pass a uid to use Firestore, or null for guest. */
export function setActiveUser(uid) {
  if (uid === activeUid) return;
  stopLiveSync();
  activeUid = uid || null;
  if (activeUid) startLiveSync();
}

function startLiveSync() {
  liveGames = null;
  liveProgress = null;
  unsubscribe = fs.subscribeGames(activeUid, (games) => {
    liveGames = games;
    window.dispatchEvent(new CustomEvent('chesshub:games-changed', { detail: { games } }));
  });
  unsubscribeProgress = fs.subscribeProgress(activeUid, (progress) => {
    liveProgress = progress || {};
    window.dispatchEvent(new CustomEvent('chesshub:progress-changed', { detail: { progress: liveProgress } }));
  });
}
function stopLiveSync() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (unsubscribeProgress) { unsubscribeProgress(); unsubscribeProgress = null; }
  liveGames = null;
  liveProgress = null;
}

export function isSignedIn() { return activeUid !== null; }

export async function saveGame(game) {
  return activeUid ? fs.saveGame(activeUid, game) : idb.saveGame(game);
}
export async function listGames() {
  if (activeUid) return liveGames ?? fs.listGames(activeUid);
  return idb.listGames();
}
export async function deleteGame(id) {
  return activeUid ? fs.deleteGame(activeUid, id) : idb.deleteGame(id);
}
export async function getProgress() {
  if (activeUid) return liveProgress ?? fs.getProgress(activeUid);
  return idb.getProgress();
}
export async function saveProgress(p) {
  return activeUid ? fs.saveProgress(activeUid, p) : idb.saveProgress(p);
}
export async function getSettings() {
  return activeUid ? fs.getSettings(activeUid) : idb.getSettings();
}
export async function saveSettings(s) {
  return activeUid ? fs.saveSettings(activeUid, s) : idb.saveSettings(s);
}
