import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { signOut } from 'firebase/auth';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDepuisDemande(dateDemande) {
  const d = toDate(dateDemande);
  if (!d) return '—';
  const ms = Date.now() - d.getTime();
  if (ms < 0) return 'À l’instant';
  const h = Math.floor(ms / 3600000);
  const j = Math.floor(h / 24);
  if (j > 0) return `Il y a ${j} jour${j > 1 ? 's' : ''}`;
  if (h > 0) return `Il y a ${h} heure${h > 1 ? 's' : ''}`;
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'À l’instant' : `Il y a ${m} minute${m > 1 ? 's' : ''}`;
}

export default function DemandeEnAttenteScreen({
  user,
  demandeInfo,
  onSessionRefresh,
}) {
  const [demande, setDemande] = useState(demandeInfo || {});
  const [uiEtat, setUiEtat] = useState('attente');
  const [nowTick, setNowTick] = useState(Date.now());
  const [actionAnnulation, setActionAnnulation] = useState(false);

  const demandeId = demandeInfo?.id;
  const refreshPlanifie = useRef(false);

  useEffect(() => {
    refreshPlanifie.current = false;
  }, [demandeId]);

  useEffect(() => {
    if (!demandeId) return undefined;
    const ref = doc(db, 'demandes_compte', demandeId);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = { id: snap.id, ...snap.data() };
      setDemande(data);
      const st = data.statut;
      if (st === 'validee') {
        setUiEtat((prev) => {
          if (prev !== 'attente') return prev;
          if (!refreshPlanifie.current) {
            refreshPlanifie.current = true;
            setTimeout(() => {
              onSessionRefresh?.();
            }, 2000);
          }
          return 'acceptee';
        });
      } else if (st === 'refusee') {
        setUiEtat((prev) => (prev === 'attente' ? 'refusee' : prev));
      } else if (st === 'annulee') {
        setUiEtat('annulee');
      }
    });
    return () => unsub();
  }, [demandeId, onSessionRefresh]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const libelleDepuis = useMemo(
    () => formatDepuisDemande(demande.dateDemande),
    [demande.dateDemande, nowTick]
  );

  const annulerDemande = useCallback(async () => {
    if (!demandeId) return;
    Alert.alert(
      'Annuler la demande',
      'Votre demande sera annulée et vous serez déconnecté.',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            setActionAnnulation(true);
            try {
              await updateDoc(doc(db, 'demandes_compte', demandeId), {
                statut: 'annulee',
              });
              await signOut(auth);
            } catch (e) {
              Alert.alert('Erreur', e?.message || 'Impossible d’annuler.');
            } finally {
              setActionAnnulation(false);
            }
          },
        },
      ]
    );
  }, [demandeId]);

  const deconnecter = async () => {
    await signOut(auth);
  };

  if (!demandeId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.err}>Demande introuvable.</Text>
        <TouchableOpacity style={styles.btn} onPress={deconnecter}>
          <Text style={styles.btnText}>Se déconnecter</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (uiEtat === 'acceptee') {
    return (
      <View style={styles.centered}>
        <Text style={styles.bigEmoji}>✅</Text>
        <Text style={styles.titre}>Demande acceptée !</Text>
        <Text style={styles.sous}>
          Bienvenue dans la coopérative.
        </Text>
        <ActivityIndicator color={GREEN} style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (uiEtat === 'refusee') {
    return (
      <View style={styles.centered}>
        <Text style={styles.bigEmoji}>❌</Text>
        <Text style={styles.titre}>Demande refusée</Text>
        <Text style={styles.sous}>
          {demande.raisonRefus?.trim()
            ? demande.raisonRefus
            : 'Aucun motif précisé par le président.'}
        </Text>
        <TouchableOpacity style={[styles.btn, { marginTop: 28 }]} onPress={deconnecter}>
          <Text style={styles.btnText}>Se déconnecter</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (uiEtat === 'annulee') {
    return (
      <View style={styles.centered}>
        <Text style={styles.sous}>Demande annulée.</Text>
        <TouchableOpacity style={[styles.btn, { marginTop: 20 }]} onPress={deconnecter}>
          <Text style={styles.btnText}>Se déconnecter</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.logo}>🌱 CoopLedger</Text>
        <Text style={styles.timer}>{libelleDepuis}</Text>
        <Text style={styles.message}>
          Votre demande est en cours d’examen par le président.
        </Text>
        <Text style={styles.meta}>
          Compte : {user?.email || demande.email || '—'}
        </Text>
        <Text style={styles.meta}>
          Nom : {demande.nom || '—'}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.btnDanger, actionAnnulation && { opacity: 0.6 }]}
        onPress={annulerDemande}
        disabled={actionAnnulation}
      >
        {actionAnnulation ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnDangerText}>Annuler ma demande</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 24,
    justifyContent: 'center',
  },
  centered: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 20,
  },
  logo: { fontSize: 22, fontWeight: '900', color: GREEN_DARK, textAlign: 'center' },
  timer: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '800',
    color: '#b45309',
    textAlign: 'center',
  },
  message: {
    marginTop: 16,
    fontSize: 16,
    lineHeight: 24,
    color: '#374151',
    textAlign: 'center',
  },
  meta: { marginTop: 10, fontSize: 14, color: '#6b7280', textAlign: 'center' },
  titre: {
    fontSize: 22,
    fontWeight: '900',
    color: GREEN_DARK,
    textAlign: 'center',
    marginTop: 12,
  },
  sous: { marginTop: 10, fontSize: 15, color: '#4b5563', textAlign: 'center', lineHeight: 22 },
  bigEmoji: { fontSize: 64 },
  btn: {
    backgroundColor: GREEN,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  btnDanger: {
    backgroundColor: '#b91c1c',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnDangerText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  err: { color: '#b91c1c', marginBottom: 16, textAlign: 'center' },
});
