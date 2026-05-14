import { useState, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../config/firebase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function useNotifications({ userData, navigationRef } = {}) {
  const [expoPushToken, setExpoPushToken] = useState(null);
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    const isExpoGo = Constants.appOwnership === 'expo';

    if (isExpoGo) {
      console.log('Expo Go - notifs désactivées');
      return;
    }

    enregistrerNotifications().then(token => {
      if (token) setExpoPushToken(token);
    });

    notificationListener.current =
      Notifications.addNotificationReceivedListener(notification => {
        console.log('Notification reçue:', notification);
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener(response => {
        const data = response.notification.request.content.data;

        if (data?.type === 'NEW_VOTE' && navigationRef?.current) {
          navigationRef.current.navigate('Vote');
        }
        if (data?.type === 'NEW_TRANSACTION' && navigationRef?.current) {
          navigationRef.current.navigate('Historique');
        }
      });

    // ✅ CORRECTION ICI — utiliser .remove()
    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  return { expoPushToken };
}

async function enregistrerNotifications() {
  if (!Device.isDevice) {
    console.log('Simulateur - notifs non disponibles');
    return null;
  }

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();

  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Permission refusée');
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId;

  if (!projectId) {
    console.log('projectId manquant dans app.json');
    return null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const token = tokenData.data;
    console.log('Token:', token);

    if (auth.currentUser) {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        await updateDoc(userRef, {
          expoPushToken: token,
          fcmTokenUpdatedAt: new Date(),
        });
      }
    }

    return token;
  } catch (error) {
    console.log('Erreur token:', error);
    return null;
  }
}