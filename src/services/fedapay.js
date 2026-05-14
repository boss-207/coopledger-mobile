/**
 * FedaPay (sandbox) via proxy serveur — la clé secrète sk_ ne doit jamais être dans l’app.
 * Configurez EXPO_PUBLIC_COOPLEDGER_API_URL + EXPO_PUBLIC_COOPLEDGER_PROXY_SECRET (même valeur que MOBILE_PROXY_SECRET sur le webhook).
 * Sans proxy : repli sur une simulation locale (démo).
 */

const PROXY_BASE = (process.env.EXPO_PUBLIC_COOPLEDGER_API_URL || '').replace(/\/$/, '');
const PROXY_SECRET = process.env.EXPO_PUBLIC_COOPLEDGER_PROXY_SECRET || '';

/** @deprecated Conservé pour compat ; l’app n’appelle plus FedaPay directement avec une clé. */
export const FEDAPAY_API_KEY =
  process.env.EXPO_PUBLIC_FEDAPAY_PUBLIC_KEY
  || process.env.EXPO_PUBLIC_FEDAPAY_KEY;

async function proxyFetch(path, options = {}) {
  if (!PROXY_BASE || !PROXY_SECRET) return null;
  const url = `${PROXY_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    'X-CoopLedger-Secret': PROXY_SECRET,
    ...options.headers,
  };
  if (options.body != null) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, {
    ...options,
    headers,
  });
}

function extractTransactionPayload(json) {
  const root = json?.data ?? json?.v1?.data ?? json;
  const tx = root?.transaction ?? root;
  const id = tx?.id ?? tx?.transaction_id ?? root?.id;
  const token = tx?.token ?? tx?.payment_token ?? tx?.payment_url ?? String(id ?? '');
  const reference = tx?.reference ?? root?.reference ?? '';
  const status = String(
    tx?.status ?? tx?.state ?? root?.status ?? ''
  ).toLowerCase();
  return { id: id != null ? String(id) : '', token: token != null ? String(token) : '', reference, status };
}

async function simulerCreation(params) {
  await new Promise((r) => setTimeout(r, 800));
  const fakeId = `SIM_${Date.now()}`;
  return {
    success: true,
    transactionId: fakeId,
    token: fakeId,
    error: null,
  };
}

export async function creerTransaction(params) {
  const res = await proxyFetch('/api/fedapay/transactions', {
    method: 'POST',
    body: JSON.stringify({
      montant: params.montant,
      description: params.description || '',
      nom: params.nom,
      email: params.email,
      telephone: params.telephone,
      cooperativeId: params.cooperativeId,
    }),
  });

  if (!res) {
    console.warn(
      '[FedaPay] Proxy non configuré (EXPO_PUBLIC_COOPLEDGER_API_URL + EXPO_PUBLIC_COOPLEDGER_PROXY_SECRET) — simulation.'
    );
    return simulerCreation(params);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return { success: false, error: `Réponse invalide (${res.status})`, transactionId: null, token: null };
  }

  if (!res.ok) {
    const msg = json?.message || json?.error || JSON.stringify(json);
    return { success: false, error: msg || `HTTP ${res.status}`, transactionId: null, token: null };
  }

  const { id, token } = extractTransactionPayload(json);
  if (!id) {
    return { success: false, error: 'Réponse FedaPay sans identifiant de transaction', transactionId: null, token: null };
  }

  return {
    success: true,
    transactionId: id,
    token: token || id,
    error: null,
  };
}

export async function envoyerPromptPaiement(token, methode, telephone = '') {
  const transactionId = token;
  const res = await proxyFetch(
    `/api/fedapay/transactions/${encodeURIComponent(transactionId)}/pay`,
    {
      method: 'POST',
      body: JSON.stringify({ mode: methode, telephone }),
    }
  );

  if (!res) {
    await new Promise((r) => setTimeout(r, 600));
    return {
      success: true,
      message: `Prompt simulé (${methode}) sur ${telephone || '(numéro)'}`,
      error: null,
    };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return { success: res.ok, message: null, error: res.ok ? null : `HTTP ${res.status}` };
  }

  if (!res.ok) {
    return {
      success: false,
      message: null,
      error: json?.message || json?.error || `HTTP ${res.status}`,
    };
  }

  return {
    success: true,
    message: json?.message || 'Prompt envoyé',
    error: null,
  };
}

export async function attendreConfirmation(transactionId) {
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    const res = await proxyFetch(
      `/api/fedapay/transactions/${encodeURIComponent(transactionId)}`,
      { method: 'GET' }
    );

    if (!res) {
      await new Promise((r) => setTimeout(r, 3000));
      return {
        success: true,
        statut: 'approved',
        reference: `REF_${transactionId}`,
        timeoutAtteint: false,
      };
    }

    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    let json;
    try {
      json = await res.json();
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    const { status, reference } = extractTransactionPayload(json);
    if (status === 'approved' || status === 'completed' || status === 'success') {
      return {
        success: true,
        statut: 'approved',
        reference: reference || `REF_${transactionId}`,
        timeoutAtteint: false,
      };
    }
    if (status === 'declined' || status === 'canceled' || status === 'cancelled' || status === 'failed') {
      return {
        success: false,
        statut: status,
        reference: reference || '',
        timeoutAtteint: false,
      };
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  return {
    success: false,
    statut: 'timeout',
    reference: '',
    timeoutAtteint: true,
  };
}

export async function verifierStatut(transactionId) {
  const res = await proxyFetch(
    `/api/fedapay/transactions/${encodeURIComponent(transactionId)}`,
    { method: 'GET' }
  );
  if (!res) {
    return {
      success: true,
      statut: 'approved',
      reference: String(transactionId),
      montant: 0,
      error: null,
    };
  }
  let json;
  try {
    json = await res.json();
  } catch {
    return { success: false, statut: 'unknown', reference: '', montant: 0, error: 'Parse error' };
  }
  const { status, reference } = extractTransactionPayload(json);
  return {
    success: res.ok,
    statut: status || 'unknown',
    reference: reference || String(transactionId),
    montant: Number(json?.data?.amount ?? json?.amount ?? 0),
    error: res.ok ? null : json?.message,
  };
}
