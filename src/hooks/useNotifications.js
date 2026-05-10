import { useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { auth, db } from '../config/firebase';
import { doc, updateDoc } from 'firebase/firestore';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function normalizeToken(token) {
  if (!token) return null;
  const s = String(token).trim();
  return s.length ? s : null;
}

async function registerForPushNotifications() {
  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    Alert.alert(
      'Notifications désactivées',
      'Activez les notifications pour être alerté des votes en cours.',
      [{ text: 'OK' }]
    );
    return null;
  }

  // Expo managed: ceci retourne le token natif (FCM sur Android, APNS sur iOS).
  // Pour envoyer via Firebase Admin, il faut des tokens FCM. Sur Android (EAS build),
  // `type` est généralement "fcm".
  const devicePush = await Notifications.getDevicePushTokenAsync();
  return {
    token: normalizeToken(devicePush?.data),
    type: devicePush?.type || null,
  };
}

export function useNotifications({ userData, navigationRef }) {
  const lastSavedToken = useRef(null);
  const lastSavedType = useRef(null);

  useEffect(() => {
    if (!userData?.uid) return;

    let receivedSub;
    let responseSub;

    (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('votes', {
            name: 'Votes',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#15803d',
            sound: 'default',
          });
        }

        const result = await registerForPushNotifications();
        const token = result?.token;
        const type = result?.type;

        if (token && token !== lastSavedToken.current) {
          const uid = auth.currentUser?.uid;
          if (uid) {
            await updateDoc(doc(db, 'users', uid), {
              fcmToken: token,
              fcmTokenType: type || null,
              fcmTokenUpdatedAt: new Date(),
            });
            lastSavedToken.current = token;
            lastSavedType.current = type || null;
          }
        }

        receivedSub = Notifications.addNotificationReceivedListener((notification) => {
          // Foreground: Expo affiche déjà la notif (handler),
          // mais on garde ce hook si tu veux afficher une bannière custom plus tard.
          void notification;
        });

        responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response?.notification?.request?.content?.data || {};
          const type = data.type;

          if (!navigationRef?.current) return;
          if (type === 'NEW_VOTE') {
            navigationRef.current.navigate('Votes');
          } else if (type === 'NEW_TRANSACTION') {
            navigationRef.current.navigate('Historique');
          }
        });
      } catch (e) {
        // Ne bloque pas l'app si les notifs ne sont pas configurées
        // (ex: Expo Go / creds manquants).
        console.log('Notifications init error:', e?.message || e);
      }
    })();

    return () => {
      if (receivedSub) receivedSub.remove();
      if (responseSub) responseSub.remove();
    };
  }, [userData?.uid, navigationRef]);
}

