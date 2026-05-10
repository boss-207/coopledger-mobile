import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Linking,
} from 'react-native';
import { useTransactions, useSolde, useVotes } from '../hooks/useBlockchain';
import { polygonscanTxUrl, formatFCFA } from '../config/blockchain';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';
const GREEN_LIGHT = '#dcfce7';

function formatDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function DashboardScreen({ userData, navigation }) {
  const { transactions, loading: txLoading, refetch: refetchTx } = useTransactions();
  const { solde, loading: soldeLoading, refetch: refetchSolde } = useSolde();
  const { votes, loading: votesLoading, refetch: refetchVotes } = useVotes();
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refetchTx(), refetchSolde(), refetchVotes()]);
    setRefreshing(false);
  }

  const validTx = transactions.filter(t => t.statut === 'valide');
  const depenses = validTx
    .filter(t => t.type === 'sortie' || t.type === 'depense')
    .reduce((a, t) => a + t.montant, 0);
  const revenus = validTx
    .filter(t => t.type === 'entree' || t.type === 'revenu')
    .reduce((a, t) => a + t.montant, 0);

  const peutCreer = userData?.role === 'tresorier' || userData?.role === 'president';
  const roleColors = { president: '#7c3aed', tresorier: '#2563eb', membre: GREEN };
  const roleLabels = { president: '🛡️ Président', tresorier: '🏦 Trésorier', membre: '👤 Membre' };

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
    >
      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Bonjour, {userData?.nom?.split(' ')[0]} 👋</Text>
          <Text style={styles.date}>
            {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
        </View>
        <View style={[styles.roleBadge, { backgroundColor: (roleColors[userData?.role] || GREEN) + '20' }]}>
          <Text style={[styles.roleText, { color: roleColors[userData?.role] || GREEN }]}>
            {roleLabels[userData?.role] || userData?.role}
          </Text>
        </View>
      </View>

      {/* ALERTE VOTE */}
      {votes.length > 0 && (
        <TouchableOpacity style={styles.alertBox} onPress={() => navigation.navigate('Votes')}>
          <Text style={{ fontSize: 22 }}>⚡</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.alertTitle}>{votes.length} vote{votes.length > 1 ? 's' : ''} en attente</Text>
            <Text style={styles.alertSub}>{votes[0]?.titre}</Text>
          </View>
          <Text style={styles.alertArrow}>→</Text>
        </TouchableOpacity>
      )}

      {/* CARTE SOLDE */}
      <View style={styles.soldeCard}>
        <View style={styles.soldeOverlay} />
        <Text style={styles.soldeLabel}>🛡️ TRÉSORERIE DE LA COOPÉRATIVE</Text>
        <Text style={styles.soldeSub}>Solde Total</Text>
        <Text style={styles.soldeAmount}>
          {Math.abs(solde) >= 1000000
            ? `${(solde / 1000000).toFixed(3)}`
            : solde.toLocaleString('fr-FR')}
        </Text>
        <Text style={styles.soldeCurrency}>
          {Math.abs(solde) >= 1000000 ? 'M FCFA' : 'FCFA'}
        </Text>
        <View style={styles.hashBox}>
          <Text style={styles.hashLabel}>🔗 Sécurisé par Blockchain · Polygon Amoy</Text>
          {transactions[0]?.hash ? (
            <TouchableOpacity onPress={() => Linking.openURL(polygonscanTxUrl(transactions[0].hash))}>
              <Text style={styles.hashValue}>
                {transactions[0].hash.slice(0, 18)}... (cliquer pour vérifier)
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.hashValue}>En attente de transactions...</Text>
          )}
          <Text style={styles.hashNetwork}>Polygon Amoy Testnet · Données en temps réel</Text>
        </View>
      </View>

      {/* 3 STATS */}
      <View style={styles.statsRow}>
        <StatCard icon="🏦" label="Fonds Totaux" value={formatFCFA(solde)} color={GREEN} bg="#f0fdf4" />
        <StatCard icon="📉" label="Dépenses" value={formatFCFA(depenses)} color="#dc2626" bg="#fef2f2" />
        <StatCard icon="📈" label="Revenus" value={formatFCFA(revenus)} color="#2563eb" bg="#eff6ff" />
      </View>

      {/* BOUTON NOUVELLE TRANSACTION */}
      {peutCreer && (
        <TouchableOpacity
          style={styles.newTxBtn}
          onPress={() => navigation.navigate('NouvelleTransaction')}
        >
          <Text style={styles.newTxBtnText}>➕  Nouvelle Transaction</Text>
        </TouchableOpacity>
      )}

      {/* TRANSACTIONS RÉCENTES */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Transactions Récentes</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Historique')}>
            <Text style={styles.sectionLink}>Voir tout →</Text>
          </TouchableOpacity>
        </View>

        {txLoading ? (
          <View style={styles.emptyBox}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>⏳</Text>
            <Text style={styles.emptyText}>Chargement depuis Polygon...</Text>
          </View>
        ) : transactions.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>📋</Text>
            <Text style={styles.emptyText}>Aucune transaction pour le moment</Text>
            <Text style={styles.emptySubText}>Les transactions apparaîtront ici depuis la blockchain</Text>
          </View>
        ) : (
          transactions.slice(0, 5).map((tx, i) => (
            <TxRow key={`${tx.id}-${i}`} tx={tx} />
          ))
        )}
      </View>

      {/* SÉCURITÉ BLOCKCHAIN */}
      <View style={styles.securityCard}>
        <Text style={{ fontSize: 32, marginBottom: 8 }}>🔒</Text>
        <Text style={styles.securityTitle}>Sécurité Immuable</Text>
        <Text style={styles.securitySub}>
          Toutes les transactions sont signées cryptographiquement sur Polygon Amoy.
          Vérifiables par tous sur Polygonscan.
        </Text>
        <TouchableOpacity
          style={styles.polygonscanBtn}
          onPress={() => Linking.openURL('https://amoy.polygonscan.com')}
        >
          <Text style={styles.polygonscanBtnText}>🔗 Vérifier sur Polygonscan</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

