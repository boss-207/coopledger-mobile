import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, Linking, Modal, Image, Pressable,
  ScrollView,
} from 'react-native';
import {
  collection,
  onSnapshot,
  query,
  where,
  limit,
} from 'firebase/firestore';
import { polygonscanTxUrl } from '../config/blockchain';
import { db } from '../config/firebase';
import { getBadgeType, TYPES_TRANSACTION } from '../utils/transactionTypes';
import { calculerFinances } from '../utils/calculsFinanciers';

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

/** Type métier Firestore */
function resolveTypeTransaction(tx, meta) {
  const brut = meta?.typeTransaction;
  if (brut && TYPES_TRANSACTION[brut]) return brut;
  if (tx.typeTransaction && TYPES_TRANSACTION[tx.typeTransaction]) return tx.typeTransaction;
  if (tx.type === 'sortie' || tx.type === 'depense') return 'depense';
  return 'cotisation';
}

function metaFromTx(tx) {
  return {
    typeTransaction: tx.typeTransaction,
    justificatif: tx.justificatif,
    referencePayment: tx.referencePayment,
  };
}

export default function HistoriqueScreen({ userData }) {
  const coopId = userData?.cooperativeId || 'broukou';
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [solde, setSolde] = useState(0);
  const [revenus, setRevenus] = useState(0);
  const [depenses, setDepenses] = useState(0);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('tout');
  const [activeTypeFilter, setActiveTypeFilter] = useState('tous');
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
    { key: 'tous', label: 'Tous les types' },
    { key: 'cotisation', label: '💰 Cotisation' },
    { key: 'depense', label: '📉 Dépense' },
    { key: 'mobile_money', label: '📱 Mobile money' },
    { key: 'main_a_main', label: '🤝 Main à main' },
    { key: 'vente_recolte', label: '🌾 Vente récolte' },
    { key: 'subvention', label: '🎁 Subvention' },
    { key: 'remboursement', label: '🔄 Remboursement' },
    { key: 'gouvernance', label: '🏛️ Gouvernance' },
  ];

  useEffect(() => {
    const q = query(
      collection(db, 'transactions'),
      where('cooperativeId', '==', coopId),
      limit(200)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => {
          const raw = d.data();
          const date = raw.date?.toDate?.()
            ? raw.date.toDate()
            : raw.date
            ? new Date(raw.date)
            : raw.createdAt?.toDate?.()
            ? raw.createdAt.toDate()
            : new Date(0);
          return {
            id: d.id,
            ...raw,
            date,
            hash: raw.hash || raw.polygonTxHash || null,
          };
        }).sort((a, b) => b.date - a.date);

        setTransactions(data);

        const { revenus, depenses, solde } = calculerFinances(data);
        setSolde(solde);
        setRevenus(revenus);
        setDepenses(depenses);
        setLoading(false);
      },
      () => {
        setTransactions([]);
        setRevenus(0);
        setDepenses(0);
        setSolde(0);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [coopId]);

  useEffect(() => {
    let data = [...transactions];
    if (activeFilter === 'revenu') data = data.filter((t) => t.type === 'revenu' || t.type === 'entree');
    else if (activeFilter === 'depense') data = data.filter((t) => t.type === 'depense' || t.type === 'sortie');
    else if (activeFilter === 'en_cours') {
      data = data.filter(
        (t) =>
          t.statut === 'en_cours'
          || t.statut === 'confirme'
          || !t.statut
          || t.statut === ''
      );
    }
    if (activeTypeFilter !== 'tous') {
      data = data.filter((t) => resolveTypeTransaction(t, metaFromTx(t)) === activeTypeFilter);
    }
    if (search.trim()) data = data.filter((t) => t.titre?.toLowerCase().includes(search.toLowerCase()));
    setFiltered(data);
  }, [activeFilter, activeTypeFilter, search, transactions]);

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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={{ marginTop: 12, color: '#6b7280' }}>Chargement depuis Firebase...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
            {revenus.toLocaleString('fr-FR')} FCFA
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Transactions</Text>
          <Text style={[styles.statValue, { color: '#7c3aed' }]}>{transactions.length}</Text>
        </View>
      </View>

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

      <View style={styles.filtersCard}>
        <Text style={styles.filterSectionTitle}>Flux</Text>
        <Text style={styles.filterSectionHint}>Revenus, dépenses ou transactions en cours</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterScrollContent}
        >
          {filters.map((f) => {
            const active = activeFilter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
                onPress={() => setActiveFilter(f.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipLabel, active ? styles.chipLabelActive : styles.chipLabelIdle]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.filterSectionDivider} />

        <Text style={styles.filterSectionTitle}>{"Type d'opération"}</Text>
        <Text style={styles.filterSectionHint}>{"Affinez par nature d'écriture (Firestore)"}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterScrollContent}
        >
          {typeTransactionFilters.map((f) => {
            const active = activeTypeFilter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
                onPress={() => setActiveTypeFilter(f.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipLabel, active ? styles.chipLabelActive : styles.chipLabelIdle]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {filtered.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={{ fontSize: 48, marginBottom: 12 }}>📭</Text>
          <Text style={styles.emptyText}>Aucune transaction trouvée</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={filtered}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          renderItem={({ item: tx }) => {
            const meta = metaFromTx(tx);
            const typeCle = resolveTypeTransaction(tx, meta);
            const badge = getBadgeType(typeCle);
            const statutColors = { valide: GREEN, en_cours: '#d97706', rejete: '#dc2626', annule: '#6b7280' };
            const statutLabels = { valide: 'Validé', en_cours: 'Vote en cours', rejete: 'Rejeté', annule: 'Annulé' };
            const justificatif = meta?.justificatif || tx.justificatif;
            const refPayment = meta?.referencePayment ?? tx.referencePayment;
            const prefixeMontant = badge.signe === '' ? '' : badge.signe;
            const montantFormate = `${prefixeMontant}${Number(tx.montant || 0).toLocaleString('fr-FR')} FCFA`;
            const hashPoly = tx.hash && String(tx.hash).startsWith('0x');

            return (
              <View
                style={{
                  backgroundColor: 'white',
                  borderRadius: 16,
                  marginBottom: 10,
                  padding: 14,
                  elevation: 2,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.06,
                  shadowRadius: 4,
                  borderLeftWidth: 4,
                  borderLeftColor: badge.couleur,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: badge.fondCouleur,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 8,
                    }}
                  >
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: badge.couleur,
                    }}
                    >
                      {badge.emoji} {badge.label}
                    </Text>
                  </View>
                  <Text style={{
                    fontSize: 16,
                    fontWeight: '800',
                    color: badge.couleur,
                  }}
                  >
                    {montantFormate}
                  </Text>
                </View>

                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: '#1f2937',
                    marginBottom: 4,
                  }}
                  numberOfLines={1}
                >
                  {tx.titre}
                </Text>

                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 12, color: '#9ca3af' }}>
                    📅 {formatDateShort(tx.date)}
                  </Text>
                  <View
                    style={{
                      backgroundColor: `${statutColors[tx.statut] || '#6b7280'}20`,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 6,
                    }}
                  >
                    <Text style={{
                      fontSize: 11,
                      fontWeight: '600',
                      color: statutColors[tx.statut] || '#6b7280',
                    }}
                    >
                      {statutLabels[tx.statut] || tx.statut}
                    </Text>
                  </View>
                </View>

                {hashPoly ? (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(polygonscanTxUrl(tx.hash))}
                    style={{ marginTop: 6 }}
                  >
                    <Text style={{ fontSize: 11, color: '#6b7280' }}>
                      🔗 {tx.hash.slice(0, 10)}...
                      {tx.hash.slice(-6)}
                      <Text style={{ color: '#2563eb' }}> ↗ Polygonscan</Text>
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {refPayment ? (
                  <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                    Réf: {String(refPayment)}
                  </Text>
                ) : null}

                {justificatif?.url ? (
                  <TouchableOpacity
                    style={styles.receiptBadge}
                    onPress={() => openReceipt(justificatif)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.receiptBadgeText}>📎 Voir le justificatif</Text>
                  </TouchableOpacity>
                ) : null}
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
  filtersCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  filterSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: GREEN_DARK,
    marginBottom: 2,
  },
  filterSectionHint: {
    fontSize: 11,
    color: '#94a3b8',
    marginBottom: 10,
    lineHeight: 15,
  },
  filterSectionDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 14,
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    marginRight: 8,
    borderWidth: 1.5,
  },
  chipActive: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  chipIdle: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  chipLabelActive: {
    color: '#fff',
  },
  chipLabelIdle: {
    color: '#475569',
  },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#6b7280' },
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
