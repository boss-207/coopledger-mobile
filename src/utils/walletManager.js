import { ethers } from 'ethers';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { POLYGON_AMOY_RPC } from '../config/contract';
import { setDeviceWalletPrivateKey } from '../config/blockchain';

function amoyProvider() {
  return new ethers.JsonRpcProvider(POLYGON_AMOY_RPC);
}

export async function genererWallet(uid) {
  const wallet = ethers.Wallet.createRandom();
  await updateDoc(doc(db, 'users', uid), {
    walletAddress: wallet.address,
    walletPrivateKey: wallet.privateKey,
    walletMnemonic: wallet.mnemonic?.phrase || '',
  });
  return { address: wallet.address, privateKey: wallet.privateKey };
}

/**
 * Wallet utilisé pour signer les transactions : celui enregistré sur users/{uid}.
 * Crée et enregistre une paire si aucune clé n’est présente.
 */
export async function getWalletMembre(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  const data = snap.data();
  if (!data?.walletPrivateKey) {
    await genererWallet(uid);
    const snap2 = await getDoc(doc(db, 'users', uid));
    const d2 = snap2.data();
    if (!d2?.walletPrivateKey) {
      throw new Error('Impossible de créer le wallet membre sur Firestore.');
    }
    return new ethers.Wallet(d2.walletPrivateKey, amoyProvider());
  }
  return new ethers.Wallet(data.walletPrivateKey, amoyProvider());
}

/**
 * Import MetaMask / Hardhat : met à jour Firestore + cache appareil pour ce compte.
 */
export async function importWalletPrivateKeyForUser(uid, privateKeyInput) {
  const trimmed = String(privateKeyInput).trim().replace(/\s/g, '');
  const pk = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
    throw new Error('Format de clé privée invalide (64 caractères hex après 0x).');
  }
  const wallet = new ethers.Wallet(pk);
  await updateDoc(doc(db, 'users', uid), {
    walletAddress: wallet.address,
    walletPrivateKey: wallet.privateKey,
    walletMnemonic: '',
  });
  await setDeviceWalletPrivateKey(wallet.privateKey);
  return wallet.address;
}

export async function getAdresseWallet(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.data()?.walletAddress || null;
}

export function truncateAddress(address) {
  if (!address) return '—';
  return address.slice(0, 6) + '...' + address.slice(-4);
}
