// One place to ask "are we running inside the native (Capacitor) app?" so the rest
// of the code can branch on it. On the web the Capacitor shim is still present and
// isNativePlatform() returns false, so this is safe everywhere.
import { Capacitor } from '@capacitor/core';

/** True only inside the packaged Android/iOS app (false on the website). */
export function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/** 'android' | 'ios' | 'web'. */
export function platform() {
  try { return Capacitor.getPlatform(); } catch { return 'web'; }
}
