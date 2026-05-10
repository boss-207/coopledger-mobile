/* eslint-disable no-undef */
// Firebase Messaging Service Worker (Web)
// Important: remplace la config si tu as une app web dédiée.

importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js');

// Même projet Firebase que l'app
firebase.initializeApp({
  apiKey: "AIzaSyATAnTfmMu0CI1E9rggP07MxUmEg4VYKKs",
  authDomain: "coopledger-3cf7c.firebaseapp.com",
  projectId: "coopledger-3cf7c",
  storageBucket: "coopledger-3cf7c.firebasestorage.app",
  messagingSenderId: "333403837411",
  appId: "1:333403837411:web:61d8c89f0f00f93ab4c6d6"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'CoopLedger';
  const options = {
    body: payload?.notification?.body || '',
    data: payload?.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};

  // Par défaut, ouvre la page /vote si NEW_VOTE
  const target =
    data.type === 'NEW_VOTE'
      ? '/vote'
      : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client?.url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
      return null;
    })
  );
});

