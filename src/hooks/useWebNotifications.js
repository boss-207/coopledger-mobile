import { useEffect, useState } from 'react';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

/**
 * Notifications Web (FCM Web SDK).
 *
 * Prérequis:
 * - Configurer VAPID key (Firebase Console → Cloud Messaging → Web Push certificates)
 * - Avoir un service worker `public/firebase-messaging-sw.js`
 *
 * Note:
 * Ce hook est prévu pour une app web React. Dans ce repo Expo (mobile+web),
 * l’intégration complète web peut nécessiter des ajustements selon ton build web.
 */
export function useWebNotifications({ vapidKey }) {
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'default');

  useEffect(() => {
    let unsubOnMessage = null;

    (async () => {
      try {
        if (!(await isSupported())) return;
        if (typeof window === 'undefined') return;
        if (!('serviceWorker' in navigator)) return;

        // Demander permission
        if (Notification.permission !== 'granted') {
          const p = await Notification.requestPermission();
          setPermission(p);
          if (p !== 'granted') return;
        }

        // Enregistrer SW
        await navigator.serviceWorker.register('/firebase-messaging-sw.js');

        const messaging = getMessaging();
        const token = await getToken(messaging, { vapidKey });

        if (token && auth.currentUser?.uid) {
          await updateDoc(doc(db, 'users', auth.currentUser.uid), {
            fcmToken: token,
            fcmTokenType: 'web',
            fcmTokenUpdatedAt: new Date(),
          });
        }

        unsubOnMessage = onMessage(messaging, (payload) => {
          // Foreground web : afficher une Notification même si onglet actif
          const title = payload?.notification?.title || 'CoopLedger';
          const body = payload?.notification?.body || '';
          if (Notification.permission === 'granted') {
            new Notification(title, { body });
          }
        });
      } catch (e) {
        // Ne pas bloquer l'app web
        console.log('Web notifications error:', e?.message || e);
      }
    })();

    return () => {
      if (typeof unsubOnMessage === 'function') unsubOnMessage();
    };
  }, [vapidKey]);

  return { permission };
}

