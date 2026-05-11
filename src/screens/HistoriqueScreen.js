import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, Linking, Modal, Image, Pressable,
  ScrollView,
} from 'react-native';
import { collection, onSnapshot } from 'firebase/firestore';
import { useTransactions, useSolde } from '../hooks/useBlockchain';
import { polygonscanTxUrl } from '../config/blockchain';
import { db } from '../config/firebase';
import { getBadgeType, TYPES_TRANSACTION } from '../utils/transactionTypes';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';

function formatDateShort(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateLong(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function toJsDate(uploadedAt) {
  if (!uploadedAt) return null;
  if (typeof uploadedAt.toDate === 'function') return uploadedAt.toDate();
  if (uploadedAt instanceof Date) return uploadedAt;
  return new Date(uploadedAt);
}

/** Type métier Firestore ; repli sur l’ancien champ chaîne Polygon si absent. */
function resolveTypeTransaction(tx, meta) {
  const brut = meta?.typeTransaction;
  if (brut && TYPES_TRANSACTION[brut]) return brut;
  if (tx.type === 'sortie' || tx.type === 'depense') return 'depense';
  return 'cotisation';
}

export default function HistoriqueScreen() {
  const { transactions, loading, refetch } = useTransactions();
  const { solde } = useSolde();
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('tout');
  const [activeTypeFilter, setActiveTypeFilter] = useState('tous');
  const [metaByChainId, setMetaByChainId] = useState({});
  const [receiptModal, setReceiptModal] = useState({
    visible: false, url: null, nom: '', dateLabel: '',
  });

  const filters = [
    { key: 'tout', label: 'Tout' },
    { key: 'revenu', label: '📈 Revenus' },
    { key: 'depense', label: '📉 Dépenses' },
    { key: 'en_cours', label: '⏳ En cours' },
  ];

  const typeTransactionFilters = [
    { key: 'tous', label: 'Tous' },
    { key: 'cotisation', label: '💰' },
    { key: 'depense', label: '📉' },
    { key: 'mobile_money', label: '📱' },
    { key: 'main_a_main', label: '🤝' },
    { key: 'gouvernance', label: '🏛️' },
  ];

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'transactions'),
      (snap) => {
        const next = {};
        snap.forEach((docSnap) => {
          const id = docSnap.id;
          if (id.startsWith('chain_')) {
            const num = Number(id.replace(/^chain_/, ''));
            if (!Number.isNaN(num)) next[num] = docSnap.data();
          }
        });
        setMetaByChainId(next);
      },
      () => {
        // Erreur Firestore (règles / réseau) : on garde la liste chaîne sans métadonnées
        setMetaByChainId({});
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    let data = [...transactions];
    if (activeFilter === 'revenu') data = data.filter(t => t.type === 'revenu' || t.type === 'entree');
    else if (activeFilter === 'depense') data = data.filter(t => t.type === 'depense' || t.type === 'sortie');
    else if (activeFilter === 'en_cours') data = data.filter(t => t.statut === 'en_cours');
    if (activeTypeFilter !== 'tous') {
      data = data.filter((t) => {
        const meta = metaByChainId[t.id];
        return resolveTypeTransaction(t, meta) === activeTypeFilter;
      });
    }
    if (search.trim()) data = data.filter(t => t.titre?.toLowerCase().includes(search.toLowerCase()));
    setFiltered(data);
  }, [activeFilter, activeTypeFilter, search, transactions, metaByChainId]);

  const revenus = transactions
    .filter(t => t.statut === 'valide' && (t.type === 'entree' || t.type === 'revenu'))
    .reduce((a, t) => a + t.montant, 0);

  function openReceipt(justificatif) {
    const d = toJsDate(justificatif.uploadedAt);
    setReceiptModal({
      visible: true,
      url: justificatif.url,
      nom: justificatif.uploadedByNom || 'Membre',
      dateLabel: formatDateLong(d),
    });
  }

  function closeReceipt() {
    setReceiptModal((s) => ({ ...s, visible: false }));
  }

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={GREEN} />
      <Text style={{ marginTop: 12, color: '#6b7280' }}>Chargement depuis Polygon...</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* STATS */}
      <View style={styles.statsBox}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Solde Total</Text>
          <Text style={[styles.statValue, { color: GREEN }]}>
            {Math.abs(solde) >= 1000000 ? `${(solde / 1000000).toFixed(2)}M` : solde.toLocaleString('fr-FR')} FCFA
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Revenu Total</Text>
          <Text style={[styles.statValue, { color: '#2563eb' }]}>
            {revenus >= 1000000 ? `${(revenus / 1000000).toFixed(2)}M` : (revenus / 1000).toFixed(0) + 'K'} FCFA
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Transactions</Text>
          <Text style={[styles.statValue, { color: '#7c3aed' }]}>{transactions.length}</Text>
        </View>
      </View>

      {/* RECHERCHE */}
      <View style={styles.searchBox}>
        <Text style={{ fontSize: 16, marginRight: 8 }}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher une transaction..."
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Text style={{ color: '#9ca3af', fontSize: 18 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filtres par type de transaction (Firestore) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.typeFiltersScroll}
      >
        {typeTransactionFilters.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[
              styles.typeChip,
              activeTypeFilter === f.key ? styles.typeChipActive : styles.typeChipInactive,
            ]}
            onPress={() => setActiveTypeFilter(f.key)}
          >
            <Text
              style={[
                styles.typeChipText,
                activeTypeFilter === f.key ? styles.typeChipTextActive : styles.typeChipTextInactive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* FILTRES */}
      <View style={styles.filtersRow}>
        {filters.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterBtn, activeFilter === f.key && styles.filterBtnActive]}
            onPress={() => setActiveFilter(f.key)}
          >
            <Text style={[styles.filterText, activeFilter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* LISTE */}
      {filtered.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={{ fontSize: 48, marginBottom: 12 }}>📭</Text>
          <Text style={styles.emptyText}>Aucune transaction trouvée</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          renderItem={({ item: tx }) => {
            const meta = metaByChainId[tx.id];
            const typeCle = resolveTypeTransaction(tx, meta);
            const badge = getBadgeType(typeCle);
            const statutColors = { valide: GREEN, en_cours: '#d97706', rejete: '#dc2626', annule: '#6b7280' };
            const statutLabels = { valide: 'Vérifié ✓', en_cours: 'Vote en cours', rejete: 'Rejeté', annule: 'Annulé' };
            const hashCourt = tx.hash
              ? `${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`
              : '0x... (en attente)';

            const justificatif = meta?.justificatif;
            const hasReceipt = Boolean(justificatif?.url);
            const refPayment = meta?.referencePayment;
            const prefixeMontant = badge.signe === '' ? '' : badge.signe;
            const montantFormate = `${prefixeMontant}${(tx.montant / 1000).toFixed(0)}K`;

            return (
              <View style={styles.txCard}>
                <View
                  style={[
                    styles.typeBadge,
                    {
                      backgroundColor: badge.fondCouleur,
                      borderColor: badge.couleur + '55',
                    },
                  ]}
                >
                  <Text style={[styles.typeBadgeText, { color: badge.couleur }]}>
                    {badge.emoji} {badge.label}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.txRowPress}
                  onPress={() => tx.hash && Linking.openURL(polygonscanTxUrl(tx.hash))}
                  disabled={!tx.hash}
                  activeOpacity={tx.hash ? 0.7 : 1}
                >
                  <View style={[styles.txIcon, { backgroundColor: badge.fondCouleur }]}>
                    <Text style={{ fontSize: 20 }}>{badge.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txTitle} numberOfLines={1}>{tx.titre}</Text>
                    <Text style={styles.txDate}>{formatDateShort(tx.date)}</Text>
                    <Text style={styles.txHash} numberOfLines={1}>
                      🔗 {hashCourt}
                      {tx.hash && <Text style={styles.txHashLink}> ↗ Polygonscan</Text>}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={styles.amountRow}>
                      <Text style={[styles.txAmount, { color: badge.couleur }]}>
                        {montantFormate}
                      </Text>
                      {hasReceipt ? (
                        <TouchableOpacity
                          onPress={(e) => {
                            e?.stopPropagation?.();
                            Linking.openURL(justificatif.url);
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.attachIconBtn}
                        >
                          <Text style={styles.attachIcon}>📎</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    {refPayment ? (
                      <Text style={styles.refPayment} numberOfLines={2}>
                        Réf : {String(refPayment)}
                      </Text>
                    ) : null}
                    <View style={[styles.txStatut, {
                      backgroundColor: (statutColors[tx.statut] || '#6b7280') + '20',
                    }]}>
                      <Text style={[styles.txStatutText, { color: statutColors[tx.statut] || '#6b7280' }]}>
                        {statutLabels[tx.statut] || tx.statut}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>

                {hasReceipt && (
                  <TouchableOpacity
                    style={styles.receiptBadge}
                    onPress={() => openReceipt(justificatif)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.receiptBadgeText}>📷 Aperçu du justificatif</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}

      <Modal
        visible={receiptModal.visible}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={closeReceipt}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Justificatif</Text>
            <Pressable style={styles.modalClose} onPress={closeReceipt} hitSlop={12}>
              <Text style={styles.modalCloseText}>✕</Text>
            </Pressable>
          </View>
          {receiptModal.url ? (
            <Image
              source={{ uri: receiptModal.url }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          ) : null}
          <Text style={styles.modalMeta}>
            Uploadé par {receiptModal.nom}{receiptModal.dateLabel ? ` le ${receiptModal.dateLabel}` : ''}
          </Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  statsBox: {
    flexDirection: 'row', backgroundColor: '#fff', margin: 16, borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, elevation: 3,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 11, color: '#6b7280', marginBottom: 4 },
  statValue: { fontSize: 16, fontWeight: '800' },
  statDivider: { width: 1, backgroundColor: '#e5e7eb', marginVertical: 4 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10,
    backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1.5, borderColor: '#e5e7eb',
  },
  searchInput: { flex: 1, fontSize: 15, color: '#111827' },
  typeFiltersScroll: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
    alignItems: 'center',
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    marginRight: 8,
  },
  typeChipActive: {
    backgroundColor: GREEN,
  },
  typeChipInactive: {
    backgroundColor: '#f1f5f9',
  },
  typeChipText: {
    fontSize: 14,
    fontWeight: '800',
  },
  typeChipTextActive: {
    color: '#fff',
  },
  typeChipTextInactive: {
    color: '#64748b',
  },
  filtersRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  filterBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e5e7eb',
  },
  filterBtnActive: { backgroundColor: GREEN, borderColor: GREEN },
  filterText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  filterTextActive: { color: '#fff' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#6b7280' },
  txCard: {
    backgroundColor: '#fff',
    borderRadius: 16, padding: 0, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, elevation: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  typeBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '62%',
  },
  typeBadgeText: { fontSize: 11, fontWeight: '900' },
  txRowPress: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    paddingTop: 40,
  },
  txIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  txTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  txDate: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  txHash: { fontSize: 11, color: GREEN, fontFamily: 'monospace', marginTop: 2 },
  txHashLink: { color: '#2563eb', fontStyle: 'italic' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  attachIconBtn: { padding: 2 },
  attachIcon: { fontSize: 18 },
  refPayment: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
    marginTop: 4,
    maxWidth: 180,
    textAlign: 'right',
  },
  txAmount: { fontSize: 16, fontWeight: '800' },
  txStatut: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 4 },
  txStatutText: { fontSize: 11, fontWeight: '600' },
  receiptBadge: {
    borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: '#f0fdf4',
  },
  receiptBadgeText: { color: GREEN_DARK, fontWeight: '800', fontSize: 14 },
  modalRoot: { flex: 1, backgroundColor: '#0f172a' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: GREEN_DARK,
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  modalClose: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalCloseText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  modalImage: { flex: 1, width: '100%', backgroundColor: '#0f172a' },
  modalMeta: {
    color: '#e2e8f0', fontSize: 14, textAlign: 'center', paddingVertical: 16, paddingHorizontal: 20,
    backgroundColor: GREEN_DARK,
  },
});
