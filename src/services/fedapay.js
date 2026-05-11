const FEDAPAY_BASE_URL = 'https://sandbox-api.fedapay.com/v1';
const FEDAPAY_API_KEY = process.env.EXPO_PUBLIC_FEDAPAY_KEY;

const getHeaders = () => ({
  Authorization: `Bearer ${FEDAPAY_API_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

async function fetchWithTimeout(url, options, ms = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('Delai de connexion depasse');
    }
    throw err;
  }
}

function lireMessageFedaPay(payload) {
  if (!payload) return null;
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
  const errors = payload?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    if (typeof first === 'string') return first;
    if (typeof first?.message === 'string') return first.message;
    if (typeof first?.description === 'string') return first.description;
  }
  if (typeof payload?.description === 'string' && payload.description.trim()) return payload.description.trim();
  return null;
}

function mapHttpError(status, payload) {
  if (status === 401) return 'Cle API invalide';
  if (status === 422) {
    const details = lireMessageFedaPay(payload);
    return details ? `Donnees invalides: ${details}` : 'Donnees invalides envoyees a FedaPay';
  }
  const details = lireMessageFedaPay(payload);
  return details || `Erreur FedaPay (${status})`;
}

function parseStatutFedaPay(payload) {
  const raw =
    payload?.v1?.status ||
    payload?.v1?.state ||
    payload?.v1?.status_name ||
    payload?.status ||
    payload?.state ||
    'pending';

  const value = String(raw).toLowerCase();
  if (value.includes('approved') || value.includes('success') || value.includes('completed')) return 'approved';
  if (value.includes('declined') || value.includes('failed')) return 'declined';
  if (value.includes('cancel')) return 'cancelled';
  return 'pending';
}

function parseMontant(payload) {
  return Number(payload?.v1?.amount ?? payload?.amount ?? 0);
}

function parseReference(payload) {
  return (
    payload?.v1?.reference ||
    payload?.v1?.id ||
    payload?.reference ||
    payload?.id ||
    ''
  );
}

export async function creerTransaction(params) {
  try {
    if (!FEDAPAY_API_KEY) {
      return {
        success: false,
        transactionId: '',
        token: '',
        error: 'Cle API FedaPay manquante (EXPO_PUBLIC_FEDAPAY_KEY)',
      };
    }
    const nomComplet = String(params?.nom || '').trim();
    const parts = nomComplet.split(/\s+/).filter(Boolean);
    const firstname = parts[0] || 'Membre';
    const lastname = parts.slice(1).join(' ') || '';

    const body = {
      description: params.description,
      amount: params.montant,
      currency: { iso: 'XOF' },
      callback_url: 'https://coopledger.app/callback',
      customer: {
        firstname,
        lastname,
        email: params.email,
        phone_number: {
          number: params.telephone,
          country: 'tg',
        },
      },
    };

    const response = await fetchWithTimeout(`${FEDAPAY_BASE_URL}/transactions`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        transactionId: '',
        token: '',
        error: mapHttpError(response.status, payload),
      };
    }

    const transactionId = String(payload?.v1?.id || payload?.id || '');
    const token = String(payload?.v1?.token || payload?.token || '');

    if (!transactionId || !token) {
      return {
        success: false,
        transactionId: '',
        token: '',
        error: 'Reponse FedaPay incomplete (id/token manquant)',
      };
    }

    return {
      success: true,
      transactionId,
      token,
      error: null,
    };
  } catch (error) {
    const msg = /Delai/.test(error?.message || '')
      ? error.message
      : 'Verifiez votre connexion';
    return {
      success: false,
      transactionId: '',
      token: '',
      error: msg,
    };
  }
}

export async function envoyerPromptPaiement(token, methode, telephone = '') {
  try {
    const response = await fetchWithTimeout(`${FEDAPAY_BASE_URL}/transactions/${token}/${methode}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        phone_number: telephone,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        message: '',
        error: mapHttpError(response.status, payload),
      };
    }

    return {
      success: true,
      message: lireMessageFedaPay(payload) || 'Prompt envoye',
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      message: '',
      error: /Delai/.test(error?.message || '') ? error.message : 'Verifiez votre connexion',
    };
  }
}

export async function verifierStatut(transactionId) {
  try {
    const response = await fetchWithTimeout(`${FEDAPAY_BASE_URL}/transactions/${transactionId}`, {
      method: 'GET',
      headers: getHeaders(),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        statut: 'pending',
        reference: '',
        montant: 0,
        error: mapHttpError(response.status, payload),
      };
    }

    return {
      success: true,
      statut: parseStatutFedaPay(payload),
      reference: String(parseReference(payload)),
      montant: parseMontant(payload),
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      statut: 'pending',
      reference: '',
      montant: 0,
      error: /Delai/.test(error?.message || '') ? error.message : 'Verifiez votre connexion',
    };
  }
}

export async function attendreConfirmation(transactionId) {
  const maxTentatives = 36;
  const pauseMs = 5000;

  for (let i = 0; i < maxTentatives; i += 1) {
    const statut = await verifierStatut(transactionId);
    const current = statut?.statut || 'pending';
    const reference = statut?.reference || transactionId;

    if (current === 'approved') {
      return {
        success: true,
        statut: current,
        reference,
        timeoutAtteint: false,
      };
    }
    if (current === 'declined' || current === 'cancelled') {
      return {
        success: false,
        statut: current,
        reference,
        timeoutAtteint: false,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }

  return {
    success: false,
    statut: 'pending',
    reference: transactionId,
    timeoutAtteint: true,
  };
}

