import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Linking, Image,
} from 'react-native';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { useSendTransaction } from '../hooks/useBlockchain';
import { polygonscanTxUrl } from '../config/blockchain';
import { db } from '../config/firebase';
import { selectImage, uploadJustificatif } from '../utils/uploadImage';
import { getNombreMembres } from '../utils/getMembresActifs';
import { calculerSolde, verifierSolde, formaterMontant } from '../utils/soldeUtils';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';

const CATEGORIES = ['Achat intrants', 'Équipement', 'Formation', 'Transport', 'Cotisations', 'Autre'];

export default function NouvelleTransactionScreen({ userData, navigation }) {
  const [form, setForm] = useState({
    titre: '', montant: '', type: 'sortie', categorie: '', fournisseur: '', description: '',
  });
  const [justificatifUri, setJustificatifUri] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingJustificatif, setUploadingJustificatif] = useState(false);
  const [soldeDisponible, setSoldeDisponible] = useState(0);
  const [soldeLoading, setSoldeLoading] = useState(true);

  const { sendTransaction, loading } = useSendTransaction();

  const update = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const montantNum = parseFloat(form.montant) || 0;
  const needsVote = montantNum >= 500000;
  const busy = loading || uploadingJustificatif;
  const depasseSolde = form.type === 'sortie' && !soldeLoading && montantNum > soldeDisponible;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setSoldeLoading(true);
        const coopId = userData?.cooperativeId || 'broukou';
        const solde = await calculerSolde(coopId);
        if (alive) setSoldeDisponible(solde);
      } catch {
        if (alive) setSoldeDisponible(0);
      } finally {
        if (alive) setSoldeLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userData?.cooperativeId]);

  async function ajouterJustificatif() {
    try {
      const uri = await selectImage();
      if (!uri) return;
      setJustificatifUri(uri);
    } catch (err) {
      Alert.alert('Erreur', err.message || 'Impossible de sélectionner l’image. Vérifie ta connexion et les permissions.');
    }
  }

  function retirerJustificatif() {
    setJustificatifUri(null);
    setUploadProgress(0);
  }

  async function soumettre() {
    if (!form.titre.trim()) return Alert.alert('Erreur', 'Entre le titre de la transaction.');
    if (!form.montant || montantNum <= 0) return Alert.alert('Erreur', 'Entre un montant valide.');
    if (justificatifUri && !userData?.uid) {
      return Alert.alert('Connexion requise', 'Connecte-toi pour joindre un justificatif (identifiant membre).');
    }

    try {
      const coopId = userData?.cooperativeId || 'broukou';

      if (form.type === 'sortie') {
        const result = await verifierSolde(montantNum, coopId);
        if (!result.suffisant) {
          Alert.alert(
            '❌ Solde insuffisant',
            `Solde disponible : ${formaterMontant(result.soldeActuel)}\n\nMontant demandé : ${formaterMontant(result.montantDemande)}\n\nIl manque : ${formaterMontant(Math.abs(result.difference))}`
          );
          return;
        }
      }

      let totalMembresActifs = 0;
      try {
        totalMembresActifs = await getNombreMembres(coopId);
      } catch {
        totalMembresActifs = 0;
      }

      const titreComplet = form.fournisseur.trim()
        ? `${form.titre.trim()} — ${form.fournisseur.trim()}`
        : form.titre.trim();

      const { hash, transactionId, voteDeclenche } = await sendTransaction({
        titre: titreComplet,
        montant: montantNum,
        categorie: form.categorie || 'Autre',
        typeTransaction: form.type,
      });

      const hashCourt = `${hash.slice(0, 10)}...${hash.slice(-6)}`;
      const scanUrl = polygonscanTxUrl(hash);

      let justificatifOk = false;

      if (justificatifUri && userData && transactionId !== null && transactionId !== undefined) {
        setUploadingJustificatif(true);
        setUploadProgress(0);
        try {
          const payload = await uploadJustificatif(transactionId, userData, {
            existingUri: justificatifUri,
            onProgress: (pct) => setUploadProgress(pct),
          });

          if (payload?.url) {
            await setDoc(
              doc(db, 'transactions', `chain_${transactionId}`),
              {
                chainTransactionId: transactionId,
                polygonTxHash: hash,
                justificatif: {
                  url: payload.url,
                  publicId: payload.publicId,
                  width: payload.width ?? null,
                  height: payload.height ?? null,
                  uploadedAt: Timestamp.fromDate(
                    payload.uploadedAt instanceof Date ? payload.uploadedAt : new Date()
                  ),
                  uploadedBy: payload.uploadedBy,
                  uploadedByNom: payload.uploadedByNom,
                },
              },
              { merge: true }
            );
            justificatifOk = true;
          }
        } catch (uploadErr) {
          Alert.alert(
            'Justificatif',
            uploadErr.message
              || 'Erreur réseau ou Cloudinary. La transaction est bien sur Polygon, mais le justificatif n’a pas été enregistré.'
          );
        } finally {
          setUploadingJustificatif(false);
          setUploadProgress(0);
        }
      } else if (justificatifUri && (transactionId === null || transactionId === undefined)) {
        Alert.alert(
          'Justificatif',
          'La transaction est confirmée sur Polygon, mais l’identifiant interne n’a pas été retrouvé : le justificatif n’a pas été lié dans l’app. Tu peux réessayer plus tard depuis une mise à jour.'
        );
      }

      const baseMsg = voteDeclenche
        ? `La transaction dépasse 500 000 FCFA.\n\nUn vote a été déclenché automatiquement sur Polygon (total membres figé à ce moment sur la chaîne).\n\nRéférence coopérative : ${totalMembresActifs} membre(s) actif(s) dans Firestore.\n\nHash : ${hashCourt}`
        : `Transaction confirmée sur Polygon Amoy.\n\nHash : ${hashCourt}`;

      const suffix = justificatifOk ? '\n\n📎 Justificatif ajouté ✅' : '';

      if (voteDeclenche) {
        Alert.alert(
          '⚡ Vote déclenché !',
          baseMsg + suffix,
          [
            { text: 'Voir sur Polygonscan', onPress: () => Linking.openURL(scanUrl) },
            { text: 'OK', onPress: () => navigation.goBack() },
          ]
        );
      } else {
        Alert.alert(
          '✅ Transaction enregistrée !',
          baseMsg + suffix,
          [
            { text: 'Voir sur Polygonscan', onPress: () => Linking.openURL(scanUrl) },
            { text: 'OK', onPress: () => navigation.goBack() },
          ]
        );
      }

      try {
        const soldeMaj = await calculerSolde(coopId);
        setSoldeDisponible(soldeMaj);
      } catch {}
    } catch (err) {
      Alert.alert('Erreur', err.message || 'Impossible d\'enregistrer la transaction. Réessaie.');
    }
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={{ padding: 20 }}>
        {(userData?.role === 'tresorier' || userData?.role === 'president') && (
          <TouchableOpacity
            style={styles.appelBtn}
            onPress={() => navigation.navigate('AppelDeFonds', { userData })}
          >
            <Text style={styles.appelBtnText}>💰 Appel de fonds</Text>
          </TouchableOpacity>
        )}

        <View style={styles.soldeCard}>
          {soldeLoading ? (
            <View style={styles.soldeLoadingRow}>
              <ActivityIndicator color={GREEN} size="small" />
              <Text style={styles.soldeLoadingText}>Chargement du solde...</Text>
            </View>
          ) : (
            <Text style={styles.soldeText}>
              💰 Solde disponible : {formaterMontant(soldeDisponible)}
            </Text>
          )}
        </View>

        {/* TYPE */}
        <Text style={styles.label}>TYPE DE TRANSACTION</Text>
        <View style={styles.typeRow}>
          {[
            { key: 'sortie', icon: '📉', label: 'Dépense' },
            { key: 'entree', icon: '📈', label: 'Revenu' },
          ].map(t => (
            <TouchableOpacity
              key={t.key}
              style={[styles.typeBtn, form.type === t.key && styles.typeBtnActive]}
              onPress={() => update('type', t.key)}
            >
              <Text style={{ fontSize: 24 }}>{t.icon}</Text>
              <Text style={[styles.typeBtnText, form.type === t.key && styles.typeBtnTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* TITRE */}
        <Text style={styles.label}>INTITULÉ *</Text>
        <View style={styles.inputBox}>
          <TextInput
            style={styles.input}
            placeholder="Ex : Achat engrais NPK"
            placeholderTextColor="#9ca3af"
            value={form.titre}
            onChangeText={v => update('titre', v)}
          />
        </View>

        {/* MONTANT */}
        <Text style={styles.label}>MONTANT (FCFA) *</Text>
        <View style={styles.inputBox}>
          <Text style={{ fontSize: 18, marginRight: 8 }}>💰</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex : 750000"
            placeholderTextColor="#9ca3af"
            value={form.montant}
            onChangeText={v => update('montant', v)}
            keyboardType="numeric"
          />
        </View>
        {depasseSolde && (
          <Text style={styles.soldeWarnText}>
            ⚠️ Montant supérieur au solde disponible
          </Text>
        )}

        {needsVote && (
          <View style={styles.alertBox}>
            <Text style={{ fontSize: 20 }}>⚡</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Vote automatique requis</Text>
              <Text style={styles.alertSub}>
                Ce montant dépasse 500 000 FCFA. Un vote de 60% des membres sera déclenché automatiquement sur Polygon.
              </Text>
            </View>
          </View>
        )}

        {/* CATÉGORIE */}
        <Text style={styles.label}>CATÉGORIE</Text>
        <View style={styles.catsGrid}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.catBtn, form.categorie === cat && styles.catBtnActive]}
              onPress={() => update('categorie', cat)}
            >
              <Text style={[styles.catText, form.categorie === cat && styles.catTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* FOURNISSEUR */}
        <Text style={styles.label}>FOURNISSEUR / BÉNÉFICIAIRE</Text>
        <View style={styles.inputBox}>
          <TextInput
            style={styles.input}
            placeholder="Ex : Agri-Togo SARL"
            placeholderTextColor="#9ca3af"
            value={form.fournisseur}
            onChangeText={v => update('fournisseur', v)}
          />
        </View>

        {/* JUSTIFICATIF */}
        <Text style={styles.label}>JUSTIFICATIF (OPTIONNEL)</Text>
        <Text style={styles.justifHint}>
          Photo compressée automatiquement (~500 Ko) puis envoyée sur Cloudinary. Seul le lien est stocké dans Firebase.
        </Text>

        {!justificatifUri ? (
          <TouchableOpacity style={styles.justifBtn} onPress={ajouterJustificatif} disabled={busy}>
            <Text style={styles.justifBtnText}>📸 Ajouter un justificatif</Text>
            <Text style={styles.justifBtnSub}>Caméra ou galerie</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.justifPreviewBox}>
            <Image source={{ uri: justificatifUri }} style={styles.justifImage} resizeMode="cover" />
            <TouchableOpacity style={styles.justifRemove} onPress={retirerJustificatif} disabled={busy}>
              <Text style={styles.justifRemoveText}>❌ Supprimer</Text>
            </TouchableOpacity>
          </View>
        )}

        {uploadingJustificatif && (
          <View style={styles.progressWrap}>
            <Text style={styles.progressLabel}>Envoi du justificatif… {uploadProgress} %</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${uploadProgress}%` }]} />
            </View>
          </View>
        )}

        {/* NOTE BLOCKCHAIN */}
        <View style={styles.blockchainNote}>
          <Text style={styles.blockchainNoteText}>
            🔗 Cette transaction sera enregistrée de manière immuable sur la blockchain Polygon Amoy avec un hash cryptographique unique vérifiable sur Polygonscan.
          </Text>
        </View>

        {/* BOUTON SOUMETTRE */}
        <TouchableOpacity
          style={[styles.btn, busy && { opacity: 0.6 }]}
          onPress={soumettre}
          disabled={busy}
        >
          {busy
            ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.btnText}>
                  {uploadingJustificatif ? `Justificatif ${uploadProgress} %` : 'Confirmation en cours...'}
                </Text>
              </View>
            )
            : (
              <Text style={styles.btnText}>
                {needsVote ? '⚡ Soumettre au Vote' : '✅ Enregistrer sur la Blockchain'}
              </Text>
            )
          }
        </TouchableOpacity>

        {loading && !uploadingJustificatif && (
          <Text style={styles.waitingText}>
            En attente de confirmation du bloc Polygon (~5-30 sec)...
          </Text>
        )}

        <View style={{ height: 40 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  soldeCard: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  soldeLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  soldeLoadingText: { fontSize: 13, color: '#475569', fontWeight: '700' },
  soldeText: { fontSize: 14, fontWeight: '800', color: GREEN_DARK },
  soldeWarnText: {
    marginTop: 8,
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '700',
  },
  label: { fontSize: 11, fontWeight: '700', color: '#6b7280', letterSpacing: 1, marginBottom: 8, marginTop: 16 },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  typeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#fff', borderWidth: 2, borderColor: '#e5e7eb', borderRadius: 16, paddingVertical: 14,
  },
  typeBtnActive: { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  typeBtnText: { fontSize: 15, fontWeight: '700', color: '#6b7280' },
  typeBtnTextActive: { color: GREEN },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  input: { flex: 1, fontSize: 15, color: '#111827' },
  alertBox: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#fffbeb',
    borderWidth: 1.5, borderColor: '#fbbf24', borderRadius: 14, padding: 14, marginTop: 8,
  },
  alertTitle: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  alertSub: { fontSize: 12, color: '#b45309', marginTop: 4, lineHeight: 16 },
  catsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e5e7eb',
  },
  catBtnActive: { backgroundColor: GREEN, borderColor: GREEN },
  catText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  catTextActive: { color: '#fff' },
  justifHint: { fontSize: 12, color: '#6b7280', marginBottom: 10, lineHeight: 17 },
  justifBtn: {
    backgroundColor: '#fff', borderWidth: 2, borderColor: GREEN, borderRadius: 16,
    paddingVertical: 16, alignItems: 'center',
  },
  justifBtnText: { color: GREEN_DARK, fontSize: 16, fontWeight: '800' },
  justifBtnSub: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  justifPreviewBox: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  justifImage: { width: '100%', height: 150, backgroundColor: '#f3f4f6' },
  justifRemove: { paddingVertical: 12, alignItems: 'center', backgroundColor: '#fef2f2' },
  justifRemoveText: { color: '#b91c1c', fontWeight: '700', fontSize: 14 },
  progressWrap: { marginTop: 12 },
  progressLabel: { fontSize: 13, fontWeight: '600', color: GREEN_DARK, marginBottom: 6 },
  progressTrack: {
    height: 10, borderRadius: 8, backgroundColor: '#e5e7eb', overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: GREEN, borderRadius: 8,
  },
  blockchainNote: {
    backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#86efac',
    borderRadius: 14, padding: 14, marginTop: 16,
  },
  blockchainNoteText: { fontSize: 12, color: GREEN_DARK, lineHeight: 18 },
  btn: {
    backgroundColor: GREEN, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 20,
    shadowColor: GREEN_DARK, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, elevation: 6,
    flexDirection: 'row', justifyContent: 'center',
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  waitingText: { textAlign: 'center', color: '#6b7280', fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  appelBtn: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1.5,
    borderColor: GREEN,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  appelBtnText: { color: GREEN_DARK, fontWeight: '800', fontSize: 14 },
});
