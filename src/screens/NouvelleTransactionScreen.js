import React, { useEffect, useMemo, useState } from 'react';

import Svg, { Circle, G, Text as SvgText } from 'react-native-svg'; // ✅ une seule ligne

import * as Print from 'expo-print';

import * as Sharing from 'expo-sharing';

import { Share } from 'react-native';

import {

View,

Text,

StyleSheet,

ScrollView,

ActivityIndicator,

TouchableOpacity,

Linking,

Alert,

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

  

const radius = 70;

const strokeWidth = 22;

const circumference = 2 * Math.PI * radius;

const dashEntrees = (revenus / total) * circumference;

const dashDepenses = (depenses / total) * circumference;

  

/*const telechargerRapportPDF = async (r) => {

try {

const mois = r.mois || 'Mois';

const annee = r.annee || '';

const dateEnvoi = getDate(r.dateEnvoi);

const dateStr = dateEnvoi ? dateEnvoi.toLocaleDateString('fr-FR') : '-';

const htmlContent = `

<html><body style="font-family: Arial, sans-serif; padding: 20px; color: #111;">

<h1 style="color: #14532d;">📄 Rapport Mensuel – ${mois} ${annee}</h1>

<p><strong>Coopérative :</strong> CTA de Broukou</p>

<p><strong>Envoyé le :</strong> ${dateStr}</p>

<p><strong>Membres notifiés :</strong> ${Number(r.nombreNotifies || 0)}</p>

<hr/>

<h2>Résumé financier</h2>

<p>Ce rapport a été généré automatiquement depuis CoopLedger.</p>

<p style="font-size:11px; color:#6b7280;">Source : Registre Firestore + preuves blockchain</p>

</body></html>

`;

const { uri } = await Print.printToFileAsync({ html: htmlContent });

await Sharing.shareAsync(uri, {

mimeType: 'application/pdf',

dialogTitle: `Rapport ${mois} ${annee}`,

UTI: 'com.adobe.pdf',

});

} catch (e) {

Alert.alert('Erreur', 'Impossible de générer le PDF.');

}

};*/

  

const telechargerRapportPDF = async (r) => {

try {

const mois = r.mois || 'Mois';

const annee = r.annee || '';

const dateEnvoi = getDate(r.dateEnvoi); // getDate existe déjà dans votre fichier

const dateStr = dateEnvoi ? dateEnvoi.toLocaleDateString('fr-FR') : '-';

const nbNotifies = Number(r.nombreNotifies || 0);

// ── Calculs financiers pour le rapport ──

const totalEntreesVal = revenus || 0; // vos états existants

const totalDepensesVal = depenses || 0;

const soldeVal = solde || 0;

const nbTransactions = transactions?.length || 0;

// ── Dernières transactions (max 10) ──

const dernieresTx = (transactions || []).slice(0, 10);

const lignesTx = dernieresTx.map((tx) => {

const isEntree = tx.type === 'entree' || tx.type === 'revenu';

const montant = Number(tx.montant || 0).toLocaleString('fr-FR');

const date = tx.date instanceof Date

? tx.date.toLocaleDateString('fr-FR')

: '—';

const couleur = isEntree ? '#15803d' : '#dc2626';

const signe = isEntree ? '+' : '-';

return `

<tr>

<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;">

${tx.titre || '—'}

</td>

<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;text-align:center;">

${date}

</td>

<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;

color:${couleur};font-weight:700;text-align:right;">

${signe}${montant} FCFA

</td>

<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">

<span style="background:${

tx.statut === 'valide' ? '#dcfce7' :

tx.statut === 'en_cours' ? '#fef9c3' : '#fee2e2'

};color:${

tx.statut === 'valide' ? '#15803d' :

tx.statut === 'en_cours' ? '#b45309' : '#dc2626'

};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;">

${tx.statut === 'valide' ? 'Validé' :

tx.statut === 'en_cours' ? 'En cours' : tx.statut || '—'}

</span>

</td>

</tr>

`;

}).join('');

// ── Pourcentage pour la barre de progression ──

const pctEntrees = totalEntreesVal + totalDepensesVal > 0

? Math.round((totalEntreesVal / (totalEntreesVal + totalDepensesVal)) * 100)

: 100;

const pctDepenses = 100 - pctEntrees;

// ── HTML du rapport ──

const html = `

<!DOCTYPE html>

<html lang="fr">

<head>

<meta charset="UTF-8"/>

<meta name="viewport" content="width=device-width, initial-scale=1.0"/>

<title>Rapport ${mois} ${annee}</title>

<style>

* { margin: 0; padding: 0; box-sizing: border-box; }

body {

font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;

background: #f8fafc;

color: #111827;

}

/* ── En-tête ── */

.header {

background: linear-gradient(135deg, #14532d 0%, #15803d 60%, #16a34a 100%);

color: white;

padding: 36px 40px 28px;

}

.header-top {

display: flex;

justify-content: space-between;

align-items: flex-start;

margin-bottom: 20px;

}

.logo-zone { display: flex; align-items: center; gap: 14px; }

.logo-circle {

width: 52px; height: 52px; border-radius: 50%;

background: rgba(255,255,255,0.2);

display: flex; align-items: center; justify-content: center;

font-size: 26px;

}

.logo-text { font-size: 24px; font-weight: 900; letter-spacing: -0.5px; }

.logo-sub { font-size: 13px; opacity: 0.75; margin-top: 2px; }

.badge-blockchain {

background: rgba(255,255,255,0.15);

border: 1px solid rgba(255,255,255,0.3);

border-radius: 20px;

padding: 6px 14px;

font-size: 11px;

font-weight: 700;

letter-spacing: 0.5px;

}

.header-title {

font-size: 28px; font-weight: 900;

letter-spacing: -0.5px; margin-bottom: 6px;

}

.header-meta {

font-size: 13px; opacity: 0.7;

}

/* ── Corps ── */

.body { padding: 32px 40px; }

/* ── Cartes stats ── */

.stats-grid {

display: grid;

grid-template-columns: repeat(3, 1fr);

gap: 16px;

margin-bottom: 28px;

}

.stat-card {

background: white;

border-radius: 16px;

padding: 20px;

box-shadow: 0 2px 8px rgba(0,0,0,0.06);

border-top: 4px solid transparent;

}

.stat-card.solde { border-top-color: #15803d; }

.stat-card.entrees { border-top-color: #2563eb; }

.stat-card.depenses { border-top-color: #dc2626; }

.stat-emoji { font-size: 22px; margin-bottom: 8px; }

.stat-label { font-size: 11px; color: #6b7280; font-weight: 600;

text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }

.stat-value { font-size: 22px; font-weight: 900; }

.stat-value.green { color: #15803d; }

.stat-value.blue { color: #2563eb; }

.stat-value.red { color: #dc2626; }

/* ── Barre répartition ── */

.section {

background: white;

border-radius: 16px;

padding: 22px;

margin-bottom: 20px;

box-shadow: 0 2px 8px rgba(0,0,0,0.06);

}

.section-title {

font-size: 15px; font-weight: 800; color: #111827;

margin-bottom: 16px;

display: flex; align-items: center; gap: 8px;

}

.bar-container {

height: 18px; background: #fee2e2; border-radius: 999px;

overflow: hidden; margin-bottom: 12px;

}

.bar-fill {

height: 100%; background: #15803d; border-radius: 999px;

width: ${pctEntrees}%;

}

.bar-legend {

display: flex; justify-content: space-between; font-size: 12px;

}

.legend-green { color: #15803d; font-weight: 700; }

.legend-red { color: #dc2626; font-weight: 700; }

/* ── Tableau ── */

table { width: 100%; border-collapse: collapse; }

thead tr { background: #f1f5f9; }

thead th {

padding: 10px 12px; text-align: left;

font-size: 11px; font-weight: 700;

color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;

}

thead th:last-child { text-align: center; }

thead th:nth-child(3){ text-align: right; }

/* ── Infos coopérative ── */

.coop-info {

display: grid; grid-template-columns: 1fr 1fr; gap: 12px;

margin-bottom: 20px;

}

.info-item {

background: white; border-radius: 12px; padding: 14px 18px;

box-shadow: 0 1px 4px rgba(0,0,0,0.05);

}

.info-key { font-size: 11px; color: #9ca3af; font-weight: 600;

text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px; }

.info-value { font-size: 14px; font-weight: 700; color: #111827; }

/* ── Pied de page ── */

.footer {

background: #14532d; color: rgba(255,255,255,0.7);

padding: 20px 40px; text-align: center; font-size: 12px;

margin-top: 32px;

}

.footer strong { color: #4ade80; }

</style>

</head>

<body>

<!-- EN-TÊTE -->

<div class="header">

<div class="header-top">

<div class="logo-zone">

<div class="logo-circle">🌱</div>

<div>

<div class="logo-text">CoopLedger</div>

<div class="logo-sub">CTA de Broukou · Région de la Kara</div>

</div>

</div>

<div class="badge-blockchain">⛓ Blockchain Polygon</div>

</div>

<div class="header-title">Rapport Mensuel — ${mois} ${annee}</div>

<div class="header-meta">Généré le ${new Date().toLocaleDateString('fr-FR', {

day: 'numeric', month: 'long', year: 'numeric'

})} · Envoyé le : ${dateStr} · ${nbNotifies} membres notifiés</div>

</div>

<!-- CORPS -->

<div class="body">

<!-- Infos -->

<div class="coop-info">

<div class="info-item">

<div class="info-key">Période</div>

<div class="info-value">${mois} ${annee}</div>

</div>

<div class="info-item">

<div class="info-key">Membres notifiés</div>

<div class="info-value">${nbNotifies}</div>

</div>

<div class="info-item">

<div class="info-key">Total opérations</div>

<div class="info-value">${nbTransactions} transactions</div>

</div>

<div class="info-item">

<div class="info-key">Date d'envoi</div>

<div class="info-value">${dateStr}</div>

</div>

</div>

<!-- Stats -->

<div class="stats-grid">

<div class="stat-card solde">

<div class="stat-emoji">💰</div>

<div class="stat-label">Solde net</div>

<div class="stat-value green">

${soldeVal.toLocaleString('fr-FR')} FCFA

</div>

</div>

<div class="stat-card entrees">

<div class="stat-emoji">📈</div>

<div class="stat-label">Total entrées</div>

<div class="stat-value blue">

${totalEntreesVal.toLocaleString('fr-FR')} FCFA

</div>

</div>

<div class="stat-card depenses">

<div class="stat-emoji">📉</div>

<div class="stat-label">Total dépenses</div>

<div class="stat-value red">

${totalDepensesVal.toLocaleString('fr-FR')} FCFA

</div>

</div>

</div>

<!-- Répartition -->

<div class="section">

<div class="section-title">📊 Répartition Entrées / Dépenses</div>

<div class="bar-container">

<div class="bar-fill"></div>

</div>

<div class="bar-legend">

<span class="legend-green">● Entrées : ${pctEntrees}%

(${totalEntreesVal.toLocaleString('fr-FR')} FCFA)

</span>

<span class="legend-red">● Dépenses : ${pctDepenses}%

(${totalDepensesVal.toLocaleString('fr-FR')} FCFA)

</span>

</div>

</div>

<!-- Tableau transactions -->

<div class="section">

<div class="section-title">📋 Dernières transactions</div>

${dernieresTx.length === 0

? '<p style="color:#9ca3af;text-align:center;padding:20px;">Aucune transaction ce mois.</p>'

: `<table>

<thead>

<tr>

<th>Titre</th>

<th style="text-align:center">Date</th>

<th style="text-align:right">Montant</th>

<th style="text-align:center">Statut</th>

</tr>

</thead>

<tbody>${lignesTx}</tbody>

</table>`

}

</div>

</div>

<!-- PIED DE PAGE -->

<div class="footer">

<strong>CoopLedger</strong> · Rapport généré automatiquement ·

Source : Registre Firestore + preuves blockchain Polygon Amoy ·

Destinataires : IFAD, Banques partenaires, Ministère de l'Agriculture

</div>

</body>

</html>

`;

// ── Génération du PDF ──

const { uri } = await Print.printToFileAsync({

html,

base64: false,

});

// ── Partage / téléchargement ──

const canShare = await Sharing.isAvailableAsync();

if (canShare) {

await Sharing.shareAsync(uri, {

mimeType: 'application/pdf',

dialogTitle: `Rapport ${mois} ${annee} - CoopLedger`,

UTI: 'com.adobe.pdf',

});

} else {

// Fallback : Share natif React Native

await Share.share({

title: `Rapport ${mois} ${annee}`,

message: `Rapport CoopLedger ${mois} ${annee}\nSolde : ${soldeVal.toLocaleString('fr-FR')} FCFA\nEntrées : ${totalEntreesVal.toLocaleString('fr-FR')} FCFA\nDépenses : ${totalDepensesVal.toLocaleString('fr-FR')} FCFA`,

url: uri,

});

}

} catch (e) {

console.error('Erreur PDF:', e);

Alert.alert(

'Erreur PDF',

'Impossible de générer le rapport PDF.\n\nAssurez-vous que expo-print et expo-sharing sont installés :\nnpx expo install expo-print expo-sharing',

[{ text: 'OK' }]

);

}

};

  

return (

<View style={styles.chartBox}>

<View style={{ alignItems: 'center', marginBottom: 12 }}>

<Svg width={180} height={180} viewBox="0 0 180 180">

<G rotation="-90" origin="90, 90">

{/* Fond rouge (dépenses) */}

<Circle

cx="90" cy="90" r={radius}

stroke="#dc2626"

strokeWidth={strokeWidth}

fill="transparent"

strokeDasharray={`${circumference} ${circumference}`}

strokeDashoffset={0}

/>

{/* Arc vert (entrées) */}

<Circle

cx="90" cy="90" r={radius}

stroke="#15803d"

strokeWidth={strokeWidth}

fill="transparent"

strokeDasharray={`${dashEntrees} ${circumference}`}

strokeDashoffset={0}

/>

</G>

{/* Texte central */}

<SvgText x="90" y="85" textAnchor="middle" fontSize="22" fontWeight="900" fill="#111827">

{pctEntrees}%

</SvgText>

<SvgText x="90" y="105" textAnchor="middle" fontSize="12" fill="#6b7280">

Entrées

</SvgText>

</Svg>

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

<TouchableOpacity

onPress={() => {

Alert.alert(

'Se déconnecter ?',

'Vous devrez vous reconnecter avec\nvos identifiants.',

[

{ text: 'Annuler', style: 'cancel' },

{

text: 'Se déconnecter',

style: 'destructive',

onPress: () => signOut(auth),

},

]

);

}}

style={styles.logoutHeaderBtn}

>

<Text style={styles.logoutHeaderText}>🚪 Déconnexion</Text>

</TouchableOpacity>

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

{/*<TouchableOpacity

style={styles.askBtn}

onPress={() => Linking.openURL(`mailto:${userData?.email || 'contact@coopledger.tg'}?subject=${encodeURIComponent(`Demande rapport ${mois}`)}`)}

>

<Text style={styles.askBtnText}>📧 Demander ce rapport</Text>

</TouchableOpacity>*/}

<TouchableOpacity

style={{

backgroundColor: '#14532d',

borderRadius: 12,

paddingVertical: 12,

paddingHorizontal: 16,

flexDirection: 'row',

alignItems: 'center',

justifyContent: 'center',

gap: 8,

marginTop: 10,

}}

onPress={() => telechargerRapportPDF(r)}

>

<Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>

📥 Télécharger le rapport PDF

</Text>

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

header: {

position: 'relative',

backgroundColor: GREEN_DARK,

padding: 18,

borderBottomLeftRadius: 24,

borderBottomRightRadius: 24,

},

logoutHeaderBtn: {

position: 'absolute',

right: 16,

top: 18,

padding: 8,

zIndex: 2,

},

logoutHeaderText: {

color: '#fca5a5',

fontSize: 13,

fontWeight: '700',

},

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