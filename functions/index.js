/**
 * CoopLedger — Cloud Functions
 * Twilio (WhatsApp + SMS) + Resend (email)
 *
 * Secrets (Firebase Functions v2) :
 *   firebase functions:secrets:set TWILIO_SID
 *   firebase functions:secrets:set TWILIO_TOKEN
 *   firebase functions:secrets:set TWILIO_WHATSAPP_FROM
 *   firebase functions:secrets:set TWILIO_SMS_FROM
 *   firebase functions:secrets:set RESEND_API_KEY
 *   firebase functions:secrets:set RESEND_FROM
 *
 * TWILIO_WHATSAPP_FROM : ex. whatsapp:+14155238886 (sandbox)
 * TWILIO_SMS_FROM      : numéro SMS E.164, ex. +12025550123 (SMS classique)
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const twilio = require("twilio");
const { Resend } = require("resend");

initializeApp();
const db = getFirestore();

setGlobalOptions({ maxInstances: 10, region: "europe-west1" });

const twilioSid = defineSecret("TWILIO_SID");
const twilioToken = defineSecret("TWILIO_TOKEN");
const twilioWhatsappFrom = defineSecret("TWILIO_WHATSAPP_FROM");
const twilioSmsFrom = defineSecret("TWILIO_SMS_FROM");
const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFrom = defineSecret("RESEND_FROM");

const COOP_DEFAULT_NAME = "CTA de Broukou";
const VOTE_URL = "https://coopledger-togo.vercel.app/vote";

const COOP_ID_PUSH = "broukou";
const COOP_ID_REPORT = "broukou";

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isFcmTokenInvalid(code) {
  return (
    code === "messaging/invalid-registration-token" ||
    code === "messaging/registration-token-not-registered"
  );
}

function isRateExceeded(code) {
  return code === "messaging/message-rate-exceeded";
}

async function removeInvalidTokens(tokenToUserRef) {
  const entries = Array.from(tokenToUserRef.entries());
  if (entries.length === 0) return;

  const batch = db.batch();
  for (const [, ref] of entries) {
    batch.update(ref, {
      fcmToken: admin.firestore.FieldValue.delete(),
      fcmTokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

async function sendMulticastWithRetry(message, tokenToUserRef) {
  const maxAttempts = 3;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    const res = await admin.messaging().sendEachForMulticast(message);

    const invalidEntries = new Map();
    let sawRateExceeded = false;

    res.responses.forEach((resp, idx) => {
      if (resp.success) return;
      const code = resp?.error?.code;
      const token = message.tokens[idx];
      if (!token) return;

      if (isFcmTokenInvalid(code)) {
        const ref = tokenToUserRef.get(token);
        if (ref) invalidEntries.set(token, ref);
      }
      if (isRateExceeded(code)) sawRateExceeded = true;

      logger.warn("FCM send error", {
        code,
        message: resp?.error?.message,
      });
    });

    // Nettoyage des tokens invalides (sans bloquer)
    try {
      await removeInvalidTokens(invalidEntries);
    } catch (e) {
      logger.error("FCM cleanup invalid tokens failed", { error: e?.message });
    }

    // Retry si rate exceeded (backoff)
    if (!sawRateExceeded) return res;
    if (attempt < maxAttempts) {
      const backoff = 500 * Math.pow(2, attempt - 1);
      await sleep(backoff);
      continue;
    }
    return res;
  }
}

async function getActiveMembersWithToken({ coopId, excludeUid }) {
  const snap = await db.collection("users").where("cooperativeId", "==", coopId).get();
  const members = [];

  for (const d of snap.docs) {
    const u = d.data();
    const uid = u.uid || d.id;
    if (excludeUid && uid === excludeUid) continue;
    const st = u.statut;
    if (st === "inactif" || st === "exclu") continue;
    if (st && st !== "actif") continue;
    if (!u.fcmToken || typeof u.fcmToken !== "string") continue;
    members.push({
      uid,
      token: u.fcmToken,
      ref: d.ref,
    });
  }

  return members;
}

function voteCreatorUid(vote) {
  return (
    vote?.creeParUid ||
    vote?.createdByUid ||
    vote?.createdBy ||
    vote?.uidCreateur ||
    vote?.creatorUid ||
    null
  );
}

function buildNewVotePush({ voteId, titre, montant }) {
  return {
    notification: {
      title: "⚡ Vote Requis — CoopLedger",
      body: `${titre} · ${formatMontantFcfa(montant)} FCFA · Expire dans 30 min`,
    },
    data: {
      voteId: String(voteId),
      type: "NEW_VOTE",
      montant: String(montant ?? ""),
      titre: String(titre ?? ""),
      click_action: "VOTE_SCREEN",
    },
    android: {
      priority: "high",
      notification: {
        channelId: "votes",
        priority: "max",
        defaultSound: true,
        defaultVibrateTimings: true,
        color: "#15803d",
        icon: "notification_icon",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
          contentAvailable: true,
        },
      },
    },
  };
}

function buildVoteResultPush({ voteId, titre, montant, statut }) {
  if (statut === "approuve") {
    return {
      notification: {
        title: "✅ Vote Approuvé — CoopLedger",
        body: `${titre} · ${formatMontantFcfa(montant)} FCFA débloqué par la majorité`,
      },
      data: { voteId: String(voteId), type: "VOTE_APPROVED" },
    };
  }
  if (statut === "rejete") {
    return {
      notification: {
        title: "❌ Vote Rejeté — CoopLedger",
        body: `${titre} · La proposition a été rejetée`,
      },
      data: { voteId: String(voteId), type: "VOTE_REJECTED" },
    };
  }
  return {
    notification: {
      title: "⏸️ Vote Annulé — CoopLedger",
      body: `${titre} · Quorum non atteint dans le délai`,
    },
    data: { voteId: String(voteId), type: "VOTE_CANCELLED" },
  };
}

function buildNewTransactionPush({ transactionId, titre, montant }) {
  return {
    notification: {
      title: "💰 Nouvelle Transaction — CoopLedger",
      body: `${titre} · ${formatMontantFcfa(montant)} FCFA enregistré sur la blockchain`,
    },
    data: {
      transactionId: String(transactionId),
      type: "NEW_TRANSACTION",
    },
  };
}

function buildGovernanceResultPush(vote) {
  const type = vote?.type;
  const statut = vote?.statut;
  const candidatNom = vote?.candidatNom || "le candidat";
  const coopName = COOP_DEFAULT_NAME;

  if (statut === "approuve") {
    if (type === "transfert_presidence") {
      return {
        notification: {
          title: "🎉 Nouveau Président !",
          body: `${candidatNom} est le nouveau président de la coopérative ${coopName}`,
        },
        data: { voteId: String(vote?.id || ""), type: "GOV_PRESIDENT_CHANGED" },
      };
    }
    if (type === "transfert_tresorier") {
      return {
        notification: {
          title: "🎉 Nouveau Trésorier !",
          body: `${candidatNom} est le nouveau trésorier de la coopérative ${coopName}`,
        },
        data: { voteId: String(vote?.id || ""), type: "GOV_TREASURER_CHANGED" },
      };
    }
  }

  if (statut === "rejete") {
    if (type === "transfert_presidence") {
      return {
        notification: {
          title: "❌ Transfert refusé",
          body: `Le transfert de présidence à ${candidatNom} a été refusé par les membres`,
        },
        data: { voteId: String(vote?.id || ""), type: "GOV_PRESIDENT_REJECTED" },
      };
    }
    if (type === "transfert_tresorier") {
      return {
        notification: {
          title: "❌ Changement refusé",
          body: `Le changement de trésorier vers ${candidatNom} a été refusé par les membres`,
        },
        data: { voteId: String(vote?.id || ""), type: "GOV_TREASURER_REJECTED" },
      };
    }
  }

  if (statut === "annule") {
    if (type === "transfert_presidence") {
      return {
        notification: {
          title: "⏸️ Vote Annulé — CoopLedger",
          body: `Transfert de présidence à ${candidatNom} annulé (quorum non atteint)`,
        },
        data: { voteId: String(vote?.id || ""), type: "GOV_PRESIDENT_CANCELLED" },
      };
    }
    if (type === "transfert_tresorier") {
      return {
        notification: {
          title: "⏸️ Vote Annulé — CoopLedger",
          body: `Changement de trésorier vers ${candidatNom} annulé (quorum non atteint)`,
        },
        data: { voteId: String(vote?.id || ""), type: "GOV_TREASURER_CANCELLED" },
      };
    }
  }

  return null;
}

function monthLabelFr(mois, annee) {
  const d = new Date(Number(annee), Number(mois) - 1, 1);
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function formatFcfa(n) {
  const num = Number(n);
  if (Number.isNaN(num)) return "0";
  return num.toLocaleString("fr-FR");
}

function toDateSafeAdmin(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function makeMonthRange(mois, annee) {
  const m = Number(mois) - 1;
  const y = Number(annee);
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

async function getRecipientsEmails({ coopId }) {
  const snap = await db.collection("users").where("cooperativeId", "==", coopId).get();
  const emails = [];
  for (const d of snap.docs) {
    const u = d.data();
    if (u.statut === "inactif") continue;
    const email = typeof u.email === "string" ? u.email.trim() : "";
    if (!email || !email.includes("@")) continue;
    emails.push(email);
  }
  // dédup simple
  return Array.from(new Set(emails));
}

function buildReportHtml({
  coopName,
  monthLabel,
  solde,
  entrees,
  depenses,
  txCount,
  participationPct,
  lastTx,
  votesSummary,
}) {
  const txRows = lastTx
    .map(
      (t) =>
        `<tr>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${(t.titre || "Transaction")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${t.sign}${formatFcfa(
          t.montant
        )} FCFA</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;text-align:right;">${t.dateLabel}</td>` +
        `</tr>`
    )
    .join("");

  const voteRows = votesSummary
    .map((v) => {
      const statut =
        v.statut === "approuve"
          ? "✅ Approuvé"
          : v.statut === "rejete"
          ? "❌ Rejeté"
          : v.statut === "annule"
          ? "⏸️ Annulé"
          : "🗳️ Ouvert";
      return (
        `<tr>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${(v.titre || "Vote")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatFcfa(
          v.montant
        )} FCFA</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${statut}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">${v.participationPct}%</td>` +
        `</tr>`
      );
    })
    .join("");

  return `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f8fafc;padding:24px;">
    <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#14532d;color:white;padding:20px 22px;">
        <div style="font-size:18px;font-weight:900;">🌱 CoopLedger</div>
        <div style="margin-top:6px;font-size:14px;opacity:.85;">📊 Rapport mensuel — ${monthLabel} · ${coopName}</div>
      </div>

      <div style="padding:18px 22px;">
        <div style="font-size:15px;font-weight:800;margin-bottom:10px;color:#111827;">Résumé financier</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:10px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Solde</td>
            <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:900;color:#111827;">${formatFcfa(
              solde
            )} FCFA</td>
          </tr>
          <tr>
            <td style="padding:10px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Entrées</td>
            <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:900;color:#15803d;">+${formatFcfa(
              entrees
            )} FCFA</td>
          </tr>
          <tr>
            <td style="padding:10px;color:#6b7280;">Dépenses</td>
            <td style="padding:10px;text-align:right;font-weight:900;color:#dc2626;">-${formatFcfa(
              depenses
            )} FCFA</td>
          </tr>
        </table>

        <div style="margin-top:12px;color:#374151;font-size:13px;">
          <strong>${txCount}</strong> transaction(s) validée(s) · Participation moyenne aux votes :
          <strong>${participationPct}%</strong>
        </div>

        <div style="margin-top:18px;font-size:15px;font-weight:800;margin-bottom:10px;color:#111827;">10 dernières transactions</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;color:#6b7280;font-size:12px;text-transform:uppercase;">
              <th style="padding:10px;text-align:left;">Titre</th>
              <th style="padding:10px;text-align:right;">Montant</th>
              <th style="padding:10px;text-align:right;">Date</th>
            </tr>
          </thead>
          <tbody>
            ${txRows || `<tr><td colspan="3" style="padding:12px;color:#6b7280;">Aucune transaction ce mois.</td></tr>`}
          </tbody>
        </table>

        <div style="margin-top:18px;font-size:15px;font-weight:800;margin-bottom:10px;color:#111827;">Votes du mois</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;color:#6b7280;font-size:12px;text-transform:uppercase;">
              <th style="padding:10px;text-align:left;">Proposition</th>
              <th style="padding:10px;text-align:right;">Montant</th>
              <th style="padding:10px;text-align:right;">Statut</th>
              <th style="padding:10px;text-align:right;">Participation</th>
            </tr>
          </thead>
          <tbody>
            ${voteRows || `<tr><td colspan="4" style="padding:12px;color:#6b7280;">Aucun vote ce mois.</td></tr>`}
          </tbody>
        </table>

        <div style="margin-top:18px;padding:12px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:12px;color:#14532d;font-weight:700;">
          Données : registre Firestore + preuves blockchain (hash des transactions).
        </div>
      </div>

      <div style="padding:14px 22px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">
        CoopLedger · ${coopName} · Polygon
      </div>
    </div>
  </div>`;
}

async function sendMonthlyReport({ mois, annee, triggeredBy }) {
  const { start, end } = makeMonthRange(mois, annee);
  const coopId = COOP_ID_REPORT;
  const coopName = COOP_DEFAULT_NAME;

  // Transactions du mois
  const txSnap = await db
    .collection("transactions")
    .where("date", ">=", admin.firestore.Timestamp.fromDate(start))
    .where("date", "<", admin.firestore.Timestamp.fromDate(end))
    .orderBy("date", "desc")
    .get();

  const txAll = txSnap.docs.map((d) => d.data());
  const txValidees = txAll.filter((t) => (t.statut || "en_cours") === "valide");

  const totalEntrees = txValidees
    .filter((t) => t.type === "entree" || t.type === "revenu")
    .reduce((acc, t) => acc + Number(t.montant || 0), 0);

  const totalDepenses = txValidees
    .filter((t) => t.type === "sortie" || t.type === "depense")
    .reduce((acc, t) => acc + Number(t.montant || 0), 0);

  const solde = totalEntrees - totalDepenses;

  // Dernières 10 tx (validées, mois)
  const lastTx = txValidees.slice(0, 10).map((t) => {
    const date = toDateSafeAdmin(t.date);
    const dateLabel = date
      ? date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
      : "-";
    const isEntree = t.type === "entree" || t.type === "revenu";
    return {
      titre: t.titre || "Transaction",
      montant: Number(t.montant || 0),
      sign: isEntree ? "+" : "-",
      dateLabel,
    };
  });

  // Votes du mois
  const votesSnap = await db
    .collection("votes")
    .where("dateCreation", ">=", admin.firestore.Timestamp.fromDate(start))
    .where("dateCreation", "<", admin.firestore.Timestamp.fromDate(end))
    .orderBy("dateCreation", "desc")
    .get();

  const votesMonth = votesSnap.docs.map((d) => d.data());
  const participationPct =
    votesMonth.length > 0
      ? Math.round(
          votesMonth.reduce((acc, v) => {
            const votesOui = Number(v.votesOui || 0);
            const votesNon = Number(v.votesNon || 0);
            const totalVotes = votesOui + votesNon;
            const totalMembres = Number(v.totalMembres || 0);
            const base = totalMembres > 0 ? totalMembres : Math.max(totalVotes, 1);
            return acc + (totalVotes / base) * 100;
          }, 0) / votesMonth.length
        )
      : 0;

  const votesSummary = votesMonth.slice(0, 50).map((v) => {
    const votesOui = Number(v.votesOui || 0);
    const votesNon = Number(v.votesNon || 0);
    const totalVotes = votesOui + votesNon;
    const totalMembres = Number(v.totalMembres || 0);
    const base = totalMembres > 0 ? totalMembres : Math.max(totalVotes, 1);
    const pct = Math.round((totalVotes / base) * 100);
    return {
      titre: v.titre || v.title || "Vote",
      montant: Number(v.montant || v.amount || 0),
      statut: v.statut || "ouvert",
      participationPct: Number.isFinite(pct) ? pct : 0,
    };
  });

  const emails = await getRecipientsEmails({ coopId });
  if (emails.length === 0) {
    logger.warn("Rapport mensuel: aucun destinataire", { coopId, mois, annee });
    return { sent: 0 };
  }

  const resend = new Resend(resendApiKey.value());
  const fromEmail = resendFrom.value();
  const subject = `📊 Rapport Mensuel CoopLedger - ${monthLabelFr(mois, annee)}`;

  const html = buildReportHtml({
    coopName,
    monthLabel: monthLabelFr(mois, annee),
    solde,
    entrees: totalEntrees,
    depenses: totalDepenses,
    txCount: txValidees.length,
    participationPct,
    lastTx,
    votesSummary,
  });

  // Resend : envoi en lot (chunk) pour éviter les limites
  const chunks = chunkArray(emails, 100);
  let sent = 0;
  for (const c of chunks) {
    try {
      await resend.emails.send({
        from: fromEmail,
        to: c,
        subject,
        html,
      });
      sent += c.length;
    } catch (e) {
      logger.error("Rapport mensuel: échec d'envoi chunk", {
        error: e?.message,
        mois,
        annee,
      });
    }
  }

  logger.info("Rapport mensuel envoyé", {
    mois,
    annee,
    sent,
    triggeredBy: triggeredBy || "system",
  });
  return { sent };
}

exports.envoyerRapportMensuel = onCall(
  { secrets: [resendApiKey, resendFrom] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Connexion requise.");
    }

    const mois = Number(request.data?.mois);
    const annee = Number(request.data?.annee);
    if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
      throw new HttpsError("invalid-argument", "Paramètre mois invalide (1..12).");
    }
    if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
      throw new HttpsError("invalid-argument", "Paramètre année invalide.");
    }

    const userRef = db.collection("users").doc(request.auth.uid);
    const userSnap = await userRef.get();
    const u = userSnap.exists ? userSnap.data() : null;

    if (!u || u.statut === "inactif") {
      throw new HttpsError("permission-denied", "Profil inactif.");
    }

    // Limitation simple : président ou trésorier
    if (u.role !== "president" && u.role !== "tresorier") {
      throw new HttpsError("permission-denied", "Seul le président ou le trésorier peut envoyer le rapport.");
    }

    const result = await sendMonthlyReport({
      mois,
      annee,
      triggeredBy: request.auth.uid,
    });

    return { ok: true, ...result };
  }
);

exports.rapportAutomatiqueMensuel = onSchedule(
  {
    schedule: "0 7 1 * *",
    timeZone: "Africa/Lome",
    secrets: [resendApiKey, resendFrom],
  },
  async () => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const mois = prev.getMonth() + 1;
    const annee = prev.getFullYear();
    await sendMonthlyReport({ mois, annee, triggeredBy: "scheduler" });
  }
);

/** @param {unknown} n */
function formatMontantFcfa(n) {
  const num = Number(n);
  if (Number.isNaN(num)) return "0";
  return num.toLocaleString("fr-FR");
}

