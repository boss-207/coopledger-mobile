/**
 * Envoi du rapport mensuel CoopLedger via Resend + Firestore (GitHub Actions).
 * Aligné sur la logique Dashboard / Cloud Functions (types entree/revenu, sortie/depense, typeTransaction).
 */
import admin from 'firebase-admin';
import { Resend } from 'resend';

const cooperativeId = process.env.COOPERATIVE_ID || 'broukou';

/** @param {string} name */
function requireEnv(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === '') {
    console.error(`Variable d’environnement manquante : ${name}`);
    process.exit(1);
  }
  return v;
}

const serviceAccount = {
  type: 'service_account',
  project_id: requireEnv('FIREBASE_PROJECT_ID'),
  client_email: requireEnv('FIREBASE_CLIENT_EMAIL'),
  private_key: requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const resend = new Resend(requireEnv('RESEND_API_KEY'));
const RESEND_FROM = process.env.RESEND_FROM || 'CoopLedger <onboarding@resend.dev>';

const TYPES_ENTREE = [
  'cotisation',
  'mobile_money',
  'main_a_main',
  'vente_recolte',
  'subvention',
  'remboursement',
];

/**
 * @param {string | undefined} periode mois_courant | mois_precedent
 */
function getMonthRange(periode) {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth();
  if (periode === 'mois_precedent') {
    const prev = new Date(y, m - 1, 1);
    y = prev.getFullYear();
    m = prev.getMonth();
  }
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m + 1, 1, 0, 0, 0, 0);
  return { start, end, mois: m + 1, annee: y };
}

/** @param {FirebaseFirestore.DocumentData} t */
function isEntreeTx(t) {
  return (
    t.type === 'entree' ||
    t.type === 'revenu' ||
    TYPES_ENTREE.includes(t.typeTransaction)
  );
}

/** @param {FirebaseFirestore.DocumentData} t */
function isDepenseTx(t) {
  return (
    t.type === 'sortie' ||
    t.type === 'depense' ||
    t.typeTransaction === 'depense'
  );
}

/** @param {FirebaseFirestore.DocumentData} t */
function inCooperative(t) {
  if (t.cooperativeId == null || t.cooperativeId === '') return true;
  return t.cooperativeId === cooperativeId;
}

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

