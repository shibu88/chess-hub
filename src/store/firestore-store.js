// Firestore backend for signed-in (verified) users. Paths follow CLAUDE.md:
//   users/{uid}/games/{gameId}, users/{uid}/training/progress, users/{uid}/settings/app
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, orderBy,
} from 'firebase/firestore';
import { db } from '../auth/auth.js';

const gamesCol = (uid) => collection(db, 'users', uid, 'games');
const gameDoc = (uid, id) => doc(db, 'users', uid, 'games', id);
const progressDoc = (uid) => doc(db, 'users', uid, 'training', 'progress');
const settingsDoc = (uid) => doc(db, 'users', uid, 'settings', 'app');

function newId() {
  return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export async function saveGame(uid, game) {
  const now = Date.now();
  const record = { ...game };
  if (!record.id) record.id = newId();
  if (!record.createdAt) record.createdAt = now;
  record.updatedAt = now;
  await setDoc(gameDoc(uid, record.id), record);
  return record.id;
}

export async function listGames(uid) {
  const snap = await getDocs(query(gamesCol(uid), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => d.data());
}

export async function deleteGame(uid, id) {
  await deleteDoc(gameDoc(uid, id));
}

export async function getProgress(uid) {
  const s = await getDoc(progressDoc(uid));
  return s.exists() ? s.data() : {};
}
export async function saveProgress(uid, progress) {
  await setDoc(progressDoc(uid), progress);
}

export async function getSettings(uid) {
  const s = await getDoc(settingsDoc(uid));
  return s.exists() ? s.data() : {};
}
export async function saveSettings(uid, settings) {
  await setDoc(settingsDoc(uid), settings);
}

/** Create a game only if that id isn't already in the account (used by merge). */
export async function saveIfAbsent(uid, game) {
  const ref = gameDoc(uid, game.id);
  const snap = await getDoc(ref);
  if (snap.exists()) return false;
  await setDoc(ref, { ...game, createdAt: game.createdAt || Date.now(), updatedAt: Date.now() });
  return true;
}

/** Live games subscription; calls cb(gamesArray) on every change. Returns unsubscribe. */
export function subscribeGames(uid, cb) {
  return onSnapshot(query(gamesCol(uid), orderBy('createdAt', 'desc')), (snap) => {
    cb(snap.docs.map((d) => d.data()));
  }, (err) => console.error('games subscription', err));
}

/** Live training-progress subscription; calls cb(progressOrNull) on every change. */
export function subscribeProgress(uid, cb) {
  return onSnapshot(progressDoc(uid), (snap) => {
    cb(snap.exists() ? snap.data() : null);
  }, (err) => console.error('progress subscription', err));
}
