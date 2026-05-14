const express = require('express');
const cron = require('node-cron');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const { ethers } = require('ethers');
const CoopLedgerABI = require('./CoopLedgerABI.json');

function fcfaToChain(montantFcfa) {
  return BigInt(Math.round(Number(montantFcfa)));
}

/**
 * Enregistre la transaction sur Polygon Amoy (même logique que l’app : enregistrerTransaction).
 * Nécessite un wallet serveur autorisé sur le contrat.
 */
async function enregistrerTransactionOnChain({
  titre,
  montantFcfa,
  categorie,
  typeTransaction,
}) {
  const rpc = process.env.POLYGON_AMOY_RPC;
  const pkRaw = process.env.WEBHOOK_CHAIN_PRIVATE_KEY;
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!rpc || !pkRaw || !contractAddress) {
    throw new Error(
      'POLYGON_AMOY_RPC, WEBHOOK_CHAIN_PRIVATE_KEY et CONTRACT_ADDRESS sont requis pour l’enregistrement on-chain.'
    );
  }
  const pk = String(pkRaw).trim().replace(/\s/g, '');
  const pkNorm = pk.startsWith('0x') ? pk : `0x${pk}`;
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pkNorm, provider);
  const contract = new ethers.Contract(contractAddress, CoopLedgerABI, wallet);
  const montantChain = fcfaToChain(montantFcfa);
  const tx = await contract.enregistrerTransaction(
    titre,
    montantChain,
    categorie,
    typeTransaction
  );
  const receipt = await tx.wait();
  return receipt.hash;
}

const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
  console.error('Variables FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL et FIREBASE_PRIVATE_KEY requises.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-CoopLedger-Secret, Authorization'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

app.use(express.json());

function requireProxySecret(req, res, next) {
  const secret =
    req.headers['x-coopledger-secret'] || req.headers['X-CoopLedger-Secret'];
  const expected = process.env.MOBILE_PROXY_SECRET;
  if (!expected || secret !== expected) {
    return res.status(401).json({ error: 'Secret proxy invalide ou manquant' });
  }
  return next();
}

function fedapayHeaders() {
  const sk = process.env.FEDAPAY_SECRET_KEY;
  if (!sk) throw new Error('FEDAPAY_SECRET_KEY manquant sur le serveur');
  return {
    Authorization: `Bearer ${sk}`,
    'Content-Type': 'application/json',
  };
}

function fedapayAuthHeader() {
  const sk = process.env.FEDAPAY_SECRET_KEY;
  if (!sk) throw new Error('FEDAPAY_SECRET_KEY manquant sur le serveur');
  return { Authorization: `Bearer ${sk}` };
}

app.post(
  '/api/fedapay/transactions',
  requireProxySecret,
  async (req, res) => {
    try {
      const {
        montant,
        description = '',
        nom = 'Client',
        email = 'client@example.com',
        telephone = '',
      } = req.body || {};

      const amount = Math.round(Number(montant || 0));
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Montant invalide' });
      }

      const parts = String(nom).trim().split(/\s+/);
      const firstname = parts[0] || 'Client';
      const lastname = parts.slice(1).join(' ') || 'CoopLedger';

      let number = String(telephone || '').replace(/\s/g, '');
      if (number && !number.startsWith('+')) {
        const digits = number.replace(/\D/g, '');
        number = digits.startsWith('228') ? `+${digits}` : `+228${digits}`;
      }

      const customer = {
        firstname,
        lastname,
        email: String(email).trim() || 'client@example.com',
      };
      if (number) {
        customer.phone_number = { number, country: 'tg' };
      }

      const payload = {
        description: String(description).slice(0, 500),
        amount,
        currency: { iso: 'XOF' },
        customer,
      };

      const r = await fetch(
        'https://sandbox-api.fedapay.com/v1/transactions',
        {
          method: 'POST',
          headers: fedapayHeaders(),
          body: JSON.stringify(payload),
        }
      );

      const text = await r.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return res.status(r.status).send(text);
      }
      return res.status(r.status).json(json);
    } catch (err) {
      console.error('fedapay create:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

app.post(
  '/api/fedapay/transactions/:id/pay',
  requireProxySecret,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { mode, telephone } = req.body || {};
      let number = String(telephone || '').replace(/\s/g, '');
      if (number && !number.startsWith('+')) {
        const digits = number.replace(/\D/g, '');
        number = digits.startsWith('228') ? `+${digits}` : `+228${digits}`;
      }

      const payBody = { mode: mode || 'mtn' };
      if (number) {
        payBody.phone_number = { number, country: 'tg' };
      }

      const r = await fetch(
        `https://sandbox-api.fedapay.com/v1/transactions/${encodeURIComponent(id)}/pay`,
        {
          method: 'POST',
          headers: fedapayHeaders(),
          body: JSON.stringify(payBody),
        }
      );

      const text = await r.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return res.status(r.status).send(text);
      }
      return res.status(r.status).json(json);
    } catch (err) {
      console.error('fedapay pay:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

app.get(
  '/api/fedapay/transactions/:id',
  requireProxySecret,
  async (req, res) => {
    try {
      const { id } = req.params;
      const r = await fetch(
        `https://sandbox-api.fedapay.com/v1/transactions/${encodeURIComponent(id)}`,
        { headers: fedapayAuthHeader() }
      );
      const text = await r.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return res.status(r.status).send(text);
      }
      return res.status(r.status).json(json);
    } catch (err) {
      console.error('fedapay get:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Rapport mensuel — rappel push le 1er du mois à 8h (Togo)
cron.schedule(
  '0 8 1 * *',
  async () => {
    console.log('[CRON] Génération rapport mensuel automatique');
    try {
      const usersSnap = await db
        .collection('users')
        .where('role', '==', 'president')
        .where('statut', '==', 'actif')
        .get();

      console.log(`[CRON] ${usersSnap.size} président(s) trouvé(s)`);

      const tokens = usersSnap.docs
        .map((d) => d.data().expoPushToken)
        .filter((t) => t && String(t).startsWith('ExponentPushToken['));

      if (tokens.length > 0) {
        const messages = tokens.map((token) => ({
          to: token,
          title: '📊 Rapport mensuel disponible',
          body:
            'Le rapport du mois précédent est prêt. Ouvrez l\'app pour le consulter.',
          data: { type: 'RAPPORT_MENSUEL' },
          sound: 'default',
          channelId: 'votes',
        }));

        await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messages),
        });
      }
    } catch (e) {
      console.error('[CRON] Rapport mensuel:', e);
    }
  },
  { timezone: 'Africa/Lome' }
);

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CoopLedger Webhook',
    version: '1.0.0',
  });
});

