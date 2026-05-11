import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
} from 'react-native';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { formaterMontant } from '../utils/soldeUtils';
import { getBadgeType } from '../utils/transactionTypes';
import { calculerScoreTransparence } from '../utils/scoreTransparence';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';
const COOP_NOM = 'CTA de Broukou';
const COOP_REGION = 'Région de la Kara';

function getDate(raw) {
  const d = raw?.toDate ? raw.toDate() : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ProgressBar({ value, max, color = GREEN }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

function DonutChart({ revenus, depenses }) {
  const total = revenus + depenses;
  if (total <= 0) return <Text style={styles.emptyChart}>Aucune donnée disponible</Text>;
  const pctEntrees = Math.round((revenus / total) * 100);
  const solde = revenus - depenses;
  return (
    <View style={styles.chartBox}>
      <View style={styles.donutOuter}>
        <View style={styles.donutHalfLeft} />
        <View style={styles.donutHalfRight} />
        <View style={styles.donutInner}>
          <Text style={styles.donutPct}>{pctEntrees}%</Text>
          <Text style={styles.donutLabel}>Entrées</Text>
        </View>
      </View>
      <View style={styles.legendRow}><View style={[styles.dot, { backgroundColor: GREEN }]} /><Text>Entrées : {formaterMontant(revenus)}</Text></View>
      <View style={styles.legendRow}><View style={[styles.dot, { backgroundColor: '#dc2626' }]} /><Text>Dépenses : {formaterMontant(depenses)}</Text></View>
      <View style={styles.sep} />
      <Text style={[styles.netText, { color: solde >= 0 ? GREEN_DARK : '#dc2626' }]}>
        Solde net : {formaterMontant(solde)}
      </Text>
    </View>
  );
}

function BarChart({ moisData }) {
  const maxValue = Math.max(1, ...moisData.map((m) => Math.max(m.entrees, m.depenses)));
  return (
    <View style={styles.barChartWrap}>
      <View style={styles.barLegend}>
        <Text style={styles.legendItem}>■ Entrées</Text>
        <Text style={[styles.legendItem, { color: '#dc2626' }]}>■ Dépenses</Text>
      </View>
      <View style={styles.barsRow}>
        {moisData.map((m) => {
          const hE = (m.entrees / maxValue) * 120;
          const hD = (m.depenses / maxValue) * 120;
          return (
            <View key={m.label} style={styles.monthCol}>
              <View style={styles.monthBars}>
                <View style={[styles.bar, { height: hE, backgroundColor: GREEN }]} />
                <View style={[styles.bar, { height: hD, backgroundColor: '#dc2626' }]} />
              </View>
              <Text style={styles.monthLabel}>{m.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function InstitutionDashboard({ userData }) {
  const [transactions, setTransactions] = useState([]);
  const [votes, setVotes] = useState([]);
  const [membresActifs, setMembresActifs] = useState([]);
  const [rapports, setRapports] = useState([]);
  const [loading, setLoading] = useState(true);

  const coopId = userData?.cooperativeId || 'broukou';

  useEffect(() => {
    const unsubs = [];
    let loaded = 0;
    const done = () => {
      loaded += 1;
      if (loaded >= 4) setLoading(false);
    };

    unsubs.push(onSnapshot(collection(db, 'transactions'), (s) => {
      setTransactions(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      done();
    }, done));

    unsubs.push(onSnapshot(collection(db, 'votes'), (s) => {
      setVotes(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      done();
    }, done));

    unsubs.push(onSnapshot(
      query(collection(db, 'users'), where('statut', '==', 'actif'), where('cooperativeId', '==', coopId)),
      (s) => {
        setMembresActifs(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        done();
      },
      done
    ));

    const rapportsQ = query(
      collection(db, 'rapports_envoyes'),
      where('cooperativeId', '==', coopId),
      orderBy('dateEnvoi', 'desc'),
      limit(12)
    );
    unsubs.push(onSnapshot(rapportsQ, (s) => {
      setRapports(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      done();
    }, done));

    return () => unsubs.forEach((u) => u && u());
  }, [coopId]);

  const txValides = useMemo(
    () => transactions.filter((t) => t?.statut === 'valide' && t?.cooperativeId === coopId),
    [transactions, coopId]
  );

  const revenus = useMemo(
    () => txValides
      .filter((t) => ['cotisation', 'mobile_money', 'main_a_main'].includes(t.typeTransaction))
      .reduce((a, t) => a + Number(t.montant || 0), 0),
    [txValides]
  );
  const depenses = useMemo(
    () => txValides
      .filter((t) => t.typeTransaction === 'depense')
      .reduce((a, t) => a + Number(t.montant || 0), 0),
    [txValides]
  );
  const solde = revenus - depenses;

  const score = useMemo(() => calculerScoreTransparence(txValides, votes), [txValides, votes]);

  const transactionsRecentes = useMemo(() => (
    [...txValides]
      .sort((a, b) => (getDate(b.date)?.getTime() || 0) - (getDate(a.date)?.getTime() || 0))
      .slice(0, 10)
  ), [txValides]);

  const moisData = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString('fr-FR', { month: 'short' });
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: label.charAt(0).toUpperCase() + label.slice(1, 3),
        entrees: 0,
        depenses: 0,
      });
    }
    txValides.forEach((t) => {
      const d = getDate(t.date);
      if (!d) return;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const item = months.find((m) => m.key === key);
      if (!item) return;
      const amount = Number(t.montant || 0);
      if (t.typeTransaction === 'depense') item.depenses += amount;
      else item.entrees += amount;
    });
    return months.map(({ key, ...rest }) => rest);
  }, [txValides]);

  function contacterCoop() {
    const subject = encodeURIComponent('Demande de financement - CTA de Broukou');
    const body = encodeURIComponent(
      `Bonjour, suite à la consultation du score de transparence CoopLedger de la coopérative CTA de Broukou (score: ${score.total}/100), nous souhaitons...`
    );
    const email = userData?.emailPresident || userData?.email || 'contact@coopledger.tg';
    Linking.openURL(`mailto:${email}?subject=${subject}&body=${body}`);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={styles.loadingText}>Chargement des données institutionnelles...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={styles.header}>
        <Text style={styles.logo}>🌱 CoopLedger</Text>
        <Text style={styles.title}>🏦 Espace Institution</Text>
        <Text style={styles.subtitle}>{userData?.nom || 'Institution'}</Text>
        <View style={styles.readOnlyBadge}><Text style={styles.readOnlyText}>Lecture seule</Text></View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>📊 Score de Transparence</Text>
        <Text style={styles.cardSub}>{COOP_NOM} · {COOP_REGION}</Text>
        <Text style={[styles.scoreValue, { color: score.couleur }]}>{score.total} / 100</Text>
        <ProgressBar value={score.total} max={100} color={score.couleur} />
        <Text style={[styles.scoreLine, { color: score.couleur }]}>{score.badge} {score.texte}</Text>
        <Text style={styles.scoreLine}>{score.texteElig}</Text>

        <Text style={styles.criteriaTitle}>Détail des critères :</Text>
        <Text style={styles.criteriaLabel}>🔗 Traçabilité {score.score1}/25</Text><ProgressBar value={score.score1} max={25} />
        <Text style={styles.criteriaLabel}>🗳️ Votes {score.score2}/25</Text><ProgressBar value={score.score2} max={25} />
        <Text style={styles.criteriaLabel}>📎 Justificatifs {score.score3}/20</Text><ProgressBar value={score.score3} max={20} />
        <Text style={styles.criteriaLabel}>📅 Activité {score.score4}/15</Text><ProgressBar value={score.score4} max={15} />
        <Text style={styles.criteriaLabel}>💰 Finances {score.score5}/15</Text><ProgressBar value={score.score5} max={15} />
      </View>

      <View style={styles.grid}>
        <View style={styles.statCard}><Text>💰 Solde total</Text><Text style={[styles.statValue, { color: solde >= 0 ? GREEN : '#dc2626' }]}>{formaterMontant(solde)}</Text></View>
        <View style={styles.statCard}><Text>📈 Total entrées</Text><Text style={[styles.statValue, { color: GREEN }]}>{formaterMontant(revenus)}</Text></View>
        <View style={styles.statCard}><Text>📉 Total dépenses</Text><Text style={[styles.statValue, { color: '#dc2626' }]}>{formaterMontant(depenses)}</Text></View>
        <View style={styles.statCard}><Text>👥 Membres actifs</Text><Text style={styles.statValue}>{membresActifs.length}</Text></View>
      </View>

      <View style={styles.card}><Text style={styles.cardTitle}>Répartition Entrées / Dépenses</Text><DonutChart revenus={revenus} depenses={depenses} /></View>
      <View style={styles.card}><Text style={styles.cardTitle}>Évolution sur 6 mois</Text><BarChart moisData={moisData} /></View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Transactions récentes</Text>
        {transactionsRecentes.map((tx) => {
          const badge = getBadgeType(tx.typeTransaction);
          const isDep = tx.typeTransaction === 'depense';
          const date = getDate(tx.date);
          const hash = String(tx.hash || '');
          return (
            <View key={tx.id} style={styles.txRow}>
              <View style={[styles.txBadge, { backgroundColor: badge.fondCouleur }]}><Text style={{ color: badge.couleur }}>{badge.emoji} {badge.label}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txTitle}>{tx.titre || 'Transaction'}</Text>
                <Text style={styles.txDate}>{date ? date.toLocaleDateString('fr-FR') : '-'}</Text>
                {hash ? <Text style={styles.txHash}>{hash.slice(0, 6)}...{hash.slice(-4)}</Text> : null}
              </View>
              <Text style={[styles.txAmount, { color: isDep ? '#dc2626' : GREEN }]}>{isDep ? '-' : '+'}{formaterMontant(tx.montant)}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Rapports mensuels</Text>
        {rapports.length === 0 ? (
          <Text style={styles.emptyText}>Aucun rapport disponible pour le moment.</Text>
        ) : rapports.map((r) => {
          const d = getDate(r.dateEnvoi);
          const mois = r.mois || 'Mois';
          const annee = r.annee || '';
          return (
            <View key={r.id} style={styles.reportItem}>
              <Text style={styles.reportTitle}>📄 Rapport {mois} {annee}</Text>
              <Text style={styles.reportMeta}>Envoyé le : {d ? d.toLocaleDateString('fr-FR') : '-'}</Text>
              <Text style={styles.reportMeta}>Membres notifiés : {Number(r.nombreNotifies || 0)}</Text>
              <TouchableOpacity
                style={styles.askBtn}
                onPress={() => Linking.openURL(`mailto:${userData?.email || 'contact@coopledger.tg'}?subject=${encodeURIComponent(`Demande rapport ${mois}`)}`)}
              >
                <Text style={styles.askBtnText}>📧 Demander ce rapport</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      <TouchableOpacity style={styles.contactBtn} onPress={contacterCoop}>
        <Text style={styles.contactBtnText}>📧 Contacter la coopérative</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  loadingText: { marginTop: 10, color: '#6b7280' },
  header: { backgroundColor: GREEN_DARK, padding: 18, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  logo: { color: '#fff', fontWeight: '900', fontSize: 20 },
  title: { color: '#fff', marginTop: 8, fontSize: 18, fontWeight: '900' },
  subtitle: { color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  readOnlyBadge: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  readOnlyText: { color: GREEN_DARK, fontWeight: '800', fontSize: 12 },
  card: { backgroundColor: '#fff', margin: 14, marginBottom: 0, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#e5e7eb' },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#111827', marginBottom: 4 },
  cardSub: { color: '#6b7280', marginBottom: 10 },
  scoreValue: { fontSize: 34, fontWeight: '900', textAlign: 'center', marginVertical: 8 },
  scoreLine: { fontWeight: '700', textAlign: 'center', marginTop: 5, color: '#374151' },
  criteriaTitle: { marginTop: 10, fontWeight: '800', color: '#111827' },
  criteriaLabel: { marginTop: 8, fontSize: 12, color: '#374151', fontWeight: '700' },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: '#e5e7eb', overflow: 'hidden', marginTop: 4 },
  progressFill: { height: '100%', borderRadius: 999 },
  grid: { paddingHorizontal: 14, marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%', backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  statValue: { fontWeight: '900', fontSize: 18, marginTop: 6, color: '#111827' },
  chartBox: { alignItems: 'center', marginTop: 10 },
  donutOuter: { width: 180, height: 180, borderRadius: 90, overflow: 'hidden', position: 'relative', backgroundColor: '#fff' },
  donutHalfLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', backgroundColor: GREEN },
  donutHalfRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', backgroundColor: '#dc2626' },
  donutInner: { position: 'absolute', width: 110, height: 110, borderRadius: 55, backgroundColor: '#fff', top: 35, left: 35, alignItems: 'center', justifyContent: 'center' },
  donutPct: { fontWeight: '900', fontSize: 24, color: '#111827' },
  donutLabel: { color: '#6b7280', fontSize: 12 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sep: { width: '100%', borderTopWidth: 1, borderTopColor: '#e5e7eb', marginTop: 10, paddingTop: 10 },
  netText: { fontWeight: '900' },
  emptyChart: { color: '#6b7280', marginTop: 8 },
  barChartWrap: { marginTop: 8 },
  barLegend: { flexDirection: 'row', gap: 14, marginBottom: 8 },
  legendItem: { color: GREEN, fontWeight: '700', fontSize: 12 },
  barsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  monthCol: { flex: 1, alignItems: 'center' },
  monthBars: { height: 120, flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  bar: { width: 10, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  monthLabel: { marginTop: 6, fontSize: 11, color: '#4b5563' },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingVertical: 10 },
  txBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  txTitle: { fontWeight: '800', color: '#111827', fontSize: 13 },
  txDate: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  txHash: { color: '#15803d', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  txAmount: { fontWeight: '900', fontSize: 12 },
  emptyText: { color: '#6b7280', marginTop: 8 },
  reportItem: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 10, marginTop: 8 },
  reportTitle: { fontWeight: '900', color: '#111827' },
  reportMeta: { color: '#6b7280', marginTop: 4, fontSize: 12 },
  askBtn: { marginTop: 8, backgroundColor: '#ecfdf5', borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  askBtnText: { color: GREEN_DARK, fontWeight: '800' },
  contactBtn: { margin: 14, backgroundColor: GREEN, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  contactBtnText: { color: '#fff', fontWeight: '900', fontSize: 16 },
});

