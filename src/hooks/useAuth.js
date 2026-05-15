import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { roleCanonique } from '../utils/roles';

function profilAvecRoleCanonique(uid, profile) {
  const role = roleCanonique(profile.role) || profile.role || 'membre';
  return { uid, ...profile, role };
}

export function useAuth() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [demandeEnAttente, setDemandeEnAttente] = useState(false);
  const [demandeEnAttenteInfo, setDemandeEnAttenteInfo] = useState(null);

  const refreshSession = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return;
    try {
      const userRef = doc(db, 'users', u.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const profile = snap.data();
        const st = profile.statut;
        if (st === 'inactif' || st === 'exclu') {
          await signOut(auth);
          setUser(null);
          setUserData(null);
          setDemandeEnAttente(false);
          setDemandeEnAttenteInfo(null);
          return;
        }
        setUserData(profilAvecRoleCanonique(u.uid, profile));
        setDemandeEnAttente(false);
        setDemandeEnAttenteInfo(null);
      }
    } catch (e) {
      console.error('refreshSession:', e);
    }
  }, []);

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
            setDemandeEnAttente(false);
            setDemandeEnAttenteInfo(null);
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
            const profil = profilAvecRoleCanonique(firebaseUser.uid, profile);
            if (__DEV__ && profile.role !== profil.role) {
              console.log('[useAuth] rôle canonique:', profile.role, '→', profil.role);
            }
            setUserData(profil);
          } else {
            setUserData(null);
            if (!firebaseUser.email) {
              setDemandeEnAttente(false);
              setDemandeEnAttenteInfo(null);
              await signOut(auth);
              setUser(null);
              setLoading(false);
              return;
            }

            const demandeValideeSnap = await getDocs(
              query(
                collection(db, 'demandes_compte'),
                where('email', '==', firebaseUser.email),
                where('statut', '==', 'validee')
              )
            );

            if (!demandeValideeSnap.empty) {
              const demande = demandeValideeSnap.docs[0].data();
              const profilBrut = {
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                nom: demande.nom || firebaseUser.email.split('@')[0],
                role: demande.roleChoisi || 'membre',
                cooperativeId: demande.cooperativeId || 'broukou',
                statut: 'actif',
                dateInscription: new Date(),
              };
              const profil = profilAvecRoleCanonique(firebaseUser.uid, profilBrut);
              await setDoc(userRef, profil);
              setUserData(profil);
              setDemandeEnAttente(false);
              setDemandeEnAttenteInfo(null);
            } else {
              const demandeAttenteSnap = await getDocs(
                query(
                  collection(db, 'demandes_compte'),
                  where('email', '==', firebaseUser.email),
                  where('statut', '==', 'en_attente')
                )
              );

              if (!demandeAttenteSnap.empty) {
                const d = demandeAttenteSnap.docs[0];
                setDemandeEnAttenteInfo({ id: d.id, ...d.data() });
                setDemandeEnAttente(true);
              } else {
                setDemandeEnAttente(false);
                setDemandeEnAttenteInfo(null);
                await signOut(auth);
                setUser(null);
              }
            }
            setLoading(false);
            return;
          }
        } catch (err) {
          console.error('Erreur profil:', err);
          setDemandeEnAttente(false);
          setDemandeEnAttenteInfo(null);
          try {
            await signOut(auth);
          } catch {
            /* ignore */
          }
          setUser(null);
          setUserData(null);
        }
      } else {
        setUser(null);
        setUserData(null);
        setDemandeEnAttente(false);
        setDemandeEnAttenteInfo(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return {
    user,
    userData,
    loading,
    demandeEnAttente,
    demandeEnAttenteInfo,
    refreshSession,
  };
}