/**
 * @param {string | undefined | null} raw
 * @returns {string | null} E.164 ou null
 */
function toE164(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const s = raw.trim().replace(/[\s.-]/g, "");
  if (!s.startsWith("+")) return null;
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  return s;
}

/**
 * @param {FirebaseFirestore.DocumentData} vote
 */
function coopNameFromVote(vote) {
  return (
    vote.cooperativeNom ||
    vote.cooperativeName ||
    vote.nomCooperative ||
    COOP_DEFAULT_NAME
  );
}

/**
 * @param {FirebaseFirestore.DocumentData} user
 * @returns {boolean}
 */
function isActiveMember(user) {
  return user.statut !== "inactif";
}

/**
 * @param {{ nom?: string, titre: string, montant: unknown, cooperativeName: string }} p
 */
function buildVoteWhatsAppBody({ nom, titre, montant, cooperativeName }) {
  const prenom = nom || "membre";
  return (
    `🌱 *CoopLedger - Vote Requis*\n\n` +
    `Bonjour ${prenom} 👋\n\n` +
    `Un vote a été déclenché dans votre coopérative *${cooperativeName}*.\n\n` +
    `📋 *${titre}*\n` +
    `💰 *${formatMontantFcfa(montant)} FCFA*\n` +
    `⏱️ Expire dans *30 minutes*\n\n` +
    `👉 Votez maintenant :\n` +
    `${VOTE_URL}\n\n` +
    `_CoopLedger · Blockchain Polygon_`
  );
}

