import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  formaterNumero,
  validerNumeroTogolais,
  detecterOperateur,
  estimerFrais,
} from '../utils/mobileMoneyUtils';
import {
  creerTransaction,
  envoyerPromptPaiement,
  attendreConfirmation,
} from '../services/fedapay';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';
const DUREE_MAX = 180;

export default function MobileMoneyScreen({ navigation, userData }) {
  const coopId = userData?.cooperativeId || 'broukou';
  const [montant, setMontant] = useState('');
  const [telephone, setTelephone] = useState(userData?.telephone || '');
  const [objet, setObjet] = useState('Cotisation');
  const [operateurSelectionne, setOperateurSelectionne] = useState('');
  const [loading, setLoading] = useState(false);
  const [etapePaiement, setEtapePaiement] = useState(null);
  const [secondesRestantes, setSecondesRestantes] = useState(DUREE_MAX);
  const [pulseOn, setPulseOn] = useState(false);

  const montantNum = parseInt(montant || '0', 10) || 0;
  const numeroFormate = useMemo(() => formaterNumero(telephone), [telephone]);
  const frais = useMemo(() => estimerFrais(montantNum), [montantNum]);

  useEffect(() => {
    if (!loading || etapePaiement !== 'attente') return undefined;
    setSecondesRestantes(DUREE_MAX);
    const interval = setInterval(() => {
      setSecondesRestantes((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [loading, etapePaiement]);

  useEffect(() => {
    if (!loading || etapePaiement !== 'prompt') return undefined;
    const interval = setInterval(() => {
      setPulseOn((prev) => !prev);
    }, 600);
    return () => clearInterval(interval);
  }, [loading, etapePaiement]);

  useEffect(() => {
    if (!operateurSelectionne) {
      const auto = detecterOperateur(telephone);
      if (auto === 'MOOV' || auto === 'TMONEY') setOperateurSelectionne(auto);
    }
  }, [telephone, operateurSelectionne]);

  function formatTemps(secondes) {
    const m = Math.floor(secondes / 60);
    const s = secondes % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  async function handlePaiement() {
    if (!operateurSelectionne) {
      Alert.alert('Erreur', 'Choisissez un opérateur');
      return;
    }
    if (!montant || parseInt(montant, 10) <= 0) {
      Alert.alert('Erreur', 'Montant invalide');
      return;
    }
    const { valide } = validerNumeroTogolais(telephone);
    if (!valide) {
      Alert.alert('Erreur', 'Numéro de téléphone invalide');
      return;
    }

    setLoading(true);
    setEtapePaiement('creation');

    try {
      const numero = formaterNumero(telephone);
      const creation = await creerTransaction({
        montant: parseInt(montant, 10),
        description: objet,
        nom: userData?.nom || 'Membre',
        email: userData?.email || 'membre@coopledger.tg',
        telephone: numero,
        cooperativeId: coopId,
      });

      if (!creation.success) {
        throw new Error(creation.error || 'Erreur création transaction');
      }

      setEtapePaiement('prompt');
      const methode = operateurSelectionne === 'MOOV' ? 'moov' : 'mtn';
      const prompt = await envoyerPromptPaiement(
        creation.token,
        methode,
        numero
      );

      if (!prompt.success) {
        throw new Error(prompt.error || 'Erreur envoi prompt');
      }

      setEtapePaiement('attente');
      const confirmation = await attendreConfirmation(
        creation.transactionId
      );

      if (confirmation.timeoutAtteint) {
        Alert.alert(
          '⏱️ Délai dépassé',
          "Le paiement n'a pas été confirmé dans le délai.\n" +
          'Si vous avez confirmé sur votre téléphone,\n' +
          'contactez le trésorier avec votre référence :\n' +
          creation.transactionId
        );
        setLoading(false);
        setEtapePaiement(null);
        return;
      }

      if (!confirmation.success) {
        throw new Error('Paiement refusé ou annulé');
      }

      setEtapePaiement('enregistrement');
      await addDoc(collection(db, 'transactions'), {
        titre: objet,
        montant: parseInt(montant, 10),
        typeTransaction: 'mobile_money',
        type: 'entree',
        categorie: 'cotisation',
        operateur: operateurSelectionne,
        telephone: numero,
        referencePayment: confirmation.reference,
        fedapayTransactionId: creation.transactionId,
        membreUid: userData?.uid || '',
        membreNom: userData?.nom || 'Membre',
        cooperativeId: coopId,
        statut: 'valide',
        date: serverTimestamp(),
        hash: `fedapay_${creation.transactionId}`,
        creePar: userData?.uid || '',
      });

      setLoading(false);
      setEtapePaiement(null);
      Alert.alert(
        '✅ Paiement confirmé !',
        `Montant : ${parseInt(montant, 10).toLocaleString('fr-FR')} FCFA\n` +
        `Opérateur : ${operateurSelectionne}\n` +
        `Référence : ${confirmation.reference}\n\n` +
        'La transaction a été enregistrée dans CoopLedger.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      setLoading(false);
      setEtapePaiement(null);
      Alert.alert(
        '❌ Paiement échoué',
        error.message || "Une erreur est survenue.\nVérifiez votre connexion et réessayez."
      );
    }
  }

  function renderEtapePaiement() {
    if (!loading) return null;
    if (etapePaiement === 'creation') {
      return (
        <View style={styles.progressCard}>
          <ActivityIndicator color={GREEN} />
          <Text style={styles.progressText}>Création de la transaction...</Text>
        </View>
      );
    }
    if (etapePaiement === 'prompt') {
      return (
        <View style={[styles.progressCard, pulseOn && styles.progressCardPulse]}>
          <Text style={styles.progressText}>📱 Prompt envoyé sur {numeroFormate}</Text>
          <Text style={styles.progressSubText}>Confirmez le paiement sur votre téléphone</Text>
        </View>
      );
    }
    if (etapePaiement === 'attente') {
      return (
        <View style={styles.progressCard}>
          <Text style={styles.progressText}>⏳ En attente de confirmation...</Text>
          <Text style={styles.timerText}>{formatTemps(secondesRestantes)}</Text>
          <Text style={styles.progressSubText}>Vérifiez votre téléphone</Text>
        </View>
      );
    }
    if (etapePaiement === 'enregistrement') {
      return (
        <View style={styles.progressCard}>
          <ActivityIndicator color={GREEN} />
          <Text style={styles.progressText}>💾 Enregistrement dans CoopLedger...</Text>
        </View>
      );
    }
    return null;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Paiement Mobile Money</Text>
      <Text style={styles.subtitle}>Moov Flooz (Togo) et T-Money (Togocom)</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Montant (FCFA)</Text>
        <TextInput
          style={styles.input}
          value={montant}
          onChangeText={setMontant}
          keyboardType="numeric"
          placeholder="Ex: 5000"
          placeholderTextColor="#9ca3af"
        />

        <Text style={styles.label}>Numéro de téléphone</Text>
        <TextInput
          style={styles.input}
          value={telephone}
          onChangeText={setTelephone}
          keyboardType="phone-pad"
          placeholder="+228XXXXXXXX"
          placeholderTextColor="#9ca3af"
        />

        <Text style={styles.label}>Objet</Text>
        <TextInput
          style={styles.input}
          value={objet}
          onChangeText={setObjet}
          placeholder="Ex: Cotisation mensuelle"
          placeholderTextColor="#9ca3af"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Opérateur</Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.operatorBtn, operateurSelectionne === 'MOOV' && styles.operatorBtnActive]}
            onPress={() => setOperateurSelectionne('MOOV')}
          >
            <Text style={[styles.operatorText, operateurSelectionne === 'MOOV' && styles.operatorTextActive]}>
              MOOV (Flooz)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.operatorBtn, operateurSelectionne === 'TMONEY' && styles.operatorBtnActive]}
            onPress={() => setOperateurSelectionne('TMONEY')}
          >
            <Text style={[styles.operatorText, operateurSelectionne === 'TMONEY' && styles.operatorTextActive]}>
              T-Money
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.resumeBox}>
          <Text style={styles.resumeLine}>Téléphone formaté : {numeroFormate || '—'}</Text>
          <Text style={styles.resumeLine}>Frais estimés : {frais.toLocaleString('fr-FR')} FCFA</Text>
        </View>
      </View>

      {!loading ? (
        <TouchableOpacity style={styles.mainBtn} onPress={handlePaiement}>
          <Text style={styles.mainBtnText}>Initier le paiement</Text>
        </TouchableOpacity>
      ) : (
        renderEtapePaiement()
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '900', color: GREEN_DARK },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 14 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 14,
    marginBottom: 12,
  },
  label: { fontSize: 12, fontWeight: '800', color: '#374151', marginBottom: 6, marginTop: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
    fontSize: 14,
    backgroundColor: '#f9fafb',
  },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
  operatorBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  operatorBtnActive: { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  operatorText: { color: '#374151', fontWeight: '700', fontSize: 13 },
  operatorTextActive: { color: GREEN_DARK },
  resumeBox: {
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 10,
  },
  resumeLine: { fontSize: 12, color: '#4b5563', marginBottom: 2 },
  mainBtn: {
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
  },
  mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  progressCard: {
    marginTop: 8,
    borderWidth: 1.5,
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  progressCardPulse: {
    borderColor: GREEN,
    backgroundColor: '#dcfce7',
  },
  progressText: { color: GREEN_DARK, fontWeight: '800', textAlign: 'center' },
  progressSubText: { color: '#166534', fontSize: 12, textAlign: 'center' },
  timerText: {
    fontSize: 24,
    fontWeight: '900',
    color: GREEN_DARK,
    letterSpacing: 1,
  },
});

