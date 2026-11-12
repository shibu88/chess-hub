// Tabbed Login / Register dialog. Login = email + password (+ forgot password);
// Register = email + display name + password (min 6). Both offer Google sign-in.
import { el } from '../app/dom.js';
import { signUpEmail, signInEmail, signInGoogle, resetPassword } from './auth.js';

// Small inline line-icons (static markup only).
const ICON = {
  login: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
  register: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

function icon(name) { return el('span', { class: 'ic', 'aria-hidden': 'true', html: ICON[name] }); }

function friendlyError(err) {
  switch (err && err.code) {
    case 'auth/invalid-email': return 'That email address looks invalid.';
    case 'auth/missing-password': return 'Please enter a password.';
    case 'auth/weak-password': return 'Password should be at least 6 characters.';
    case 'auth/email-already-in-use': return 'That email already has an account — try Login.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Email or password is incorrect.';
    case 'auth/too-many-requests': return 'Too many attempts. Try again later.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return '';
    case 'auth/popup-blocked': return 'The sign-in popup was blocked by the browser.';
    default: return 'Something went wrong. Please try again.';
  }
}

/** A labelled input with a leading icon, and an optional password eye toggle. */
function field({ label, type, id, placeholder, autocomplete, iconName, hint }) {
  const input = el('input', { type, id, class: 'auth-input', placeholder, autocomplete, 'aria-label': label });
  const wrap = el('div', { class: 'input-wrap' }, [icon(iconName), input]);
  let eyeBtn = null;
  if (type === 'password') {
    eyeBtn = el('button', { type: 'button', class: 'eye-btn', 'aria-label': 'Show password', title: 'Show password', html: ICON.eye });
    eyeBtn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eyeBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      eyeBtn.classList.toggle('on', show);
    });
    wrap.append(eyeBtn);
  }
  const labelEl = el('label', { class: 'auth-label', for: id }, [
    label, hint ? el('span', { class: 'label-hint', text: ` (${hint})` }) : null,
  ]);
  return { input, node: el('div', { class: 'field-group' }, [labelEl, wrap]) };
}

export function openAuthDialog(mode = 'login') {
  let tab = mode === 'register' ? 'register' : 'login';
  const lastFocused = document.activeElement;
  let done = false;

  function close() {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }

  const loginTab = el('button', { type: 'button', class: 'auth-tab', role: 'tab' }, [icon('login'), ' Login']);
  const registerTab = el('button', { type: 'button', class: 'auth-tab', role: 'tab' }, [icon('register'), ' Register']);
  const closeBtn = el('button', { type: 'button', class: 'auth-close', 'aria-label': 'Close', html: ICON.close, on: { click: close } });
  const tabs = el('div', { class: 'auth-tabs', role: 'tablist' }, [loginTab, registerTab, closeBtn]);

  const body = el('div', { class: 'auth-body' });

  function setBusy(b, primary) { primary.disabled = b; }

  function renderLogin() {
    const email = field({ label: 'Email', type: 'email', id: 'login-email', placeholder: 'you@example.com', autocomplete: 'email', iconName: 'mail' });
    const pass = field({ label: 'Password', type: 'password', id: 'login-pass', placeholder: '••••••••', autocomplete: 'current-password', iconName: 'lock' });
    const error = el('p', { class: 'auth-error', role: 'alert' });
    const forgot = el('button', { type: 'button', class: 'auth-link auth-forgot', text: 'Forgot password?' });
    const submit = el('button', { type: 'submit', class: 'auth-primary', text: 'Sign In' });
    const google = el('button', { type: 'button', class: 'auth-google', text: 'Continue with Google' });

    const form = el('form', { class: 'auth-form', on: { submit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      const em = email.input.value.trim(), pw = pass.input.value;
      if (!em || !pw) { error.textContent = 'Please enter your email and password.'; return; }
      setBusy(true, submit);
      try { await signInEmail(em, pw); close(); }
      catch (err) { error.textContent = friendlyError(err); setBusy(false, submit); }
    } } }, [email.node, pass.node, forgot, error, submit, divider(), google]);

    forgot.addEventListener('click', async () => {
      const em = email.input.value.trim();
      if (!em) { error.textContent = 'Enter your email above first.'; email.input.focus(); return; }
      try { await resetPassword(em); error.classList.add('ok'); error.textContent = `Password reset link sent to ${em}.`; }
      catch (err) { error.classList.remove('ok'); error.textContent = friendlyError(err); }
    });
    google.addEventListener('click', () => doGoogle(error, submit));

    body.replaceChildren(form);
    email.input.focus();
  }

  function renderRegister() {
    const email = field({ label: 'Email', type: 'email', id: 'reg-email', placeholder: 'you@example.com', autocomplete: 'email', iconName: 'mail' });
    const name = field({ label: 'Display name', type: 'text', id: 'reg-name', placeholder: 'Your name', autocomplete: 'nickname', iconName: 'user' });
    const pass = field({ label: 'Password', type: 'password', id: 'reg-pass', placeholder: '••••••••', autocomplete: 'new-password', iconName: 'lock', hint: 'min 6 characters' });
    const error = el('p', { class: 'auth-error', role: 'alert' });
    const submit = el('button', { type: 'submit', class: 'auth-primary', text: 'Create Account' });
    const google = el('button', { type: 'button', class: 'auth-google', text: 'Continue with Google' });

    const form = el('form', { class: 'auth-form', on: { submit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      const em = email.input.value.trim(), pw = pass.input.value, nm = name.input.value.trim();
      if (!em || !pw) { error.textContent = 'Please enter your email and a password.'; return; }
      setBusy(true, submit);
      try { const user = await signUpEmail(em, pw, nm); showVerifySent(user.email); }
      catch (err) { error.textContent = friendlyError(err); setBusy(false, submit); }
    } } }, [email.node, name.node, pass.node, error, submit, divider(), google]);

    google.addEventListener('click', () => doGoogle(error, submit));
    body.replaceChildren(form);
    email.input.focus();
  }

  function divider() { return el('div', { class: 'auth-divider', 'aria-hidden': 'true', text: 'or' }); }

  async function doGoogle(error, primary) {
    error.textContent = '';
    setBusy(true, primary);
    try { await signInGoogle(); close(); }
    catch (err) { error.textContent = friendlyError(err); setBusy(false, primary); }
  }

  function showVerifySent(email) {
    body.replaceChildren(el('div', { class: 'auth-verify' }, [
      el('h3', { text: 'Verify your email' }),
      el('p', { text: `We sent a verification link to ${email}. Open it, then come back and log in.` }),
      el('button', { type: 'button', class: 'auth-primary', text: 'Done', on: { click: close } }),
    ]));
  }

  function selectTab(which) {
    tab = which;
    const isLogin = which === 'login';
    loginTab.classList.toggle('active', isLogin);
    registerTab.classList.toggle('active', !isLogin);
    loginTab.setAttribute('aria-selected', String(isLogin));
    registerTab.setAttribute('aria-selected', String(!isLogin));
    if (isLogin) renderLogin(); else renderRegister();
  }
  loginTab.addEventListener('click', () => selectTab('login'));
  registerTab.addEventListener('click', () => selectTab('register'));

  const dialog = el('div', { class: 'auth-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Account' }, [tabs, body]);
  const overlay = el('div', { class: 'overlay auth-overlay', on: { click: (e) => { if (e.target === overlay) close(); } } }, [dialog]);

  selectTab(tab);
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
}
