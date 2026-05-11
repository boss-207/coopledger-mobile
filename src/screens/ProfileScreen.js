import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Linking,
  Share,
  ActivityIndicator,
} from 'react-native';
import { signOut } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { useVotes } from '../hooks/useBlockchain';
import { quitterCooperative } from '../utils/getMembresActifs';
import {
  getWalletAddress,
  importWalletFromPrivateKey,
  isContractConfigured,
  polygonscanAddressUrl,
} from '../config/blockchain';
import { CONTRACT_ADDRESS } from '../config/contract';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';

const COOP_NOM_AFFICHE = 'CTA de Broukou';

/** Vote Firestore ouvert où ce membre est censé pouvoir participer (hors cas « son propre transfert »). */
function membreDoitVoterSurCeVote(uid, vote) {
  if (!vote || vote.statut !== 'ouvert') return false;
  if (vote.type === 'transfert_presidence' && uid === vote.ancienRoleUid) return false;
  if (vote.type === 'transfert_tresorier' && uid === vote.ancienRoleUid) return false;
  return true;
}

export default function ProfileScreen({ userData }) {
  const { votes: votesPolygonFinanciers } = useVotes();
  const roleColors = { president: '#7c3aed', tresorier: '#2563eb', membre: GREEN };
  const roleLabels = { president: '🛡️ Président', tresorier: '🏦 Trésorier', membre: '👤 Membre' };
  const roleColor = roleColors[userData?.role] || GREEN;

  const [walletAddress, setWalletAddress] = useState(null);
  const [modalImport, setModalImport] = useState(false);
  const [pkInput, setPkInput] = useState('');
  const [importLoading, setImportLoading] = useState(false);

  const [telephoneInput, setTelephoneInput] = useState('');
  const [telephoneSaveLoading, setTelephoneSaveLoading] = useState(false);
  const [bloqueParVoteFirestore, setBloqueParVoteFirestore] = useState(false);
  const [quitterLoading, setQuitterLoading] = useState(false);

  const contractOk = isContractConfigured();
  const coopId = userData?.cooperativeId || 'broukou';

  useEffect(() => {
    if (!userData?.uid) {
      setBloqueParVoteFirestore(false);
      return;
    }
    const openVotesQ = query(
      collection(db, 'votes'),
      where('cooperativeId', '==', coopId),
      where('statut', '==', 'ouvert')
    );
    const unsub = onSnapshot(openVotesQ, (snap) => {
      const uid = userData.uid;
      let blocked = false;
      snap.docs.forEach((d) => {
        const v = d.data();
        if (membreDoitVoterSurCeVote(uid, { ...v, statut: 'ouvert' })) blocked = true;
      });
      setBloqueParVoteFirestore(blocked);
    }, () => setBloqueParVoteFirestore(false));
    return () => unsub();
  }, [userData?.uid, coopId]);

  useEffect(() => {
    getWalletAddress()
      .then(setWalletAddress)
      .catch(() => setWalletAddress(null));
  }, []);

  useEffect(() => {
    setTelephoneInput(userData?.telephone || '');
  }, [userData?.telephone]);

  /** E.164 international : + puis indicatif pays (ex. +228…) */
  function validateTelephoneE164(value) {
    const trimmed = String(value || '').trim().replace(/\s/g, '');
    if (!trimmed) return { ok: false, message: 'Indique un numéro ou laisse vide.' };
    if (!trimmed.startsWith('+')) {
      return { ok: false, message: 'Le numéro doit commencer par + (format international).' };
    }
    if (!/^\+[1-9]\d{7,14}$/.test(trimmed)) {
      return {
        ok: false,
        message: 'Format invalide. Exemple : +22890123456 (8 à 15 chiffres après le +).',
      };
    }
    return { ok: true, value: trimmed };
  }

  async function sauvegarderTelephone() {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert('Erreur', 'Tu dois être connecté.');
      return;
    }
    const raw = telephoneInput.trim();
    if (!raw) {
      setTelephoneSaveLoading(true);
      try {
        await updateDoc(doc(db, 'users', uid), { telephone: null });
        Alert.alert('Enregistré', 'Numéro retiré du profil.');
      } catch (e) {
        Alert.alert('Erreur', e.message || 'Sauvegarde impossible.');
      }
      setTelephoneSaveLoading(false);
      return;
    }
    const check = validateTelephoneE164(raw);
    if (!check.ok) {
      Alert.alert('Numéro invalide', check.message);
      return;
    }
    setTelephoneSaveLoading(true);
    try {
      await updateDoc(doc(db, 'users', uid), { telephone: check.value });
      Alert.alert('Enregistré', 'Ton numéro WhatsApp / SMS a été sauvegardé (format international).');
    } catch (e) {
      Alert.alert('Erreur', e.message || 'Sauvegarde impossible.');
    }
    setTelephoneSaveLoading(false);
  }

  const peutAfficherQuitterCoop =
    userData?.role !== 'president' &&
    userData?.role !== 'tresorier';

  function handleQuitterCooperative() {
    if (userData?.role === 'president') {
      Alert.alert(
        'Départ impossible',
        'Le président ne peut pas quitter. Transférez d’abord la présidence.'
      );
      return;
    }
    if (userData?.role === 'tresorier') {
      Alert.alert(
        'Départ impossible',
        'Le trésorier ne peut pas quitter. Le président doit d’abord nommer un nouveau trésorier.'
      );
      return;
    }
    const doitPolygon = Array.isArray(votesPolygonFinanciers) && votesPolygonFinanciers.length > 0;
    if (doitPolygon || bloqueParVoteFirestore) {
      Alert.alert(
        'Vote en cours',
        'Vous ne pouvez pas quitter pendant un vote en cours.'
      );
      return;
    }

    const uid = auth.currentUser?.uid;
    const nom = userData?.nom || 'Membre';
    if (!uid) {
      Alert.alert('Erreur', 'Tu dois être connecté.');
      return;
    }

    Alert.alert(
      'Quitter la coopérative',
      `Êtes-vous sûr de vouloir quitter la coopérative ${COOP_NOM_AFFICHE} ? Vous perdrez accès à l’application.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Continuer',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Dernière confirmation',
              'Cette action est définitive. Seul le président pourra vous réintégrer. Confirmer le départ ?',
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Confirmer le départ',
                  style: 'destructive',
                  onPress: async () => {
                    setQuitterLoading(true);
                    try {
                      await quitterCooperative(uid);
                      await signOut(auth);
                      Alert.alert(
                        'Au revoir',
                        `Vous avez quitté la coopérative. Au revoir ${nom} 👋`
                      );
                    } catch (e) {
                      Alert.alert('Erreur', e?.message || 'Impossible de finaliser le départ.');
                    }
                    setQuitterLoading(false);
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }

  function handleDeconnexion() {
    Alert.alert(
      'Déconnexion',
      'Veux-tu vraiment te déconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Déconnexion', style: 'destructive', onPress: () => signOut(auth) },
      ]
    );
  }

  async function partagerAdresse() {
    if (!walletAddress) return;
    await Share.share({ message: walletAddress });
  }

  async function confirmerImportCle() {
    if (!pkInput.trim()) {
      Alert.alert('Erreur', 'Colle ta clé privée (format 0x…).');
      return;
    }
    setImportLoading(true);
    try {
      const addr = await importWalletFromPrivateKey(pkInput);
      setWalletAddress(addr);
      setPkInput('');
      setModalImport(false);
      Alert.alert(
        'Wallet mis à jour',
        `L’app utilise maintenant l’adresse :\n${addr}\n\nDemande du MATIC test sur ce compte si besoin.`
      );
    } catch (e) {
      Alert.alert('Erreur', e.message || 'Import impossible.');
    }
    setImportLoading(false);
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Modal visible={modalImport} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Importer une clé privée</Text>
            <Text style={styles.modalWarn}>
              ⚠️ N’utilise que ton propre téléphone. Ne donne jamais cette clé à personne. Si tu colles la clé du même compte que MetaMask Amoy, l’app pourra signer comme ce compte.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="0x… ou 64 caractères hex"
              placeholderTextColor="#9ca3af"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={pkInput}
              onChangeText={setPkInput}
            />
            <TouchableOpacity
              style={[styles.modalBtn, importLoading && { opacity: 0.6 }]}
              onPress={confirmerImportCle}
              disabled={importLoading}
            >
              {importLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalBtnText}>Enregistrer</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancel} onPress={() => { setModalImport(false); setPkInput(''); }}>
              <Text style={styles.modalCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* HEADER PROFIL */}
      <View style={styles.headerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {userData?.nom?.charAt(0)?.toUpperCase() || '?'}
          </Text>
        </View>
        <Text style={styles.nom}>{userData?.nom || 'Membre'}</Text>
        <Text style={styles.email}>{userData?.email}</Text>
        <View style={[styles.roleBadge, { backgroundColor: roleColor + '25' }]}>
          <Text style={[styles.roleText, { color: roleColor }]}>
            {roleLabels[userData?.role] || userData?.role}
          </Text>
        </View>
      </View>

      {/* WALLET POLYGON + CONTRAT */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>⛓️ Polygon Amoy — étapes</Text>
        <Text style={styles.helpText}>
          1) Déploie le contrat sur ton PC avec Hardhat (voir README ou commentaires dans{' '}
          <Text style={{ fontFamily: 'monospace' }}>src/config/contract.js</Text>).{'\n'}
          2) Le même compte que MetaMask utilisé au déploiement est le président on-chain.{'\n'}
          3) Sur le téléphone : ton wallet CoopLedger peut être différent de MetaMask — utilise « Importer MetaMask » pour coller la même clé que sur MetaMask (Amoy).{'\n'}
          4) Envoie du MATIC test sur l’adresse affichée ci-dessous :{' '}
          <Text style={{ color: GREEN, fontWeight: '700' }} onPress={() => Linking.openURL('https://faucet.polygon.technology')}>
            faucet.polygon.technology
          </Text>
        </Text>

        <InfoRow
          icon="📜"
          label="Contrat"
          value={contractOk ? `${CONTRACT_ADDRESS.slice(0, 10)}…` : 'Non déployé'}
        />
        {contractOk && (
          <TouchableOpacity
            onPress={() => Linking.openURL(polygonscanAddressUrl(CONTRACT_ADDRESS))}
            style={{ alignSelf: 'flex-end', marginBottom: 8 }}
          >
            <Text style={{ color: GREEN, fontWeight: '600', fontSize: 13 }}>Voir sur Polygonscan →</Text>
          </TouchableOpacity>
        )}
        {!contractOk && (
          <Text style={styles.warnBanner}>
            Mets à jour CONTRACT_ADDRESS dans src/config/contract.js après{' '}
            <Text style={{ fontFamily: 'monospace' }}>npx hardhat run scripts/deploy.js --network amoy</Text>
          </Text>
        )}

        <InfoRow
          icon="👛"
          label="Wallet app"
          value={walletAddress ? `${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)}` : '…'}
        />
        {walletAddress && (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <TouchableOpacity style={styles.smallBtn} onPress={partagerAdresse}>
              <Text style={styles.smallBtnText}>Partager l’adresse</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtn} onPress={() => Linking.openURL(polygonscanAddressUrl(walletAddress))}>
              <Text style={styles.smallBtnText}>Polygonscan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.smallBtn, styles.smallBtnOutline]} onPress={() => setModalImport(true)}>
              <Text style={[styles.smallBtnText, { color: GREEN }]}>Importer MetaMask</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* INFOS COOPÉRATIVE */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🌱 Ma Coopérative</Text>
        <InfoRow icon="🏛️" label="Nom" value={COOP_NOM_AFFICHE} />
        <InfoRow icon="📍" label="Localisation" value="Préfecture de Doufelgou, Région de la Kara" />
        <InfoRow icon="⛓️" label="Blockchain" value="Polygon Amoy (testnet)" />
      </View>

      {/* INFOS COMPTE */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>👤 Mon Compte</Text>
        <InfoRow icon="✉️" label="Email" value={userData?.email || '-'} />
        <Text style={styles.phoneHelp}>
          Numéro WhatsApp / SMS (international, ex. +22890123456). Utilisé pour les alertes de vote.
        </Text>
        <TextInput
          style={styles.phoneInput}
          placeholder="+22890123456"
          placeholderTextColor="#9ca3af"
          keyboardType="phone-pad"
          autoCapitalize="none"
          autoCorrect={false}
          value={telephoneInput}
          onChangeText={setTelephoneInput}
        />
        <TouchableOpacity
          style={[styles.smallBtn, telephoneSaveLoading && { opacity: 0.65 }, { alignSelf: 'flex-start', marginTop: 10 }]}
          onPress={sauvegarderTelephone}
          disabled={telephoneSaveLoading}
        >
          {telephoneSaveLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.smallBtnText}>Enregistrer le numéro</Text>
          )}
        </TouchableOpacity>
        <InfoRow icon="🏷️" label="Rôle (Firebase)" value={roleLabels[userData?.role] || userData?.role} />
        <InfoRow icon="🆔" label="UID" value={userData?.uid?.slice(0, 12) + '...' || '-'} />
        <InfoRow icon="📅" label="Membre depuis" value={
          userData?.dateInscription?.toDate
            ? userData.dateInscription.toDate().toLocaleDateString('fr-FR')
            : 'Récemment'
        } />
      </View>

      {/* BLOCKCHAIN INFO */}
      <View style={[styles.section, { backgroundColor: GREEN_DARK }]}>
        <Text style={[styles.sectionTitle, { color: '#86efac', borderBottomColor: 'rgba(255,255,255,0.1)' }]}>
          Réseau test
        </Text>
        <InfoRow icon="🌐" label="RPC" value="rpc-amoy.polygon.technology" dark />
        <InfoRow icon="🆔" label="Chain ID" value="80002" dark />
      </View>

      {peutAfficherQuitterCoop ? (
        <TouchableOpacity
          style={[styles.quitCoopBtn, quitterLoading && { opacity: 0.65 }]}
          onPress={handleQuitterCooperative}
          disabled={quitterLoading}
        >
          {quitterLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.quitCoopText}>🚪 Quitter la coopérative</Text>
          )}
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity style={styles.deconnexionBtn} onPress={handleDeconnexion}>
        <Text style={styles.deconnexionText}>🚪  Se déconnecter</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>CoopLedger · Polygon Amoy</Text>
      </View>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

function InfoRow({ icon, label, value, dark }) {
  return (
    <View style={styles.infoRow}>
      <Text style={{ fontSize: 18, marginRight: 10 }}>{icon}</Text>
      <Text style={[styles.infoLabel, dark && { color: 'rgba(255,255,255,0.5)' }]}>{label}</Text>
      <Text style={[styles.infoValue, dark && { color: '#fff' }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

  headerCard: {
    backgroundColor: GREEN_DARK, alignItems: 'center',
    paddingTop: 40, paddingBottom: 30, paddingHorizontal: 20,
  },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: GREEN, justifyContent: 'center',
    alignItems: 'center', marginBottom: 14,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)',
  },
  avatarText: { fontSize: 36, fontWeight: '900', color: '#fff' },
  nom: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 4 },
  email: { fontSize: 14, color: 'rgba(255,255,255,0.6)', marginBottom: 14 },
  roleBadge: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  roleText: { fontSize: 14, fontWeight: '700' },

  section: {
    margin: 16, marginBottom: 0, backgroundColor: '#fff',
    borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, elevation: 3,
  },
  sectionTitle: {
    fontSize: 16, fontWeight: '800', color: '#111827',
    marginBottom: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  helpText: {
    fontSize: 13, color: '#4b5563', lineHeight: 20, marginBottom: 14,
  },
  warnBanner: {
    fontSize: 12, color: '#92400e', backgroundColor: '#fffbeb',
    padding: 10, borderRadius: 10, marginBottom: 10,
  },
  phoneHelp: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 17,
    marginBottom: 8,
    marginTop: 4,
  },
  phoneInput: {
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f9fafb',
  },
  infoLabel: { fontSize: 13, color: '#6b7280', width: 88 },
  infoValue: { flex: 1, fontSize: 13, fontWeight: '600', color: '#111827', textAlign: 'right' },

  smallBtn: {
    backgroundColor: GREEN, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
  },
  smallBtnOutline: {
    backgroundColor: '#fff', borderWidth: 2, borderColor: GREEN,
  },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24,
  },
  modalBox: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  modalWarn: { fontSize: 12, color: '#92400e', marginBottom: 12, lineHeight: 18 },
  modalInput: {
    borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 12,
    padding: 14, fontFamily: 'monospace', fontSize: 13, marginBottom: 14,
  },
  modalBtn: {
    backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontWeight: '800' },
  modalCancel: { marginTop: 12, alignItems: 'center', padding: 8 },
  modalCancelText: { color: '#6b7280', fontWeight: '600' },

  quitCoopBtn: {
    marginHorizontal: 16,
    marginBottom: 0,
    backgroundColor: '#b91c1c',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  quitCoopText: { fontSize: 16, fontWeight: '800', color: '#fff' },

  deconnexionBtn: {
    margin: 16, backgroundColor: '#fff', borderWidth: 2,
    borderColor: '#dc2626', borderRadius: 16, paddingVertical: 16,
    alignItems: 'center',
  },
  deconnexionText: { fontSize: 16, fontWeight: '700', color: '#dc2626' },

  footer: { alignItems: 'center', paddingVertical: 20, gap: 4 },
  footerText: { fontSize: 12, color: '#9ca3af' },
});
