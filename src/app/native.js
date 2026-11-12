// Native (Android) app shell: behaviour that only makes sense inside the
// Capacitor WebView. Every export is a no-op on the web (guarded by isNative()),
// and the plugins are imported dynamically so the website bundle never pulls
// them in. Called once from main.js plus the keep-awake helpers used by Review.
import { isNative } from './platform.js';

/** Keep the screen on while a long task (an analysis review) runs. No-op on web. */
export async function keepScreenOn() {
  if (!isNative()) return;
  try {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    await KeepAwake.keepAwake();
  } catch (e) { console.warn('keepAwake', e); }
}

/** Let the screen sleep again once the task ends. No-op on web. */
export async function allowScreenSleep() {
  if (!isNative()) return;
  try {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    await KeepAwake.allowSleep();
  } catch (e) { console.warn('allowSleep', e); }
}

/**
 * One-time app-shell setup, run from the app entry. Hides the splash once we're
 * drawn, sets the status-bar text for our dark theme, and wires the Android
 * hardware back button to go back through the hash history, or exit at Home.
 */
export async function initNativeShell() {
  if (!isNative()) return;
  document.documentElement.classList.add('native');

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch (e) { console.warn('splash', e); }

  try {
    // Style.Dark = light text/icons, for our dark header background.
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
  } catch (e) { console.warn('statusbar', e); }

  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', () => {
      const atHome = !location.hash || location.hash === '#/' || location.hash === '#';
      if (atHome) App.exitApp();
      else window.history.back();
    });
  } catch (e) { console.warn('backButton', e); }
}
