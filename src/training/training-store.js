// Thin persistence wrapper for training progress. Loads/saves the progress
// object through the shared store (IndexedDB as a guest, Firestore when signed
// in) and debounces writes. Stage D adds live onSnapshot sync + sign-in merge.
import { getProgress, saveProgress } from '../store/index.js';
import { normalize, defaultProgress, mergeProgress } from './progress.js';

let current = null;
let saveTimer = null;

/** Load (and cache) the current progress object. */
export async function loadProgress() {
  let raw;
  try { raw = await getProgress(); } catch (err) { console.error('load progress failed', err); raw = null; }
  current = normalize(raw && Object.keys(raw).length ? raw : defaultProgress());
  return current;
}

export function getCurrent() { return current; }

/**
 * Fold a live remote snapshot (from another device) into the current object.
 * Merging — rather than replacing — keeps any in-flight local change (e.g. the
 * set you're mid-way through) while picking up remote solves and unlocks.
 */
export function applyRemote(remote) {
  current = current ? mergeProgress(current, remote) : normalize(remote);
  return current;
}

/** Queue a debounced save of the current object. */
export function persist(debounceMs = 500) {
  if (!current) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveProgress(current).catch((err) => console.error('save progress failed', err));
  }, debounceMs);
}

/** Flush any pending save immediately (used on teardown). */
export async function persistNow() {
  if (!current) return;
  clearTimeout(saveTimer);
  try { await saveProgress(current); } catch (err) { console.error('save progress failed', err); }
}
