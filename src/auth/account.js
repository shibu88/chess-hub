// Account glue: header account area, auth-state transitions, guest↔account
// data merge, live sync start/stop, and the sign-out keep/clear prompt.
import { el } from '../app/dom.js';
import { choiceDialog } from '../app/modal.js';
import { openAuthDialog } from './authdialog.js';
import { onAuth, isVerified, refreshUser, resendVerification, signOutUser, currentUser, firebaseEnabled } from './auth.js';
import { setActiveUser } from '../store/index.js';
import { mergeGuestIntoAccount, mergeTrainingProgress, copyAccountToDevice, clearLocal } from '../store/merge.js';

export function initAccount() {
  const area = document.getElementById('account-area');
  if (!area) return;

  // A single "Login" button before sign-in and when signed out.
  const LOGIN_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
  function renderSignedOut() {
    const login = el('button', { type: 'button', class: 'login-btn', on: { click: () => openAuthDialog('login') } }, [
      el('span', { class: 'ic', 'aria-hidden': 'true', html: LOGIN_ICON }), ' Login',
    ]);
    area.replaceChildren(login);
  }

  function renderSignedIn(user) {
    const email = el('span', { class: 'acct-email', title: user.email || '', text: user.email || 'Signed in' });
    const signout = el('button', { type: 'button', class: 'link-btn', text: 'Sign out', on: { click: onSignOut } });
    area.replaceChildren(email, signout);
  }

  function renderUnverified(user) {
    const email = el('span', { class: 'acct-email', text: user.email || '' });
    const verify = el('button', { type: 'button', class: 'link-btn acct-verify', text: 'Verify email', on: { click: onCheckVerified } });
    const signout = el('button', { type: 'button', class: 'link-btn', text: 'Sign out', on: { click: onSignOut } });
    area.replaceChildren(email, verify, el('span', { class: 'sep', 'aria-hidden': 'true', text: '|' }), signout);
  }

  let mergedUid = null;

  async function applyState(user) {
    if (!user) {
      mergedUid = null;
      setActiveUser(null);
      renderSignedOut();
      return;
    }
    if (isVerified(user)) {
      renderSignedIn(user);
      if (mergedUid !== user.uid) {
        mergedUid = user.uid;
        try {
          const added = await mergeGuestIntoAccount(user.uid);
          if (added) console.info(`Merged ${added} guest game(s) into your account.`);
          await mergeTrainingProgress(user.uid);
        } catch (err) { console.error('merge failed', err); }
        setActiveUser(user.uid); // start Firestore + live sync
      }
    } else {
      mergedUid = null;
      setActiveUser(null); // stay on guest storage until verified
      renderUnverified(user);
    }
  }

  async function onCheckVerified() {
    const user = await refreshUser();
    if (user && isVerified(user)) { applyState(user); return; }
    // still unverified — offer to resend
    const choice = await choiceDialog({
      title: 'Email not verified yet',
      message: 'We haven’t seen a verified email yet. Resend the verification link?',
      choices: [
        { label: 'Resend link', value: 'resend', primary: true },
        { label: 'Close', value: null },
      ],
    });
    if (choice === 'resend') {
      try { await resendVerification(); } catch (err) { console.error('resend failed', err); }
    }
  }

  async function onSignOut() {
    const uid = currentUser()?.uid;
    const choice = await choiceDialog({
      title: 'Sign out',
      message: 'Keep a copy of your games on this device?',
      choices: [
        { label: 'Keep a copy', value: 'keep', primary: true },
        { label: 'Don’t keep', value: 'clear' },
        { label: 'Cancel', value: null },
      ],
    });
    if (choice === null) return; // cancelled
    try {
      if (choice === 'keep' && uid) await copyAccountToDevice(uid);
      else if (choice === 'clear') await clearLocal();
    } catch (err) { console.error('sign-out data step failed', err); }
    try { await signOutUser(); } catch (err) { console.error('sign-out failed', err); }
  }

  if (!firebaseEnabled) { renderSignedOut(); return; }
  onAuth((user) => applyState(user));
}
