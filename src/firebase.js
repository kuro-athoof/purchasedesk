import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCae5Q-UcznHF2HZFhIf3Ucv5s4vuuSHQ8",
  authDomain: "purchasedesk-316ca.firebaseapp.com",
  projectId: "purchasedesk-316ca",
  storageBucket: "purchasedesk-316ca.firebasestorage.app",
  messagingSenderId: "170437645183",
  appId: "1:170437645183:web:059c32e4aff2197e21404a"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