/**
 * @param {{ titre: string, montant: unknown, cooperativeName: string }} p
 */
function buildVoteSmsBody({ titre, montant, cooperativeName }) {
  return (
    `[CoopLedger] Vote requis — ${cooperativeName}. ` +
    `${titre} — ${formatMontantFcfa(montant)} FCFA. ` +
    `Expire dans 30 min. ${VOTE_URL}`
  );
}

/**
 * @param {{ titre: string, montant: unknown, approved: boolean }} p
 */
function buildResultWhatsAppBody({ titre, montant, approved }) {
  if (approved) {
    return (
      `✅ *CoopLedger - Vote Approuvé*\n\n` +
      `La proposition *${titre}* a été approuvée par la majorité.\n` +
      `💰 ${formatMontantFcfa(montant)} FCFA débloqué.`
    );
  }
  return (
    `❌ *CoopLedger - Vote Rejeté*\n\n` +
    `La proposition *${titre}* a été rejetée par les membres.`
  );
}

/**
 * @param {{ titre: string, montant: unknown, approved: boolean }} p
 */
function buildResultSmsBody({ titre, montant, approved }) {
  if (approved) {
    return (
      `[CoopLedger] Vote approuvé — ${titre}. ` +
      `${formatMontantFcfa(montant)} FCFA débloqué.`
    );
  }
  return `[CoopLedger] Vote rejeté — ${titre}.`;
}

