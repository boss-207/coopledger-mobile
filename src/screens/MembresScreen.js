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
import { db } from '../config/firebase';
import { useVotes } from '../hooks/useBlockchain';
import {
  getNombreMembres,
  exclureMembre,
  reintegrerMembre,
} from '../utils/getMembresActifs';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';
const ROLE_COLORS = {
  president: '#7c3aed',
  tresorier: '#2563eb',
  membre: '#15803d',
};
const ROLE_LABELS = {
  president: 'Président',
  tresorier: 'Trésorier',
  membre: 'Membre',
};

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

function MemberRow({
  member,
  voteCount,
  isPresidentRow,
  onChangeRole,
  canManage,
  onPressExclure,
  onPressReintegrer,
  showExclure,
  showReintegrer,
}) {
  const color = ROLE_COLORS[member.role] || GREEN;
  const st = member.statut;
  const labelStatut = statutMembreLabel(st);

  return (
    <View style={styles.memberCard}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{getInitiales(member.nom)}</Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.memberName}>{member.nom || 'Membre'}</Text>
        <View style={[styles.roleBadge, { backgroundColor: `${color}22` }]}>
          <Text style={[styles.roleText, { color }]}>{ROLE_LABELS[member.role] || member.role}</Text>
        </View>
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
          <TouchableOpacity style={styles.editBtn} onPress={() => onChangeRole(member)}>
            <Text style={styles.editBtnText}>✏️ Rôle</Text>
          </TouchableOpacity>
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

export default function MembresScreen({ userData }) {
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

  const sortedMembers = useMemo(() => {
    const roleOrder = { president: 0, tresorier: 1, membre: 2 };
    return [...users].sort((a, b) => {
      const roleDiff = (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
      if (roleDiff !== 0) return roleDiff;
      return (a.nom || '').localeCompare(b.nom || '', 'fr');
    });
  }, [users]);

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
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Gestion des membres</Text>
              <Text style={styles.headerSub}>Coopérative {coopId}</Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Membres actifs</Text>
                <Text style={styles.statValue}>{activeMembers.length}</Text>
              </View>
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
              onChangeRole={(m) => {
                setSelectedMember(m);
                setRoleModalVisible(true);
              }}
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
        <TouchableOpacity style={styles.floatingBtn} onPress={() => setAddModalVisible(true)}>
          <Text style={styles.floatingBtnText}>➕ Ajouter un membre</Text>
        </TouchableOpacity>
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
    position: 'absolute',
    bottom: 24,
    right: 16,
    backgroundColor: GREEN,
    borderRadius: 26,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    elevation: 6,
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
