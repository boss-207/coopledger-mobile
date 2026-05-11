import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ⚠️ Remplace par tes vraies clés Firebase (les mêmes que le web)
export const firebaseConfig = {
  apiKey: "AIzaSyATAnTfmMu0CI1E9rggP07MxUmEg4VYKKs",
  authDomain: "coopledger-3cf7c.firebaseapp.com",
  projectId: "coopledger-3cf7c",
  storageBucket: "coopledger-3cf7c.firebasestorage.app",
  messagingSenderId: "333403837411",
  appId: "1:333403837411:web:61d8c89f0f00f93ab4c6d6"
};

const app = initializeApp(firebaseConfig);

// Auth avec persistance sur mobile (reste connecté après fermeture)
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

export const db = getFirestore(app);
