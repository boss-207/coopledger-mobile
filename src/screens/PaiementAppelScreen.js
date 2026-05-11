import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  ScrollView,
} from 'react-native';
import { addDoc, arrayUnion, doc, increment, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { creerTransaction, envoyerPromptPaiement, attendreConfirmation } from '../services/fedapay';
import { formaterNumero } from '../utils/mobileMoneyUtils';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';

function detectOperateurFromPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const n = digits.startsWith('228') ? digits.slice(3) : digits;
  const p = n.slice(0, 2);
  if (['90', '91', '92', '93', '98', '99'].includes(p)) return 'FLOOZ';
  if (['96', '97'].includes(p)) return 'MTN';
  return 'TMONEY';
}

export default function PaiementAppelScreen({ route, navigation, userData }) {
  const appel = route?.params?.appel;
  const [operateurSelectionne, setOperateurSelectionne] = useState(detectOperateurFromPhone(userData?.telephone || ''));
  const [telephone, setTelephone] = useState(userData?.telephone || '');
  const [loading, setLoading] = useState(false);
  const [etape, setEtape] = useState('');

  const montant = Number(appel?.montantParMembre || 0);
  const frais = Math.round(montant * 0.01);
  const total = montant + frais;

  const numeroFormate = useMemo(() => formaterNumero(telephone), [telephone]);

  async function confirmerPaiement() {
    if (!appel) return;
    if (!numeroFormate || numeroFormate.replace(/\D/g, '').length < 11) {
      Alert.alert('Erreur', 'Numéro invalide.');
      return;
    }
    setLoading(true);
    try {
      setEtape('🔄 Création de la transaction FedaPay...');
      const creation = await creerTransaction({
        montant,
        nom: userData?.nom || 'Membre',
        email: userData?.email || 'membre@coopledger.tg',
        telephone: numeroFormate,
        description: `Appel de fonds CoopLedger : ${appel.titre}`,
      });
      if (!creation.success) throw new Error(creation.error || 'Création FedaPay impossible');

      setEtape('📱 Prompt envoyé sur votre téléphone...');
      const methode = operateurSelectionne === 'FLOOZ' ? 'moov' : 'mtn';
      const prompt = await envoyerPromptPaiement(creation.token, methode, numeroFormate);
      if (!prompt.success) throw new Error(prompt.error || 'Prompt impossible');

      setEtape('⏳ En attente de confirmation...');
      const confirmation = await attendreConfirmation(creation.transactionId);
      if (!confirmation.success) throw new Error('Paiement refusé ou expiré');

      await addDoc(collection(db, 'transactions'), {
        titre: `Appel de fonds - ${appel.titre}`,
        montant,
        typeTransaction: 'mobile_money',
        type: 'entree',
        categorie: 'appel_fonds',
        operateur: operateurSelectionne,
        telephone: numeroFormate,
        referencePayment: confirmation.reference,
        fedapayTransactionId: creation.transactionId,
        appelDeFondsId: appel.id,
        membreUid: userData?.uid || '',
        membreNom: userData?.nom || 'Membre',
        cooperativeId: 'broukou',
        statut: 'valide',
        date: serverTimestamp(),
        hash: `fedapay_${creation.transactionId}`,
        creePar: userData?.uid || '',
      });

      await updateDoc(doc(db, 'appels_fonds', appel.id), {
        membresAyantPaye: arrayUnion(userData?.uid || ''),
        totalCollecte: increment(montant),
      });

      const deja = Array.isArray(appel?.membresAyantPaye) ? appel.membresAyantPaye.length : 0;
      const prochainTotalPaye = deja + 1;
      const totalCibles = Math.max(1, Math.round(Number(appel?.totalAttendu || 0) / Math.max(montant, 1)));
      if (prochainTotalPaye >= totalCibles) {
        await updateDoc(doc(db, 'appels_fonds', appel.id), { statut: 'clos' });
        await addDoc(collection(db, 'notifications_queue'), {
          type: 'appel_fonds_cloture',
          titre: '🎉 Tous les membres ont payé !',
          message: `${(Number(appel.totalCollecte || 0) + montant).toLocaleString('fr-FR')} FCFA collectés.`,
          cooperativeId: 'broukou',
          createdAt: serverTimestamp(),
        });
      }

      Alert.alert(
        '✅ Paiement confirmé !',
        `Référence : ${confirmation.reference}\nMontant : ${montant.toLocaleString('fr-FR')} FCFA\nMerci pour votre contribution !`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Paiement impossible.');
    } finally {
      setLoading(false);
      setEtape('');
    }
  }

  if (!appel) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>Appel introuvable.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>💳 Payer ma part</Text>
        <Text style={styles.headerSub}>{appel.titre}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.row}><Text style={styles.k}>Appel :</Text> {appel.titre}</Text>
        <Text style={styles.row}><Text style={styles.k}>Raison :</Text> {appel.raisonAppel || '-'}</Text>
        <Text style={styles.row}><Text style={styles.k}>Montant :</Text> {montant.toLocaleString('fr-FR')} FCFA</Text>
        <Text style={styles.row}><Text style={styles.k}>Date limite :</Text> {new Date(appel.dateEcheance?.seconds ? appel.dateEcheance.seconds * 1000 : appel.dateEcheance).toLocaleDateString('fr-FR')}</Text>
        {appel?.justificatif?.url ? (
          <TouchableOpacity onPress={() => Linking.openURL(appel.justificatif.url)}>
            <Text style={styles.link}>Voir justificatif</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Opérateur</Text>
        <View style={styles.opsRow}>
          {['MTN', 'FLOOZ', 'TMONEY'].map((op) => (
            <TouchableOpacity
              key={op}
              style={[styles.opBtn, operateurSelectionne === op && styles.opBtnActive]}
              onPress={() => setOperateurSelectionne(op)}
            >
              <Text style={[styles.opText, operateurSelectionne === op && styles.opTextActive]}>
                {op === 'MTN' ? '🟡 MTN MoMo' : op === 'FLOOZ' ? '🔵 Flooz' : '🔴 T-Money'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Numéro de téléphone</Text>
        <TextInput style={styles.input} value={telephone} onChangeText={setTelephone} keyboardType="phone-pad" />

        <View style={styles.resume}>
          <Text style={styles.resumeText}>Opérateur : {operateurSelectionne}</Text>
          <Text style={styles.resumeText}>Numéro : {numeroFormate}</Text>
          <Text style={styles.resumeText}>Montant : {montant.toLocaleString('fr-FR')} FCFA</Text>
          <Text style={styles.resumeText}>Frais FedaPay (~1%) : ~{frais.toLocaleString('fr-FR')} FCFA</Text>
          <Text style={styles.resumeTotal}>Total : ~{total.toLocaleString('fr-FR')} FCFA</Text>
        </View>
      </View>

      <TouchableOpacity style={[styles.confirmBtn, loading && { opacity: 0.6 }]} onPress={confirmerPaiement} disabled={loading}>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.confirmText}>{etape || 'Traitement...'}</Text>
          </View>
        ) : (
          <Text style={styles.confirmText}>✅ Confirmer le paiement</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  emptyText: { color: '#6b7280' },
  header: { backgroundColor: GREEN_DARK, padding: 16 },
  headerTitle: { color: '#fff', fontWeight: '900', fontSize: 18 },
  headerSub: { color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  card: { backgroundColor: '#fff', margin: 14, marginBottom: 0, borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', padding: 12 },
  row: { color: '#374151', marginBottom: 6 },
  k: { fontWeight: '800', color: '#111827' },
  link: { color: GREEN, fontWeight: '700', marginTop: 6 },
  label: { marginTop: 8, marginBottom: 6, color: '#374151', fontWeight: '800', fontSize: 12 },
  opsRow: { gap: 8 },
  opBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: '#fff' },
  opBtnActive: { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  opText: { color: '#374151', fontWeight: '700' },
  opTextActive: { color: GREEN_DARK },
  input: { borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 10, backgroundColor: '#f9fafb', paddingHorizontal: 12, paddingVertical: 10, color: '#111827' },
  resume: { marginTop: 10, backgroundColor: '#f3f4f6', borderRadius: 10, padding: 10 },
  resumeText: { color: '#374151', marginBottom: 3 },
  resumeTotal: { color: GREEN_DARK, fontWeight: '900', marginTop: 4 },
  confirmBtn: { margin: 14, backgroundColor: GREEN, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

