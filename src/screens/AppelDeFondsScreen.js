import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addDoc, collection, getDocs, query, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { selectImage, compressImage, uploadToCloudinary } from '../utils/uploadImage';
import { getMembresActifs } from '../utils/getMembresActifs';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';

export default function AppelDeFondsScreen({ userData, navigation }) {
  const coopId = userData?.cooperativeId || 'broukou';
  const [titre, setTitre] = useState('');
  const [raisonAppel, setRaisonAppel] = useState('');
  const [montant, setMontant] = useState('');
  const [dateEcheance, setDateEcheance] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [justifUri, setJustifUri] = useState(null);
  const [loading, setLoading] = useState(false);
  const [etape, setEtape] = useState('');
  const [nbMembres, setNbMembres] = useState(0);

  const canAccess = userData?.role === 'tresorier' || userData?.role === 'president';

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!canAccess) return;
      try {
        const list = await getMembresActifs(coopId);
        if (alive) setNbMembres(list.length);
      } catch {
        if (alive) setNbMembres(0);
      }
    })();
    return () => { alive = false; };
  }, [canAccess, coopId]);

  const montantNum = useMemo(() => Number(montant || 0), [montant]);
  const totalAttendu = useMemo(() => montantNum * nbMembres, [montantNum, nbMembres]);

  const dateAffichee = dateEcheance
    ? dateEcheance.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : 'Choisir une date';

  async function choisirJustificatif() {
    try {
      const uri = await selectImage();
      if (!uri) return;
      setJustifUri(uri);
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Impossible de sélectionner l’image.');
    }
  }

  async function lancerAppel() {
    if (!userData?.uid) {
      Alert.alert('Erreur', 'Vous devez être connecté.');
      return;
    }
    if (userData?.role !== 'tresorier' && userData?.role !== 'president') {
      Alert.alert(
        'Accès refusé',
        'Seuls le trésorier et le président peuvent créer un appel de fonds.'
      );
      return;
    }

    if (!titre.trim()) return Alert.alert('Erreur', "Le titre de l'appel est obligatoire.");
    if (!montantNum || montantNum <= 0) return Alert.alert('Erreur', 'Montant invalide.');
    if (!dateEcheance) {
      return Alert.alert('Erreur', 'Choisissez une date limite de paiement.');
    }

    setLoading(true);
    try {
      const membres = await getMembresActifs(coopId);
      let justificatif = null;

      if (justifUri) {
        setEtape('📤 Upload du justificatif...');
        const compressed = await compressImage(justifUri);
        const cloud = await uploadToCloudinary(compressed);
        justificatif = { url: cloud.url, publicId: cloud.publicId };
      }

      setEtape('💾 Enregistrement...');
      await addDoc(collection(db, 'appels_fonds'), {
        titre: titre.trim(),
        raisonAppel: raisonAppel.trim(),
        montantParMembre: parseInt(montant, 10),
        justificatif,
        dateEcheance: Timestamp.fromDate(dateEcheance),
        creePar: userData?.uid || '',
        creeParNom: userData?.nom || 'Trésorier',
        cooperativeId: coopId,
        statut: 'actif',
        dateCreation: serverTimestamp(),
        membresAyantPaye: [],
        totalCollecte: 0,
        totalAttendu: parseInt(montant, 10) * membres.length,
      });

      setEtape('📣 Notifications...');
      const usersSnap = await getDocs(query(collection(db, 'users'), where('cooperativeId', '==', coopId)));
      const notifies = usersSnap.docs.filter((d) => !!d.data()?.fcmToken).length;
      await addDoc(collection(db, 'notifications_queue'), {
        type: 'appel_fonds',
        titre: '💰 Appel de fonds !',
        message: `${userData?.nom || 'Le trésorier'} demande ${parseInt(montant, 10).toLocaleString('fr-FR')} FCFA avant le ${dateEcheance.toLocaleDateString('fr-FR')}`,
        cooperativeId: coopId,
        createdAt: serverTimestamp(),
      });

      Alert.alert(
        '✅ Appel de fonds lancé !',
        `${membres.length} membres ont été notifiés.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
      void notifies;
    } catch (e) {
      Alert.alert('Erreur', e?.message || "Impossible de lancer l'appel de fonds.");
    } finally {
      setLoading(false);
      setEtape('');
    }
  }

  if (!canAccess) {
    return (
      <View style={styles.deniedWrap}>
        <Text style={styles.deniedText}>🚫 Accès réservé au trésorier et président</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>💰 Appel de fonds</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>Trésorier</Text></View>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Titre de l'appel</Text>
        <TextInput style={styles.input} value={titre} onChangeText={setTitre} placeholder="Achat semences saison 2026" />

        <Text style={styles.label}>Raison / Justification</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          multiline
          numberOfLines={4}
          value={raisonAppel}
          onChangeText={setRaisonAppel}
          placeholder="La coopérative a besoin..."
        />

        <Text style={styles.label}>Montant demandé par membre (FCFA)</Text>
        <TextInput style={styles.input} keyboardType="numeric" value={montant} onChangeText={setMontant} placeholder="15000" />
        <Text style={styles.infoText}>
          Total attendu : {totalAttendu.toLocaleString('fr-FR')} FCFA pour {nbMembres} membres actifs
        </Text>

        <Text style={styles.label}>Date limite de paiement</Text>
        <TouchableOpacity
          style={styles.datePickerBtn}
          onPress={() => setShowDatePicker(true)}
        >
          <Text style={[styles.datePickerBtnText, !dateEcheance && styles.datePickerPlaceholder]}>
            📅 {dateAffichee}
          </Text>
          <Text style={{ color: GREEN }}>▼</Text>
        </TouchableOpacity>

        {showDatePicker ? (
          <>
            <DateTimePicker
              value={dateEcheance || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minimumDate={new Date()}
              locale="fr-FR"
              onChange={(event, selectedDate) => {
                if (Platform.OS === 'android') {
                  setShowDatePicker(false);
                  if (event.type === 'dismissed') return;
                }
                if (selectedDate) {
                  setDateEcheance(selectedDate);
                }
              }}
            />
            {Platform.OS === 'ios' ? (
              <TouchableOpacity style={styles.iosDateDone} onPress={() => setShowDatePicker(false)}>
                <Text style={styles.iosDateDoneText}>Terminer</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}

        <Text style={styles.label}>Justificatif (optionnel)</Text>
        {!justifUri ? (
          <TouchableOpacity style={styles.uploadBtn} onPress={choisirJustificatif}>
            <Text style={styles.uploadBtnText}>📸 Ajouter un justificatif</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.previewWrap}>
            <Image source={{ uri: justifUri }} style={styles.preview} />
            <TouchableOpacity style={styles.changeBtn} onPress={choisirJustificatif}>
              <Text style={styles.changeText}>Changer l'image</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, (!titre.trim() || montantNum <= 0 || !dateEcheance || loading) && { opacity: 0.6 }]}
          disabled={!titre.trim() || montantNum <= 0 || !dateEcheance || loading}
          onPress={lancerAppel}
        >
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.submitText}>{etape || 'Traitement...'}</Text>
            </View>
          ) : (
            <Text style={styles.submitText}>📢 Lancer l'appel de fonds</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    backgroundColor: GREEN_DARK,
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backText: { color: '#fff', fontSize: 24, fontWeight: '900' },
  headerTitle: { flex: 1, color: '#fff', fontWeight: '900', fontSize: 18 },
  badge: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { color: GREEN_DARK, fontWeight: '800', fontSize: 11 },
  form: { padding: 16 },
  label: { marginTop: 12, marginBottom: 6, color: '#374151', fontWeight: '800', fontSize: 12 },
  input: {
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
  },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  infoText: { marginTop: 8, color: GREEN_DARK, fontWeight: '700', fontSize: 12 },
  datePickerBtn: {
    borderWidth: 1,
    borderColor: '#d1fae5',
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  datePickerBtnText: { color: '#1f2937', fontSize: 15, flex: 1 },
  datePickerPlaceholder: { color: '#9ca3af' },
  iosDateDone: {
    marginTop: 8,
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  iosDateDoneText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  uploadBtn: { marginTop: 4, backgroundColor: '#ecfdf5', borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  uploadBtnText: { color: GREEN_DARK, fontWeight: '800' },
  previewWrap: { alignItems: 'center', marginTop: 8 },
  preview: { width: 160, height: 160, borderRadius: 12, backgroundColor: '#f3f4f6' },
  changeBtn: { marginTop: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  changeText: { color: '#374151', fontWeight: '700', fontSize: 12 },
  submitBtn: { marginTop: 18, backgroundColor: GREEN, borderRadius: 14, alignItems: 'center', paddingVertical: 15 },
  submitText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deniedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', padding: 20 },
  deniedText: { color: '#b91c1c', fontWeight: '800', fontSize: 16, textAlign: 'center' },
});
