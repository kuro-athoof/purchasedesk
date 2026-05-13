import { db } from './firebase.js';
import { collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { setSaving, toast } from './utils.js';
import { SHOP_ID } from './auth.js';

// All shop data lives under /shops/purchasedesk-shop/
function col(name)     { return collection(db, 'shops', SHOP_ID, name); }
function ref(name, id) { return doc(db, 'shops', SHOP_ID, name, id); }

export function listenCollection(name, callback) {
  return onSnapshot(col(name), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function fsSet(colName, id, data) {
  setSaving(true);
  try { await setDoc(ref(colName, id), data); }
  catch (e) { toast('Save failed: ' + e.message, 'error'); console.error(e); }
  setSaving(false);
}

export async function fsDel(colName, id) {
  setSaving(true);
  try { await deleteDoc(ref(colName, id)); }
  catch (e) { toast('Delete failed: ' + e.message, 'error'); console.error(e); }
  setSaving(false);
}

// setUser no longer needed (shared shop data, not per-user)
export function setUser() {}

export async function seedCountries() {
  const defaults = [
    { id:'c1', name:'United Arab Emirates', code:'AED', sym:'د.إ', cpy:3.6725, mvr:15.42, cof:15, mup:100, gst:8 },
    { id:'c2', name:'India',                code:'INR', sym:'₹',   cpy:83.5,   mvr:15.42, cof:15, mup:100, gst:8 },
    { id:'c3', name:'China',                code:'CNY', sym:'¥',   cpy:7.24,   mvr:15.42, cof:18, mup:100, gst:8 },
    { id:'c4', name:'Maldives (Local)',      code:'MVR', sym:'ر',   cpy:15.42,  mvr:15.42, cof:0,  mup:50,  gst:8 },
  ];
  for (const c of defaults) await fsSet('countries', c.id, c);
}
