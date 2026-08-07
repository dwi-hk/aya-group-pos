import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, connectDatabaseEmulator } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { getAuth, setPersistence, inMemoryPersistence, signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyCx0u4ka3lhjiPm84hI8U7v37GNusCvPaE',
  authDomain: 'kasir-aya-group-e6fb4.firebaseapp.com',
  databaseURL: 'https://kasir-aya-group-e6fb4-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'kasir-aya-group-e6fb4',
  storageBucket: 'kasir-aya-group-e6fb4.firebasestorage.app',
  messagingSenderId: '654765768336',
  appId: '1:654765768336:web:7fb865aaf00e371de36215'
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getDatabase(firebaseApp);
export const auth = getAuth(firebaseApp);
// Keamanan: sesi hanya hidup di memori halaman. Setiap aplikasi dibuka ulang, user wajib login lagi.
await setPersistence(auth, inMemoryPersistence);
await signOut(auth).catch(() => {});

if (location.hostname === 'localhost' && new URLSearchParams(location.search).has('emulator')) {
  try { connectDatabaseEmulator(db, '127.0.0.1', 9000); } catch (_) {}
}