exports.notifierVoteWhatsApp = onDocumentCreated(
  {
    document: "votes/{voteId}",
    secrets: [
      twilioSid,
      twilioToken,
      twilioWhatsappFrom,
      twilioSmsFrom,
      resendApiKey,
      resendFrom,
    ],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) {
      logger.warn("notifierVoteWhatsApp: pas de snapshot");
      return;
    }

    const vote = snap.data();
    const titre = vote.titre || vote.title || "Sans titre";
    const montant = vote.montant ?? vote.amount ?? 0;
    const cooperativeName = coopNameFromVote(vote);
    const coopId = vote.cooperativeId || "broukou";

    const client = twilio(twilioSid.value(), twilioToken.value());
    const waFrom = twilioWhatsappFrom.value();
    const smsFrom = twilioSmsFrom.value();
    const resend = new Resend(resendApiKey.value());
    const fromEmail = resendFrom.value();

    const usersSnap = await db
      .collection("users")
      .where("cooperativeId", "==", coopId)
      .get();

    const tasks = [];

    for (const doc of usersSnap.docs) {
      const u = doc.data();
      if (!isActiveMember(u)) continue;

      const nom = u.nom || "";
      const phone = toE164(u.telephone);

      if (phone) {
        const waBody = buildVoteWhatsAppBody({
          nom,
          titre,
          montant,
          cooperativeName,
        });
        tasks.push(
          client.messages
            .create({
              from: waFrom,
              to: `whatsapp:${phone}`,
              body: waBody,
            })
            .then(() => logger.info("WhatsApp vote envoyé", { to: phone }))
            .catch((err) =>
              logger.error("WhatsApp vote échec", { to: phone, error: err.message })
            )
        );

        tasks.push(
          client.messages
            .create({
              from: smsFrom,
              to: phone,
              body: buildVoteSmsBody({ titre, montant, cooperativeName }),
            })
            .then(() => logger.info("SMS vote envoyé", { to: phone }))
            .catch((err) =>
              logger.error("SMS vote échec", { to: phone, error: err.message })
            )
        );
      }

      const email = typeof u.email === "string" ? u.email.trim() : "";
      if (email && email.includes("@")) {
        tasks.push(
          resend.emails
            .send({
              from: fromEmail,
              to: email,
              subject: `CoopLedger — Vote requis : ${titre}`,
              html:
                `<p>Bonjour ${nom || "membre"},</p>` +
                `<p>Un vote a été déclenché dans <strong>${cooperativeName}</strong>.</p>` +
                `<ul>` +
                `<li><strong>${titre}</strong></li>` +
                `<li>Montant : ${formatMontantFcfa(montant)} FCFA</li>` +
                `<li>Expire dans 30 minutes</li>` +
                `</ul>` +
                `<p><a href="${VOTE_URL}">Voter maintenant</a></p>` +
                `<p><em>CoopLedger · Polygon</em></p>`,
            })
            .then(() => logger.info("Email vote envoyé", { to: email }))
            .catch((err) =>
              logger.error("Email vote échec", { to: email, error: err.message })
            )
        );
      }
    }

    await Promise.allSettled(tasks);
  }
);