async function main() {
  const periode = process.env.RAPPORT_PERIODE || 'mois_courant';
  const { start, end, mois, annee } = getMonthRange(periode);
  const nomMois = nomsMois[mois - 1];

  console.log(
    `Rapport ${nomMois} ${annee} (période: ${periode}) — ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`
  );

  const startTs = admin.firestore.Timestamp.fromDate(start);
  const endTs = admin.firestore.Timestamp.fromDate(end);

  const txSnap = await db
    .collection('transactions')
    .where('date', '>=', startTs)
    .where('date', '<', endTs)
    .orderBy('date', 'desc')
    .get();

  const txValidees = txSnap.docs
    .map((d) => d.data())
    .filter((t) => (t.statut || 'en_cours') === 'valide' && inCooperative(t));

  const totalEntrees = txValidees
    .filter(isEntreeTx)
    .reduce((a, t) => a + Number(t.montant || 0), 0);

  const totalDepenses = txValidees
    .filter(isDepenseTx)
    .reduce((a, t) => a + Number(t.montant || 0), 0);

  const solde = totalEntrees - totalDepenses;

  const votesSnap = await db
    .collection('votes')
    .where('dateCreation', '>=', startTs)
    .where('dateCreation', '<', endTs)
    .orderBy('dateCreation', 'desc')
    .get();

  const votes = votesSnap.docs.map((d) => d.data()).filter(inCooperative);
  const votesApprouves = votes.filter((v) => v.statut === 'approuve').length;
  const votesRejetes = votes.filter((v) => v.statut === 'rejete').length;

  const membresSnap = await db
    .collection('users')
    .where('cooperativeId', '==', cooperativeId)
    .where('statut', '==', 'actif')
    .get();

  const destinataires = [
    ...new Set(
      membresSnap.docs
        .map((d) => d.data().email)
        .filter((e) => typeof e === 'string' && e.trim().includes('@'))
    ),
  ];

  console.log(`${destinataires.length} destinataire(s) actif(s) avec e-mail`);

  if (destinataires.length === 0) {
    console.log('Aucun destinataire : arrêt sans erreur.');
    return;
  }

  const formater = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;

  const lignesTx = txValidees.slice(0, 10).map((t) => {
    const isEntree = isEntreeTx(t);
    return `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">
              ${(t.titre || '—').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:${
              isEntree ? '#15803d' : '#dc2626'
            };text-align:right;">
              ${isEntree ? '+' : '-'}${formater(t.montant)}
            </td>
          </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#14532d;padding:32px;text-align:center;">
      <p style="font-size:40px;margin:0;">🌱</p>
      <h1 style="color:white;margin:8px 0 4px;font-size:22px;">CoopLedger</h1>
      <p style="color:rgba(255,255,255,0.8);margin:0;font-size:14px;">Rapport ${nomMois} ${annee}</p>
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:12px;">CTA de Broukou · Togo</p>
    </div>
    <div style="padding:28px;">
      <div style="background:${solde >= 0 ? '#f0fdf4' : '#fef2f2'};border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
        <p style="margin:0;font-size:13px;color:#6b7280;">Solde du mois (transactions validées)</p>
        <p style="margin:8px 0 0;font-size:32px;font-weight:800;color:${solde >= 0 ? '#15803d' : '#dc2626'};">
          ${solde >= 0 ? '+' : ''}${formater(solde)}
        </p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr style="background:#f8fafc;">
          <td style="padding:12px;font-size:13px;">📈 Entrées</td>
          <td style="padding:12px;font-weight:700;text-align:right;color:#15803d;">+${formater(totalEntrees)}</td>
        </tr>
        <tr>
          <td style="padding:12px;font-size:13px;">📉 Dépenses</td>
          <td style="padding:12px;font-weight:700;text-align:right;color:#dc2626;">-${formater(totalDepenses)}</td>
        </tr>
      </table>
      <h3 style="color:#14532d;font-size:15px;margin:0 0 12px;">🗳️ Votes — ${votesApprouves} approuvés, ${votesRejetes} rejetés</h3>
      <h3 style="color:#14532d;font-size:15px;margin:16px 0 12px;">📋 Transactions du mois (aperçu)</h3>
      <table style="width:100%;border-collapse:collapse;">
        ${lignesTx || '<tr><td style="padding:12px;color:#9ca3af;text-align:center;">Aucune transaction validée sur la période.</td></tr>'}
      </table>
      <div style="background:#f0fdf4;border-radius:10px;padding:14px;text-align:center;margin-top:24px;">
        <p style="margin:0;color:#15803d;font-size:13px;font-weight:600;">⛓️ Données blockchain Polygon</p>
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:11px;margin:0;">CoopLedger · Rapport automatisé (GitHub Actions)</p>
    </div>
  </div>
</body>
</html>`;

  let emailsEnvoyes = 0;
  for (const email of destinataires) {
    try {
      await resend.emails.send({
        from: RESEND_FROM,
        to: email,
        subject: `📊 Rapport CoopLedger — ${nomMois} ${annee}`,
        html,
      });
      emailsEnvoyes += 1;
      console.log(`✅ Envoyé : ${email}`);
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.error(`❌ ${email} :`, err?.message || err);
    }
  }

  await db.collection('rapports_envoyes').add({
    mois,
    annee,
    nomMois,
    cooperativeId,
    totalEntrees,
    totalDepenses,
    solde,
    nbTransactionsValidees: txValidees.length,
    votesApprouves,
    votesRejetes,
    emailsEnvoyes,
    periode,
    dateEnvoi: admin.firestore.FieldValue.serverTimestamp(),
    declenchePar: 'github_actions',
  });

  console.log(`\n✅ Terminé : ${emailsEnvoyes}/${destinataires.length} e-mails.`);
}

main().catch((err) => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