function StatCard({ icon, label, value, color, bg }) {
  return (
    <View style={[styles.statCard, { backgroundColor: bg }]}>
      <Text style={{ fontSize: 22, marginBottom: 6 }}>{icon}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

function TxRow({ tx }) {
  const isEntree = tx.type === 'entree' || tx.type === 'revenu';
  const statutColors = { valide: GREEN, en_cours: '#d97706', rejete: '#dc2626', annule: '#6b7280' };
  const statutLabels = { valide: 'Validé', en_cours: 'Vote en cours', rejete: 'Rejeté', annule: 'Annulé' };

  const hashCourt = tx.hash ? `${tx.hash.slice(0, 8)}...${tx.hash.slice(-4)}` : '0x...';

  return (
    <TouchableOpacity
      style={styles.txRow}
      onPress={() => tx.hash && Linking.openURL(polygonscanTxUrl(tx.hash))}
      disabled={!tx.hash}
    >
      <View style={[styles.txIcon, { backgroundColor: isEntree ? '#dcfce7' : '#fee2e2' }]}>
        <Text style={{ fontSize: 16 }}>{isEntree ? '↑' : '↓'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.txTitle} numberOfLines={1}>{tx.titre}</Text>
        <Text style={styles.txHash} numberOfLines={1}>🔗 {hashCourt}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.txAmount, { color: isEntree ? GREEN : '#dc2626' }]}>
          {isEntree ? '+' : '-'}{tx.montant.toLocaleString('fr-FR')}
        </Text>
        <View style={[styles.txStatut, { backgroundColor: (statutColors[tx.statut] || '#6b7280') + '20' }]}>
          <Text style={[styles.txStatutText, { color: statutColors[tx.statut] || '#6b7280' }]}>
            {statutLabels[tx.statut] || tx.statut}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  greeting: { fontSize: 22, fontWeight: '800', color: '#111827' },
  date: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  roleText: { fontSize: 13, fontWeight: '700' },
  alertBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20,
    marginBottom: 12, backgroundColor: '#fffbeb', borderWidth: 1.5, borderColor: '#f59e0b',
    borderRadius: 16, padding: 14,
  },
  alertTitle: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  alertSub: { fontSize: 12, color: '#b45309', marginTop: 2 },
  alertArrow: { fontSize: 18, color: '#f59e0b', fontWeight: '700' },
  soldeCard: {
    marginHorizontal: 20, marginBottom: 16, backgroundColor: GREEN_DARK,
    borderRadius: 24, padding: 24, overflow: 'hidden',
    shadowColor: GREEN_DARK, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, elevation: 8,
  },
  soldeOverlay: {
    position: 'absolute', top: -40, right: -40, width: 160, height: 160,
    borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  soldeLabel: { fontSize: 11, fontWeight: '700', color: '#86efac', letterSpacing: 1, marginBottom: 4 },
  soldeSub: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 4 },
  soldeAmount: { fontSize: 52, fontWeight: '900', color: '#fff', lineHeight: 60 },
  soldeCurrency: { fontSize: 20, fontWeight: '600', color: '#86efac', marginBottom: 16 },
  hashBox: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 12 },
  hashLabel: { fontSize: 12, color: '#86efac', fontWeight: '600', marginBottom: 4 },
  hashValue: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' },
  hashNetwork: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 16 },
  statCard: { flex: 1, borderRadius: 16, padding: 14, alignItems: 'center' },
  statLabel: { fontSize: 11, color: '#6b7280', marginBottom: 4, textAlign: 'center' },
  statValue: { fontSize: 14, fontWeight: '800', textAlign: 'center' },
  newTxBtn: {
    marginHorizontal: 20, marginBottom: 20, backgroundColor: GREEN,
    borderRadius: 16, paddingVertical: 16, alignItems: 'center',
    shadowColor: GREEN_DARK, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, elevation: 6,
  },
  newTxBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  section: {
    marginHorizontal: 20, backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, elevation: 3,
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  sectionLink: { fontSize: 13, color: GREEN, fontWeight: '600' },
  emptyBox: { alignItems: 'center', paddingVertical: 24 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#6b7280' },
  emptySubText: { fontSize: 13, color: '#9ca3af', marginTop: 4, textAlign: 'center' },
  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  txIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  txTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  txHash: { fontSize: 11, color: GREEN, fontFamily: 'monospace', marginTop: 2 },
  txAmount: { fontSize: 14, fontWeight: '700' },
  txStatut: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 4 },
  txStatutText: { fontSize: 11, fontWeight: '600' },
  securityCard: {
    marginHorizontal: 20, backgroundColor: GREEN_DARK, borderRadius: 20,
    padding: 20, marginBottom: 16, alignItems: 'center',
  },
  securityTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  securitySub: { fontSize: 13, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  polygonscanBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12,
  },
  polygonscanBtnText: { color: '#86efac', fontSize: 14, fontWeight: '700' },
});
