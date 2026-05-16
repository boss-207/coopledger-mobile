import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Alert,
  Animated,
} from 'react-native';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { formaterMontant } from '../utils/soldeUtils';
import { getBadgeType } from '../utils/transactionTypes';
import { calculerScoreTransparence } from '../utils/scoreTransparence';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';
const GREEN_LIGHT = '#dcfce7';
const RED = '#dc2626';
const RED_LIGHT = '#fee2e2';
const COOP_NOM = 'CTA de Broukou';
const COOP_REGION = 'Région de la Kara · Togo';

function getDate(raw) {
  const d = raw?.toDate ? raw.toDate() : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Barre de progression animée
function ProgressBar({ value, max, color = GREEN }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const anim = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: pct,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressFill, { width, backgroundColor: color }]} />
    </View>
  );
}

// ── Vrai Donut Chart dynamique (SVG simulé avec Views et rotations)
function DonutChart({ revenus, depenses }) {
  const total = revenus + depenses;

  if (total <= 0) {
    return (
      <View style={styles.donutEmpty}>
        <Text style={styles.donutEmptyText}>Aucune donnée disponible</Text>
      </View>
    );
  }

  const pctEntrees = Math.round((revenus / total) * 100);
  const pctDepenses = 100 - pctEntrees;
  const solde = revenus - depenses;

  // Angle de rotation pour la part verte (entrées)
  // On utilise 2 demi-cercles avec rotation pour simuler un vrai donut
  // La part verte couvre pctEntrees% du cercle
  const degEntrees = (pctEntrees / 100) * 360;

  // Pour les cas extrêmes (>50% ou <50%)
  const showSecondGreen = degEntrees > 180;

  return (
    <View style={styles.donutContainer}>
      {/* Cercle donut */}
      <View style={styles.donutWrapper}>
        {/* Fond rouge = dépenses (100%) */}
        <View style={[styles.donutCircle, { backgroundColor: RED }]}>

          {/* Cas 1 : Entrées <= 50% — on couvre une partie du rouge */}
          {!showSecondGreen && (
            <View style={[styles.donutHalf, { backgroundColor: RED }]}>
              <View
                style={[
                  styles.donutHalf,
                  {
                    backgroundColor: GREEN,
                    transform: [{ rotate: `${degEntrees}deg` }],
                  },
                ]}
              />
            </View>
          )}

          {/* Cas 2 : Entrées > 50% — on commence par tout colorier en vert, puis on masque */}
          {showSecondGreen && (
            <>
              {/* Moitié gauche verte fixe */}
              <View style={[styles.donutHalfLeft, { backgroundColor: GREEN }]} />
              {/* Moitié droite avec rotation pour la part restante */}
              <View
                style={[
                  styles.donutHalfRight,
                  {
                    backgroundColor: GREEN,
                    transform: [{ rotate: `${degEntrees - 180}deg` }],
                    transformOrigin: 'left center',
                  },
                ]}
              />
            </>
          )}

          {/* Trou central blanc — effet donut */}
          <View style={styles.donutHole}>
            <Text style={styles.donutPct}>{pctEntrees}%</Text>
            <Text style={styles.donutPctLabel}>Entrées</Text>
          </View>
        </View>
      </View>

      {/* Légende */}
      <View style={styles.donutLegend}>
        <View style={styles.donutLegendRow}>
          <View style={[styles.donutLegendDot, { backgroundColor: GREEN }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.donutLegendLabel}>Entrées</Text>
            <Text style={[styles.donutLegendValue, { color: GREEN }]}>
              +{formaterMontant(revenus)}
            </Text>
          </View>
          <Text style={[styles.donutLegendPct, { color: GREEN }]}>{pctEntrees}%</Text>
        </View>

        <View style={[styles.donutLegendRow, { marginTop: 10 }]}>
          <View style={[styles.donutLegendDot, { backgroundColor: RED }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.donutLegendLabel}>Dépenses</Text>
            <Text style={[styles.donutLegendValue, { color: RED }]}>
              -{formaterMontant(depenses)}
            </Text>
          </View>
          <Text style={[styles.donutLegendPct, { color: RED }]}>{pctDepenses}%</Text>
        </View>

        <View style={styles.donutSep} />

        <View style={styles.donutSoldeRow}>
          <Text style={styles.donutSoldeLabel}>Solde net du mois</Text>
          <Text style={[styles.donutSoldeValue, { color: solde >= 0 ? GREEN : RED }]}>
            {solde >= 0 ? '+' : ''}{formaterMontant(solde)}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Graphique en barres par mois
function BarChart({ moisData }) {
  const maxValue = Math.max(1, ...moisData.map((m) => Math.max(m.entrees, m.depenses)));
  return (
    <View style={styles.barChartWrap}>
      <View style={styles.barLegend}>
        <View style={styles.barLegendItem}>
          <View style={[styles.barLegendDot, { backgroundColor: GREEN }]} />
          <Text style={styles.barLegendText}>Entrées</Text>
        </View>
        <View style={styles.barLegendItem}>
          <View style={[styles.barLegendDot, { backgroundColor: RED }]} />
          <Text style={styles.barLegendText}>Dépenses</Text>
        </View>
      </View>
      <View style={styles.barsRow}>
        {moisData.map((m) => {
          const hE = maxValue > 0 ? (m.entrees / maxValue) * 110 : 0;
          const hD = maxValue > 0 ? (m.depenses / maxValue) * 110 : 0;
          return (
            <View key={m.label} style={styles.monthCol}>
              <View style={styles.monthBars}>
                <View style={{ alignItems: 'center' }}>
                  <View style={[styles.bar, { height: Math.max(2, hE), backgroundColor: GREEN }]} />
                </View>
                <View style={{ alignItems: 'center' }}>
                  <View style={[styles.bar, { height: Math.max(2, hD), backgroundColor: RED }]} />
                </View>
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
      query(
        collection(db, 'users'),
        where('statut', '==', 'actif'),
        where('cooperativeId', '==', coopId)
      ),
      (s) => {
        const actifs = s.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => u.role !== 'institution');
        setMembresActifs(actifs);
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
    () => transactions.filter(
      (t) => t?.statut === 'valide' && t?.cooperativeId === coopId
    ),
    [transactions, coopId]
  );

  const revenus = useMemo(
    () => txValides
      .filter((t) =>
        ['cotisation', 'mobile_money', 'main_a_main',
          'vente_recolte', 'subvention', 'remboursement']
          .includes(t.typeTransaction) || t.type === 'entree'
      )
      .reduce((a, t) => a + Number(t.montant || 0), 0),
    [txValides]
  );

  const depenses = useMemo(
    () => txValides
      .filter((t) => t.typeTransaction === 'depense' || t.type === 'sortie')
      .reduce((a, t) => a + Number(t.montant || 0), 0),
    [txValides]
  );

  const solde = revenus - depenses;

  const score = useMemo(
    () => calculerScoreTransparence(txValides, votes),
    [txValides, votes]
  );

  const transactionsRecentes = useMemo(() => (
    [...txValides]
      .sort((a, b) =>
        (getDate(b.date)?.getTime() || 0) - (getDate(a.date)?.getTime() || 0)
      )
      .slice(0, 10)
  ), [txValides]);

  const moisData = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
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
      if (t.typeTransaction === 'depense' || t.type === 'sortie') {
        item.depenses += amount;
      } else {
        item.entrees += amount;
      }
    });
    return months.map(({ key, ...rest }) => rest);
  }, [txValides]);

  function contacterCoop() {
    const subject = encodeURIComponent('Demande de financement - CTA de Broukou');
    const body = encodeURIComponent(
      `Bonjour,\n\nSuite à la consultation du score de transparence CoopLedger de la coopérative CTA de Broukou (score : ${score.total}/100), nous souhaitons en savoir plus sur les possibilités de financement.\n\nCordialement.`
    );
    const email = userData?.emailPresident || 'contact@coopledger.tg';
    Linking.openURL(`mailto:${email}?subject=${subject}&body=${body}`);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={styles.loadingText}>Chargement des données...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>

      {/* ── HEADER */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => Alert.alert(
            'Se déconnecter ?',
            'Vous devrez vous reconnecter avec vos identifiants.',
            [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Se déconnecter', style: 'destructive', onPress: () => signOut(auth) },
            ]
          )}
          style={styles.logoutBtn}
        >
          <Text style={styles.logoutBtnText}>🚪 Déconnexion</Text>
        </TouchableOpacity>
        <Text style={styles.headerLogo}>🌱 CoopLedger</Text>
        <Text style={styles.headerTitle}>🏦 Espace Institution</Text>
        <Text style={styles.headerSubtitle}>{userData?.nom || 'Institution'}</Text>
        <View style={styles.readOnlyBadge}>
          <Text style={styles.readOnlyText}>👁 Lecture seule</Text>
        </View>
      </View>

      {/* ── SCORE DE TRANSPARENCE */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📊 Score de Transparence</Text>
        <Text style={styles.cardSub}>{COOP_NOM} · {COOP_REGION}</Text>

        <View style={styles.scoreCircle}>
          <Text style={[styles.scoreNumber, { color: score.couleur }]}>{score.total}</Text>
          <Text style={styles.scoreOver}>/100</Text>
        </View>

        <ProgressBar value={score.total} max={100} color={score.couleur} />

        <View style={[styles.scoreBadge, { backgroundColor: score.couleur + '18' }]}>
          <Text style={[styles.scoreBadgeText, { color: score.couleur }]}>
            {score.badge} {score.texte}
          </Text>
        </View>
        <Text style={styles.scoreElig}>{score.texteElig}</Text>

        <View style={styles.criteriaSep} />
        <Text style={styles.criteriaTitle}>Détail des critères</Text>

        {[
          { label: '🔗 Traçabilité blockchain', val: score.score1, max: 25 },
          { label: '🗳️ Participation aux votes', val: score.score2, max: 25 },
          { label: '📎 Justificatifs fournis', val: score.score3, max: 20 },
          { label: '📅 Activité régulière', val: score.score4, max: 15 },
          { label: '💰 Santé financière', val: score.score5, max: 15 },
        ].map((c) => (
          <View key={c.label} style={styles.criteriaRow}>
            <View style={styles.criteriaHeader}>
              <Text style={styles.criteriaLabel}>{c.label}</Text>
              <Text style={styles.criteriaScore}>{c.val}/{c.max}</Text>
            </View>
            <ProgressBar value={c.val} max={c.max} color={GREEN} />
          </View>
        ))}
      </View>

      {/* ── RÉSUMÉ FINANCIER */}
      <Text style={styles.sectionTitle}>💼 Résumé financier</Text>
      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { borderTopColor: solde >= 0 ? GREEN : RED }]}>
          <Text style={styles.statLabel}>💰 Solde total</Text>
          <Text style={[styles.statValue, { color: solde >= 0 ? GREEN : RED }]}>
            {solde >= 0 ? '+' : ''}{formaterMontant(solde)}
          </Text>
        </View>
        <View style={[styles.statCard, { borderTopColor: GREEN }]}>
          <Text style={styles.statLabel}>📈 Entrées</Text>
          <Text style={[styles.statValue, { color: GREEN }]}>+{formaterMontant(revenus)}</Text>
        </View>
        <View style={[styles.statCard, { borderTopColor: RED }]}>
          <Text style={styles.statLabel}>📉 Dépenses</Text>
          <Text style={[styles.statValue, { color: RED }]}>-{formaterMontant(depenses)}</Text>
        </View>
        <View style={[styles.statCard, { borderTopColor: '#6366f1' }]}>
          <Text style={styles.statLabel}>👥 Membres actifs</Text>
          <Text style={[styles.statValue, { color: '#6366f1' }]}>{membresActifs.length}</Text>
        </View>
      </View>

      {/* ── DONUT CHART */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📊 Répartition Entrées / Dépenses</Text>
        <DonutChart revenus={revenus} depenses={depenses} />
      </View>

      {/* ── BAR CHART */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📈 Évolution sur 6 mois</Text>
        <BarChart moisData={moisData} />
      </View>

      {/* ── TRANSACTIONS RÉCENTES */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🧾 Transactions récentes</Text>
        {transactionsRecentes.length === 0 ? (
          <Text style={styles.emptyText}>Aucune transaction validée.</Text>
        ) : transactionsRecentes.map((tx) => {
          const badge = getBadgeType(tx.typeTransaction);
          const isDep = tx.typeTransaction === 'depense' || tx.type === 'sortie';
          const date = getDate(tx.date);
          const hash = String(tx.hash || '');
          return (
            <View key={tx.id} style={styles.txRow}>
              <View style={[styles.txBadge, { backgroundColor: badge.fondCouleur }]}>
                <Text style={{ fontSize: 18 }}>{badge.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txTitle} numberOfLines={1}>
                  {tx.titre || 'Transaction'}
                </Text>
                <Text style={styles.txMeta}>
                  {badge.label} · {date ? date.toLocaleDateString('fr-FR') : '—'}
                </Text>
                {hash ? (
                  <Text style={styles.txHash}>
                    ⛓ {hash.slice(0, 8)}...{hash.slice(-4)}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.txAmount, { color: isDep ? RED : GREEN }]}>
                {isDep ? '-' : '+'}{formaterMontant(tx.montant)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* ── RAPPORTS MENSUELS */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📄 Rapports mensuels</Text>
        {rapports.length === 0 ? (
          <Text style={styles.emptyText}>Aucun rapport disponible pour le moment.</Text>
        ) : rapports.map((r) => {
          const d = getDate(r.dateEnvoi);
          return (
            <View key={r.id} style={styles.reportItem}>
              <View style={styles.reportHeader}>
                <Text style={styles.reportTitle}>
                  📄 Rapport {r.nomMois || r.mois} {r.annee}
                </Text>
                <View style={styles.reportBadge}>
                  <Text style={styles.reportBadgeText}>Envoyé</Text>
                </View>
              </View>
              <Text style={styles.reportMeta}>
                📅 {d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}
              </Text>
              <View style={styles.reportStats}>
                <Text style={styles.reportStat}>
                  💰 Solde : {formaterMontant(r.solde || 0)}
                </Text>
                <Text style={styles.reportStat}>
                  📧 {Number(r.emailsEnvoyes || 0)} envoyés
                </Text>
              </View>
              <TouchableOpacity
                style={styles.askBtn}
                onPress={() => Linking.openURL(
                  `mailto:${userData?.email || 'contact@coopledger.tg'}?subject=${encodeURIComponent(`Demande rapport ${r.nomMois || r.mois} ${r.annee}`)}`
                )}
              >
                <Text style={styles.askBtnText}>📧 Demander ce rapport</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {/* ── BOUTON CONTACT */}
      <TouchableOpacity style={styles.contactBtn} onPress={contacterCoop}>
        <Text style={styles.contactBtnText}>📧 Contacter la coopérative</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  loadingText: { marginTop: 12, color: '#6b7280', fontSize: 14 },

  // Header
  header: {
    backgroundColor: GREEN_DARK,
    paddingTop: 50,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  logoutBtn: { position: 'absolute', right: 16, top: 50, padding: 8, zIndex: 2 },
  logoutBtnText: { color: '#fca5a5', fontSize: 13, fontWeight: '700' },
  headerLogo: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 6 },
  headerSubtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 14, marginTop: 4 },
  readOnlyBadge: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  readOnlyText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  // Cards
  card: {
    backgroundColor: '#fff',
    margin: 14,
    marginBottom: 0,
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#111827', marginBottom: 4 },
  cardSub: { color: '#6b7280', fontSize: 13, marginBottom: 12 },

  // Score
  scoreCircle: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', marginVertical: 12 },
  scoreNumber: { fontSize: 56, fontWeight: '900', lineHeight: 60 },
  scoreOver: { fontSize: 22, color: '#9ca3af', fontWeight: '700', marginLeft: 4 },
  scoreBadge: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 10,
  },
  scoreBadgeText: { fontWeight: '800', fontSize: 15 },
  scoreElig: { textAlign: 'center', color: '#374151', fontWeight: '700', marginTop: 8 },
  criteriaSep: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 14 },
  criteriaTitle: { fontWeight: '800', color: '#374151', marginBottom: 10 },
  criteriaRow: { marginBottom: 10 },
  criteriaHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  criteriaLabel: { fontSize: 13, color: '#374151', fontWeight: '600', flex: 1 },
  criteriaScore: { fontSize: 13, color: GREEN, fontWeight: '800' },

  // Progress
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: '#e5e7eb', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },

  // Stats grid
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#374151', marginLeft: 16, marginTop: 16, marginBottom: 8 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, gap: 8 },
  statCard: {
    width: '47%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderTopWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statLabel: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  statValue: { fontSize: 17, fontWeight: '900', marginTop: 6 },

  // ── DONUT CHART
  donutContainer: { alignItems: 'center', paddingVertical: 12 },
  donutWrapper: { marginBottom: 20 },
  donutCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutHalf: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '50%',
    height: '100%',
    transformOrigin: 'right center',
  },
  donutHalfLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '50%',
    height: '100%',
  },
  donutHalfRight: {
    position: 'absolute',
    top: 0,
    left: '50%',
    width: '50%',
    height: '100%',
    transformOrigin: 'left center',
  },
  donutHole: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 10,
  },
  donutPct: { fontSize: 30, fontWeight: '900', color: '#111827' },
  donutPctLabel: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  donutEmpty: { padding: 30, alignItems: 'center' },
  donutEmptyText: { color: '#9ca3af', fontSize: 14 },
  donutLegend: { width: '100%', paddingHorizontal: 8 },
  donutLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 14,
    padding: 12,
  },
  donutLegendDot: { width: 14, height: 14, borderRadius: 7, marginRight: 12 },
  donutLegendLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  donutLegendValue: { fontSize: 15, fontWeight: '800', marginTop: 2 },
  donutLegendPct: { fontSize: 18, fontWeight: '900', marginLeft: 'auto' },
  donutSep: { height: 1, backgroundColor: '#e5e7eb', marginVertical: 12 },
  donutSoldeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  donutSoldeLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  donutSoldeValue: { fontSize: 17, fontWeight: '900' },

  // Bar chart
  barChartWrap: { marginTop: 8 },
  barLegend: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  barLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barLegendDot: { width: 10, height: 10, borderRadius: 3 },
  barLegendText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  barsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 130 },
  monthCol: { flex: 1, alignItems: 'center' },
  monthBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 110 },
  bar: { width: 10, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  monthLabel: { marginTop: 6, fontSize: 11, color: '#6b7280', fontWeight: '600' },

  // Transactions
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  txBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txTitle: { fontWeight: '800', color: '#111827', fontSize: 13 },
  txMeta: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  txHash: { color: GREEN, fontSize: 10, marginTop: 2, fontFamily: 'monospace' },
  txAmount: { fontWeight: '900', fontSize: 13 },
  emptyText: { color: '#9ca3af', textAlign: 'center', paddingVertical: 20, fontSize: 14 },

  // Rapports
  reportItem: {
    backgroundColor: '#f9fafb',
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  reportHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reportTitle: { fontWeight: '800', color: '#111827', flex: 1 },
  reportBadge: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  reportBadgeText: { color: GREEN, fontSize: 11, fontWeight: '700' },
  reportMeta: { color: '#6b7280', fontSize: 12, marginTop: 6 },
  reportStats: { flexDirection: 'row', gap: 14, marginTop: 6 },
  reportStat: { fontSize: 12, color: '#374151', fontWeight: '600' },
  askBtn: {
    marginTop: 10,
    backgroundColor: GREEN_LIGHT,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  askBtnText: { color: GREEN_DARK, fontWeight: '800', fontSize: 13 },

  // Contact
  contactBtn: {
    margin: 14,
    marginTop: 16,
    backgroundColor: GREEN_DARK,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: GREEN_DARK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  contactBtnText: { color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 0.5 },
});