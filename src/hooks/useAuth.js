import { useState, useEffect } from 'react';
import { Alert } from 'react-native';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const userRef = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const profile = userSnap.data();
            const st = profile.statut;
            if (st === 'inactif' || st === 'exclu') {
              Alert.alert(
                'Accès refusé',
                st === 'exclu'
                  ? 'Votre compte a été exclu. Contactez le président pour une réintégration.'
                  : 'Ce compte n’est plus actif dans la coopérative. Contactez le président si vous pensez qu’il s’agit d’une erreur.'
              );
              await signOut(auth);
              setUser(null);
              setUserData(null);
              setLoading(false);
              return;
            }
            setUserData({ uid: firebaseUser.uid, ...profile });
          } else {
            const defaultProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              nom: firebaseUser.email.split('@')[0],
              role: 'membre',
              cooperativeId: 'broukou',
              dateInscription: new Date(),
              statut: 'actif',
            };
            await setDoc(userRef, defaultProfile);
            setUserData(defaultProfile);
          }
        } catch (err) {
          console.error('Erreur profil:', err);
          setUserData({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            nom: firebaseUser.email.split('@')[0],
            role: 'membre',
          });
        }
      } else {
        setUser(null);
        setUserData(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return { user, userData, loading };
}
