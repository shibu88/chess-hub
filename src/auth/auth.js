// Firebase Auth + Firestore init and a small auth API. The rest of the app
// talks to this module, never to the Firebase SDK directly.
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendEmailVerification, sendPasswordResetEmail, signInWithPopup, GoogleAuthProvider,
  signInWithCredential, setPersistence, browserLocalPersistence, updateProfile,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { isNative } from '../app/platform.js';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(config.apiKey && config.projectId);

let auth = null;
let db = null;

if (firebaseEnabled) {
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  setPersistence(auth, browserLocalPersistence).catch((e) => console.warn('persistence', e));
}

export { auth, db };

/** A user counts as an active account only once their email is verified. */
export function isVerified(user) {
  return !!(user && user.emailVerified);
}

export function onAuth(cb) {
  if (!firebaseEnabled) { cb(null); return () => {}; }
  return onAuthStateChanged(auth, cb);
}

export function currentUser() { return auth?.currentUser || null; }

export async function signUpEmail(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    try { await updateProfile(cred.user, { displayName }); } catch (e) { console.warn('set display name', e); }
  }
  await sendEmailVerification(cred.user);
  return cred.user;
}

export function signInEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signInGoogle() {
  // The web popup can't run inside a WebView, so in the app we use the native
  // Google sign-in plugin with skipNativeAuth (it returns an ID token only),
  // then sign the single Firebase JS SDK in with that token's credential. The
  // website keeps the popup, so its behaviour is unchanged.
  if (isNative()) {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error('Google sign-in returned no ID token.');
    return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  }
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function resendVerification() {
  if (auth?.currentUser) await sendEmailVerification(auth.currentUser);
}

/** Reload the user so a just-verified email is reflected in emailVerified. */
export async function refreshUser() {
  if (auth?.currentUser) { await auth.currentUser.reload(); return auth.currentUser; }
  return null;
}

export function signOutUser() {
  return signOut(auth);
}
