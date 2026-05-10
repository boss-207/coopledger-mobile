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
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';

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

function MemberRow({ member, voteCount, isPresident, onChangeRole, onRemove, canManage }) {
  const color = ROLE_COLORS[member.role] || GREEN;
  const statutActif = member.statut !== 'inactif';

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
          <View style={[styles.dot, { backgroundColor: statutActif ? '#22c55e' : '#9ca3af' }]} />
          <Text style={styles.metaText}>{statutActif ? 'Actif' : 'Inactif'}</Text>
          <Text style={styles.voteCountText}>Votes: {voteCount}</Text>
        </View>
      </View>

      {canManage && !isPresident && (
        <View style={styles.actionsCol}>
          <TouchableOpacity style={styles.editBtn} onPress={() => onChangeRole(member)}>
            <Text style={styles.editBtnText}>✏️ Rôle</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.removeBtn} onPress={() => onRemove(member)}>
            <Text style={styles.removeBtnText}>🚫 Retirer</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function MembresScreen({ userData }) {
  const [users, setUsers] = useState([]);
  const [votesByUser, setVotesByUser] = useState({});
  const [openVotesCount, setOpenVotesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);

  const [newNom, setNewNom] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [pendingTransferId, setPendingTransferId] = useState(null);

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

    const openVotesQ = query(collection(db, 'votes'), where('statut', '==', 'ouvert'));
    const unsubOpenVotes = onSnapshot(
      openVotesQ,
      (snap) => {
        setOpenVotesCount(snap.size);
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

  const activeMembers = useMemo(
    () => sortedMembers.filter((m) => m.statut !== 'inactif'),
    [sortedMembers]
  );

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

  async function applyTransferPresidence(targetMember) {
    if (!targetMember) return;
    if (targetMember.role === 'president') {
      Alert.alert('Info', 'Ce membre est déjà président.');
      return;
    }

    setActionLoading(true);
    try {
      const presidentActuel = users.find((u) => u.role === 'president');
      if (!presidentActuel) {
        Alert.alert('Erreur', 'Aucun président actuel trouvé.');
        return;
      }

      const batch = writeBatch(db);
      batch.update(doc(db, 'users', presidentActuel.id), { role: 'membre' });
      batch.update(doc(db, 'users', targetMember.id), { role: 'president' });
      await batch.commit();
      Alert.alert('Succès', `La présidence a été transférée à ${targetMember.nom}.`);
    } catch {
      Alert.alert('Erreur', 'Impossible de transférer la présidence.');
    } finally {
      setActionLoading(false);
      setTransferModalVisible(false);
      setPendingTransferId(null);
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
        `Attention : vous allez transférer la présidence à ${member.nom}. Vous deviendrez membre. Confirmer ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Confirmer', style: 'destructive', onPress: () => applyTransferPresidence(member) },
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

  function onPressRemove(member) {
    if (member.role === 'president') {
      Alert.alert('Action impossible', 'Impossible de retirer le président.');
      return;
    }
    if (member.id === userData?.uid) {
      Alert.alert('Action impossible', 'Tu ne peux pas te retirer toi-même.');
      return;
    }
    if (openVotesCount > 0) {
      Alert.alert(
        'Action impossible',
        'Impossible de retirer un membre pendant un vote en cours.'
      );
      return;
    }

    Alert.alert(
      'Confirmation',
      `Retirer ${member.nom} de la coopérative ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              await updateDoc(doc(db, 'users', member.id), { statut: 'inactif' });
              Alert.alert('Succès', `${member.nom} a été marqué inactif.`);
            } catch {
              Alert.alert('Erreur', 'Impossible de retirer ce membre.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
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
        data={sortedMembers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
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

            <Text style={styles.sectionTitle}>Liste des membres</Text>
          </>
        }
        renderItem={({ item }) => (
          <MemberRow
            member={item}
            voteCount={votesByUser[item.uid || item.id] || 0}
            isPresident={item.role === 'president'}
            canManage={canManage}
            onChangeRole={(m) => {
              setSelectedMember(m);
              setRoleModalVisible(true);
            }}
            onRemove={onPressRemove}
          />
        )}
        ListFooterComponent={
          canManage ? (
            <TouchableOpacity
              style={styles.transferBtn}
              onPress={() => setTransferModalVisible(true)}
            >
              <Text style={styles.transferBtnText}>🔄 Transférer la présidence</Text>
            </TouchableOpacity>
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

      <Modal visible={transferModalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCardLarge}>
            <Text style={styles.modalTitle}>Transférer la présidence</Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {activeMembers
                .filter((m) => m.role !== 'president')
                .map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[
                      styles.transferOption,
                      pendingTransferId === m.id && styles.transferOptionActive,
                    ]}
                    onPress={() => setPendingTransferId(m.id)}
                  >
                    <Text style={styles.transferOptionText}>{m.nom}</Text>
                    <Text style={styles.transferOptionSub}>
                      {ROLE_LABELS[m.role] || m.role}
                    </Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setTransferModalVisible(false);
                  setPendingTransferId(null);
                }}
              >
                <Text style={styles.cancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={() => {
                  const target = activeMembers.find((m) => m.id === pendingTransferId);
                  if (!target) {
                    Alert.alert('Information', 'Sélectionne un membre.');
                    return;
                  }
                  Alert.alert(
                    'Confirmation finale',
                    `Transférer la présidence à ${target.nom} ? Cette action est sensible.`,
                    [
                      { text: 'Annuler', style: 'cancel' },
                      {
                        text: 'Confirmer',
                        style: 'destructive',
                        onPress: () => applyTransferPresidence(target),
                      },
                    ]
                  );
                }}
              >
                <Text style={styles.confirmText}>Transférer</Text>
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

  transferBtn: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  transferBtnText: { color: '#b91c1c', fontWeight: '700' },

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
