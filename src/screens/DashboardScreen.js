import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Linking,
} from 'react-native';
import { useVotes } from '../hooks/useBlockchain';
import { polygonscanTxUrl, formatFCFA } from '../config/blockchain';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { calculerFinances, estEntree } from '../utils/calculsFinanciers';
import { estPresidentOuTresorier } from '../utils/roles';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';

function formatDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function DashboardScreen({ userData, navigation }) {
  const { votes, refetch: refetchVotes } = useVotes();
  const [transactions, setTransactions] = useState([]);
  const [solde, setSolde] = useState(0);
  const [revenus, setRevenus] = useState(0);
  const [depenses, setDepenses] = useState(0);
  const [txLoading, setTxLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(new Date());
  const [appelsActifs, setAppelsActifs] = useState([]);
  const [nbDemandes, setNbDemandes] = useState(0);

  const coopId = userData?.cooperativeId || 'broukou';

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const qTx = query(
      collection(db, 'transactions'),
      where('cooperativeId', '==', coopId),
      limit(50)
    );
    const unsubTx = onSnapshot(qTx, (snap) => {
      const data = snap.docs.map((d) => {
        const raw = d.data();
        const date = raw.date?.toDate?.()
          ? raw.date.toDate()
          : raw.date ? new Date(raw.date)
          : raw.createdAt?.toDate?.() ? raw.createdAt.toDate()
          : new Date(0);
        return {
          id: d.id,
          ...raw,
          date,
          hash: raw.hash || raw.polygonTxHash || null,
        };
      }).sort((a, b) => b.date - a.date);

      setTransactions(data);

      const { revenus: rev, depenses: dep, solde: sol } = calculerFinances(data);
      setRevenus(rev);
      setDepenses(dep);
      setSolde(sol);
      setTxLoading(false);
    }, () => {
      setTransactions([]);
      setRevenus(0);
      setDepenses(0);
      setSolde(0);
      setTxLoading(false);
    });
    return () => unsubTx();
  }, [coopId]);

  useEffect(() => {
    const q = query(
      collection(db, 'appels_fonds'),
      where('cooperativeId', '==', coopId),
      where('statut', '==', 'actif')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => {
          const ta = a?.dateCreation?.toDate ? a.dateCreation.toDate().getTime() : 0;
          const tb = b?.dateCreation?.toDate ? b.dateCreation.toDate().getTime() : 0;
          return tb - ta;
        });
        setAppelsActifs(data || []);
      },
      (err) => {
        console.error('appels_fonds error:', err);
        setAppelsActifs([]);
      }
    );
    return () => unsub();
  }, [coopId]);

  useEffect(() => {
    if (userData?.role !== 'president') {
      setNbDemandes(0);
      return undefined;
    }
    const qDem = query(
      collection(db, 'demandes_compte'),
      where('statut', '==', 'en_attente'),
      where('cooperativeId', '==', coopId)
    );
    const unsub = onSnapshot(
      qDem,
      (snap) => setNbDemandes(snap.size),
      () => setNbDemandes(0)
    );
    return () => unsub();
  }, [userData?.role, coopId]);

  async function onRefresh() {
    setRefreshing(true);
    await refetchVotes();
    setRefreshing(false);
  }

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

      {estPresidentOuTresorier(userData) ? (
        <View style={styles.quickLinks}>
          <TouchableOpacity onPress={() => navigation.navigate('Profil', { screen: 'RapportMensuel' })}>
            <Text style={styles.quickLinkText}>📄 Rapport mensuel</Text>
          </TouchableOpacity>
          {userData?.role === 'president' ? (
            <TouchableOpacity onPress={() => navigation.navigate('Membres')}>
              <Text style={styles.quickLinkText}>👥 Membres</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

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

      {userData?.role === 'president' && nbDemandes > 0 ? (
        <TouchableOpacity
          style={styles.demandesBanner}
          onPress={() => navigation.navigate('Membres')}
        >
          <Text style={{ fontSize: 20 }}>👤</Text>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.demandesBannerTitle}>
              {nbDemandes} demande{nbDemandes > 1 ? 's' : ''} en attente
            </Text>
            <Text style={styles.demandesBannerSub}>
              Appuyez pour valider ou refuser
            </Text>
          </View>
          <Text style={{ color: '#b45309' }}>→</Text>
        </TouchableOpacity>
      ) : null}

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

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Appels de fonds actifs</Text>
        </View>
        {appelsActifs.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>Aucun appel de fonds actif</Text>
          </View>
        ) : appelsActifs.map((appel) => {
          const totalAttendu = Number(appel.totalAttendu || 0);
          const totalCollecte = Number(appel.totalCollecte || 0);
          const nbPaye = Array.isArray(appel.membresAyantPaye) ? appel.membresAyantPaye.length : 0;
          const nbCibles = Math.max(1, Math.round(totalAttendu / Math.max(Number(appel.montantParMembre || 1), 1)));
          const progressPct = Math.min(100, Math.round((totalCollecte / Math.max(totalAttendu, 1)) * 100));
          const aPaye = Array.isArray(appel.membresAyantPaye) && appel.membresAyantPaye.includes(userData?.uid);
          const d = appel?.dateEcheance?.toDate ? appel.dateEcheance.toDate() : new Date(appel.dateEcheance);
          return (
            <View key={appel.id} style={styles.appelCard}>
              <Text style={styles.appelTitle}>💰 {appel.titre}</Text>
              <Text style={styles.appelMeta}>Demandé par : {appel.creeParNom || 'Trésorier'}</Text>
              <Text style={styles.appelMeta}>Montant : {Number(appel.montantParMembre || 0).toLocaleString('fr-FR')} FCFA / membre</Text>
              <Text style={styles.appelMeta}>Échéance : {formatDate(d)}</Text>
              <Text style={styles.appelMeta}>Progression :</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
              </View>
              <Text style={styles.appelMeta}>{nbPaye}/{nbCibles} membres ont payé</Text>
              <Text style={styles.appelMeta}>{totalCollecte.toLocaleString('fr-FR')} / {totalAttendu.toLocaleString('fr-FR')} FCFA collectés</Text>
              {aPaye ? (
                <View style={styles.payeBadge}><Text style={styles.payeBadgeText}>✅ Vous avez payé</Text></View>
              ) : (
                <TouchableOpacity
                  style={styles.payBtn}
                  onPress={() => navigation.navigate('PaiementAppel', { appel })}
                >
                  <Text style={styles.payBtnText}>💳 Payer maintenant</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      {userData?.role === 'membre' && (
        <TouchableOpacity
          style={styles.cotisationBtn}
          onPress={() => navigation.navigate('MobileMoney', { userData })}
        >
          <Text style={styles.cotisationBtnText}>💳 Payer ma cotisation</Text>
        </TouchableOpacity>
      )}

      {estPresidentOuTresorier(userData) && (
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
            <Text style={styles.emptyText}>Chargement depuis Firebase...</Text>
          </View>
        ) : transactions.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>📋</Text>
            <Text style={styles.emptyText}>Aucune transaction pour le moment</Text>
            <Text style={styles.emptySubText}>Les transactions validées apparaîtront ici depuis le registre Firebase</Text>
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
  const isEntree = estEntree(tx);
  const montant = Number(tx.montant || 0);
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
          {isEntree ? '+' : '-'}{montant.toLocaleString('fr-FR')}
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
  quickLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  quickLinkText: { color: GREEN, fontWeight: '700', fontSize: 13 },
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
  demandesBanner: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  demandesBannerTitle: { fontWeight: '700', color: '#92400e' },
  demandesBannerSub: { fontSize: 12, color: '#b45309', marginTop: 2 },
  cotisationBtn: {
    backgroundColor: '#15803d',
    borderRadius: 16,
    padding: 18,
    marginHorizontal: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#15803d',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  cotisationBtnText: { color: 'white', fontSize: 16, fontWeight: '800' },
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
  appelCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  appelTitle: { fontSize: 14, fontWeight: '900', color: '#111827' },
  appelMeta: { marginTop: 4, color: '#4b5563', fontSize: 12 },
  progressTrack: { height: 10, borderRadius: 8, backgroundColor: '#e5e7eb', marginTop: 8, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: GREEN, borderRadius: 8 },
  payeBadge: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#dcfce7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  payeBadgeText: { color: GREEN_DARK, fontWeight: '800', fontSize: 12 },
  payBtn: { marginTop: 10, backgroundColor: GREEN, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
  payBtnText: { color: '#fff', fontWeight: '800' },
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
