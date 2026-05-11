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
  Modal,
  FlatList,
  ScrollView,
} from 'react-native';
import { addDoc, collection } from 'firebase/firestore';
import { db } from '../config/firebase';
import { selectImage, compressImage, uploadToCloudinary } from '../utils/uploadImage';
import { getMembresActifs } from '../utils/getMembresActifs';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';
const SUGGESTIONS = ['Cotisation mensuelle', 'Remboursement', 'Participation achat'];

function initiale(nom) {
  return String(nom || '?').trim().charAt(0).toUpperCase() || '?';
}

export default function MainAMainScreen({ userData, navigation }) {
  const [membres, setMembres] = useState([]);
  const [loadingMembres, setLoadingMembres] = useState(true);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [membreSelectionne, setMembreSelectionne] = useState(null);
  const [montant, setMontant] = useState('');
  const [objet, setObjet] = useState('');
  const [notes, setNotes] = useState('');
  const [imageUri, setImageUri] = useState(null);
  const [saving, setSaving] = useState(false);
  const [etape, setEtape] = useState('');

  const roleAutorise = userData?.role === 'tresorier' || userData?.role === 'president';

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!roleAutorise) {
        setLoadingMembres(false);
        return;
      }
      try {
        setLoadingMembres(true);
        const list = await getMembresActifs(userData?.cooperativeId || 'broukou');
        if (alive) setMembres(list.filter((m) => m.role !== 'institution'));
      } catch {
        if (alive) Alert.alert('Erreur', 'Impossible de charger les membres.');
      } finally {
        if (alive) setLoadingMembres(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [roleAutorise, userData?.cooperativeId]);

  const peutEnregistrer = useMemo(() => {
    return !!membreSelectionne && !!montant && Number(montant) > 0 && !!imageUri && !saving;
  }, [membreSelectionne, montant, imageUri, saving]);

  async function choisirPhoto() {
    try {
      const uri = await selectImage();
      if (!uri) return;
      setImageUri(uri);
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Impossible de sélectionner la photo.');
    }
  }

  async function enregistrerDepot() {
    if (!peutEnregistrer) return;
    setSaving(true);
    try {
      setEtape('📤 Upload du justificatif...');
      const compressedUri = await compressImage(imageUri);
      const cloud = await uploadToCloudinary(compressedUri);

      setEtape('💾 Enregistrement...');
      const montantNum = Number(montant);
      await addDoc(collection(db, 'transactions'), {
        titre: `Dépôt physique - ${membreSelectionne.nom}`,
        montant: montantNum,
        typeTransaction: 'main_a_main',
        type: 'entree',
        categorie: 'cotisation',
        membreUid: membreSelectionne.uid,
        membreNom: membreSelectionne.nom,
        recuPar: userData?.uid || '',
        recuParNom: userData?.nom || 'Trésorier',
        cooperativeId: 'broukou',
        justificatif: {
          url: cloud.url,
          publicId: cloud.publicId,
        },
        statut: 'valide',
        date: new Date(),
        hash: `mam_${Date.now()}`,
        notes: notes || '',
        creePar: userData?.uid || '',
      });

      Alert.alert(
        '✅ Dépôt enregistré !',
        `${montantNum.toLocaleString('fr-FR')} FCFA reçu de ${membreSelectionne.nom}\nJustificatif sauvegardé.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('cloudinary') || msg.includes('upload') || msg.includes('réseau') || msg.includes('reseau')) {
        Alert.alert('❌ Erreur upload. Vérifie la connexion.');
      } else {
        Alert.alert('❌ Erreur enregistrement.');
      }
    } finally {
      setSaving(false);
      setEtape('');
    }
  }

  if (!roleAutorise) {
    return (
      <View style={styles.refuseContainer}>
        <Text style={styles.refuseEmoji}>🚫</Text>
        <Text style={styles.refuseText}>Accès réservé au trésorier et président</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🤝 Dépôt physique</Text>
        <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>Trésorier / Président</Text></View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.label}>Membre concerné</Text>
        <TouchableOpacity style={styles.selector} onPress={() => setPickerVisible(true)}>
          <Text style={styles.selectorText}>
            {membreSelectionne ? `${initiale(membreSelectionne.nom)} · ${membreSelectionne.nom}` : 'Choisir un membre'}
          </Text>
        </TouchableOpacity>
        {membreSelectionne ? (
          <View style={styles.selectedBox}>
            <Text style={styles.selectedText}>✅ {membreSelectionne.nom} sélectionné</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Montant reçu (FCFA)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="Ex: 15000"
          value={montant}
          onChangeText={setMontant}
        />

        <Text style={styles.label}>Objet du dépôt</Text>
        <View style={styles.chipsRow}>
          {SUGGESTIONS.map((s) => (
            <TouchableOpacity key={s} style={styles.chip} onPress={() => setObjet(s)}>
              <Text style={styles.chipText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={styles.input}
          placeholder="Objet..."
          value={objet}
          onChangeText={setObjet}
        />

        <Text style={styles.label}>Justificatif (obligatoire)</Text>
        {!imageUri ? (
          <TouchableOpacity style={styles.photoBtn} onPress={choisirPhoto}>
            <Text style={styles.photoBtnText}>📸 Photographier le reçu</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.imageWrap}>
            <Image source={{ uri: imageUri }} style={styles.preview} />
            <TouchableOpacity style={styles.changePhotoBtn} onPress={choisirPhoto}>
              <Text style={styles.changePhotoText}>🔄 Changer la photo</Text>
            </TouchableOpacity>
          </View>
        )}
        {!imageUri ? <Text style={styles.warn}>* Justificatif obligatoire</Text> : null}

        <Text style={styles.label}>Notes (optionnel)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          multiline
          numberOfLines={3}
          placeholder="Notes..."
          value={notes}
          onChangeText={setNotes}
        />

        <TouchableOpacity
          style={[styles.submitBtn, !peutEnregistrer && styles.submitDisabled]}
          onPress={enregistrerDepot}
          disabled={!peutEnregistrer}
        >
          {saving ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.submitText}>{etape || 'Traitement...'}</Text>
            </View>
          ) : (
            <Text style={styles.submitText}>✅ Enregistrer le dépôt</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={pickerVisible} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choisir un membre</Text>
            {loadingMembres ? (
              <ActivityIndicator color={GREEN} />
            ) : (
              <FlatList
                data={membres}
                keyExtractor={(item) => item.uid}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.memberRow}
                    onPress={() => {
                      setMembreSelectionne(item);
                      setPickerVisible(false);
                    }}
                  >
                    <View style={styles.avatar}><Text style={styles.avatarText}>{initiale(item.nom)}</Text></View>
                    <Text style={styles.memberName}>{item.nom || 'Membre'}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity style={styles.closeBtn} onPress={() => setPickerVisible(false)}>
              <Text style={styles.closeBtnText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    backgroundColor: GREEN_DARK,
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: { padding: 6 },
  backText: { color: '#fff', fontSize: 22, fontWeight: '900' },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '900' },
  roleBadge: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  roleBadgeText: { color: GREEN_DARK, fontSize: 11, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 30 },
  label: { marginTop: 12, marginBottom: 7, color: '#374151', fontWeight: '800', fontSize: 12 },
  selector: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectorText: { color: '#111827', fontWeight: '700' },
  selectedBox: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#dcfce7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  selectedText: { color: '#166534', fontWeight: '700', fontSize: 12 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: '#111827',
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { color: '#374151', fontWeight: '700', fontSize: 12 },
  photoBtn: {
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  photoBtnText: { color: '#fff', fontWeight: '800' },
  imageWrap: { alignItems: 'center', marginTop: 4 },
  preview: { width: 200, height: 200, borderRadius: 16, backgroundColor: '#f3f4f6' },
  changePhotoBtn: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#ecfdf5' },
  changePhotoText: { color: GREEN_DARK, fontWeight: '800' },
  warn: { color: '#b91c1c', marginTop: 6, fontSize: 12, fontWeight: '700' },
  notesInput: { minHeight: 86, textAlignVertical: 'top' },
  submitBtn: {
    marginTop: 18,
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalCard: {
    maxHeight: '78%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 14,
  },
  modalTitle: { fontSize: 17, fontWeight: '900', color: '#111827', marginBottom: 8 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: GREEN_DARK, fontWeight: '900' },
  memberName: { color: '#111827', fontWeight: '700' },
  closeBtn: { marginTop: 10, backgroundColor: '#f3f4f6', borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
  closeBtnText: { color: '#374151', fontWeight: '700' },
  refuseContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  refuseEmoji: { fontSize: 48, marginBottom: 12 },
  refuseText: { fontSize: 16, fontWeight: '800', color: '#b91c1c', textAlign: 'center' },
});

