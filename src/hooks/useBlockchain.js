import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getContractReadOnly,
  getContractWithSigner,
  getWalletAddress,
  fcfaToChain,
  chainToFcfa,
  STATUT_TX,
  STATUT_VOTE,
  ROLES,
  parseBlockchainError,
} from '../config/blockchain';

// Cache local des tx hashes (transactionId → txHash on-chain)
const TX_HASHES_KEY = '@coopledger_tx_hashes';

async function getTxHashesCache() {
  const raw = await AsyncStorage.getItem(TX_HASHES_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function saveTxHash(transactionId, hash) {
  const cache = await getTxHashesCache();
  cache[String(transactionId)] = hash;
  await AsyncStorage.setItem(TX_HASHES_KEY, JSON.stringify(cache));
}

// ─── Utilitaire de mapping ─────────────────────────────────────────────────────

function mapTransaction(t, index) {
  return {
    id: index,
    titre: t.titre,
    montant: chainToFcfa(t.montant),
    categorie: t.categorie,
    type: t.typeTransaction,
    creePar: t.creePar,
    date: new Date(Number(t.timestamp) * 1000),
    statut: STATUT_TX[Number(t.statut)] ?? 'en_cours',
    voteDeclenche: t.voteDeclenche,
    hash: null, // sera mis à jour après sendTransaction
  };
}

function mapVote(v, transactionId) {
  const now = Date.now() / 1000;
  const expiresAt = Number(v.expiresAt);
  const statutNum = Number(v.statut);
  let statut = STATUT_VOTE[statutNum] ?? 'ouvert';
  // Calcul côté app si expiré mais pas encore marqué on-chain
  if (statut === 'ouvert' && now > expiresAt) statut = 'annule';

  return {
    transactionId,
    titre: v.titre,
    montant: chainToFcfa(v.montant),
    votesOui: Number(v.votesOui),
    votesNon: Number(v.votesNon),
    openedAt: new Date(Number(v.openedAt) * 1000),
    dateExpiration: new Date(expiresAt * 1000),
    statut,
    totalMembres: Number(v.totalMembresAuMomentDuVote),
    quorumRequis: 60,
  };
}

// ─── useTransactions ──────────────────────────────────────────────────────────

export function useTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const charger = useCallback(async () => {
    try {
      setError(null);
      const contract = getContractReadOnly();
      const raw = await contract.getToutesTransactions();
      const hashesCache = await getTxHashesCache();
      const mapped = raw.map((t, i) => {
        const tx = mapTransaction(t, i);
        tx.hash = hashesCache[String(i)] || null;
        return tx;
      }).reverse(); // plus récent en premier
      setTransactions(mapped);
    } catch (err) {
      setError(parseBlockchainError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    charger();
    const interval = setInterval(charger, 15000); // Refresh toutes les 15s
    return () => clearInterval(interval);
  }, [charger]);

  return { transactions, loading, error, refetch: charger };
}

// ─── useVotesPourTransactions ──────────────────────────────────────────────────
// Charge tous les votes ouverts (pour DashboardScreen & VoteScreen)

export function useVotes() {
  const [votes, setVotes] = useState([]);
  const [historique, setHistorique] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const charger = useCallback(async () => {
    try {
      setError(null);
      const contract = getContractReadOnly();
      const txCount = Number(await contract.nombreTransactions());
      const fetchedVotes = [];

      // Récupère les votes associés aux transactions
      for (let i = 0; i < txCount; i++) {
        try {
          const voteHasIndex = await contract.voteParTransaction(i);
          if (Number(voteHasIndex) > 0) {
            const rawVote = await contract.getVote(i);
            fetchedVotes.push(mapVote(rawVote, i));
          }
        } catch {
          // pas de vote pour cette transaction, on passe
        }
      }

      const now = new Date();
      const ouverts = fetchedVotes.filter(v => {
        if (v.statut !== 'ouvert') return false;
        return v.dateExpiration > now;
      });
      const clos = fetchedVotes.filter(v =>
        ['approuve', 'rejete', 'annule'].includes(v.statut)
      ).slice(0, 5);

      setVotes(ouverts);
      setHistorique(clos);
    } catch (err) {
      setError(parseBlockchainError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    charger();
    const interval = setInterval(charger, 15000);
    return () => clearInterval(interval);
  }, [charger]);

  return { votes, historique, loading, error, refetch: charger };
}

// ─── useVote (vote unique pour une transaction) ───────────────────────────────

export function useVote(transactionId) {
  const [vote, setVote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const charger = useCallback(async () => {
    if (transactionId === null || transactionId === undefined) return;
    try {
      setError(null);
      const contract = getContractReadOnly();
      const rawVote = await contract.getVote(transactionId);
      setVote(mapVote(rawVote, transactionId));
    } catch (err) {
      setError(parseBlockchainError(err));
    } finally {
      setLoading(false);
    }
  }, [transactionId]);

  useEffect(() => {
    charger();
  }, [charger]);

  return { vote, loading, error, refetch: charger };
}

// ─── useSolde ──────────────────────────────────────────────────────────────────

export function useSolde() {
  const [solde, setSolde] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const charger = useCallback(async () => {
    try {
      setError(null);
      const contract = getContractReadOnly();
      const raw = await contract.getSolde();
      setSolde(Number(raw)); // peut être négatif
    } catch (err) {
      setError(parseBlockchainError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    charger();
    const interval = setInterval(charger, 15000);
    return () => clearInterval(interval);
  }, [charger]);

  return { solde, loading, error, refetch: charger };
}

// ─── sendTransaction ──────────────────────────────────────────────────────────

export function useSendTransaction() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const sendTransaction = useCallback(async ({
    titre,
    montant,
    categorie,
    typeTransaction,
  }) => {
    setLoading(true);
    setError(null);
    try {
      const contract = await getContractWithSigner();
      const montantChain = fcfaToChain(montant);

      const tx = await contract.enregistrerTransaction(
        titre,
        montantChain,
        categorie,
        typeTransaction
      );
      const receipt = await tx.wait();

      // Trouver l'id de la transaction depuis l'event
      const event = receipt.logs?.find(l => {
        try { return contract.interface.parseLog(l)?.name === 'TransactionEnregistree'; }
        catch { return false; }
      });
      const parsed = event ? contract.interface.parseLog(event) : null;
      const transactionId = parsed ? Number(parsed.args.transactionId) : null;
      const voteDeclenche = parsed ? parsed.args.voteDeclenche : (montant > 500000);

      if (transactionId !== null) {
        await saveTxHash(transactionId, receipt.hash);
      }

      return {
        hash: receipt.hash,
        transactionId,
        voteDeclenche,
      };
    } catch (err) {
      const msgFr = parseBlockchainError(err);
      setError(msgFr);
      throw new Error(msgFr);
    } finally {
      setLoading(false);
    }
  }, []);

  return { sendTransaction, loading, error };
}

// ─── vote ──────────────────────────────────────────────────────────────────────

export function useVoter() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const voter = useCallback(async (transactionId, choix) => {
    setLoading(true);
    setError(null);
    try {
      const contract = await getContractWithSigner();
      const tx = choix === 'oui'
        ? await contract.voterOui(transactionId)
        : await contract.voterNon(transactionId);
      const receipt = await tx.wait();

      // Lire le statut du vote après confirmation
      const eventLog = receipt.logs?.find(l => {
        try { return contract.interface.parseLog(l)?.name === 'VoteEnregistre'; }
        catch { return false; }
      });
      const finaliseLog = receipt.logs?.find(l => {
        try { return contract.interface.parseLog(l)?.name === 'VoteFinalise'; }
        catch { return false; }
      });

      const parsed = eventLog ? contract.interface.parseLog(eventLog) : null;
      const finalise = finaliseLog ? contract.interface.parseLog(finaliseLog) : null;

      return {
        hash: receipt.hash,
        votesOui: parsed ? Number(parsed.args.votesOui) : null,
        votesNon: parsed ? Number(parsed.args.votesNon) : null,
        voteTermine: !!finalise,
        resultat: finalise ? STATUT_VOTE[Number(finalise.args.resultat)] : null,
      };
    } catch (err) {
      const msgFr = parseBlockchainError(err);
      setError(msgFr);
      throw new Error(msgFr);
    } finally {
      setLoading(false);
    }
  }, []);

  return { voter, loading, error };
}

// ─── useMembres (admin) ───────────────────────────────────────────────────────

export function useMembres() {
  const [membres, setMembres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const charger = useCallback(async () => {
    try {
      setError(null);
      const contract = getContractReadOnly();
      const raw = await contract.getMembres();
      setMembres(raw.map(m => ({
        wallet: m.wallet,
        nom: m.nom,
        role: ROLES[Number(m.role)] ?? 'membre',
        actif: m.actif,
      })));
    } catch (err) {
      setError(parseBlockchainError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const addMember = useCallback(async (wallet, nom) => {
    const contract = await getContractWithSigner();
    const tx = await contract.addMember(wallet, nom);
    await tx.wait();
    await charger();
    return tx.hash;
  }, [charger]);

  const removeMember = useCallback(async (wallet) => {
    const contract = await getContractWithSigner();
    const tx = await contract.removeMember(wallet);
    await tx.wait();
    await charger();
    return tx.hash;
  }, [charger]);

  const setRole = useCallback(async (wallet, role) => {
    const roleMap = { membre: 1, tresorier: 2 };
    const roleNum = roleMap[role];
    if (!roleNum) throw new Error('Rôle invalide. Utiliser "membre" ou "tresorier"');
    const contract = await getContractWithSigner();
    const tx = await contract.setRole(wallet, roleNum);
    await tx.wait();
    await charger();
    return tx.hash;
  }, [charger]);

  const transferPresidence = useCallback(async (wallet) => {
    const contract = await getContractWithSigner();
    const tx = await contract.transferPresidence(wallet);
    await tx.wait();
    await charger();
    return tx.hash;
  }, [charger]);

  return {
    membres,
    loading,
    error,
    refetch: charger,
    addMember,
    removeMember,
    setRole,
    transferPresidence,
  };
}

// ─── useWalletAddress ──────────────────────────────────────────────────────────

export function useWalletAddress() {
  const [address, setAddress] = useState(null);

  useEffect(() => {
    getWalletAddress().then(setAddress).catch(() => {});
  }, []);

  return address;
}
