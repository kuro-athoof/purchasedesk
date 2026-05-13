import { auth, db } from './firebase.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
} from 'firebase/auth';
import {
  doc, getDoc, setDoc, collection, onSnapshot, deleteDoc, updateDoc
} from 'firebase/firestore';

// ── OWNER UID ────────────────────────────────────────────
// After you first sign in, your UID is stored here automatically.
// All staff accounts are created under YOUR shop data.
const SHOP_ID = 'purchasedesk-shop'; // fixed shop namespace — never changes

export function shopRef(path) {
  return doc(db, 'shops', SHOP_ID, ...path.split('/'));
}
export function shopCol(name) {
  return collection(db, 'shops', SHOP_ID, name);
}

// ── AUTH STATE ────────────────────────────────────────────
export function initAuth(onLogin, onLogout) {
  onAuthStateChanged(auth, async user => {
    if (!user) { onLogout(); return; }

    // Load this user's profile from shop users collection
    const profileSnap = await getDoc(doc(db, 'shops', SHOP_ID, 'users', user.uid));

    if (!profileSnap.exists()) {
      // First ever login = owner — create owner profile
      const isFirst = await checkIfFirstUser();
      if (isFirst) {
        await setDoc(doc(db, 'shops', SHOP_ID, 'users', user.uid), {
          uid:       user.uid,
          email:     user.email,
          name:      'Owner',
          role:      'owner',
          active:    true,
          createdAt: new Date().toISOString(),
        });
        // Store owner uid in shop doc
        await setDoc(doc(db, 'shops', SHOP_ID), {
          ownerUid:  user.uid,
          shopName:  'PurchaseDesk',
          createdAt: new Date().toISOString(),
        }, { merge: true });
        onLogin(user, { role:'owner', name:'Owner', active:true });
      } else {
        // Not in users list — not authorized
        await signOut(auth);
        showAuthErr('Access denied. Contact the shop owner to get access.');
      }
      return;
    }

    const profile = profileSnap.data();
    if (!profile.active) {
      await signOut(auth);
      showAuthErr('Your account has been deactivated. Contact the shop owner.');
      return;
    }

    onLogin(user, profile);
  });

  document.getElementById('auth-btn').addEventListener('click', doSignIn);
  document.getElementById('auth-email').addEventListener('keydown', e => { if (e.key==='Enter') doSignIn(); });
  document.getElementById('auth-pass').addEventListener('keydown',  e => { if (e.key==='Enter') doSignIn(); });
  document.getElementById('sb-signout-btn').addEventListener('click', () => {
    if (confirm('Sign out?')) signOut(auth);
  });
}

async function checkIfFirstUser() {
  try {
    const shopSnap = await getDoc(doc(db, 'shops', SHOP_ID));
    return !shopSnap.exists();
  } catch { return false; }
}

async function doSignIn() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  const btn   = document.getElementById('auth-btn');
  if (!email || !pass) { showAuthErr('Email and password are required.'); return; }
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  showAuthErr('');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    const msgs = {
      'auth/invalid-credential': 'Wrong email or password.',
      'auth/user-not-found':     'Account not found.',
      'auth/wrong-password':     'Incorrect password.',
      'auth/invalid-email':      'Invalid email address.',
      'auth/too-many-requests':  'Too many attempts. Try again later.',
    };
    showAuthErr(msgs[e.code] || e.message);
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

function showAuthErr(msg) {
  const el = document.getElementById('login-err');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

export function setUserDisplay(user, profile) {
  document.getElementById('user-email').textContent = profile?.name || user.email;
  document.getElementById('sb-avatar').textContent  = (profile?.name || user.email || '?')[0].toUpperCase();
  // Show admin panel link only for owner
  const adminLink = document.getElementById('nav-admin');
  if (adminLink) adminLink.style.display = profile?.role === 'owner' ? '' : 'none';
}

// ── STAFF MANAGEMENT (owner only) ─────────────────────────
export function listenStaffUsers(callback) {
  return onSnapshot(shopCol('users'), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function createStaffAccount(email, password, name, role) {
  // Create Firebase Auth account
  // We use a secondary auth approach: create via REST so current session stays
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaSyCae5Q-UcznHF2HZFhIf3Ucv5s4vuuSHQ8`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);

  const uid = data.localId;
  // Save profile in Firestore
  await setDoc(doc(db, 'shops', SHOP_ID, 'users', uid), {
    uid, email, name,
    role:      role || 'staff',
    active:    true,
    createdAt: new Date().toISOString(),
  });
  return uid;
}

export async function toggleStaffActive(uid, active) {
  await updateDoc(doc(db, 'shops', SHOP_ID, 'users', uid), { active });
}

export async function deleteStaffAccount(uid) {
  await deleteDoc(doc(db, 'shops', SHOP_ID, 'users', uid));
  // Note: Firebase Auth account stays but Firestore profile deleted = no access
}

export async function resetStaffPassword(uid, newPassword) {
  // Owner-only: update password via admin SDK would be ideal,
  // but from client we store a flag and the user must reset on next login
  await updateDoc(doc(db, 'shops', SHOP_ID, 'users', uid), {
    passwordNote: newPassword, // owner sets this, staff reads it on login
    mustReset: true,
  });
}

export { SHOP_ID };
