import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, Linking, Modal, Image, Pressable,
} from 'react-native';
import { collection, onSnapshot } from 'firebase/firestore';
import { useTransactions, useSolde } from '../hooks/useBlockchain';
import { polygonscanTxUrl } from '../config/blockchain';
import { db } from '../config/firebase';

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

export default function HistoriqueScreen() {
  const { transactions, loading, refetch } = useTransactions();
  const { solde } = useSolde();
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('tout');
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
    if (search.trim()) data = data.filter(t => t.titre?.toLowerCase().includes(search.toLowerCase()));
    setFiltered(data);
  }, [activeFilter, search, transactions]);

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
            const isEntree = tx.type === 'entree' || tx.type === 'revenu';
            const statutColors = { valide: GREEN, en_cours: '#d97706', rejete: '#dc2626', annule: '#6b7280' };
            const statutLabels = { valide: 'Vérifié ✓', en_cours: 'Vote en cours', rejete: 'Rejeté', annule: 'Annulé' };
            const hashCourt = tx.hash
              ? `${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`
              : '0x... (en attente)';

            const meta = metaByChainId[tx.id];
            const justificatif = meta?.justificatif;
            const hasReceipt = Boolean(justificatif?.url);

            return (
              <View style={styles.txCard}>
                <TouchableOpacity
                  style={styles.txRowPress}
                  onPress={() => tx.hash && Linking.openURL(polygonscanTxUrl(tx.hash))}
                  disabled={!tx.hash}
                  activeOpacity={tx.hash ? 0.7 : 1}
                >
                  <View style={[styles.txIcon, { backgroundColor: isEntree ? '#dcfce7' : '#fee2e2' }]}>
                    <Text style={{ fontSize: 20 }}>{isEntree ? '📈' : '📉'}</Text>
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
                    <Text style={[styles.txAmount, { color: isEntree ? GREEN : '#dc2626' }]}>
                      {isEntree ? '+' : '-'}{(tx.montant / 1000).toFixed(0)}K
                    </Text>
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
                    <Text style={styles.receiptBadgeText}>📎 Voir le reçu</Text>
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
  },
  txRowPress: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
  },
  txIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  txTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  txDate: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  txHash: { fontSize: 11, color: GREEN, fontFamily: 'monospace', marginTop: 2 },
  txHashLink: { color: '#2563eb', fontStyle: 'italic' },
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