exports.notifierResultatWhatsApp = onDocumentUpdated(
  {
    document: "votes/{voteId}",
    secrets: [
      twilioSid,
      twilioToken,
      twilioWhatsappFrom,
      twilioSmsFrom,
      resendApiKey,
      resendFrom,
    ],
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    const prev = before.statut;
    const next = after.statut;

    if (prev === next) return;
    if (next !== "approuve" && next !== "rejete") return;

    const approved = next === "approuve";
    const titre = after.titre || after.title || "Sans titre";
    const montant = after.montant ?? after.amount ?? 0;
    const cooperativeName = coopNameFromVote(after);
    const coopId = after.cooperativeId || "broukou";

    const client = twilio(twilioSid.value(), twilioToken.value());
    const waFrom = twilioWhatsappFrom.value();
    const smsFrom = twilioSmsFrom.value();
    const resend = new Resend(resendApiKey.value());
    const fromEmail = resendFrom.value();

    const usersSnap = await db
      .collection("users")
      .where("cooperativeId", "==", coopId)
      .get();

    const waResultBody = buildResultWhatsAppBody({ titre, montant, approved });
    const smsResultBody = buildResultSmsBody({ titre, montant, approved });

    const tasks = [];

    for (const doc of usersSnap.docs) {
      const u = doc.data();
      if (!isActiveMember(u)) continue;

      const nom = u.nom || "";
      const phone = toE164(u.telephone);

      if (phone) {
        tasks.push(
          client.messages
            .create({
              from: waFrom,
              to: `whatsapp:${phone}`,
              body: waResultBody,
            })
            .then(() => logger.info("WhatsApp résultat envoyé", { to: phone }))
            .catch((err) =>
              logger.error("WhatsApp résultat échec", { to: phone, error: err.message })
            )
        );

        tasks.push(
          client.messages
            .create({
              from: smsFrom,
              to: phone,
              body: smsResultBody,
            })
            .then(() => logger.info("SMS résultat envoyé", { to: phone }))
            .catch((err) =>
              logger.error("SMS résultat échec", { to: phone, error: err.message })
            )
        );
      }

      const email = typeof u.email === "string" ? u.email.trim() : "";
      if (email && email.includes("@")) {
        const subject = approved
          ? `CoopLedger — Vote approuvé : ${titre}`
          : `CoopLedger — Vote rejeté : ${titre}`;
        const html = approved
          ? `<p>Bonjour ${nom || "membre"},</p>` +
            `<p>La proposition <strong>${titre}</strong> a été approuvée.</p>` +
            `<p>Montant : ${formatMontantFcfa(montant)} FCFA débloqué.</p>`
          : `<p>Bonjour ${nom || "membre"},</p>` +
            `<p>La proposition <strong>${titre}</strong> a été rejetée.</p>`;

        tasks.push(
          resend.emails
            .send({
              from: fromEmail,
              to: email,
              subject,
              html: html + `<p><em>CoopLedger · ${cooperativeName}</em></p>`,
            })
            .then(() => logger.info("Email résultat envoyé", { to: email }))
            .catch((err) =>
              logger.error("Email résultat échec", { to: email, error: err.message })
            )
        );
      }
    }

    await Promise.allSettled(tasks);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// FCM (Push natives) — Functions v2
// ─────────────────────────────────────────────────────────────────────────────

exports.notifierNouveauVote = onDocumentCreated(
  { document: "votes/{voteId}" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const voteId = event.params.voteId;
    const vote = snap.data() || {};

    const titre = vote.titre || vote.title || "Vote";
    const montant = vote.montant ?? vote.amount ?? 0;
    const excludeUid = voteCreatorUid(vote);

    const members = await getActiveMembersWithToken({
      coopId: COOP_ID_PUSH,
      excludeUid,
    });

    if (members.length === 0) {
      logger.info("FCM: aucun membre/token pour nouveau vote", { voteId });
      return;
    }

    const tokenToUserRef = new Map(members.map((m) => [m.token, m.ref]));
    const tokens = members.map((m) => m.token);

    const base = buildNewVotePush({ voteId, titre, montant });
    const chunks = chunkArray(tokens, 500);

    for (const c of chunks) {
      await sendMulticastWithRetry({ ...base, tokens: c }, tokenToUserRef);
    }
  }
);

exports.notifierResultatVote = onDocumentUpdated(
  { document: "votes/{voteId}" },
  async (event) => {
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};

    const ancienStatut = before.statut;
    const nouveauStatut = after.statut;

    if (ancienStatut === nouveauStatut) return;
    if (ancienStatut !== "ouvert") return;
    if (
      nouveauStatut !== "approuve" &&
      nouveauStatut !== "rejete" &&
      nouveauStatut !== "annule"
    ) {
      return;
    }

    const voteId = event.params.voteId;
    const titre = after.titre || after.title || "Vote";
    const montant = after.montant ?? after.amount ?? 0;

    const members = await getActiveMembersWithToken({
      coopId: COOP_ID_PUSH,
      excludeUid: null,
    });

    if (members.length === 0) return;

    const tokenToUserRef = new Map(members.map((m) => [m.token, m.ref]));
    const tokens = members.map((m) => m.token);
    const governancePayload =
      after.type === "transfert_presidence" || after.type === "transfert_tresorier"
        ? buildGovernanceResultPush({ ...after, id: voteId })
        : null;

    const base = {
      ...(governancePayload || buildVoteResultPush({ voteId, titre, montant, statut: nouveauStatut })),
      android: {
        priority: "high",
        notification: {
          channelId: "votes",
          priority: "max",
          defaultSound: true,
          defaultVibrateTimings: true,
          color: "#15803d",
          icon: "notification_icon",
        },
      },
      apns: {
        payload: { aps: { sound: "default", badge: 1, contentAvailable: true } },
      },
    };

    for (const c of chunkArray(tokens, 500)) {
      await sendMulticastWithRetry({ ...base, tokens: c }, tokenToUserRef);
    }
  }
);

exports.notifierNouvelleTransaction = onDocumentCreated(
  { document: "transactions/{txId}" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const txId = event.params.txId;
    const tx = snap.data() || {};

    if (tx.statut !== "valide") return;

    const titre = tx.titre || "Transaction";
    const montant = tx.montant ?? 0;

    const members = await getActiveMembersWithToken({
      coopId: COOP_ID_PUSH,
      excludeUid: null,
    });
    if (members.length === 0) return;

    const tokenToUserRef = new Map(members.map((m) => [m.token, m.ref]));
    const tokens = members.map((m) => m.token);
    const base = {
      ...buildNewTransactionPush({
        transactionId: txId,
        titre,
        montant,
      }),
      android: {
        priority: "high",
        notification: {
          channelId: "votes",
          priority: "max",
          defaultSound: true,
          defaultVibrateTimings: true,
          color: "#15803d",
          icon: "notification_icon",
        },
      },
      apns: {
        payload: { aps: { sound: "default", badge: 1, contentAvailable: true } },
      },
    };

    for (const c of chunkArray(tokens, 500)) {
      await sendMulticastWithRetry({ ...base, tokens: c }, tokenToUserRef);
    }
  }
);

/** Broadcast FCM — création d’une entrée historique_exclusions (exclusion président). */
exports.notifierExclusionMembre = onDocumentCreated(
  { document: "historique_exclusions/{id}" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const row = snap.data() || {};
    const coopId = row.cooperativeId || COOP_ID_PUSH;
    const nom = row.membreNom || "Un membre";

    const members = await getActiveMembersWithToken({
      coopId,
      excludeUid: null,
    });

    if (members.length === 0) {
      logger.info("FCM exclusion: aucun destinataire", { id: event.params.id });
      return;
    }

    const tokenToUserRef = new Map(members.map((m) => [m.token, m.ref]));
    const tokens = members.map((m) => m.token);

    const base = {
      notification: {
        title: "👤 Membre exclu",
        body: `${nom} a été exclu de la coopérative.`,
      },
      data: {
        type: "MEMBER_EXCLUDED",
        cooperativeId: String(coopId),
        membreNom: String(nom),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "votes",
          priority: "max",
          defaultSound: true,
          defaultVibrateTimings: true,
          color: "#15803d",
          icon: "notification_icon",
        },
      },
      apns: {
        payload: { aps: { sound: "default", badge: 1, contentAvailable: true } },
      },
    };

    for (const c of chunkArray(tokens, 500)) {
      await sendMulticastWithRetry({ ...base, tokens: c }, tokenToUserRef);
    }
  }
);

