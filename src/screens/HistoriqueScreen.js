import React, { useState, useEffect, useMemo } from 'react';
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
const GREEN_LIGHT = '#dcfce7';
const BORDER = '#e5e7eb';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function formatGroupHeader(d) {
  if (!d) return 'Date inconnue';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const sameDay = (a, b) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();

  if (sameDay(date, today)) return "Aujourd'hui";
  if (sameDay(date, yesterday)) return 'Hier';
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function toJsDate(uploadedAt) {
  if (!uploadedAt) return null;
  if (typeof uploadedAt.toDate === 'function') return uploadedAt.toDate();
  if (uploadedAt instanceof Date) return uploadedAt;
  return new Date(uploadedAt);
}

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

// ─── Constantes d'affichage ──────────────────────────────────────────────────

const STATUT_COLORS = {
  valide: GREEN,
  en_cours: '#d97706',
  rejete: '#dc2626',
  annule: '#6b7280',
};

const STATUT_LABELS = {
  valide: 'Validé',
  en_cours: 'En cours',
  rejete: 'Rejeté',
  annule: 'Annulé',
};

const filters = [
  { key: 'tout',    label: 'Tout' },
  { key: 'revenu',  label: '📈 Revenus' },
  { key: 'depense', label: '📉 Dépenses' },
  { key: 'en_cours',label: '⏳ En cours' },
];

const typeTransactionFilters = [
  { key: 'tous',         label: 'Tous' },
  { key: 'cotisation',   label: '💰' },
  { key: 'depense',      label: '📉' },
  { key: 'mobile_money', label: '📱' },
  { key: 'main_a_main',  label: '🤝' },
  { key: 'vente_recolte',label: '🌾' },
  { key: 'subvention',   label: '🎁' },
  { key: 'remboursement',label: '🔄' },
  { key: 'gouvernance',  label: '🏛️' },
];

// ─── Composant principal ─────────────────────────────────────────────────────

export default function HistoriqueScreen({ userData }) {
  const coopId = userData?.cooperativeId || 'broukou';

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [solde, setSolde]               = useState(0);
  const [revenus, setRevenus]           = useState(0);
  const [depenses, setDepenses]         = useState(0);
  const [filtered, setFiltered]         = useState([]);
  const [search, setSearch]             = useState('');
  const [activeFilter, setActiveFilter] = useState('tout');
  const [activeTypeFilter, setActiveTypeFilter] = useState('tous');
  const [receiptModal, setReceiptModal] = useState({
    visible: false, url: null, nom: '', dateLabel: '',
  });

  // ── Chargement Firestore ──────────────────────────────────────────────────
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
        const calc = calculerFinances(data);
        setSolde(calc.solde);
        setRevenus(calc.revenus);
        setDepenses(calc.depenses);
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

  // ── Filtrage ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let data = [...transactions];
    if (activeFilter === 'revenu')
      data = data.filter((t) => t.type === 'revenu' || t.type === 'entree');
    else if (activeFilter === 'depense')
      data = data.filter((t) => t.type === 'depense' || t.type === 'sortie');
    else if (activeFilter === 'en_cours')
      data = data.filter((t) =>
        t.statut === 'en_cours' || t.statut === 'confirme' || !t.statut || t.statut === ''
      );
    if (activeTypeFilter !== 'tous')
      data = data.filter((t) => resolveTypeTransaction(t, metaFromTx(t)) === activeTypeFilter);
    if (search.trim())
      data = data.filter((t) => t.titre?.toLowerCase().includes(search.toLowerCase()));
    setFiltered(data);
  }, [activeFilter, activeTypeFilter, search, transactions]);

  // ── Groupement par date ───────────────────────────────────────────────────
  const flatItems = useMemo(() => {
    const groups = {};
    filtered.forEach((tx) => {
      const key = tx.date instanceof Date && !Number.isNaN(tx.date.getTime())
        ? tx.date.toDateString()
        : 'unknown';
      if (!groups[key]) groups[key] = { date: tx.date, txs: [] };
      groups[key].txs.push(tx);
    });

    const result = [];
    Object.values(groups).forEach(({ date, txs }) => {
      result.push({ type: 'header', date, key: `h-${date?.toDateString?.() || Math.random()}` });
      txs.forEach((tx) => result.push({ type: 'item', tx, key: tx.id }));
    });
    return result;
  }, [filtered]);

  // ── Justificatifs ─────────────────────────────────────────────────────────
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

  // ── Chargement ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={{ marginTop: 12, color: '#6b7280', fontSize: 14 }}>
          Chargement du registre…
        </Text>
      </View>
    );
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* ── Bandeau stats ── */}
      <View style={styles.statsBox}>
        <View style={styles.statItem}>
          <Text style={styles.statEmoji}>💰</Text>
          <Text style={styles.statLabel}>Solde</Text>
          <Text style={[styles.statValue, { color: solde >= 0 ? GREEN : '#dc2626' }]}>
            {Math.abs(solde) >= 1000000
              ? `${(solde / 1000000).toFixed(2)}M`
              : solde.toLocaleString('fr-FR')}
          </Text>
          <Text style={styles.statCurrency}>FCFA</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statItem}>
          <Text style={styles.statEmoji}>📈</Text>
          <Text style={styles.statLabel}>Revenus</Text>
          <Text style={[styles.statValue, { color: '#2563eb' }]}>
            {revenus >= 1000000
              ? `${(revenus / 1000000).toFixed(2)}M`
              : revenus.toLocaleString('fr-FR')}
          </Text>
          <Text style={styles.statCurrency}>FCFA</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statItem}>
          <Text style={styles.statEmoji}>📋</Text>
          <Text style={styles.statLabel}>Total</Text>
          <Text style={[styles.statValue, { color: '#7c3aed' }]}>{transactions.length}</Text>
          <Text style={styles.statCurrency}>opérations</Text>
        </View>
      </View>

      {/* ── Barre de recherche ── */}
      <View style={styles.searchBox}>
        <Text style={{ fontSize: 15, marginRight: 8 }}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher une transaction…"
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Text style={{ color: '#9ca3af', fontSize: 18 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Filtres par type (icônes) ── */}
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

      {/* ── Filtres Revenus / Dépenses / En cours ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersScroll}
      >
        {filters.map((f) => (
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
      </ScrollView>

      {/* ── Liste groupée ── */}
      {flatItems.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={{ fontSize: 52, marginBottom: 12 }}>📭</Text>
          <Text style={styles.emptyText}>Aucune transaction trouvée</Text>
          <Text style={styles.emptySub}>
            {search.trim() ? 'Essayez un autre mot-clé.' : 'Les transactions apparaîtront ici.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={flatItems}
          keyExtractor={(item) => item.key}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
          renderItem={({ item }) => {
            // ── En-tête de groupe date ──
            if (item.type === 'header') {
              return (
                <View style={styles.dateHeader}>
                  <View style={styles.dateHeaderLine} />
                  <Text style={styles.dateHeaderText}>
                    {formatGroupHeader(item.date)}
                  </Text>
                  <View style={styles.dateHeaderLine} />
                </View>
              );
            }

            // ── Carte transaction ──
            const tx     = item.tx;
            const meta   = metaFromTx(tx);
            const typeCle = resolveTypeTransaction(tx, meta);
            const badge  = getBadgeType(typeCle);
            const justificatif = meta?.justificatif || tx.justificatif;
            const refPayment   = meta?.referencePayment ?? tx.referencePayment;
            const prefixe      = badge.signe === '' ? '' : badge.signe;
            const montantFormate = `${prefixe}${Number(tx.montant || 0).toLocaleString('fr-FR')} FCFA`;
            const hashPoly     = tx.hash && String(tx.hash).startsWith('0x');
            const statutColor  = STATUT_COLORS[tx.statut] || '#6b7280';
            const statutLabel  = STATUT_LABELS[tx.statut] || tx.statut || '—';

            return (
              <View style={[styles.txCard, { borderLeftColor: badge.couleur }]}>

                {/* Ligne 1 : badge type + montant */}
                <View style={styles.txRow1}>
                  <View style={[styles.typeBadge, { backgroundColor: badge.fondCouleur }]}>
                    <Text style={[styles.typeBadgeText, { color: badge.couleur }]}>
                      {badge.emoji} {badge.label}
                    </Text>
                  </View>
                  <Text style={[styles.txMontant, { color: badge.couleur }]}>
                    {montantFormate}
                  </Text>
                </View>

                {/* Titre */}
                <Text style={styles.txTitre} numberOfLines={1}>
                  {tx.titre || '—'}
                </Text>

                {/* Ligne 2 : date + statut */}
                <View style={styles.txRow2}>
                  <Text style={styles.txDate}>
                    🕐 {formatDateShort(tx.date)}
                  </Text>
                  <View style={[styles.statutBadge, { backgroundColor: `${statutColor}18` }]}>
                    <View style={[styles.statutDot, { backgroundColor: statutColor }]} />
                    <Text style={[styles.statutText, { color: statutColor }]}>
                      {statutLabel}
                    </Text>
                  </View>
                </View>

                {/* Hash blockchain */}
                {hashPoly ? (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(polygonscanTxUrl(tx.hash))}
                    style={styles.hashRow}
                  >
                    <Text style={styles.hashText}>
                      🔗 {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
                      {'  '}
                      <Text style={{ color: '#2563eb', fontWeight: '700' }}>↗ Polygonscan</Text>
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {/* Référence paiement */}
                {refPayment ? (
                  <Text style={styles.refText}>Réf : {String(refPayment)}</Text>
                ) : null}

                {/* Justificatif */}
                {justificatif?.url ? (
                  <TouchableOpacity
                    style={styles.receiptBtn}
                    onPress={() => openReceipt(justificatif)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.receiptBtnText}>📎 Voir le justificatif</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {/* ── Modal justificatif ── */}
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
            Uploadé par {receiptModal.nom}
            {receiptModal.dateLabel ? ` le ${receiptModal.dateLabel}` : ''}
          </Text>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // ── Stats ──
  statsBox: {
    flexDirection: 'row',
    backgroundColor: GREEN_DARK,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 12,
    borderRadius: 20,
    padding: 16,
    elevation: 6,
    shadowColor: GREEN_DARK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  statItem:    { flex: 1, alignItems: 'center' },
  statEmoji:   { fontSize: 20, marginBottom: 3 },
  statLabel:   { fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: '600', letterSpacing: 0.5, marginBottom: 2 },
  statValue:   { fontSize: 17, fontWeight: '900' },
  statCurrency:{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 4 },

  // ── Recherche ──
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1.5,
    borderColor: BORDER,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#111827' },

  // ── Filtres type ──
  typeFiltersScroll: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    alignItems: 'center',
    gap: 8,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    marginRight: 6,
  },
  typeChipActive:   { backgroundColor: GREEN },
  typeChipInactive: { backgroundColor: '#f1f5f9', borderWidth: 1.5, borderColor: BORDER },
  typeChipText:     { fontSize: 14, fontWeight: '800' },
  typeChipTextActive:   { color: '#fff' },
  typeChipTextInactive: { color: '#64748b' },

  // ── Filtres revenus/dépenses ──
  filtersScroll: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    alignItems: 'center',
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: BORDER,
    marginRight: 6,
  },
  filterBtnActive: { backgroundColor: GREEN, borderColor: GREEN },
  filterText:      { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  filterTextActive:{ color: '#fff' },

  // ── En-tête de date ──
  dateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 8,
    gap: 10,
  },
  dateHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dateHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 4,
  },

  // ── Carte transaction ──
  txCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 8,
    padding: 14,
    borderLeftWidth: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  txRow1: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  typeBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  txMontant: {
    fontSize: 16,
    fontWeight: '900',
  },
  txTitre: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 6,
  },
  txRow2: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  txDate: {
    fontSize: 12,
    color: '#9ca3af',
  },
  statutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    gap: 5,
  },
  statutDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statutText: {
    fontSize: 11,
    fontWeight: '700',
  },
  hashRow: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  hashText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  refText: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 3,
  },
  receiptBtn: {
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: GREEN_LIGHT,
    borderRadius: 10,
    alignItems: 'center',
  },
  receiptBtnText: {
    color: GREEN_DARK,
    fontWeight: '700',
    fontSize: 13,
  },

  // ── Vide ──
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
  },

  // ── Modal justificatif ──
  modalRoot:   { flex: 1, backgroundColor: '#0f172a' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: GREEN_DARK,
  },
  modalTitle:     { color: '#fff', fontSize: 18, fontWeight: '800' },
  modalClose:     {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalCloseText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  modalImage:     { flex: 1, width: '100%', backgroundColor: '#0f172a' },
  modalMeta: {
    color: '#e2e8f0',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: GREEN_DARK,
  },
});