import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Linking, Image,
} from 'react-native';
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { useSendTransaction } from '../hooks/useBlockchain';
import {
  getContractReadOnly,
  getWalletAddress,
  isContractConfigured,
  polygonscanTxUrl,
  ROLES as ROLES_CHAIN,
} from '../config/blockchain';
import { db } from '../config/firebase';
import { selectImage, uploadJustificatif } from '../utils/uploadImage';
import { getNombreMembres, getMembresActifs } from '../utils/getMembresActifs';
import { calculerSolde, verifierSolde, formaterMontant } from '../utils/soldeUtils';
import { envoyerNotifPush } from '../services/pushService';
import { peutCreerTransaction, roleCanonique } from '../utils/roles';
import { getWalletMembre } from '../utils/walletManager';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';

const OPERATEURS_DEPENSE = [
  { key: 'MOOV', label: 'Moov Flooz', couleur: '#0066CC', fond: '#e8f0fe', emoji: '🔵' },
  { key: 'TMONEY', label: 'T-Money', couleur: '#E30613', fond: '#fde8ea', emoji: '🔴' },
];

const CATEGORIES = ['Achat intrants', 'Équipement', 'Formation', 'Transport', 'Cotisations', 'Autre'];

/** Le + du tab ouvre parfois cette pile sans historique → goBack() échoue. */
function retourDepuisNouvelleTransaction(navigation) {
  if (navigation?.canGoBack?.()) {
    navigation.goBack();
    return;
  }
  navigation.navigate('DashboardMain');
}

/**
 * Logs de diagnostic au clic sur « Enregistrer sur la Blockchain » / « Soumettre au Vote » :
 * comparer Firestore (président + utilisateur) avec le contrat (president(), membres(signer)).
 */
async function logDiagnosticEnregistrementTransaction({ coopId, profile }) {
  const tag = '[EnregistrerTransaction]';

  const firestoreActeur = profile
    ? {
        id: profile.uid ?? null,
        uid: profile.uid ?? null,
        nom: profile.nom ?? null,
        email: profile.email ?? null,
        role_brut_firestore: profile.role ?? null,
        roleCanonique: roleCanonique(profile.role),
        cooperativeId: profile.cooperativeId ?? coopId,
        statut: profile.statut ?? null,
        walletAddressFirestore: profile.walletAddress || null,
        telephone: profile.telephone ?? profile.phone ?? profile.tel ?? null,
      }
    : null;

  let presidentsFirestore = [];
  try {
    const pq = query(
      collection(db, 'users'),
      where('cooperativeId', '==', coopId),
      where('role', '==', 'president')
    );
    const psnap = await getDocs(pq);
    presidentsFirestore = psnap.docs.map((d) => {
      const p = d.data();
      return {
        id_document: d.id,
        uid: d.id,
        nom: p.nom ?? null,
        email: p.email ?? null,
        role: p.role ?? null,
        cooperativeId: p.cooperativeId ?? null,
        statut: p.statut ?? null,
        walletAddress: p.walletAddress || null,
        telephone: p.telephone ?? p.phone ?? p.tel ?? null,
        dateInscription: p.dateInscription ?? null,
      };
    });
  } catch (e) {
    console.warn(tag, 'Lecture président Firestore impossible:', e?.message ?? e);
  }

  let adresseSignerLocal = null;
  let lectureChaine = null;
  try {
    if (profile?.uid) {
      try {
        const w = await getWalletMembre(profile.uid);
        adresseSignerLocal = w.address;
      } catch {
        adresseSignerLocal = await getWalletAddress();
      }
    } else {
      adresseSignerLocal = await getWalletAddress();
    }
    if (!isContractConfigured()) {
      lectureChaine = {
        erreur:
          'Contrat non configuré (vérifie CONTRACT_ADDRESS dans src/config/contract.js).',
      };
    } else {
      const contract = getContractReadOnly();
      const prezOnChain = await contract.president();
      const m = await contract.membres(adresseSignerLocal);
      const roleNum = Number(m.role);
      lectureChaine = {
        presidentOnChain_address: prezOnChain,
        walletQuiSigne_laTransaction: adresseSignerLocal,
        membre_signer_via_membres_mapping: {
          wallet_chain: m.wallet,
          nom_chain: m.nom,
          role_num: roleNum,
          role_label: ROLES_CHAIN[roleNum] ?? String(roleNum),
          actif_chain: !!m.actif,
        },
        alignement: {
          president_fs_wallet_vs_chain:
            presidentsFirestore.length === 1 && presidentsFirestore[0].walletAddress
              ? String(presidentsFirestore[0].walletAddress).toLowerCase()
                === String(prezOnChain).toLowerCase()
              : null,
          signer_est_president_chain:
            String(adresseSignerLocal).toLowerCase() === String(prezOnChain).toLowerCase(),
        },
      };
    }
  } catch (e) {
    lectureChaine = { erreur_lecture: e?.message ?? String(e) };
  }

  console.log(`${tag} — diagnostic soumission transaction`);
  console.log(`${tag} cooperativeId utilisé:`, coopId);
  console.log(`${tag} utilisateur connecté (Firestore):`, JSON.stringify(firestoreActeur, null, 2));
  console.log(
    `${tag} président(s) dans Firestore (${presidentsFirestore.length} doc(s)): `,
    JSON.stringify(presidentsFirestore, null, 2)
  );
  console.log(`${tag} chaîne Polygon (contrat):`, JSON.stringify(lectureChaine, null, 2));
}

