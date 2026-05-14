import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import {
  collection,
  doc,
  addDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth';
import { deleteApp, initializeApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ethers } from 'ethers';
import * as Clipboard from 'expo-clipboard';
import { auth, db, firebaseConfig } from '../config/firebase';
import { useVotes } from '../hooks/useBlockchain';
import {
  getNombreMembres,
  getStatsMembres,
  exclureMembre,
  reintegrerMembre,
} from '../utils/getMembresActifs';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';
const ROLE_COLORS = {
  president: '#7c3aed',
  tresorier: '#2563eb',
  membre: '#15803d',
  institution: '#14532d',
};
const ROLE_LABELS = {
  president: 'Président',
  tresorier: 'Trésorier',
  membre: 'Membre',
  institution: 'Institution',
};
const INSTITUTION_TYPES = ['Banque', 'Organisation internationale', 'Ministère', 'ONG', 'Autre'];

function formatDate(value) {
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getInitiales(nom) {
  if (!nom) return '?';
  const parts = nom.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('');
}

function statutMembreLabel(statut) {
  if (statut === 'exclu') return 'Exclu';
  if (statut === 'inactif') return 'Inactif';
  return 'Actif';
}

function dotCouleurStatut(statut) {
  if (statut === 'exclu') return '#dc2626';
  if (statut === 'inactif') return '#6b7280';
  return '#22c55e';
}

function formatDateHeure(value) {
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function creerCompteInstitution(email, motDePasse) {
  const appName = `secondary_${Date.now()}`;
  const appSecondaire = initializeApp(firebaseConfig, appName);
  const authSecondaire = getAuth(appSecondaire);
  try {
    const cred = await createUserWithEmailAndPassword(authSecondaire, email, motDePasse);
    const uid = cred.user.uid;
    await authSecondaire.signOut();
    await deleteApp(appSecondaire);
    return { success: true, uid };
  } catch (err) {
    try {
      await deleteApp(appSecondaire);
    } catch (_) {
      /* ignore */
    }
    return { success: false, error: err?.code || err?.message };
  }
}

function generateTempPassword(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let pwd = '';
  for (let i = 0; i < length; i += 1) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

function MemberRow({
  member,
  voteCount,
  isPresidentRow,
  canManage,
  onPressExclure,
  onPressReintegrer,
  showExclure,
  showReintegrer,
}) {
  const st = member.statut;
  const labelStatut = statutMembreLabel(st);

  return (
    <View style={styles.memberCard}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{getInitiales(member.nom)}</Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.memberName}>{member.nom || 'Membre'}</Text>
        {member.email ? (
          <Text style={styles.memberEmail} numberOfLines={1}>{member.email}</Text>
        ) : null}
        <Text style={styles.metaText}>Inscrit le {formatDate(member.dateInscription)}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.dot, { backgroundColor: dotCouleurStatut(st) }]} />
          <Text style={styles.metaText}>
            {labelStatut}
            {st === 'actif' || !st ? ' ✅' : st === 'inactif' ? ' ⚫' : ' ❌'}
          </Text>
          <Text style={styles.voteCountText}>Votes: {voteCount}</Text>
        </View>
      </View>

      {canManage && !isPresidentRow ? (
        <View style={styles.actionsCol}>
          {showExclure ? (
            <TouchableOpacity style={styles.removeBtn} onPress={() => onPressExclure(member)}>
              <Text style={styles.removeBtnText}>🚫 Exclure</Text>
            </TouchableOpacity>
          ) : null}
          {showReintegrer ? (
            <TouchableOpacity style={styles.reintegreBtn} onPress={() => onPressReintegrer(member)}>
              <Text style={styles.reintegreBtnText}>✅ Réintégrer</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function membreDoitVoterSurCeVote(uid, vote) {
  if (!vote || vote.statut !== 'ouvert') return false;
  if (vote.type === 'transfert_presidence' && uid === vote.ancienRoleUid) return false;
  if (vote.type === 'transfert_tresorier' && uid === vote.ancienRoleUid) return false;
  return true;
}

export default function MembresScreen({ userData, navigation }) {
  const { votes: votesPolygonOuverts } = useVotes();
  const [users, setUsers] = useState([]);
  const [votesByUser, setVotesByUser] = useState({});
  const [openVotesCount, setOpenVotesCount] = useState(0);
  const [openVotesList, setOpenVotesList] = useState([]);
  const [openTransferCount, setOpenTransferCount] = useState(0);
  const [openFinancialCount, setOpenFinancialCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [memberFilter, setMemberFilter] = useState('actifs');

  const [excludeModalVisible, setExcludeModalVisible] = useState(false);
  const [excludeTarget, setExcludeTarget] = useState(null);
  const [excludeRaison, setExcludeRaison] = useState('');

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);

  const [newNom, setNewNom] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [demandesEnAttente, setDemandesEnAttente] = useState([]);
  const [validationModalVisible, setValidationModalVisible] = useState(false);
  const [demandeAValider, setDemandeAValider] = useState(null);
  const [roleValidation, setRoleValidation] = useState('membre');
  const [refusModalVisible, setRefusModalVisible] = useState(false);
  const [demandeARefuser, setDemandeARefuser] = useState(null);
  const [raisonRefus, setRaisonRefus] = useState('');
  const [institutionModalVisible, setInstitutionModalVisible] = useState(false);
  const [institutionNom, setInstitutionNom] = useState('');
  const [institutionEmail, setInstitutionEmail] = useState('');
  const [institutionType, setInstitutionType] = useState('Banque');
  const [institutionTempPassword, setInstitutionTempPassword] = useState('');
  const [statsMembres, setStatsMembres] = useState({
    totalMembres: 0,
    totalInstitutions: 0,
    total: 0,
    label: '',
  });
  const [institutionMdpCopie, setInstitutionMdpCopie] = useState(false);

  // Transferts par vote (président uniquement)
  const [modalPickPresident, setModalPickPresident] = useState(false);
  const [modalPickTresorier, setModalPickTresorier] = useState(false);
  const [candidatePresidentId, setCandidatePresidentId] = useState(null);
  const [candidateTresorierId, setCandidateTresorierId] = useState(null);
  const [raisonPresident, setRaisonPresident] = useState('');
  const [raisonTresorier, setRaisonTresorier] = useState('');

  const canManage = userData?.role === 'president';
  const coopId = userData?.cooperativeId || 'broukou';

  useEffect(() => {
    const usersQ = query(collection(db, 'users'), where('cooperativeId', '==', coopId));
    const unsubUsers = onSnapshot(
      usersQ,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setUsers(list);
        setLoading(false);
        setError(null);
        getStatsMembres(coopId).then(setStatsMembres);
      },
      () => {
        setError('Impossible de charger les membres. Vérifie la connexion Firestore.');
        setLoading(false);
      }
    );

    const unsubBulletins = onSnapshot(
      collection(db, 'bulletins_vote'),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          const uid = data.userId;
          if (!uid) return;
          map[uid] = (map[uid] || 0) + 1;
        });
        setVotesByUser(map);
      },
      () => {}
    );

    const openVotesQ = query(
      collection(db, 'votes'),
      where('cooperativeId', '==', coopId),
      where('statut', '==', 'ouvert')
    );
    const unsubOpenVotes = onSnapshot(
      openVotesQ,
      (snap) => {
        setOpenVotesCount(snap.size);
        setOpenVotesList(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        );
        let transfer = 0;
        let financial = 0;
        snap.docs.forEach((d) => {
          const v = d.data();
          if (v.type === 'transfert_presidence' || v.type === 'transfert_tresorier') transfer += 1;
          else financial += 1;
        });
        setOpenTransferCount(transfer);
        setOpenFinancialCount(financial);
      },
      () => {}
    );

    return () => {
      unsubUsers();
      unsubBulletins();
      unsubOpenVotes();
    };
  }, [coopId]);

  useEffect(() => {
    if (!canManage) {
      setDemandesEnAttente([]);
      return undefined;
    }
    const demandesQ = query(
      collection(db, 'demandes_compte'),
      where('cooperativeId', '==', coopId),
      where('statut', '==', 'en_attente')
    );
    const unsubDemandes = onSnapshot(
      demandesQ,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const at = a?.dateDemande?.toDate ? a.dateDemande.toDate().getTime() : 0;
            const bt = b?.dateDemande?.toDate ? b.dateDemande.toDate().getTime() : 0;
            return bt - at;
          });
        setDemandesEnAttente(list);
      },
      () => {
        setDemandesEnAttente([]);
      }
    );
    return () => unsubDemandes();
  }, [canManage, coopId]);

  const sortedMembers = useMemo(() => {
    const roleOrder = { president: 0, tresorier: 1, membre: 2 };
    return [...users].sort((a, b) => {
      const roleDiff = (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
      if (roleDiff !== 0) return roleDiff;
      return (a.nom || '').localeCompare(b.nom || '', 'fr');
    });
  }, [users]);

  const institutions = useMemo(
    () => sortedMembers.filter((m) => m.role === 'institution'),
    [sortedMembers]
  );

  /** Seuls statut « actif » (ou profil sans statut = ancien script) comptent pour quorum / transferts. */
  const activeMembers = useMemo(
    () =>
      sortedMembers.filter((m) => {
        const s = m.statut;
        if (s === 'inactif' || s === 'exclu') return false;
        return true;
      }),
    [sortedMembers]
  );

  const displayedMembers = useMemo(() => {
    return sortedMembers.filter((m) => {
      if (m.role === 'institution') return false;
      const s = m.statut;
      if (memberFilter === 'tous') return true;
      if (memberFilter === 'actifs') return s === 'actif' || s === undefined || s === null;
      if (memberFilter === 'inactifs') return s === 'inactif';
      if (memberFilter === 'exclus') return s === 'exclu';
      return true;
    });
  }, [sortedMembers, memberFilter]);

  const exclusionVoteEnCoursPour = useMemo(() => {
    return (memberUid) => {
      if (votesPolygonOuverts?.length > 0) return true;
      for (const v of openVotesList) {
        if (membreDoitVoterSurCeVote(memberUid, v)) return true;
      }
      return false;
    };
  }, [votesPolygonOuverts, openVotesList]);

  const participationRate = useMemo(() => {
    if (activeMembers.length === 0) return 0;
    const votedUsers = activeMembers.filter((m) => (votesByUser[m.uid || m.id] || 0) > 0).length;
    return Math.round((votedUsers / activeMembers.length) * 100);
  }, [activeMembers, votesByUser]);

  const mostActive = useMemo(() => {
    if (activeMembers.length === 0) return null;
    let top = activeMembers[0];
    let topVotes = votesByUser[top.uid || top.id] || 0;
    activeMembers.forEach((m) => {
      const count = votesByUser[m.uid || m.id] || 0;
      if (count > topVotes) {
        top = m;
        topVotes = count;
      }
    });
    return { member: top, votes: topVotes };
  }, [activeMembers, votesByUser]);

  async function handleAddMember() {
    if (!newNom.trim() || !newEmail.trim()) {
      Alert.alert('Erreur', 'Nom et email sont obligatoires.');
      return;
    }

    setActionLoading(true);
    try {
      const newRef = doc(collection(db, 'users'));
      await setDoc(newRef, {
        uid: newRef.id,
        nom: newNom.trim(),
        email: newEmail.trim().toLowerCase(),
        role: 'membre',
        cooperativeId: coopId,
        statut: 'actif',
        dateInscription: new Date(),
      });
      setNewNom('');
      setNewEmail('');
      setAddModalVisible(false);
      Alert.alert('Succès', 'Membre ajouté avec succès.');
    } catch {
      Alert.alert('Erreur', 'Impossible d’ajouter le membre pour le moment.');
    } finally {
      setActionLoading(false);
    }
  }

  function ouvrirAjoutInstitution() {
    setInstitutionNom('');
    setInstitutionEmail('');
    setInstitutionType('Banque');
    setInstitutionTempPassword(generateTempPassword(10));
    setInstitutionMdpCopie(false);
    setInstitutionModalVisible(true);
  }

  async function copierMotDePasseInstitution() {
    if (!institutionTempPassword) return;
    await Clipboard.setStringAsync(institutionTempPassword);
    setInstitutionMdpCopie(true);
    setTimeout(() => setInstitutionMdpCopie(false), 2000);
  }

  async function handleAddInstitution() {
    if (!institutionNom.trim() || !institutionEmail.trim()) {
      Alert.alert('Erreur', 'Nom et email sont obligatoires.');
      return;
    }
    setActionLoading(true);
    try {
      const emailInst = institutionEmail.trim().toLowerCase();
      const mdp = institutionTempPassword;
      const creation = await creerCompteInstitution(emailInst, mdp);

      if (!creation.success) {
        if (creation.error === 'auth/email-already-in-use') {
          Alert.alert(
            'Email déjà utilisé',
            'Un compte Firebase existe déjà avec cet email. Choisissez une autre adresse.'
          );
          return;
        }
        Alert.alert('Erreur', `Création impossible : ${creation.error || 'erreur inconnue'}.`);
        return;
      }

      const uidCree = creation.uid;
      await setDoc(doc(db, 'users', uidCree), {
        uid: uidCree,
        nom: institutionNom.trim(),
        email: emailInst,
        role: 'institution',
        typeInstitution: institutionType,
        cooperativeId: coopId,
        statut: 'actif',
        dateInscription: new Date(),
        walletAddress: '',
        creePar: userData?.uid || null,
      });

      setInstitutionModalVisible(false);
      Alert.alert(
        '✅ Compte créé !',
        `Institution : ${institutionNom.trim()}\nEmail : ${emailInst}\nMot de passe : ${mdp}\n\n⚠️ Notez ce mot de passe et transmettez-le à l’institution de façon sécurisée.`
      );
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Création institution impossible.');
    } finally {
      setActionLoading(false);
    }
  }

  function ouvrirValidationDemande(demande) {
    setDemandeAValider(demande);
    setRoleValidation('membre');
    setValidationModalVisible(true);
  }

  function ouvrirRefusDemande(demande) {
    setDemandeARefuser(demande);
    setRaisonRefus('');
    setRefusModalVisible(true);
  }

  async function confirmerRefusDemande() {
    if (!demandeARefuser) return;
    if (!raisonRefus.trim()) {
      Alert.alert('Champ requis', 'Veuillez saisir la raison du refus.');
      return;
    }
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'demandes_compte', demandeARefuser.id), {
        statut: 'refusee',
        raisonRefus: raisonRefus.trim(),
      });
      setRefusModalVisible(false);
      setDemandeARefuser(null);
      setRaisonRefus('');
      Alert.alert('Succès', `Demande de ${demandeARefuser.nom || 'ce membre'} refusée.`);
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Impossible de refuser la demande.');
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmerValidationDemande() {
    if (!demandeAValider) return;
    const roleChoisi = roleValidation || 'membre';
    const demande = demandeAValider;
    const mdpMembre = String(demande.motDePasse || '').trim();
    if (mdpMembre.length < 6) {
      Alert.alert(
        'Mot de passe manquant',
        'Cette demande ne contient pas de mot de passe valide (min. 6 caractères). Le membre doit refaire une demande depuis l’application.'
      );
      return;
    }
    setActionLoading(true);
    try {
      const wallet = ethers.Wallet.createRandom();
      let uidCree = null;
      let utiliseFallbackClient = false;
      try {
        const functions = getFunctions(undefined, 'europe-west1');
        const validerDemandeCompte = httpsCallable(functions, 'validerDemandeCompte');
        const res = await validerDemandeCompte({
          email: String(demande.email || '').toLowerCase().trim(),
          motDePasseTemporaire: mdpMembre,
          nom: demande.nom || '',
        });
        uidCree = res?.data?.uid || res?.data?.user?.uid || null;
      } catch (e) {
        const continuerFallback = await new Promise((resolve) => {
          Alert.alert(
            'Function indisponible',
            'La Function validerDemandeCompte est indisponible. Continuer avec la création côté client ?',
            [
              { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Continuer', style: 'destructive', onPress: () => resolve(true) },
            ]
          );
        });
        if (!continuerFallback) return;
        const createRes = await createUserWithEmailAndPassword(
          auth,
          String(demande.email || '').toLowerCase().trim(),
          mdpMembre
        );
        utiliseFallbackClient = true;
        uidCree = createRes?.user?.uid || null;
        if (!uidCree) throw new Error('Création Auth impossible.');
      }

      if (!uidCree) throw new Error('UID non reçu après création Auth.');

      const userRef = doc(db, 'users', uidCree);
      await setDoc(userRef, {
        uid: uidCree,
        nom: demande.nom || '',
        email: String(demande.email || '').toLowerCase().trim(),
        telephone: demande.telephone || '',
        role: roleChoisi,
        cooperativeId: 'broukou',
        statut: 'actif',
        dateInscription: new Date(),
        walletAddress: wallet.address,
        walletPrivateKey: wallet.privateKey,
      });

      await updateDoc(doc(db, 'demandes_compte', demande.id), {
        statut: 'validee',
        walletAddress: wallet.address,
        uid: uidCree,
        roleChoisi,
      });

      setValidationModalVisible(false);
      setDemandeAValider(null);
      Alert.alert('Succès', `✅ ${demande.nom || 'Le membre'} a été ajouté comme ${ROLE_LABELS[roleChoisi] || roleChoisi} !`);
      if (utiliseFallbackClient) {
        await signOut(auth);
      }
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Validation impossible.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSetRole(member, nextRole) {
    if (!member) return;
    if (member.role === nextRole) {
      Alert.alert('Information', 'Ce membre a déjà ce rôle.');
      return;
    }

    if (nextRole === 'president') {
      Alert.alert(
        'Confirmation',
        `Le transfert de présidence se fait désormais par vote (section "Transferts").`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'OK', style: 'default' },
        ]
      );
      return;
    }

    setActionLoading(true);
    try {
      if (nextRole === 'tresorier') {
        const tresorierActuel = users.find((u) => u.role === 'tresorier' && u.id !== member.id);
        if (tresorierActuel) {
          const batch = writeBatch(db);
          batch.update(doc(db, 'users', tresorierActuel.id), { role: 'membre' });
          batch.update(doc(db, 'users', member.id), { role: 'tresorier' });
          await batch.commit();
        } else {
          await updateDoc(doc(db, 'users', member.id), { role: 'tresorier' });
        }
      } else {
        await updateDoc(doc(db, 'users', member.id), { role: nextRole });
      }

      Alert.alert('Succès', `Rôle mis à jour pour ${member.nom}.`);
    } catch {
      Alert.alert('Erreur', 'Impossible de changer le rôle.');
    } finally {
      setActionLoading(false);
      setRoleModalVisible(false);
      setSelectedMember(null);
    }
  }

  function ouvrirExclusion(member) {
    if (member.role === 'president') {
      Alert.alert('Action impossible', 'Impossible d’exclure le président.');
      return;
    }
    if (member.role === 'tresorier') {
      Alert.alert(
        'Action impossible',
        'Nommez d’abord un nouveau trésorier avant d’exclure l’actuel.'
      );
      return;
    }
    if (member.id === userData?.uid) {
      Alert.alert('Action impossible', 'Tu ne peux pas t’exclure toi-même depuis cette liste.');
      return;
    }
    if (exclusionVoteEnCoursPour(member.id)) {
      Alert.alert(
        'Vote en cours',
        'Impossible d’exclure ce membre pendant un vote en cours auquel il doit participer.'
      );
      return;
    }
    setExcludeRaison('');
    setExcludeTarget(member);
    setExcludeModalVisible(true);
  }

  function confirmerExclusionModal() {
    const raison = excludeRaison.trim();
    if (!excludeTarget || !raison) {
      Alert.alert('Champ requis', 'Indiquez la raison de l’exclusion.');
      return;
    }
    const nom = excludeTarget.nom || 'Membre';
    Alert.alert(
      'Confirmation définitive',
      `Exclure définitivement ${nom} de la coopérative ?\n\nRaison : ${raison}\n\nCette action est enregistrée dans l’historique.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Exclure',
          style: 'destructive',
          onPress: async () => {
            setExcludeModalVisible(false);
            setActionLoading(true);
            const cible = excludeTarget;
            try {
              const presidentNom = userData?.nom || 'Président';
              await exclureMembre(cible.id, raison, presidentNom);
              await addDoc(collection(db, 'historique_exclusions'), {
                membreUid: cible.id,
                membreNom: nom,
                excluParUid: userData?.uid || null,
                excluParNom: presidentNom,
                raison,
                date: Timestamp.now(),
                cooperativeId: coopId,
              });
              setExcludeTarget(null);
              setExcludeRaison('');
              Alert.alert('Succès', `${nom} a été exclu de la coopérative.`);
            } catch (e) {
              Alert.alert('Erreur', e?.message || 'Exclusion impossible.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  }

  function handleReintegrer(member) {
    Alert.alert(
      'Réintégration',
      `Réintégrer ${member.nom || 'ce membre'} dans la coopérative ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Réintégrer',
          onPress: async () => {
            setActionLoading(true);
            try {
              await reintegrerMembre(member.id);
              await addDoc(collection(db, 'reintegration_notifications'), {
                targetUid: member.id,
                membreNom: member.nom || 'Membre',
                cooperativeNom: 'CTA de Broukou',
                cooperativeId: coopId,
                createdAt: Timestamp.now(),
              });
              Alert.alert('Succès', `${member.nom || 'Le membre'} a été réintégré.`);
            } catch (e) {
              Alert.alert('Erreur', e?.message || 'Réintégration impossible.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  }

  const presidentActuel = useMemo(() => users.find((u) => u.role === 'president'), [users]);
  const tresorierActuel = useMemo(() => users.find((u) => u.role === 'tresorier'), [users]);

  const transfertBloque = openVotesCount > 0;
  const transfertMsg = openTransferCount > 0
    ? 'Un vote de transfert est déjà en cours. Attendez la fin du vote.'
    : openFinancialCount > 0
      ? 'Un vote est déjà en cours. Attendez la fin du vote.'
      : null;

  async function proposerTransfert({ type, candidat }) {
    if (!canManage) return;
    if (transfertBloque) {
      Alert.alert('Action impossible', transfertMsg || 'Un vote est en cours.');
      return;
    }
    if (!candidat) {
      Alert.alert('Information', 'Sélectionne un membre actif.');
      return;
    }

    // Règles : éviter auto-proposition invalide
    if (type === 'transfert_presidence' && candidat.role === 'president') {
      Alert.alert('Information', 'Le candidat est déjà président.');
      return;
    }
    if (type === 'transfert_tresorier' && (candidat.role === 'tresorier' || candidat.role === 'president')) {
      Alert.alert('Information', 'Choisis un membre actif (pas le trésorier actuel, pas le président).');
      return;
    }

    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    if (type === 'transfert_presidence') {
      Alert.alert(
        'Confirmation',
        `Êtes-vous sûr de proposer ${candidat.nom} comme nouveau président ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Continuer',
            style: 'destructive',
            onPress: () => {
              Alert.alert(
                'Confirmation finale',
                'Tous les membres voteront pendant 24 heures. Confirmer ?',
                [
                  { text: 'Annuler', style: 'cancel' },
                  {
                    text: 'Confirmer',
                    style: 'destructive',
                    onPress: async () => {
                      setActionLoading(true);
                      try {
                        const totalMembres = await getNombreMembres(coopId);
                        const voteBase = {
                          type,
                          candidatUid: candidat.id,
                          candidatNom: candidat.nom || 'Candidat',
                          creeParUid: userData?.uid,
                          creeParNom: userData?.nom || (presidentActuel?.nom || 'Président'),
                          statut: 'ouvert',
                          votesOui: 0,
                          votesNon: 0,
                          totalMembres,
                          quorumRequis: 60,
                          cooperativeId: coopId,
                          dateCreation: Timestamp.fromDate(now),
                          dateExpiration: Timestamp.fromDate(expires),
                        };
                        const raison = raisonPresident.trim();
                        const payloadFinal = {
                          ...voteBase,
                          titre: `Transfert de présidence à ${candidat.nom}`,
                          description:
                            `Le président ${presidentActuel?.nom || 'actuel'} propose ${candidat.nom} comme nouveau président de la coopérative CTA de Broukou.`,
                          ancienRoleUid: presidentActuel?.id || userData?.uid,
                          ancienRoleNom: presidentActuel?.nom || userData?.nom || 'Président',
                          ancienRole: 'president',
                          nouveauRole: 'president',
                          raisonTransfert: raison || null,
                        };
                        await addDoc(collection(db, 'votes'), payloadFinal);
                        setCandidatePresidentId(null);
                        setRaisonPresident('');
                        Alert.alert('Succès', 'Vote de transfert de présidence créé.');
                      } catch (e) {
                        Alert.alert('Erreur', e?.message || 'Impossible de créer le vote.');
                      }
                      setActionLoading(false);
                    },
                  },
                ]
              );
            },
          },
        ]
      );
      return;
    }

    if (type === 'transfert_tresorier') {
      Alert.alert(
        'Confirmation',
        `Êtes-vous sûr de proposer ${candidat.nom} comme nouveau trésorier ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Continuer',
            style: 'destructive',
            onPress: () => {
              Alert.alert(
                'Confirmation finale',
                'Tous les membres voteront pendant 24 heures. Confirmer ?',
                [
                  { text: 'Annuler', style: 'cancel' },
                  {
                    text: 'Confirmer',
                    style: 'destructive',
                    onPress: async () => {
                      setActionLoading(true);
                      try {
                        const totalMembres = await getNombreMembres(coopId);
                        const voteBase = {
                          type,
                          candidatUid: candidat.id,
                          candidatNom: candidat.nom || 'Candidat',
                          creeParUid: userData?.uid,
                          creeParNom: userData?.nom || (presidentActuel?.nom || 'Président'),
                          statut: 'ouvert',
                          votesOui: 0,
                          votesNon: 0,
                          totalMembres,
                          quorumRequis: 60,
                          cooperativeId: coopId,
                          dateCreation: Timestamp.fromDate(now),
                          dateExpiration: Timestamp.fromDate(expires),
                        };
                        const raison = raisonTresorier.trim();
                        const payloadFinal = {
                          ...voteBase,
                          titre: `Changement de trésorier → ${candidat.nom}`,
                          description:
                            `Le président ${presidentActuel?.nom || 'actuel'} propose ${candidat.nom} comme nouveau trésorier de la coopérative CTA de Broukou.`,
                          ancienRoleUid: tresorierActuel?.id || null,
                          ancienRoleNom: tresorierActuel?.nom || 'Trésorier',
                          ancienRole: 'tresorier',
                          nouveauRole: 'tresorier',
                          raisonTransfert: raison || null,
                        };
                        await addDoc(collection(db, 'votes'), payloadFinal);
                        setCandidateTresorierId(null);
                        setRaisonTresorier('');
                        Alert.alert('Succès', 'Vote de changement de trésorier créé.');
                      } catch (e) {
                        Alert.alert('Erreur', e?.message || 'Impossible de créer le vote.');
                      }
                      setActionLoading(false);
                    },
                  },
                ]
              );
            },
          },
        ]
      );
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={styles.loadingText}>Chargement des membres...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <FlatList
        data={displayedMembers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
        ListEmptyComponent={
          <Text style={styles.emptyFilterText}>
            Aucun membre dans cette catégorie.
          </Text>
        }
        ListHeaderComponent={
          <>
            {navigation ? (
              <TouchableOpacity
                style={styles.membresBackRow}
                onPress={() => navigation.goBack()}
                accessibilityRole="button"
                accessibilityLabel="Retour"
              >
                <Text style={styles.membresBackText}>← Retour</Text>
              </TouchableOpacity>
            ) : null}

            {canManage && demandesEnAttente.length > 0 ? (
              <View style={styles.alertBannerDemandes}>
                <Text style={styles.alertBannerTitle}>
                  🔔 {demandesEnAttente.length} demande(s) en attente de validation
                </Text>
                {demandesEnAttente.map((demande) => (
                  <View key={demande.id} style={styles.pendingCard}>
                    <View style={styles.pendingTopRow}>
                      <View style={styles.pendingAvatar}>
                        <Text style={styles.pendingAvatarText}>{getInitiales(demande.nom)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pendingName}>{demande.nom || 'Demandeur'}</Text>
                        <Text style={styles.pendingMeta}>{demande.email || '-'}</Text>
                        <Text style={styles.pendingMeta}>{demande.telephone || '-'}</Text>
                        <Text style={styles.pendingMeta}>
                          Demandé le {formatDateHeure(demande.dateDemande)}
                        </Text>
                      </View>
                    </View>
                    {demande.message ? (
                      <View style={styles.pendingMessageBox}>
                        <Text style={styles.pendingMessageLabel}>Message</Text>
                        <Text style={styles.pendingMessageText}>{demande.message}</Text>
                      </View>
                    ) : null}

                    <View style={styles.pendingActions}>
                      <TouchableOpacity
                        style={styles.pendingValidateBtn}
                        onPress={() => ouvrirValidationDemande(demande)}
                        disabled={actionLoading}
                      >
                        <Text style={styles.pendingValidateText}>✅ Valider</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.pendingRefuseBtn}
                        onPress={() => ouvrirRefusDemande(demande)}
                        disabled={actionLoading}
                      >
                        <Text style={styles.pendingRefuseText}>❌ Refuser</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.header}>
              <Text style={styles.headerTitle}>Gestion des membres</Text>
              <Text style={styles.headerSub}>Coopérative {coopId}</Text>
            </View>

            <View style={styles.statsCard}>
              <Text style={styles.statsMainNumber}>{statsMembres.total}</Text>
              <Text style={styles.statsLabel}>{statsMembres.label}</Text>
              <View style={styles.statsMembresRow}>
                <View style={styles.statsItem}>
                  <Text style={styles.statsNum}>👤 {statsMembres.totalMembres}</Text>
                  <Text style={styles.statsSub}>Membres actifs</Text>
                </View>
                <View style={styles.statsDivider} />
                <View style={styles.statsItem}>
                  <Text style={styles.statsNum}>🏦 {statsMembres.totalInstitutions}</Text>
                  <Text style={styles.statsSub}>Institutions</Text>
                </View>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Participation</Text>
                <Text style={styles.statValue}>{participationRate}%</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Plus actif</Text>
                <Text style={styles.statValueSmall} numberOfLines={1}>
                  {mostActive ? `${mostActive.member.nom} (${mostActive.votes})` : '-'}
                </Text>
              </View>
            </View>

            {institutions.length > 0 ? (
              <View style={styles.institutionsSection}>
                <Text style={styles.institutionsTitle}>🏦 Institutions</Text>
                {institutions.map((inst) => (
                  <View key={inst.id} style={styles.institutionCard}>
                    <View style={styles.pendingAvatar}>
                      <Text style={styles.pendingAvatarText}>{getInitiales(inst.nom)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pendingName}>{inst.nom || 'Institution'}</Text>
                      <Text style={styles.pendingMeta}>{inst.email || '-'}</Text>
                      <View style={styles.institutionTypeBadge}>
                        <Text style={styles.institutionTypeText}>{inst.typeInstitution || 'Autre'}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.filterRow}>
              {[
                { key: 'actifs', label: 'Actifs' },
                { key: 'inactifs', label: 'Inactifs' },
                { key: 'exclus', label: 'Exclus' },
                { key: 'tous', label: 'Tous' },
              ].map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.filterChip,
                    memberFilter === key && styles.filterChipActive,
                  ]}
                  onPress={() => setMemberFilter(key)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      memberFilter === key && styles.filterChipTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Liste des membres</Text>
          </>
        }
        renderItem={({ item }) => {
          const st = item.statut;
          const estActifListe =
            st === 'actif' || st === undefined || st === null;
          return (
            <MemberRow
              member={item}
              voteCount={votesByUser[item.uid || item.id] || 0}
              isPresidentRow={item.role === 'president'}
              canManage={canManage}
              onPressExclure={ouvrirExclusion}
              onPressReintegrer={handleReintegrer}
              showExclure={canManage && estActifListe && item.role !== 'president'}
              showReintegrer={
                canManage && (st === 'inactif' || st === 'exclu')
              }
            />
          );
        }}
        ListFooterComponent={
          canManage ? (
            <View style={styles.transfersSection}>
              <Text style={styles.transfersTitle}>Transferts (vote démocratique)</Text>
              {transfertMsg ? (
                <View style={styles.transfersLockedBox}>
                  <Text style={styles.transfersLockedText}>{transfertMsg}</Text>
                </View>
              ) : null}

              <View style={[styles.transferCard, { borderColor: '#7c3aed33' }]}>
                <Text style={[styles.transferCardTitle, { color: '#7c3aed' }]}>🛡️ Transférer la Présidence</Text>
                <Text style={styles.transferCardDesc}>
                  Cette décision sera soumise au vote de tous les membres pendant 24 heures.
                </Text>

                <TouchableOpacity
                  style={styles.selector}
                  onPress={() => setModalPickPresident(true)}
                  disabled={transfertBloque}
                >
                  <Text style={styles.selectorLabel}>Candidat</Text>
                  <Text style={styles.selectorValue}>
                    {candidatePresidentId
                      ? (activeMembers.find((m) => m.id === candidatePresidentId)?.nom || '—')
                      : 'Choisir un membre actif…'}
                  </Text>
                </TouchableOpacity>

                <TextInput
                  style={styles.reasonInput}
                  placeholder="Raison du transfert (optionnel)"
                  value={raisonPresident}
                  onChangeText={setRaisonPresident}
                  editable={!transfertBloque}
                  multiline
                />

                <TouchableOpacity
                  style={[styles.btnPres, (transfertBloque || actionLoading) && { opacity: 0.6 }]}
                  onPress={() => {
                    const candidat = activeMembers.find((m) => m.id === candidatePresidentId);
                    proposerTransfert({ type: 'transfert_presidence', candidat });
                  }}
                  disabled={transfertBloque || actionLoading}
                >
                  <Text style={styles.btnPresText}>Proposer le transfert</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.transferCard, { borderColor: '#1d4ed833' }]}>
                <Text style={[styles.transferCardTitle, { color: '#1d4ed8' }]}>🏦 Changer le Trésorier</Text>
                <Text style={styles.transferCardDesc}>
                  Cette décision sera soumise au vote de tous les membres pendant 24 heures.
                </Text>

                <TouchableOpacity
                  style={styles.selector}
                  onPress={() => setModalPickTresorier(true)}
                  disabled={transfertBloque}
                >
                  <Text style={styles.selectorLabel}>Candidat</Text>
                  <Text style={styles.selectorValue}>
                    {candidateTresorierId
                      ? (activeMembers.find((m) => m.id === candidateTresorierId)?.nom || '—')
                      : 'Choisir un membre actif…'}
                  </Text>
                </TouchableOpacity>

                <TextInput
                  style={styles.reasonInput}
                  placeholder="Raison du changement (optionnel)"
                  value={raisonTresorier}
                  onChangeText={setRaisonTresorier}
                  editable={!transfertBloque}
                  multiline
                />

                <TouchableOpacity
                  style={[styles.btnTres, (transfertBloque || actionLoading) && { opacity: 0.6 }]}
                  onPress={() => {
                    const candidat = activeMembers.find((m) => m.id === candidateTresorierId);
                    proposerTransfert({ type: 'transfert_tresorier', candidat });
                  }}
                  disabled={transfertBloque || actionLoading}
                >
                  <Text style={styles.btnTresText}>Proposer le changement</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null
        }
      />

      {canManage && (
        <View style={styles.floatingGroup}>
          <TouchableOpacity style={styles.floatingBtnSecondary} onPress={ouvrirAjoutInstitution}>
            <Text style={styles.floatingBtnText}>🏦 Ajouter une institution</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.floatingBtn} onPress={() => setAddModalVisible(true)}>
            <Text style={styles.floatingBtnText}>➕ Ajouter un membre</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={addModalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ajouter un membre</Text>
            <TextInput
              style={styles.input}
              placeholder="Nom complet"
              value={newNom}
              onChangeText={setNewNom}
            />
            <TextInput
              style={styles.input}
              placeholder="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              value={newEmail}
              onChangeText={setNewEmail}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddModalVisible(false)}>
                <Text style={styles.cancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleAddMember}>
                <Text style={styles.confirmText}>Créer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={institutionModalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ajouter une institution</Text>
            <TextInput
              style={styles.input}
              placeholder="Nom de l'institution (ex: IFAD Togo)"
              value={institutionNom}
              onChangeText={setInstitutionNom}
            />
            <TextInput
              style={styles.input}
              placeholder="Email de connexion"
              keyboardType="email-address"
              autoCapitalize="none"
              value={institutionEmail}
              onChangeText={setInstitutionEmail}
            />

            <Text style={styles.validationLabel}>Type d'institution</Text>
            <View style={styles.typeGrid}>
              {INSTITUTION_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.typeChip, institutionType === type && styles.typeChipActive]}
                  onPress={() => setInstitutionType(type)}
                >
                  <Text style={[styles.typeChipText, institutionType === type && styles.typeChipTextActive]}>
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.validationLabel}>Mot de passe temporaire</Text>
            <View style={styles.tempPasswordRow}>
              <TextInput
                style={styles.tempPasswordInput}
                value={institutionTempPassword}
                onChangeText={setInstitutionTempPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.tempCopyBtn} onPress={copierMotDePasseInstitution}>
                <Text style={styles.tempCopyText}>📋 Copier</Text>
              </TouchableOpacity>
            </View>
            {institutionMdpCopie ? (
              <Text style={styles.copieOk}>Copié ✅</Text>
            ) : null}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setInstitutionModalVisible(false)}>
                <Text style={styles.cancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleAddInstitution}>
                <Text style={styles.confirmText}>Créer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={roleModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Changer rôle: {selectedMember?.nom || ''}
            </Text>
            {['membre', 'tresorier', 'president'].map((role) => (
              <TouchableOpacity
                key={role}
                style={styles.roleOption}
                onPress={() => handleSetRole(selectedMember, role)}
              >
                <Text style={[styles.roleOptionText, { color: ROLE_COLORS[role] }]}>
                  {ROLE_LABELS[role]}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.cancelBtn, { marginTop: 12 }]}
              onPress={() => {
                setRoleModalVisible(false);
                setSelectedMember(null);
              }}
            >
              <Text style={styles.cancelText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Sélecteur candidat présidence */}
      <Modal visible={modalPickPresident} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCardLarge}>
            <Text style={styles.modalTitle}>Choisir le candidat (présidence)</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {activeMembers
                .filter((m) => m.role !== 'president')
                .map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[
                      styles.transferOption,
                      candidatePresidentId === m.id && styles.transferOptionActive,
                    ]}
                    onPress={() => setCandidatePresidentId(m.id)}
                  >
                    <Text style={styles.transferOptionText}>{m.nom}</Text>
                    <Text style={styles.transferOptionSub}>{ROLE_LABELS[m.role] || m.role}</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalPickPresident(false)}>
                <Text style={styles.cancelText}>Fermer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={() => setModalPickPresident(false)}>
                <Text style={styles.confirmText}>Valider</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sélecteur candidat trésorier */}
      <Modal visible={modalPickTresorier} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCardLarge}>
            <Text style={styles.modalTitle}>Choisir le candidat (trésorier)</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {activeMembers
                .filter((m) => m.role !== 'president')
                .filter((m) => m.role !== 'tresorier')
                .map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[
                      styles.transferOption,
                      candidateTresorierId === m.id && styles.transferOptionActive,
                    ]}
                    onPress={() => setCandidateTresorierId(m.id)}
                  >
                    <Text style={styles.transferOptionText}>{m.nom}</Text>
                    <Text style={styles.transferOptionSub}>{ROLE_LABELS[m.role] || m.role}</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalPickTresorier(false)}>
                <Text style={styles.cancelText}>Fermer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={() => setModalPickTresorier(false)}>
                <Text style={styles.confirmText}>Valider</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={validationModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Valider {demandeAValider?.nom || ''}</Text>

            <Text style={styles.validationLabel}>Rôle à attribuer</Text>
            <View style={styles.validationRoles}>
              <TouchableOpacity
                style={[styles.validationRoleChip, roleValidation === 'membre' && styles.validationRoleChipActive]}
                onPress={() => setRoleValidation('membre')}
              >
                <Text style={[styles.validationRoleText, roleValidation === 'membre' && styles.validationRoleTextActive]}>
                  • Membre
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.validationRoleChip, roleValidation === 'tresorier' && styles.validationRoleChipActive]}
                onPress={() => setRoleValidation('tresorier')}
              >
                <Text style={[styles.validationRoleText, roleValidation === 'tresorier' && styles.validationRoleTextActive]}>
                  • Trésorier
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.btnValidationConfirm, actionLoading && { opacity: 0.6 }]}
              onPress={confirmerValidationDemande}
              disabled={actionLoading}
            >
              <Text style={styles.btnValidationConfirmText}>✅ Confirmer la validation</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cancelBtn, { marginTop: 10 }]}
              onPress={() => {
                if (actionLoading) return;
                setValidationModalVisible(false);
                setDemandeAValider(null);
              }}
            >
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={refusModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Refuser {demandeARefuser?.nom || ''}</Text>
            <TextInput
              style={styles.excludeReasonInput}
              placeholder="Raison du refus"
              value={raisonRefus}
              onChangeText={setRaisonRefus}
              multiline
              editable={!actionLoading}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  if (actionLoading) return;
                  setRefusModalVisible(false);
                  setDemandeARefuser(null);
                  setRaisonRefus('');
                }}
              >
                <Text style={styles.cancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pendingRefuseBtn, actionLoading && { opacity: 0.6 }]}
                onPress={confirmerRefusDemande}
                disabled={actionLoading}
              >
                <Text style={styles.pendingRefuseText}>Confirmer le refus</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={excludeModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Exclure {excludeTarget?.nom ? `« ${excludeTarget.nom} »` : 'le membre'}
            </Text>
            <Text style={styles.excludeHint}>
              La raison est obligatoire. Elle sera conservée dans l’historique.
            </Text>
            <TextInput
              style={styles.excludeReasonInput}
              placeholder="Raison de l’exclusion *"
              value={excludeRaison}
              onChangeText={setExcludeRaison}
              multiline
              editable={!actionLoading}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  if (actionLoading) return;
                  setExcludeModalVisible(false);
                  setExcludeTarget(null);
                  setExcludeRaison('');
                }}
              >
                <Text style={styles.cancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnExclureConfirm, actionLoading && { opacity: 0.6 }]}
                onPress={confirmerExclusionModal}
                disabled={actionLoading}
              >
                <Text style={styles.btnExclureConfirmText}>Confirmer l’exclusion</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {actionLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingOverlayText}>Traitement en cours...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  membresBackRow: {
    alignSelf: 'flex-start',
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  membresBackText: { fontSize: 16, fontWeight: '800', color: GREEN_DARK },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  loadingText: { marginTop: 10, color: '#6b7280' },
  errorBanner: {
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    textAlign: 'center',
  },

  header: {
    backgroundColor: GREEN_DARK,
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
  },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  headerSub: { color: 'rgba(255,255,255,0.7)', marginTop: 4 },

  statsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    elevation: 3,
  },
  statsMainNumber: { fontSize: 32, fontWeight: '900', color: GREEN_DARK, textAlign: 'center' },
  statsLabel: { fontSize: 14, color: '#4b5563', textAlign: 'center', marginTop: 4, marginBottom: 14 },
  statsMembresRow: { flexDirection: 'row', alignItems: 'stretch' },
  statsItem: { flex: 1, alignItems: 'center' },
  statsNum: { fontSize: 16, fontWeight: '800', color: '#111827' },
  statsSub: { fontSize: 11, color: '#6b7280', marginTop: 4, textAlign: 'center' },
  statsDivider: { width: 1, backgroundColor: '#e5e7eb', marginVertical: 4 },
  copieOk: { color: '#15803d', fontWeight: '800', textAlign: 'center', marginTop: 6 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    elevation: 2,
  },
  statLabel: { fontSize: 11, color: '#6b7280', marginBottom: 6 },
  statValue: { fontSize: 20, fontWeight: '900', color: '#111827' },
  statValueSmall: { fontSize: 13, fontWeight: '800', color: '#111827' },
  sectionTitle: { fontSize: 17, fontWeight: '900', color: '#111827', marginBottom: 10 },
  alertBannerDemandes: {
    marginBottom: 14,
    backgroundColor: '#fef3c7',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#f59e0b',
    padding: 14,
  },
  alertBannerTitle: {
    color: '#92400e',
    fontWeight: '900',
    fontSize: 15,
    marginBottom: 12,
  },
  pendingCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fed7aa',
    marginBottom: 8,
  },
  pendingTopRow: { flexDirection: 'row', gap: 10 },
  pendingAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingAvatarText: { color: GREEN_DARK, fontWeight: '900' },
  pendingName: { fontSize: 14, fontWeight: '900', color: '#111827' },
  pendingMeta: { marginTop: 2, color: '#6b7280', fontSize: 12 },
  pendingMessageBox: {
    marginTop: 10,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 10,
  },
  pendingMessageLabel: { fontSize: 11, color: '#6b7280', fontWeight: '800', marginBottom: 4 },
  pendingMessageText: { color: '#111827', fontWeight: '600', fontSize: 12, lineHeight: 18 },
  pendingActions: { marginTop: 10, flexDirection: 'row', gap: 8 },
  pendingValidateBtn: {
    flex: 1,
    backgroundColor: GREEN,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pendingValidateText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  pendingRefuseBtn: {
    flex: 1,
    backgroundColor: '#b91c1c',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pendingRefuseText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  institutionsSection: { marginBottom: 14 },
  institutionsTitle: { fontSize: 16, fontWeight: '900', color: GREEN_DARK, marginBottom: 8 },
  institutionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1fae5',
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  institutionTypeBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  institutionTypeText: { color: GREEN_DARK, fontWeight: '800', fontSize: 11 },

  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
  },
  filterChipActive: {
    backgroundColor: GREEN_DARK,
    borderColor: GREEN_DARK,
  },
  filterChipText: { fontSize: 12, fontWeight: '800', color: '#374151' },
  filterChipTextActive: { color: '#fff' },
  emptyFilterText: {
    textAlign: 'center',
    color: '#6b7280',
    fontWeight: '600',
    paddingVertical: 28,
  },

  memberCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    elevation: 2,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: GREEN_DARK, fontWeight: '900' },
  memberName: { fontSize: 15, fontWeight: '800', color: '#111827' },
  memberEmail: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  roleBadge: { alignSelf: 'flex-start', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4 },
  roleText: { fontSize: 11, fontWeight: '800' },
  metaText: { color: '#6b7280', fontSize: 11, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  voteCountText: { marginLeft: 8, fontSize: 11, fontWeight: '700', color: '#374151' },

  actionsCol: { gap: 8 },
  editBtn: { backgroundColor: '#eff6ff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  editBtnText: { color: '#1d4ed8', fontSize: 11, fontWeight: '800' },
  removeBtn: { backgroundColor: '#fef2f2', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  removeBtnText: { color: '#b91c1c', fontSize: 11, fontWeight: '800' },
  reintegreBtn: { backgroundColor: '#ecfdf5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  reintegreBtnText: { color: GREEN_DARK, fontSize: 11, fontWeight: '800' },

  excludeHint: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 10,
    lineHeight: 17,
  },
  excludeReasonInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    minHeight: 80,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
    textAlignVertical: 'top',
  },
  btnExclureConfirm: {
    backgroundColor: '#b91c1c',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  btnExclureConfirmText: { color: '#fff', fontWeight: '800' },

  transfersSection: { marginTop: 16 },
  transfersTitle: { fontSize: 16, fontWeight: '900', color: '#111827', marginBottom: 10 },
  transfersLockedBox: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  transfersLockedText: { color: '#92400e', fontWeight: '800', textAlign: 'center' },
  transferCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  transferCardTitle: { fontSize: 15, fontWeight: '900' },
  transferCardDesc: { marginTop: 6, color: '#6b7280', fontWeight: '600', lineHeight: 18 },
  selector: {
    marginTop: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 12,
  },
  selectorLabel: { color: '#6b7280', fontSize: 12, fontWeight: '800' },
  selectorValue: { marginTop: 4, color: '#111827', fontWeight: '900' },
  reasonInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    minHeight: 54,
    fontWeight: '600',
    color: '#111827',
  },
  btnPres: {
    marginTop: 12,
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPresText: { color: '#fff', fontWeight: '900' },
  btnTres: {
    marginTop: 12,
    backgroundColor: '#1d4ed8',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnTresText: { color: '#fff', fontWeight: '900' },

  floatingBtn: {
    backgroundColor: GREEN,
    borderRadius: 26,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    elevation: 6,
  },
  floatingGroup: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    gap: 8,
    alignItems: 'flex-end',
  },
  floatingBtnSecondary: {
    backgroundColor: GREEN_DARK,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    elevation: 4,
  },
  floatingBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16 },
  modalCardLarge: { backgroundColor: '#fff', borderRadius: 18, padding: 16, maxHeight: '85%' },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#111827', marginBottom: 10 },
  input: {
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 14,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  cancelBtn: { backgroundColor: '#f3f4f6', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { color: '#374151', fontWeight: '700' },
  confirmBtn: { backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  confirmText: { color: '#fff', fontWeight: '800' },
  validationLabel: { fontSize: 12, color: '#374151', fontWeight: '800', marginBottom: 6 },
  validationRoles: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  validationRoleChip: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  validationRoleChipActive: {
    borderColor: GREEN,
    backgroundColor: '#f0fdf4',
  },
  validationRoleText: { color: '#374151', fontWeight: '800' },
  validationRoleTextActive: { color: GREEN_DARK },
  tempPasswordRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tempPasswordInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    color: '#111827',
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tempCopyBtn: {
    backgroundColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tempCopyText: { color: '#374151', fontWeight: '900', fontSize: 12 },
  btnValidationConfirm: {
    backgroundColor: GREEN,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnValidationConfirmText: { color: '#fff', fontWeight: '900' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  typeChip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  typeChipActive: { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  typeChipText: { color: '#374151', fontWeight: '700', fontSize: 12 },
  typeChipTextActive: { color: GREEN_DARK },

  roleOption: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  roleOptionText: { fontWeight: '800' },
  transferOption: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  transferOptionActive: { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  transferOptionText: { fontWeight: '800', color: '#111827' },
  transferOptionSub: { marginTop: 3, color: '#6b7280', fontSize: 12 },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingOverlayText: { marginTop: 8, color: '#fff', fontWeight: '700' },
});