app.post('/webhook/fedapay', async (req, res) => {
  try {
    const payload = req.body;

    console.log('Webhook reçu:', JSON.stringify(payload, null, 2));

    const eventName =
      payload?.name || payload?.event?.name || '';
    const transaction =
      payload?.transaction || payload?.data?.object || {};

    if (
      !String(eventName).toLowerCase().includes('approved')
      && !String(eventName).toLowerCase().includes('completed')
    ) {
      console.log('Événement ignoré:', eventName);
      return res.json({ received: true, action: 'ignored' });
    }

    const montant = Number(transaction.amount || 0);
    const telephone =
      transaction.customer?.phone_number?.number || '';
    const reference =
      transaction.reference || `FP_${Date.now()}`;
    const transactionId = String(transaction.id || Date.now());

    const chainTxHash = await enregistrerTransactionOnChain({
      titre: `Paiement Mobile Money — FedaPay (${reference})`,
      montantFcfa: montant,
      categorie: 'cotisation',
      typeTransaction: 'mobile_money',
    });

    await db.collection('transactions').add({
      titre: 'Paiement Mobile Money — FedaPay',
      montant,
      typeTransaction: 'mobile_money',
      type: 'entree',
      categorie: 'cotisation',
      telephone,
      referencePayment: reference,
      fedapayTransactionId: transactionId,
      fedapayEvent: eventName,
      cooperativeId: 'broukou',
      statut: 'valide',
      date: admin.firestore.FieldValue.serverTimestamp(),
      hash: chainTxHash,
      source: 'webhook_fedapay',
    });

    console.log('Transaction enregistrée:', reference);

    const membresSnap = await db
      .collection('users')
      .where('cooperativeId', '==', 'broukou')
      .where('statut', '==', 'actif')
      .get();

    const tokens = membresSnap.docs
      .map((d) => d.data().expoPushToken)
      .filter(
        (t) => t && t.startsWith('ExponentPushToken[')
      );

    if (tokens.length > 0) {
      const chunks = [];
      for (let i = 0; i < tokens.length; i += 100) {
        chunks.push(tokens.slice(i, i + 100));
      }

      for (const chunk of chunks) {
        const messages = chunk.map((token) => ({
          to: token,
          sound: 'default',
          title: '💰 Paiement reçu !',
          body:
            `${montant.toLocaleString('fr-FR')} FCFA reçus via FedaPay\n`
            + `Réf: ${reference}`,
          data: {
            type: 'FEDAPAY_PAYMENT',
            reference,
            montant,
          },
          priority: 'high',
          channelId: 'votes',
        }));

        await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messages),
        });
      }

      console.log(`${tokens.length} notification(s) push envoyée(s)`);
    }

    await db.collection('webhooks_fedapay').add({
      eventName,
      transactionId,
      reference,
      montant,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      payload: JSON.stringify(payload).slice(0, 5000),
    });

    return res.json({
      received: true,
      action: 'processed',
      reference,
    });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/test', async (req, res) => {
  console.log('Test webhook reçu');
  return res.json({ ok: true, message: 'Webhook actif !' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CoopLedger Webhook démarré sur le port ${PORT}`);
});
