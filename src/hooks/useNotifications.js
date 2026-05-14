import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../config/firebase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const isExpoGo = Constants.appOwnership === 'expo';
// En Expo Go, on ne peut pas utiliser getExpoPushTokenAsync avec projectId
// mais on peut toujours écouter les notifications locales

/**
 * Ré-enregistre le token push (ex. après chargement de userData).
 * Exporté pour App.js (import dynamique).
 */
export async function refreshExpoPushToken() {
  return enregistrerNotifications();
}

async function enregistrerNotifications() {
  if (!Device.isDevice) {
    console.log('Simulateur - notifs non disponibles');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Permission refusée');
    return null;
  }

  try {
    let token;
    if (isExpoGo) {
      // Expo Go : utilise le token natif (limité mais fonctionnel pour tests)
      const tokenData = await Notifications.getExpoPushTokenAsync();
      token = tokenData.data;
    } else {
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId
        || Constants.easConfig?.projectId;
      if (!projectId) {
        console.warn('projectId EAS manquant dans app.json > extra > eas > projectId');
        return null;
      }
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      token = tokenData.data;
    }

    console.log('Expo Push Token:', token);

    if (token && auth.currentUser) {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        expoPushToken: token,
        expoPushTokenUpdatedAt: new Date(),
        deviceOS: Platform.OS,
      }).catch((e) => console.warn('Impossible de sauver le token:', e));
    }

    return token;
  } catch (error) {
    console.warn('Erreur token push:', error.message);
    return null;
  }
}

export function useNotifications({ userData, navigationRef } = {}) {
  const [expoPushToken, setExpoPushToken] = useState(null);
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('votes', {
          name: 'Votes & Transactions',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          sound: 'default',
          lightColor: '#15803d',
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          bypassDnd: false,
        });
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Notifications générales',
          importance: Notifications.AndroidImportance.HIGH,
          sound: 'default',
        });
      }

      const token = await enregistrerNotifications();
      if (!cancelled && token) setExpoPushToken(token);
    })();

    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        console.log('Notification reçue:', notification);
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;

        if (data?.type === 'NEW_VOTE' && navigationRef?.current) {
          navigationRef.current.navigate('Vote');
        }
        if (data?.type === 'NEW_TRANSACTION' && navigationRef?.current) {
          navigationRef.current.navigate('Historique');
        }
      });

    return () => {
      cancelled = true;
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!userData?.uid) return undefined;
    let cancelled = false;
    void (async () => {
      const token = await enregistrerNotifications();
      if (!cancelled && token) setExpoPushToken(token);
    })();
    return () => {
      cancelled = true;
    };
  }, [userData?.uid]);

  return { expoPushToken };
}
