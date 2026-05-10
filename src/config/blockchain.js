import { ethers } from 'ethers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CONTRACT_ADDRESS,
  POLYGON_AMOY_RPC,
  POLYGONSCAN_BASE,
} from './contract';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** True si `contract.js` contient une adresse déployée (après Hardhat deploy). */
export function isContractConfigured() {
  return (
    typeof CONTRACT_ADDRESS === 'string' &&
    CONTRACT_ADDRESS.length === 42 &&
    CONTRACT_ADDRESS.toLowerCase() !== ZERO_ADDRESS
  );
}
import CoopLedgerABI from './CoopLedgerABI.json';

// ─── Clé AsyncStorage ────────────────────────────────────────────────────────
const WALLET_KEY = '@coopledger_wallet_pk';

// ─── Provider (lecture seule, pas de signer) ─────────────────────────────────
export const provider = new ethers.JsonRpcProvider(POLYGON_AMOY_RPC);

// ─── Wallet management ────────────────────────────────────────────────────────

/**
 * Charge ou génère le wallet local de l'utilisateur.
 * La clé privée est stockée dans AsyncStorage (chiffrée par l'OS via SecureStore
 * si disponible, sinon AsyncStorage standard).
 */
export async function getOrCreateWallet() {
  try {
    let privateKey = await AsyncStorage.getItem(WALLET_KEY);
    if (!privateKey) {
      const newWallet = ethers.Wallet.createRandom();
      privateKey = newWallet.privateKey;
      await AsyncStorage.setItem(WALLET_KEY, privateKey);
    }
    return new ethers.Wallet(privateKey, provider);
  } catch (err) {
    throw new Error('Impossible de charger ou créer le wallet : ' + err.message);
  }
}

/**
 * Retourne l'adresse publique du wallet local.
 */
export async function getWalletAddress() {
  const wallet = await getOrCreateWallet();
  return wallet.address;
}

/**
 * Remplace le wallet local par celui correspondant à une clé privée (ex. export MetaMask).
 * ⚠️ À utiliser uniquement sur un appareil personnel ; ne partage jamais ta clé.
 */
export async function importWalletFromPrivateKey(privateKeyInput) {
  const trimmed = privateKeyInput.trim().replace(/\s/g, '');
  const pk = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
    throw new Error('Format de clé privée invalide (64 caractères hex après 0x).');
  }
  const wallet = new ethers.Wallet(pk);
  await AsyncStorage.setItem(WALLET_KEY, wallet.privateKey);
  return wallet.address;
}

// ─── Contract instances ──────────────────────────────────────────────────────

/**
 * Instance du contrat en lecture seule (pas de gas).
 */
export function getContractReadOnly() {
  if (!isContractConfigured()) {
    throw new Error(
      'Contrat non configuré : déploie avec Hardhat puis mets à jour src/config/contract.js (CONTRACT_ADDRESS).'
    );
  }
  return new ethers.Contract(CONTRACT_ADDRESS, CoopLedgerABI, provider);
}

/**
 * Instance du contrat avec signer (pour écrire, coûte du MATIC).
 */
export async function getContractWithSigner() {
  const wallet = await getOrCreateWallet();
  return new ethers.Contract(CONTRACT_ADDRESS, CoopLedgerABI, wallet);
}

// ─── Helpers montants ─────────────────────────────────────────────────────────
// 1 FCFA = 1 unité on-chain (BigInt)

export function fcfaToChain(montantFCFA) {
  return BigInt(Math.round(montantFCFA));
}

export function chainToFcfa(montantChain) {
  return Number(montantChain);
}

export function formatFCFA(montant) {
  const n = typeof montant === 'bigint' ? Number(montant) : montant;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M FCFA`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K FCFA`;
  return `${n.toLocaleString('fr-FR')} FCFA`;
}

// ─── Helpers Polygonscan ──────────────────────────────────────────────────────

export function polygonscanTxUrl(txHash) {
  return `${POLYGONSCAN_BASE}/tx/${txHash}`;
}

export function polygonscanAddressUrl(address) {
  return `${POLYGONSCAN_BASE}/address/${address}`;
}

// ─── Mapping statuts on-chain ↔ UI ───────────────────────────────────────────

// StatutTransaction: 0=EN_ATTENTE_VOTE, 1=VALIDE, 2=REJETE, 3=ANNULE
export const STATUT_TX = {
  0: 'en_cours',
  1: 'valide',
  2: 'rejete',
  3: 'annule',
};

// StatutVote: 0=OUVERT, 1=APPROUVE, 2=REJETE, 3=ANNULE
export const STATUT_VOTE = {
  0: 'ouvert',
  1: 'approuve',
  2: 'rejete',
  3: 'annule',
};

// Role: 0=AUCUN, 1=MEMBRE, 2=TRESORIER, 3=PRESIDENT
export const ROLES = {
  0: 'aucun',
  1: 'membre',
  2: 'tresorier',
  3: 'president',
};

// ─── Gestion d'erreurs FR ─────────────────────────────────────────────────────

export function parseBlockchainError(err) {
  const msg = err?.message || err?.toString() || '';

  if (msg.includes('insufficient funds') || msg.includes('INSUFFICIENT_FUNDS')) {
    return 'Fonds insuffisants pour payer les frais de transaction. Obtiens du MATIC test sur faucet.polygon.technology';
  }
  if (msg.includes('user rejected') || msg.includes('ACTION_REJECTED')) {
    return 'Transaction annulée';
  }
  if (msg.includes('network') || msg.includes('NETWORK_ERROR') || msg.includes('fetch')) {
    return 'Erreur réseau. Vérifie ta connexion internet.';
  }
  if (msg.includes('Seul le president')) {
    return 'Seul le président peut effectuer cette action.';
  }
  if (msg.includes('Seuls le president et le tresorier')) {
    return 'Seuls le président et le trésorier peuvent créer des transactions.';
  }
  if (msg.includes('deja vote')) {
    return 'Tu as déjà voté sur cette proposition.';
  }
  if (msg.includes('expire')) {
    return 'Ce vote a expiré sans atteindre le quorum.';
  }
  if (msg.includes('pas membre')) {
    return 'Tu n\'es pas membre de cette coopérative.';
  }
  if (msg.includes('nonce') || msg.includes('replacement')) {
    return 'Transaction en attente. Réessaie dans quelques instants.';
  }
  if (msg.includes('Contrat non configuré')) {
    return 'Contrat non déployé : exécute le script Hardhat deploy puis mets à jour CONTRACT_ADDRESS.';
  }
  return 'Erreur blockchain. Réessaie.';
}
