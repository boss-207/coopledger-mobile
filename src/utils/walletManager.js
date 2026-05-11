import { ethers } from 'ethers';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const POLYGON_AMOY_RPC = 'https://rpc-amoy.polygon.technology';

export async function genererWallet(uid) {
  const wallet = ethers.Wallet.createRandom();
  await updateDoc(doc(db, 'users', uid), {
    walletAddress: wallet.address,
    walletPrivateKey: wallet.privateKey,
    walletMnemonic: wallet.mnemonic?.phrase || '',
  });
  return { address: wallet.address, privateKey: wallet.privateKey };
}

export async function getWalletMembre(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  const data = snap.data();
  if (!data?.walletAddress) return await genererWallet(uid);
  const provider = new ethers.JsonRpcProvider(POLYGON_AMOY_RPC);
  return new ethers.Wallet(data.walletPrivateKey, provider);
}

export async function getAdresseWallet(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.data()?.walletAddress || null;
}

export function truncateAddress(address) {
  if (!address) return '—';
  return address.slice(0, 6) + '...' + address.slice(-4);
}