/** Notification ciblée — création reintegration_notifications par l’app. */
exports.notifierReintegrationMembre = onDocumentCreated(
  { document: "reintegration_notifications/{id}" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const row = snap.data() || {};
    const targetUid = row.targetUid;
    if (!targetUid) return;

    const userRef = db.doc(`users/${targetUid}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return;

    const u = userSnap.data() || {};
    const token = typeof u.fcmToken === "string" ? u.fcmToken.trim() : "";
    if (!token) {
      logger.info("FCM réintégration: pas de token", { targetUid });
      return;
    }

    const coopName = row.cooperativeNom || COOP_DEFAULT_NAME;

    const base = {
      notification: {
        title: "🎉 Réintégration",
        body: `Vous avez été réintégré dans la coopérative ${coopName} !`,
      },
      data: {
        type: "MEMBER_REINTEGRATED",
        cooperativeId: String(row.cooperativeId || COOP_ID_PUSH),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "votes",
          priority: "max",
          defaultSound: true,
          defaultVibrateTimings: true,
          color: "#15803d",
          icon: "notification_icon",
        },
      },
      apns: {
        payload: { aps: { sound: "default", badge: 1, contentAvailable: true } },
      },
      tokens: [token],
    };

    const tokenToUserRef = new Map([[token, userRef]]);
    await sendMulticastWithRetry(base, tokenToUserRef);
  }
);
