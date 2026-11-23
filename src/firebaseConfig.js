import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// .env.local의 Firebase 웹 앱 설정을 읽습니다.
// 다른 페이지에서는 app, auth, googleProvider를 가져와 재사용할 수 있습니다.
const value = name => (name || '').trim();
export const firebaseConfig = {
  apiKey: value(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: value(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: value(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: value(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: value(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: value(import.meta.env.VITE_FIREBASE_APP_ID),
  measurementId: value(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID),
};
const required = {
  apiKey: 'VITE_FIREBASE_API_KEY', authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID', appId: 'VITE_FIREBASE_APP_ID',
};
export const missingFirebaseSettings = Object.entries(required)
  .filter(([property]) => !firebaseConfig[property]).map(([, name]) => name);
let app = null, auth = null, db = null, storage = null, firebaseSetupError = null;
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
if (missingFirebaseSettings.length) {
  firebaseSetupError = new Error('Firebase 설정 누락: ' + missingFirebaseSettings.join(', '));
} else {
  try {
    app = getApps().find(existing => existing.name === '[DEFAULT]') || initializeApp(firebaseConfig);
    auth = getAuth(app);
    auth.languageCode = 'ko';
    db = getFirestore(app);
    if (firebaseConfig.storageBucket) storage = getStorage(app);
  } catch (error) { firebaseSetupError = error; }
}
export { app, auth, db, storage, googleProvider, firebaseSetupError };