export default function NouvelleTransactionScreen({ userData, navigation, route }) {
  const profile = userData ?? route?.params?.userData ?? null;
  const [form, setForm] = useState({
    titre: '',
    montant: '',
    type: 'sortie',
    categorie: '',
    fournisseur: '',
    description: '',
    modePaiement: 'mobile_money',
    telephoneFournisseur: '',
    operateurMobile: 'MOOV',
    numeroCarte: '',
    dateExpirationCarte: '',
    cvvCarte: '',
    reseauPaiement: 'visa',
    sourceRevenu: 'cotisation_membre',
    payeurNom: '',
    telephonePayeur: '',
    membreCotisationUid: '',
  });
  const [membresCotisation, setMembresCotisation] = useState([]);
  const [justificatifUri, setJustificatifUri] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingJustificatif, setUploadingJustificatif] = useState(false);
  const [soldeDisponible, setSoldeDisponible] = useState(0);
  const [soldeLoading, setSoldeLoading] = useState(true);

  const { sendTransaction, loading } = useSendTransaction(profile?.uid);

  const update = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const montantNum = parseFloat(form.montant) || 0;
  const needsVote = montantNum >= 500000;
  const busy = loading || uploadingJustificatif;
  const depasseSolde = form.type === 'sortie' && !soldeLoading && montantNum > soldeDisponible;

  const peutCreerTransactions = peutCreerTransaction(profile);
  const roleManquant = Boolean(profile?.uid) && !profile?.role;

  useEffect(() => {
    if (!__DEV__) return;
    console.log('[NouvelleTransaction]', {
      uid: profile?.uid,
      roleBrut: profile?.role,
      roleCanonique: roleCanonique(profile?.role),
      peutCreer: peutCreerTransactions,
    });
  }, [profile?.uid, profile?.role, peutCreerTransactions]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setSoldeLoading(true);
        const coopId = profile?.cooperativeId || 'broukou';
        const solde = await calculerSolde(coopId);
        if (alive) setSoldeDisponible(solde);
      } catch {
        if (alive) setSoldeDisponible(0);
      } finally {
        if (alive) setSoldeLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [profile?.cooperativeId]);

  useEffect(() => {
    let alive = true;
    const coopId = profile?.cooperativeId || 'broukou';
    if (form.type !== 'entree') return undefined;
    (async () => {
      try {
        const list = await getMembresActifs(coopId);
        if (alive) setMembresCotisation(list);
      } catch {
        if (alive) setMembresCotisation([]);
      }
    })();
    return () => { alive = false; };
  }, [form.type, profile?.cooperativeId]);

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
    if (profile == null) {
      Alert.alert('Chargement', 'Ton profil est encore en cours de chargement. Réessaie dans un instant.');
      return;
    }
    if (!peutCreerTransactions) {
      Alert.alert(
        'Accès refusé',
        'Seuls le président et le trésorier\npeuvent créer des transactions.'
      );
      return;
    }
    if (!form.titre.trim()) return Alert.alert('Erreur', 'Entre le titre de la transaction.');
    if (!form.montant || montantNum <= 0) return Alert.alert('Erreur', 'Entre un montant valide.');
    if (justificatifUri && !profile?.uid) {
      return Alert.alert('Connexion requise', 'Connecte-toi pour joindre un justificatif (identifiant membre).');
    }

    if (form.type === 'sortie' && form.modePaiement === 'especes' && !justificatifUri) {
      return Alert.alert(
        'Erreur',
        '📸 Photo du reçu signé obligatoire pour un paiement en espèces.'
      );
    }

    if (form.type === 'sortie' && form.modePaiement === 'mobile_money') {
      if (!form.operateurMobile) {
        return Alert.alert('Erreur', 'Sélectionne Moov Flooz ou T-Money.');
      }
      const tel = form.telephoneFournisseur.trim();
      if (tel.length < 8) {
        return Alert.alert(
          'Erreur',
          'Indique le numéro Mobile Money du fournisseur pour ce mode de paiement.'
        );
      }
    }

    if (form.type === 'sortie' && form.modePaiement === 'virement') {
      const digits = form.numeroCarte.replace(/\D/g, '');
      if (digits.length < 16) {
        return Alert.alert('Erreur', 'Indique un numéro de carte à 16 chiffres (démo).');
      }
      if (!form.dateExpirationCarte.trim() || form.dateExpirationCarte.trim().length < 4) {
        return Alert.alert('Erreur', 'Indique la date d’expiration (MM/AA).');
      }
      if (!form.cvvCarte.trim() || form.cvvCarte.trim().length < 3) {
        return Alert.alert('Erreur', 'Indique le CVV (3 chiffres).');
      }
    }

    if (form.type === 'entree' && form.sourceRevenu === 'cotisation_membre' && !form.membreCotisationUid) {
      return Alert.alert('Erreur', 'Sélectionne le membre qui effectue la cotisation.');
    }
    if (form.type === 'entree' && form.sourceRevenu !== 'cotisation_membre' && !form.payeurNom.trim()) {
      return Alert.alert('Erreur', 'Indique le nom du payeur ou de la source du revenu.');
    }

    try {
      const coopId = profile?.cooperativeId || 'broukou';

      await logDiagnosticEnregistrementTransaction({ coopId, profile });

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

      const typeTxFirestore = form.type === 'sortie'
        ? 'depense'
        : form.sourceRevenu === 'cotisation_membre'
          ? 'cotisation'
          : form.sourceRevenu === 'vente_recolte'
            ? 'vente_recolte'
            : form.sourceRevenu === 'subvention'
              ? 'subvention'
              : 'remboursement';

      const { hash, transactionId, voteDeclenche } = await sendTransaction({
        titre: titreComplet,
        montant: montantNum,
        categorie: form.categorie || 'Autre',
        typeTransaction: form.type,
      });

      const hashCourt = `${hash.slice(0, 10)}...${hash.slice(-6)}`;
      const scanUrl = polygonscanTxUrl(hash);

      const dossierFirestore = {
        titre: titreComplet,
        montant: montantNum,
        type: form.type,
        statut: 'valide',
        date: Timestamp.fromDate(new Date()),
        creePar: profile?.uid || null,
        createurNom: profile?.nom || null,
        categorie: form.categorie || 'Autre',
        chainTransactionId: transactionId,
        polygonTxHash: hash,
        hash,
        cooperativeId: coopId,
        typeTransaction: typeTxFirestore,
        modePaiementFournisseur: form.type === 'sortie' ? form.modePaiement : null,
        telephoneFournisseur: form.type === 'sortie' ? (form.telephoneFournisseur.trim() || null) : null,
        operateurMobile:
          form.type === 'sortie' && form.modePaiement === 'mobile_money'
            ? form.operateurMobile
            : null,
        paiementVirementDemo:
          form.type === 'sortie' && form.modePaiement === 'virement'
            ? {
                reseau: form.reseauPaiement,
                derniers4: form.numeroCarte.replace(/\D/g, '').slice(-4),
              }
            : null,
        sourceRevenu: form.type === 'entree' ? form.sourceRevenu : null,
        payeurNom: form.type === 'entree' ? (form.payeurNom.trim() || null) : null,
        telephonePayeur: form.type === 'entree' ? (form.telephonePayeur.trim() || null) : null,
        membreCotisationUid:
          form.type === 'entree' && form.sourceRevenu === 'cotisation_membre'
            ? form.membreCotisationUid
            : null,
      };

      let justificatifOk = false;

      if (justificatifUri && profile && transactionId !== null && transactionId !== undefined) {
        setUploadingJustificatif(true);
        setUploadProgress(0);
        try {
          const payload = await uploadJustificatif(transactionId, profile, {
            existingUri: justificatifUri,
            onProgress: (pct) => setUploadProgress(pct),
          });

          if (payload?.url) {
            await setDoc(
              doc(db, 'transactions', `chain_${transactionId}`),
              {
                ...dossierFirestore,
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
          } else {
            await setDoc(
              doc(db, 'transactions', `chain_${transactionId}`),
              dossierFirestore,
              { merge: true }
            );
          }
        } catch (uploadErr) {
          Alert.alert(
            'Justificatif',
            uploadErr.message
              || 'Erreur réseau ou Cloudinary. La transaction est bien sur Polygon, mais le justificatif n’a pas été enregistré.'
          );
          try {
            await setDoc(
              doc(db, 'transactions', `chain_${transactionId}`),
              dossierFirestore,
              { merge: true }
            );
          } catch (_) {
            /* ignore */
          }
        } finally {
          setUploadingJustificatif(false);
          setUploadProgress(0);
        }
      } else if (transactionId !== null && transactionId !== undefined) {
        await setDoc(
          doc(db, 'transactions', `chain_${transactionId}`),
          dossierFirestore,
          { merge: true }
        );
      } else if (justificatifUri) {
        Alert.alert(
          'Justificatif',
          'La transaction est confirmée sur Polygon, mais l’identifiant interne n’a pas été retrouvé : le justificatif n’a pas été lié dans l’app. Tu peux réessayer plus tard depuis une mise à jour.'
        );
      }

      try {
        const membresSnap = await getDocs(
          query(
            collection(db, 'users'),
            where('cooperativeId', '==', coopId),
            where('statut', '==', 'actif')
          )
        );
        const tokens = membresSnap.docs
          .map((d) => d.data().expoPushToken)
          .filter(Boolean);

        const depasse = voteDeclenche || montantNum >= 500000;

        await envoyerNotifPush({
          tokens,
          titre: depasse
            ? '🗳️ Vote requis !'
            : '💰 Nouvelle transaction',
          message: depasse
            ? `${form.titre} — ${Math.round(montantNum).toLocaleString('fr-FR')} FCFA\nUn vote a été déclenché.`
            : `${form.titre} — ${Math.round(montantNum).toLocaleString('fr-FR')} FCFA`,
          data: {
            type: depasse ? 'NEW_VOTE' : 'NEW_TRANSACTION',
            cooperativeId: coopId,
          },
        });
      } catch (notifErr) {
        console.log('Notif error:', notifErr);
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
            { text: 'OK', onPress: () => retourDepuisNouvelleTransaction(navigation) },
          ]
        );
      } else {
        Alert.alert(
          '✅ Transaction enregistrée !',
          baseMsg + suffix,
          [
            { text: 'Voir sur Polygonscan', onPress: () => Linking.openURL(scanUrl) },
            { text: 'OK', onPress: () => retourDepuisNouvelleTransaction(navigation) },
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

  if (profile == null || roleManquant) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#f8fafc',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <ActivityIndicator size="large" color={GREEN} />
        <Text
          style={{
            marginTop: 16,
            fontSize: 15,
            fontWeight: '600',
            color: '#475569',
            textAlign: 'center',
          }}
        >
          {roleManquant
            ? 'Profil incomplet (rôle manquant). Contactez le président.'
            : 'Chargement du profil…'}
        </Text>
      </View>
    );
  }

  if (!peutCreerTransactions) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#f8fafc',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Text style={{ fontSize: 48 }}>🚫</Text>
        <Text
          style={{
            fontSize: 18,
            fontWeight: '800',
            color: '#374151',
            marginTop: 16,
            textAlign: 'center',
          }}
        >
          Accès réservé
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: '#6b7280',
            marginTop: 8,
            textAlign: 'center',
          }}
        >
          Seuls le trésorier et le président peuvent créer des transactions.
        </Text>
        {__DEV__ ? (
          <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 12, textAlign: 'center' }}>
            Rôle Firestore : {String(profile.role)} → {roleCanonique(profile.role) || '(inconnu)'}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={{ padding: 20 }}>
        {peutCreerTransactions && (
          <TouchableOpacity
            style={styles.appelBtn}
            onPress={() => navigation.navigate('AppelDeFonds', { userData: profile })}
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

        {form.type === 'entree' ? (
          <View style={styles.revenuSection}>
            <Text style={styles.label}>SOURCE DU REVENU</Text>
            <View style={styles.paymentModeRow}>
              {[
                { key: 'cotisation_membre', emoji: '💰', label: 'Cotisation membre' },
                { key: 'vente_recolte', emoji: '🌾', label: 'Vente récolte' },
                { key: 'subvention', emoji: '🏛️', label: 'Subvention / Don' },
                { key: 'remboursement', emoji: '🔄', label: 'Remboursement' },
              ].map((src) => (
                <TouchableOpacity
                  key={src.key}
                  style={[
                    styles.paymentModeBtn,
                    form.sourceRevenu === src.key && styles.paymentModeBtnActive,
                  ]}
                  onPress={() => update('sourceRevenu', src.key)}
                >
                  <Text style={styles.paymentModeEmoji}>{src.emoji}</Text>
                  <Text
                    style={[
                      styles.paymentModeText,
                      form.sourceRevenu === src.key && styles.paymentModeTextActive,
                    ]}
                  >
                    {src.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {form.sourceRevenu === 'cotisation_membre' ? (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.label}>MEMBRE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  {membresCotisation.map((m) => {
                    const uid = m.uid || m.id;
                    const sel = form.membreCotisationUid === uid;
                    return (
                      <TouchableOpacity
                        key={uid}
                        style={[styles.membreChip, sel && styles.membreChipActive]}
                        onPress={() => {
                          update('membreCotisationUid', uid);
                          update('payeurNom', m.nom || '');
                        }}
                      >
                        <Text style={[styles.membreChipText, sel && styles.membreChipTextActive]}>
                          {m.nom || 'Membre'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <>
                <Text style={styles.label}>PAYEUR / SOURCE</Text>
                <View style={styles.inputBox}>
                  <TextInput
                    style={styles.input}
                    placeholder="Nom acheteur, ONG, etc."
                    placeholderTextColor="#9ca3af"
                    value={form.payeurNom}
                    onChangeText={(v) => update('payeurNom', v)}
                  />
                </View>
                <Text style={styles.label}>NUMÉRO MOBILE MONEY DU PAYEUR</Text>
                <View style={styles.inputBox}>
                  <TextInput
                    style={styles.input}
                    placeholder="+228 90 XX XX XX"
                    placeholderTextColor="#9ca3af"
                    value={form.telephonePayeur}
                    onChangeText={(v) => update('telephonePayeur', v)}
                    keyboardType="phone-pad"
                  />
                </View>
                <Text style={styles.hintSmall}>
                  Pour FedaPay : collecte après validation du vote si montant élevé.
                </Text>
              </>
            )}
          </View>
        ) : null}

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

        {form.type === 'sortie' ? (
          <View style={styles.paymentSection}>
            <Text style={styles.sectionTitle}>💸 Paiement au fournisseur</Text>
            <Text style={styles.sectionSubtitle}>
              Comment voulez-vous payer le fournisseur ?
            </Text>
            <View style={styles.paymentModeRow}>
              {[
                { key: 'mobile_money', emoji: '📱', label: 'Mobile Money' },
                { key: 'especes', emoji: '💵', label: 'Espèces' },
                { key: 'virement', emoji: '🏦', label: 'Virement' },
              ].map((mode) => (
                <TouchableOpacity
                  key={mode.key}
                  style={[
                    styles.paymentModeBtn,
                    form.modePaiement === mode.key && styles.paymentModeBtnActive,
                  ]}
                  onPress={() => update('modePaiement', mode.key)}
                >
                  <Text style={styles.paymentModeEmoji}>{mode.emoji}</Text>
                  <Text
                    style={[
                      styles.paymentModeText,
                      form.modePaiement === mode.key && styles.paymentModeTextActive,
                    ]}
                  >
                    {mode.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {form.modePaiement === 'mobile_money' ? (
              <View>
                <Text style={styles.label}>OPÉRATEUR</Text>
                <View style={styles.paymentModeRow}>
                  {OPERATEURS_DEPENSE.map((op) => (
                    <TouchableOpacity
                      key={op.key}
                      style={[
                        styles.operateurDepenseCard,
                        { backgroundColor: op.fond, borderColor: form.operateurMobile === op.key ? op.couleur : `${op.couleur}44` },
                        form.operateurMobile === op.key && { borderWidth: 2.5 },
                      ]}
                      onPress={() => update('operateurMobile', op.key)}
                    >
                      <Text style={styles.paymentModeEmoji}>{op.emoji}</Text>
                      <Text style={[styles.operateurDepenseLabel, { color: op.couleur }]}>{op.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.label}>NUMÉRO MOBILE MONEY DU FOURNISSEUR</Text>
                <View style={styles.inputBox}>
                  <TextInput
                    style={styles.input}
                    placeholder="+228 90 XX XX XX"
                    placeholderTextColor="#9ca3af"
                    value={form.telephoneFournisseur}
                    onChangeText={(v) => update('telephoneFournisseur', v)}
                    keyboardType="phone-pad"
                  />
                </View>
                <Text style={styles.hintSmall}>
                  Paiement simulé en démo (FedaPay). Flooz / T-Money : couleurs indicatives.
                </Text>
              </View>
            ) : null}

            {form.modePaiement === 'virement' ? (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.hintSmallOrange}>
                  Virement simulé pour la démo — aucune donnée bancaire réelle n’est transmise.
                </Text>
                <Text style={styles.label}>NUMÉRO DE CARTE (16 chiffres)</Text>
                <View style={styles.inputBox}>
                  <TextInput
                    style={styles.input}
                    placeholder="0000 0000 0000 0000"
                    placeholderTextColor="#9ca3af"
                    keyboardType="number-pad"
                    maxLength={19}
                    value={form.numeroCarte}
                    onChangeText={(v) => update('numeroCarte', v)}
                  />
                </View>
                <Text style={styles.label}>EXPIRATION (MM/AA)</Text>
                <View style={styles.inputBox}>
                  <TextInput
                    style={styles.input}
                    placeholder="12/28"
                    placeholderTextColor="#9ca3af"
                    value={form.dateExpirationCarte}
                    onChangeText={(v) => update('dateExpirationCarte', v)}
                  />
                </View>
                <Text style={styles.label}>CVV</Text>
                <View style={styles.inputBox}>
                  <TextInput
                    style={styles.input}
                    placeholder="•••"
                    placeholderTextColor="#9ca3af"
                    secureTextEntry
                    keyboardType="number-pad"
                    maxLength={3}
                    value={form.cvvCarte}
                    onChangeText={(v) => update('cvvCarte', v)}
                  />
                </View>
                <Text style={styles.label}>RÉSEAU</Text>
                <View style={styles.paymentModeRow}>
                  {[
                    { key: 'visa', label: 'Visa' },
                    { key: 'mastercard', label: 'Mastercard' },
                    { key: 'paypal', label: 'PayPal' },
                  ].map((r) => (
                    <TouchableOpacity
                      key={r.key}
                      style={[
                        styles.paymentModeBtn,
                        form.reseauPaiement === r.key && styles.paymentModeBtnActive,
                      ]}
                      onPress={() => update('reseauPaiement', r.key)}
                    >
                      <Text
                        style={[
                          styles.paymentModeText,
                          form.reseauPaiement === r.key && styles.paymentModeTextActive,
                        ]}
                      >
                        {r.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {form.modePaiement === 'especes' ? (
              <View style={styles.especesEncart}>
                <Text style={styles.especesEncartText}>
                  📸 Photo du reçu signé obligatoire — joignez le justificatif ci-dessous avant d’enregistrer.
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

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
  paymentSection: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: GREEN_DARK, marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: '#4b5563', marginBottom: 4 },
  revenuSection: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  paymentModeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 12,
  },
  paymentModeBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: '28%',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    backgroundColor: 'white',
  },
  paymentModeBtnActive: {
    borderColor: '#15803d',
    backgroundColor: '#f0fdf4',
  },
  paymentModeEmoji: { fontSize: 20 },
  paymentModeText: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center',
  },
  paymentModeTextActive: {
    color: '#15803d',
    fontWeight: '700',
  },
  hintSmall: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  hintSmallOrange: {
    fontSize: 12,
    color: '#b45309',
    marginBottom: 8,
    lineHeight: 17,
    fontWeight: '600',
  },
  operateurDepenseCard: {
    flex: 1,
    minWidth: '44%',
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  operateurDepenseLabel: { fontSize: 13, fontWeight: '800', marginTop: 6, textAlign: 'center' },
  especesEncart: {
    backgroundColor: '#fef3c7',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  especesEncartText: { color: '#92400e', fontSize: 13 },
  membreChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    marginRight: 8,
  },
  membreChipActive: { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  membreChipText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  membreChipTextActive: { color: GREEN_DARK, fontWeight: '800' },
});
