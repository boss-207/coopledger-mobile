import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import {
  addDoc,
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const RESEND_API_KEY = process.env.EXPO_PUBLIC_RESEND_KEY;

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';
const RED = '#dc2626';

const MONTH_MODE = {
  current: 'current',
  previous: 'previous',
};

const CATEGORY_ICONS = {
  'Achat intrants': '🌱',
  Équipement: '🛠️',
  Formation: '🎓',
  Transport: '🚚',
  Cotisations: '🤝',
  Autre: '📦',
};

function toDateSafe(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getMonthRange(mode) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const targetMonth = mode === MONTH_MODE.previous ? month - 1 : month;
  const start = new Date(year, targetMonth, 1, 0, 0, 0, 0);
  const end = new Date(year, targetMonth + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function inRange(date, start, end) {
  if (!date) return false;
  return date >= start && date < end;
}

function formatMontant(montant) {
  return `${(montant || 0).toLocaleString('fr-FR')} FCFA`;
}

function formatDate(date) {
  if (!date) return '-';
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getMonthLabel(date) {
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function normalizeTx(docData) {
  const date = toDateSafe(docData.date);
  return {
    titre: docData.titre || 'Transaction',
    montant: Number(docData.montant || 0),
    type: docData.type || 'sortie',
    statut: docData.statut || 'en_cours',
    date,
    hash: docData.hash || null,
    categorie: docData.categorie || 'Autre',
  };
}

function normalizeVote(docData) {
  const dateRaw = docData.dateCreation || docData.date || docData.createdAt;
  const date = toDateSafe(dateRaw);
  const votesOui = Number(docData.votesOui || 0);
  const votesNon = Number(docData.votesNon || 0);
  const totalMembres = Number(docData.totalMembres || 0);
  return {
    statut: docData.statut || 'ouvert',
    date,
    votesOui,
    votesNon,
    totalMembres,
  };
}

function DonutChart({ revenus, depenses }) {
  const total = revenus + depenses;

  if (total === 0) {
    return (
      <View style={donutStyles.emptyContainer}>
        <Text style={donutStyles.emptyText}>
          Aucune donnée pour ce mois
        </Text>
      </View>
    );
  }

  const pctRevenus = Math.round((revenus / total) * 100);
  const pctDepenses = 100 - pctRevenus;
  const rotationDeg = (pctRevenus / 100) * 360;

  return (
    <View style={donutStyles.wrapper}>
      <View style={donutStyles.outerCircle}>
        <View
          style={[
            donutStyles.halfLeft,
            {
              backgroundColor: '#15803d',
              transform: [{ rotate: `${rotationDeg}deg` }],
            },
          ]}
        />
        <View
          style={[
            donutStyles.halfRight,
            { backgroundColor: '#dc2626' },
          ]}
        />

        <View style={donutStyles.innerCircle}>
          <Text style={donutStyles.centerPercent}>
            {pctRevenus}%
          </Text>
          <Text style={donutStyles.centerLabel}>
            Entrées
          </Text>
        </View>
      </View>

      <View style={donutStyles.legend}>
        <View style={donutStyles.legendRow}>
          <View
            style={[
              donutStyles.legendDot,
              { backgroundColor: '#15803d' },
            ]}
          />
          <View>
            <Text style={donutStyles.legendLabel}>
              Entrées
            </Text>
            <Text style={donutStyles.legendValue}>
              +{revenus.toLocaleString('fr-FR')} FCFA
            </Text>
          </View>
          <Text style={donutStyles.legendPct}>
            {pctRevenus}%
          </Text>
        </View>

        <View
          style={[
            donutStyles.legendRow,
            { marginTop: 12 },
          ]}
        >
          <View
            style={[
              donutStyles.legendDot,
              { backgroundColor: '#dc2626' },
            ]}
          />
          <View>
            <Text style={donutStyles.legendLabel}>
              Dépenses
            </Text>
            <Text
              style={[
                donutStyles.legendValue,
                { color: '#dc2626' },
              ]}
            >
              -{depenses.toLocaleString('fr-FR')} FCFA
            </Text>
          </View>
          <Text
            style={[
              donutStyles.legendPct,
              { color: '#dc2626' },
            ]}
          >
            {pctDepenses}%
          </Text>
        </View>

        <View style={donutStyles.separator} />

        <View style={donutStyles.soldeRow}>
          <Text style={donutStyles.soldeLabel}>
            Solde net du mois
          </Text>
          <Text
            style={[
              donutStyles.soldeValue,
              {
                color: (revenus - depenses) >= 0
                  ? '#15803d'
                  : '#dc2626',
              },
            ]}
          >
            {(revenus - depenses) >= 0 ? '+' : ''}
            {(revenus - depenses).toLocaleString('fr-FR')} FCFA
          </Text>
        </View>
      </View>
    </View>
  );
}

function TxItem({ tx }) {
  const isEntree = tx.type === 'entree' || tx.type === 'revenu';
  const statutColor = tx.statut === 'valide' ? GREEN : tx.statut === 'rejete' ? RED : '#d97706';
  const hashShort = tx.hash ? `${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}` : 'N/A';
  const icon = CATEGORY_ICONS[tx.categorie] || '📦';

  return (
    <View style={styles.txRow}>
      <View style={[styles.txIcon, { backgroundColor: isEntree ? '#dcfce7' : '#fee2e2' }]}>
        <Text>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.txTitle} numberOfLines={1}>{tx.titre}</Text>
        <Text style={styles.txSub}>{formatDate(tx.date)} · {tx.categorie}</Text>
        <Text style={styles.txHash}>🔗 {hashShort}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.txAmount, { color: isEntree ? GREEN : RED }]}>
          {isEntree ? '+' : '-'}{tx.montant.toLocaleString('fr-FR')}
        </Text>
        <Text style={[styles.txStatus, { color: statutColor }]}>{tx.statut}</Text>
      </View>
    </View>
  );
}

export default function RapportScreen() {
  const [selectedMonthMode, setSelectedMonthMode] = useState(MONTH_MODE.current);
  const [transactions, setTransactions] = useState([]);
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    let txLoaded = false;
    let votesLoaded = false;

    const txQuery = query(collection(db, 'transactions'), orderBy('date', 'desc'));
    const unsubTx = onSnapshot(
      txQuery,
      (snap) => {
        const data = snap.docs.map((d) => normalizeTx(d.data()));
        setTransactions(data);
        txLoaded = true;
        if (txLoaded && votesLoaded) setLoading(false);
      },
      () => {
        txLoaded = true;
        if (txLoaded && votesLoaded) setLoading(false);
      }
    );

    const votesQuery = query(collection(db, 'votes'), orderBy('dateCreation', 'desc'));
    const unsubVotes = onSnapshot(
      votesQuery,
      (snap) => {
        const data = snap.docs.map((d) => normalizeVote(d.data()));
        setVotes(data);
        votesLoaded = true;
        if (txLoaded && votesLoaded) setLoading(false);
      },
      () => {
        votesLoaded = true;
        if (txLoaded && votesLoaded) setLoading(false);
      }
    );

    return () => {
      unsubTx();
      unsubVotes();
    };
  }, []);

  const computed = useMemo(() => {
    const { start, end } = getMonthRange(selectedMonthMode);
    const monthLabel = getMonthLabel(start);

    const txMonth = transactions.filter((t) => inRange(t.date, start, end));
    const votesMonth = votes.filter((v) => inRange(v.date, start, end));

    const txValidees = txMonth.filter((t) => t.statut === 'valide');
    const totalEntrees = txValidees
      .filter((t) => t.type === 'entree' || t.type === 'revenu')
      .reduce((acc, t) => acc + t.montant, 0);
    const totalDepenses = txValidees
      .filter((t) => t.type === 'sortie' || t.type === 'depense')
      .reduce((acc, t) => acc + t.montant, 0);
    const soldeMois = totalEntrees - totalDepenses;

    const votesApprouves = votesMonth.filter((v) => v.statut === 'approuve').length;
    const votesRejetes = votesMonth.filter((v) => v.statut === 'rejete').length;
    const votesAnnules = votesMonth.filter((v) => v.statut === 'annule').length;

    const participationPct = votesMonth.length > 0
      ? Math.round(
          votesMonth.reduce((acc, v) => {
            const totalVotes = v.votesOui + v.votesNon;
            const base = v.totalMembres > 0 ? v.totalMembres : Math.max(totalVotes, 1);
            return acc + ((totalVotes / base) * 100);
          }, 0) / votesMonth.length
        )
      : 0;

    return {
      monthLabel,
      txMonth,
      votesMonth,
      totalEntrees,
      totalDepenses,
      soldeMois,
      txValideesCount: txValidees.length,
      votesCount: votesMonth.length,
      votesApprouves,
      votesRejetes,
      votesAnnules,
      participationPct,
    };
  }, [selectedMonthMode, transactions, votes]);

  const handleShare = async () => {
    const monthName = computed.monthLabel;
    const message =
`Rapport mensuel CoopLedger - ${monthName}

Résumé financier:
- Solde du mois: ${formatMontant(computed.soldeMois)}
- Total entrées: ${formatMontant(computed.totalEntrees)}
- Total dépenses: ${formatMontant(computed.totalDepenses)}
- Transactions validées: ${computed.txValideesCount}
- Votes effectués: ${computed.votesCount}

Synthèse des votes:
- Approuvés: ${computed.votesApprouves}
- Rejetés: ${computed.votesRejetes}
- Annulés: ${computed.votesAnnules}
- Participation moyenne: ${computed.participationPct}%

Source: CoopLedger (registre Firestore + preuves blockchain des hash de transactions)
Destinataires: IFAD, Banques partenaires, Ministère de l'Agriculture.`;

    await Share.share({ message });
  };

  const handleSendEmail = async () => {
    if (sendingEmail) return;
    if (!RESEND_API_KEY) {
      Alert.alert(
        'Configuration manquante',
        'Définissez EXPO_PUBLIC_RESEND_KEY dans votre fichier .env puis redémarrez Expo.'
      );
      return;
    }
    setSendingEmail(true);

    try {
      const { start } = getMonthRange(selectedMonthMode);
      const mois = start.getMonth() + 1;
      const annee = start.getFullYear();

      const nomsMois = [
        'Janvier',
        'Février',
        'Mars',
        'Avril',
        'Mai',
        'Juin',
        'Juillet',
        'Août',
        'Septembre',
        'Octobre',
        'Novembre',
        'Décembre',
      ];
      const nomMois = nomsMois[mois - 1];

      const membresSnap = await getDocs(
        query(
          collection(db, 'users'),
          where('cooperativeId', '==', 'broukou'),
          where('statut', '==', 'actif')
        )
      );
      const destinataires = membresSnap.docs.map((d) => d.data().email).filter(Boolean);

      if (destinataires.length === 0) {
        Alert.alert('Info', 'Aucun membre avec email.');
        setSendingEmail(false);
        return;
      }

      const fmt = (n) => `${(n || 0).toLocaleString('fr-FR')} FCFA`;

      const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:32px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#14532d;padding:32px;text-align:center;">
    <p style="font-size:40px;margin:0;">🌱</p>
    <h1 style="color:white;margin:8px 0 4px;font-size:22px;">CoopLedger</h1>
    <p style="color:rgba(255,255,255,0.8);margin:0;font-size:14px;">Rapport ${nomMois} ${annee}</p>
    <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:12px;">CTA de Broukou · Togo</p>
  </div>
  <div style="padding:28px;">
    <div style="background:${
      computed.soldeMois >= 0 ? '#f0fdf4' : '#fef2f2'
    };border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#6b7280;">Solde du mois</p>
      <p style="margin:8px 0 0;font-size:32px;font-weight:800;color:${
        computed.soldeMois >= 0 ? '#15803d' : '#dc2626'
      };">
        ${computed.soldeMois >= 0 ? '+' : ''}${fmt(computed.soldeMois)}
      </p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr style="background:#f8fafc;">
        <td style="padding:12px;font-size:13px;">📈 Entrées</td>
        <td style="padding:12px;font-weight:700;text-align:right;color:#15803d;">+${fmt(computed.totalEntrees)}</td>
      </tr>
      <tr>
        <td style="padding:12px;font-size:13px;">📉 Dépenses</td>
        <td style="padding:12px;font-weight:700;text-align:right;color:#dc2626;">-${fmt(computed.totalDepenses)}</td>
      </tr>
    </table>
    <div style="background:#f0fdf4;border-radius:10px;padding:14px;text-align:center;">
      <p style="margin:0;color:#15803d;font-size:13px;font-weight:600;">⛓️ Données blockchain Polygon</p>
    </div>
  </div>
  <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="color:#9ca3af;font-size:11px;margin:0;">CoopLedger · MIABE 2026 🇹🇬</p>
  </div>
</div>
</body></html>`;

      let envoyes = 0;
      for (const email of destinataires) {
        try {
          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'CoopLedger <onboarding@resend.dev>',
              to: email,
              subject: `📊 Rapport CoopLedger — ${nomMois} ${annee}`,
              html,
            }),
          });
          if (resp.ok) envoyes += 1;
          await new Promise((r) => setTimeout(r, 300));
        } catch (err) {
          console.error('Email error:', email, err);
        }
      }

      await addDoc(collection(db, 'rapports_envoyes'), {
        mois,
        annee,
        nomMois,
        cooperativeId: 'broukou',
        totalEntrees: computed.totalEntrees,
        totalDepenses: computed.totalDepenses,
        solde: computed.soldeMois,
        emailsEnvoyes: envoyes,
        dateEnvoi: serverTimestamp(),
      });

      Alert.alert(
        '✅ Rapport envoyé !',
        `${envoyes}/${destinataires.length} emails envoyés avec succès.`
      );
    } catch (err) {
      Alert.alert('❌ Erreur', err?.message || 'Envoi impossible.');
    }
    setSendingEmail(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={styles.loadingText}>Chargement du rapport mensuel...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Rapport Mensuel</Text>
        <View style={styles.monthSwitcher}>
          <TouchableOpacity
            style={[
              styles.monthBtn,
              selectedMonthMode === MONTH_MODE.previous && styles.monthBtnActive,
            ]}
            onPress={() => setSelectedMonthMode(MONTH_MODE.previous)}
          >
            <Text
              style={[
                styles.monthBtnText,
                selectedMonthMode === MONTH_MODE.previous && styles.monthBtnTextActive,
              ]}
            >
              Mois précédent
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.monthBtn,
              selectedMonthMode === MONTH_MODE.current && styles.monthBtnActive,
            ]}
            onPress={() => setSelectedMonthMode(MONTH_MODE.current)}
          >
            <Text
              style={[
                styles.monthBtnText,
                selectedMonthMode === MONTH_MODE.current && styles.monthBtnTextActive,
              ]}
            >
              Mois actuel
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.monthLabel}>{computed.monthLabel}</Text>
        <View style={styles.blockchainBadge}>
          <Text style={styles.blockchainBadgeText}>Généré depuis la blockchain</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Résumé financier</Text>
        <View style={styles.summaryGrid}>
          <View style={[styles.card, styles.cardMain]}>
            <Text style={styles.cardLabel}>Solde du mois</Text>
            <Text style={styles.cardValueMain}>{formatMontant(computed.soldeMois)}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Entrées</Text>
            <Text style={[styles.cardValue, { color: GREEN }]}>{formatMontant(computed.totalEntrees)}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Dépenses</Text>
            <Text style={[styles.cardValue, { color: RED }]}>{formatMontant(computed.totalDepenses)}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Transactions validées</Text>
            <Text style={styles.cardValue}>{computed.txValideesCount}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Votes effectués</Text>
            <Text style={styles.cardValue}>{computed.votesCount}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          📊 Répartition Entrées / Dépenses
        </Text>
        <DonutChart
          revenus={computed.totalEntrees}
          depenses={computed.totalDepenses}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transactions du mois</Text>
        {computed.txMonth.length === 0 ? (
          <Text style={styles.emptyText}>Aucune transaction pour ce mois.</Text>
        ) : (
          computed.txMonth.map((tx, idx) => <TxItem key={`${tx.hash || tx.titre}-${idx}`} tx={tx} />)
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Votes du mois</Text>
        <View style={styles.votesSummaryRow}>
          <View style={styles.voteSummaryCard}>
            <Text style={styles.voteSummaryLabel}>Approuvés</Text>
            <Text style={[styles.voteSummaryValue, { color: GREEN }]}>{computed.votesApprouves}</Text>
          </View>
          <View style={styles.voteSummaryCard}>
            <Text style={styles.voteSummaryLabel}>Rejetés</Text>
            <Text style={[styles.voteSummaryValue, { color: RED }]}>{computed.votesRejetes}</Text>
          </View>
          <View style={styles.voteSummaryCard}>
            <Text style={styles.voteSummaryLabel}>Annulés</Text>
            <Text style={[styles.voteSummaryValue, { color: '#6b7280' }]}>{computed.votesAnnules}</Text>
          </View>
        </View>
        <Text style={styles.participationText}>
          Participation moyenne: <Text style={styles.participationValue}>{computed.participationPct}%</Text>
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.emailButton, sendingEmail && { opacity: 0.7 }]}
        onPress={handleSendEmail}
        disabled={sendingEmail}
      >
        {sendingEmail ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.emailButtonText}>📧 Envoyer par email</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
        <Text style={styles.shareButtonText}>Partager le rapport mensuel</Text>
      </TouchableOpacity>

      <View style={{ height: 110 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  loadingText: { marginTop: 12, color: '#6b7280', fontSize: 14 },

  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 26, fontWeight: '900', color: '#111827', marginBottom: 12 },
  monthSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
    padding: 4,
  },
  monthBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  monthBtnActive: { backgroundColor: '#fff' },
  monthBtnText: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
  monthBtnTextActive: { color: GREEN_DARK },
  monthLabel: { marginTop: 10, fontSize: 13, color: '#6b7280', textTransform: 'capitalize' },
  blockchainBadge: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  blockchainBadgeText: { color: GREEN_DARK, fontSize: 12, fontWeight: '700' },

  section: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    elevation: 3,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 10 },
  sectionSubtitle: { fontSize: 12, color: '#6b7280', marginBottom: 12 },

  summaryGrid: { gap: 10 },
  card: { backgroundColor: '#f9fafb', borderRadius: 12, padding: 12 },
  cardMain: { backgroundColor: GREEN_DARK },
  cardLabel: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  cardValue: { fontSize: 20, fontWeight: '900', color: '#111827', marginTop: 4 },
  cardValueMain: { fontSize: 24, fontWeight: '900', color: '#fff', marginTop: 6 },

  emptyText: { fontSize: 13, color: '#6b7280', paddingVertical: 8 },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  txIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  txSub: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  txHash: { fontSize: 11, color: GREEN, marginTop: 2, fontFamily: 'monospace' },
  txAmount: { fontSize: 14, fontWeight: '800' },
  txStatus: { fontSize: 11, textTransform: 'capitalize', marginTop: 2, fontWeight: '700' },

  votesSummaryRow: { flexDirection: 'row', gap: 8 },
  voteSummaryCard: { flex: 1, backgroundColor: '#f9fafb', borderRadius: 12, padding: 10, alignItems: 'center' },
  voteSummaryLabel: { fontSize: 12, color: '#6b7280' },
  voteSummaryValue: { fontSize: 20, fontWeight: '900', marginTop: 4 },
  participationText: { marginTop: 12, color: '#374151', fontSize: 13, fontWeight: '600' },
  participationValue: { color: GREEN_DARK, fontWeight: '900' },

  shareButton: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: GREEN,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: GREEN_DARK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    elevation: 5,
  },
  shareButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  emailButton: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: GREEN_DARK,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: GREEN_DARK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    elevation: 4,
  },
  emailButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});

const donutStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  outerCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    overflow: 'hidden',
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  halfLeft: {
    position: 'absolute',
    width: 100,
    height: 200,
    top: 0,
    left: 0,
    borderTopLeftRadius: 100,
    borderBottomLeftRadius: 100,
  },
  halfRight: {
    position: 'absolute',
    width: 100,
    height: 200,
    top: 0,
    right: 0,
    borderTopRightRadius: 100,
    borderBottomRightRadius: 100,
  },
  innerCircle: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  centerPercent: {
    fontSize: 30,
    fontWeight: '800',
    color: '#15803d',
    lineHeight: 34,
  },
  centerLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
  },
  legend: {
    marginTop: 24,
    width: '100%',
    paddingHorizontal: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
  },
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 12,
  },
  legendLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  legendValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#15803d',
    marginTop: 2,
  },
  legendPct: {
    marginLeft: 'auto',
    fontSize: 16,
    fontWeight: '800',
    color: '#15803d',
  },
  separator: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 14,
    marginHorizontal: 4,
  },
  soldeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  soldeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  soldeValue: {
    fontSize: 16,
    fontWeight: '800',
  },
});
