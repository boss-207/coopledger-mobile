import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Linking, Modal, TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useVotes, useVoter } from '../hooks/useBlockchain';
import { polygonscanTxUrl } from '../config/blockchain';
import { addDoc, collection, doc, onSnapshot, query, runTransaction, setDoc, where, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { updateRolesAfterVote } from '../utils/updateRoles';
import { quorumAtteint } from '../utils/getMembresActifs';
import { calculerSolde, formaterMontant } from '../utils/soldeUtils';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';
const VIOLET = '#7c3aed';
const BLUE = '#1d4ed8';

const VOTES_LOCAUX_KEY = '@coopledger_mes_votes';

function getInitiales(nom) {
  if (!nom) return '?';
  const parts = nom.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('');
}

function ParticipationQuorumBloc({
  votesOui,
  votesNon,
  totalMembres,
  quorumPct,
  accentColor,
}) {
  const totalVotes = votesOui + votesNon;
  const pctBar = totalMembres > 0 ? Math.min(100, Math.round((totalVotes / totalMembres) * 100)) : 0;
  const qInfo = quorumAtteint(votesOui, totalMembres, quorumPct);
  const manqueOui = Math.max(0, qInfo.votesNecessaires - qInfo.votesActuels);

  return (
    <View style={styles.participBox}>
      <Text style={styles.participTitle}>Participation</Text>
      <View style={styles.participBarTrack}>
        <View style={[styles.participBarFill, { width: `${pctBar}%`, backgroundColor: accentColor }]} />
      </View>
      <Text style={styles.participLine}>
        {totalVotes} vote{totalVotes > 1 ? 's' : ''} enregistré{totalVotes > 1 ? 's' : ''} sur {totalMembres} membre
        {totalMembres > 1 ? 's' : ''} (base quorum {quorumPct} %)
      </Text>
      <Text style={styles.quorumLine}>
        Quorum : {qInfo.votesNecessaires} vote{qInfo.votesNecessaires > 1 ? 's' : ''} OUI requis sur {totalMembres} membre
        {totalMembres > 1 ? 's' : ''} ({quorumPct} %)
      </Text>
      <Text style={styles.voteDetailLine}>
        Votes OUI : {votesOui}  ✅{'\n'}
        Votes NON : {votesNon}  ❌
      </Text>
      <Text style={[styles.manqueLine, { color: qInfo.atteint ? GREEN : '#b45309' }]}>
        {qInfo.atteint
          ? `Quorum OUI atteint (${qInfo.votesActuels}/${qInfo.votesNecessaires}) ✅`
          : `Il manque : ${manqueOui} vote${manqueOui > 1 ? 's' : ''} OUI`}
      </Text>
    </View>
  );
}

function Timer({ dateExpiration }) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    const update = () => {
      const exp = dateExpiration instanceof Date ? dateExpiration : new Date(dateExpiration);
      const ms = exp - new Date();
      if (ms <= 0) { setRemaining('Expiré'); return; }
      const min = Math.floor(ms / 60000);
      const sec = Math.floor((ms % 60000) / 1000);
      setRemaining(`${min}min ${sec}s`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [dateExpiration]);
  return <Text style={styles.timer}>⏱️ Expire dans : {remaining}</Text>;
}

export default function VoteScreen({ userData }) {
  const { votes, historique, loading, refetch } = useVotes();
  const { voter, loading: votingLoading } = useVoter();
  const [votingId, setVotingId] = useState(null);
  const [mesVotes, setMesVotes] = useState({});

  const [govVotes, setGovVotes] = useState([]);
  const [govLoading, setGovLoading] = useState(true);
  const [govVotingId, setGovVotingId] = useState(null);
  const [paiementModalVisible, setPaiementModalVisible] = useState(false);
  const [voteAPayer, setVoteAPayer] = useState(null);
  const [numeroFournisseur, setNumeroFournisseur] = useState('');
  const [nomFournisseur, setNomFournisseur] = useState('');
  const [soldeActuel, setSoldeActuel] = useState(0);
  const [paiementLoading, setPaiementLoading] = useState(false);

  // Charger votes locaux (UX uniquement — la règle réelle est on-chain)
  useEffect(() => {
    AsyncStorage.getItem(VOTES_LOCAUX_KEY).then(v => {
      if (v) setMesVotes(JSON.parse(v));
    });
  }, []);

  // Votes Firestore (gouvernance : transferts)
  useEffect(() => {
    const coopId = userData?.cooperativeId || 'broukou';
    const q = query(
      collection(db, 'votes'),
      where('cooperativeId', '==', coopId),
      where('statut', '==', 'ouvert')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((v) => v.type === 'transfert_presidence' || v.type === 'transfert_tresorier')
          .sort((a, b) => {
            const da = a?.dateCreation?.toDate ? a.dateCreation.toDate().getTime() : new Date(a?.dateCreation || 0).getTime();
            const dbb = b?.dateCreation?.toDate ? b.dateCreation.toDate().getTime() : new Date(b?.dateCreation || 0).getTime();
            return dbb - da;
          });
        setGovVotes(list);
        setGovLoading(false);
      },
      () => setGovLoading(false)
    );
    return () => unsub();
  }, [userData?.cooperativeId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const solde = await calculerSolde(userData?.cooperativeId || 'broukou');
        if (alive) setSoldeActuel(solde);
      } catch {
        if (alive) setSoldeActuel(0);
      }
    })();
    return () => { alive = false; };
  }, [historique.length, userData?.cooperativeId]);

  async function enregistrerVoteLocal(transactionId, choix) {
    const updated = { ...mesVotes, [transactionId]: choix };
    setMesVotes(updated);
    await AsyncStorage.setItem(VOTES_LOCAUX_KEY, JSON.stringify(updated));
  }

  async function handleVoter(transactionId, choix) {
    if (userData?.role === 'institution') {
      Alert.alert(
        '🚫 Accès refusé',
        'Les institutions sont en lecture seule.\nVous ne pouvez pas voter.'
      );
      return;
    }
    setVotingId(transactionId);
    try {
      const result = await voter(transactionId, choix);
      await enregistrerVoteLocal(transactionId, choix);

      if (result.voteTermine) {
        const msg = result.resultat === 'approuve'
          ? '✅ La transaction a été approuvée !'
          : '❌ La transaction a été rejetée.';
        Alert.alert('Vote terminé !', msg, [
          { text: 'Voir sur Polygonscan', onPress: () => Linking.openURL(polygonscanTxUrl(result.hash)) },
          { text: 'OK', onPress: refetch },
        ]);
      } else {
        Alert.alert(
          'Vote enregistré !',
          `Ton vote "${choix.toUpperCase()}" a été signé et enregistré sur Polygon.`,
          [
            { text: 'Voir sur Polygonscan', onPress: () => Linking.openURL(polygonscanTxUrl(result.hash)) },
            { text: 'OK', onPress: refetch },
          ]
        );
      }
    } catch (err) {
      Alert.alert('Erreur', err.message || 'Impossible de voter. Réessaie.');
    }
    setVotingId(null);
  }

  function canVoteOnGovernance(vote) {
    if (!vote) return { ok: false, reason: 'Vote introuvable.' };
    if (vote.statut !== 'ouvert') return { ok: false, reason: 'Ce vote est terminé.' };
    if (userData?.role === 'institution') {
      return {
        ok: false,
        reason: 'Les institutions sont en lecture seule. Vous ne pouvez pas voter.',
      };
    }
    const uid = userData?.uid;
    if (!uid) return { ok: false, reason: 'Connexion requise.' };
    if (userData?.statut && userData.statut !== 'actif') {
      return { ok: false, reason: 'Seuls les membres actifs peuvent voter.' };
    }

    // Règles spéciales :
    if (vote.type === 'transfert_presidence' && uid === vote.ancienRoleUid) {
      return { ok: false, reason: 'Vous ne pouvez pas voter sur votre propre transfert de rôle.' };
    }
    if (vote.type === 'transfert_tresorier' && uid === vote.ancienRoleUid) {
      return { ok: false, reason: 'Vous ne pouvez pas voter sur votre propre transfert de rôle.' };
    }

    return { ok: true };
  }

  async function handleVoterGouvernance(voteId, choix) {
    if (userData?.role === 'institution') {
      Alert.alert(
        '🚫 Accès refusé',
        'Les institutions sont en lecture seule.\nVous ne pouvez pas voter.'
      );
      return;
    }
    if (!userData?.uid) return Alert.alert('Erreur', 'Tu dois être connecté.');
    const vote = govVotes.find((v) => v.id === voteId);
    const check = canVoteOnGovernance(vote);
    if (!check.ok) return Alert.alert('Information', check.reason);

    setGovVotingId(voteId);
    try {
      const voteRef = doc(db, 'votes', voteId);
      const bulletinId = `${voteId}_${userData.uid}`;
      const bulletinRef = doc(db, 'bulletins_vote', bulletinId);

      await runTransaction(db, async (tx) => {
        const snapVote = await tx.get(voteRef);
        if (!snapVote.exists()) throw new Error('Vote introuvable.');
        const cur = snapVote.data();
        if (cur.statut !== 'ouvert') throw new Error('Ce vote est déjà terminé.');

        const snapBulletin = await tx.get(bulletinRef);
        if (snapBulletin.exists()) throw new Error('Tu as déjà voté sur ce transfert.');

        const incOui = choix === 'oui' ? 1 : 0;
        const incNon = choix === 'non' ? 1 : 0;

        tx.update(voteRef, {
          votesOui: Number(cur.votesOui || 0) + incOui,
          votesNon: Number(cur.votesNon || 0) + incNon,
          lastVoteAt: serverTimestamp(),
        });
        tx.set(bulletinRef, {
          voteId,
          userId: userData.uid,
          choix,
          createdAt: serverTimestamp(),
          type: cur.type || null,
          cooperativeId: cur.cooperativeId || null,
        });
      });

      // Vérifie si on doit clôturer le vote + appliquer les rôles (quorum / expiration)
      await updateRolesAfterVote(doc(db, 'votes', voteId));

      Alert.alert('Vote enregistré', `Ton vote "${choix.toUpperCase()}" a été enregistré.`);
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Impossible de voter. Réessaie.');
    }
    setGovVotingId(null);
  }

  function detectOperateur(numero) {
    const n = String(numero || '').replace(/\D/g, '');
    if (n.length < 10) return 'Inconnu';
    const clean = n.startsWith('228') ? n.slice(3) : n;
    const p = clean.slice(0, 2);
    if (['90', '91', '92', '93', '98', '99'].includes(p)) return 'MOOV Flooz';
    if (['96', '97'].includes(p)) return 'MTN MoMo';
    return 'T-Money';
  }

  function ouvrirModalPaiementFournisseur(vote) {
    setVoteAPayer(vote);
    setNumeroFournisseur('');
    setNomFournisseur('');
    setPaiementModalVisible(true);
  }

  async function confirmerPaiementFournisseur() {
    if (!voteAPayer) return;
    const montant = Number(voteAPayer.montant || 0);
    if (!numeroFournisseur.trim()) {
      Alert.alert('Erreur', 'Numéro fournisseur requis.');
      return;
    }
    if (soldeActuel < montant) {
      Alert.alert('Erreur', 'Solde insuffisant.');
      return;
    }
    setPaiementLoading(true);
    try {
      const soldeFinal = await calculerSolde(userData?.cooperativeId || 'broukou');
      if (soldeFinal < montant) {
        Alert.alert('Erreur', 'Solde insuffisant au moment du paiement.');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const reference = `PAYOUT_${Date.now()}`;

      await addDoc(collection(db, 'transactions'), {
        titre: `Paiement fournisseur - ${voteAPayer.titre}`,
        montant,
        typeTransaction: 'depense',
        type: 'sortie',
        categorie: voteAPayer.categorie || 'Autre',
        telephoneFournisseur: numeroFournisseur.trim(),
        nomFournisseur: nomFournisseur.trim() || 'Fournisseur',
        referencePayment: reference,
        voteId: voteAPayer.id || voteAPayer.transactionId,
        cooperativeId: userData?.cooperativeId || 'broukou',
        statut: 'valide',
        date: serverTimestamp(),
        hash: reference,
        creePar: userData?.uid || '',
      });

      if (voteAPayer?.transactionId !== undefined && voteAPayer?.transactionId !== null) {
        await setDoc(doc(db, 'transactions', `chain_${voteAPayer.transactionId}`), {
          statut: 'valide',
          referencePayment: reference,
          telephoneFournisseur: numeroFournisseur.trim(),
          nomFournisseur: nomFournisseur.trim() || 'Fournisseur',
        }, { merge: true });
      }

      await addDoc(collection(db, 'notifications_queue'), {
        type: 'paiement_fournisseur',
        titre: `💸 ${voteAPayer.titre} payé !`,
        message: `${montant.toLocaleString('fr-FR')} FCFA versés au fournisseur. Référence : ${reference}`,
        cooperativeId: userData?.cooperativeId || 'broukou',
        createdAt: serverTimestamp(),
      });

      Alert.alert('Succès', `Paiement effectué.\nRéférence : ${reference}`);
      setPaiementModalVisible(false);
      setVoteAPayer(null);
      refetch();
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Paiement fournisseur impossible.');
    } finally {
      setPaiementLoading(false);
    }
  }

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={GREEN} />
      <Text style={styles.loadingText}>Chargement des votes depuis Polygon...</Text>
    </View>
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Gouvernance Active</Text>
        <Text style={styles.headerSub}>Votes de gouvernance (Firestore) + votes financiers (Polygon)</Text>
      </View>

      {/* VOTES DE GOUVERNANCE (TRANSFERTS) */}
      {govLoading ? (
        <View style={styles.govLoadingBox}>
          <ActivityIndicator color={GREEN} />
          <Text style={styles.govLoadingText}>Chargement des votes de gouvernance...</Text>
        </View>
      ) : govVotes.length > 0 ? (
        govVotes.map((v) => {
          const isPres = v.type === 'transfert_presidence';
          const accent = isPres ? VIOLET : BLUE;
          const bg = isPres ? '#f5f3ff' : '#eff6ff';
          const badge = isPres ? '🛡️ Vote de Gouvernance' : '🏦 Vote de Gouvernance';
          const rolePropose = isPres ? 'Président' : 'Trésorier';
          const isVoting = govVotingId === v.id;
          const totalVotes = Number(v.votesOui || 0) + Number(v.votesNon || 0);
          const totalMembres = Number(v.totalMembres || 0);
          const pctOui = totalMembres > 0 ? Math.round((Number(v.votesOui || 0) / totalMembres) * 100) : 0;
          const pctNon = totalMembres > 0 ? Math.round((Number(v.votesNon || 0) / totalMembres) * 100) : 0;
          const checkVote = canVoteOnGovernance(v);
          const cantVote = !checkVote.ok;

          const exp = v?.dateExpiration?.toDate ? v.dateExpiration.toDate() : new Date(v?.dateExpiration || Date.now());

          return (
            <View key={v.id} style={[styles.govCard, { backgroundColor: bg, borderColor: `${accent}33` }]}>
              <View style={styles.govHeaderRow}>
                <View style={[styles.govBadge, { backgroundColor: `${accent}22`, borderColor: `${accent}55` }]}>
                  <Text style={[styles.govBadgeText, { color: accent }]}>{badge}</Text>
                </View>
                <Text style={[styles.govTimerBig, { color: accent }]}>
                  ⏱️ {exp instanceof Date && !Number.isNaN(exp.getTime()) ? exp.toLocaleString('fr-FR') : '—'}
                </Text>
              </View>

              <View style={styles.govCandidateRow}>
                <View style={[styles.govAvatar, { backgroundColor: `${accent}22` }]}>
                  <Text style={[styles.govAvatarText, { color: accent }]}>{getInitiales(v.candidatNom)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.govCandidateName, { color: accent }]}>{v.candidatNom || 'Candidat'}</Text>
                  <Text style={styles.govCandidateSub}>Rôle proposé : <Text style={{ fontWeight: '900' }}>{rolePropose}</Text></Text>
                </View>
              </View>

              {v.raisonTransfert ? (
                <View style={[styles.govReasonBox, { borderColor: `${accent}33` }]}>
                  <Text style={styles.govReasonTitle}>Raison (optionnelle)</Text>
                  <Text style={styles.govReasonText}>{v.raisonTransfert}</Text>
                </View>
              ) : null}

              <Text style={styles.govExplain}>
                {isPres
                  ? 'Ce vote détermine la direction de votre coopérative.'
                  : 'Ce vote détermine la gestion financière de votre coopérative.'}
              </Text>

              <ParticipationQuorumBloc
                votesOui={Number(v.votesOui || 0)}
                votesNon={Number(v.votesNon || 0)}
                totalMembres={totalMembres}
                quorumPct={Number(v.quorumRequis || 60)}
                accentColor={accent}
              />

              <View style={styles.countersRow}>
                <View style={[styles.counter, { backgroundColor: '#ffffffaa' }]}>
                  <Text style={styles.counterIcon}>✅</Text>
                  <Text style={[styles.counterNum, { color: accent }]}>{Number(v.votesOui || 0)}</Text>
                  <Text style={styles.counterLabel}>OUI ({pctOui}%)</Text>
                </View>
                <View style={[styles.counter, { backgroundColor: '#ffffffaa' }]}>
                  <Text style={styles.counterIcon}>❌</Text>
                  <Text style={[styles.counterNum, { color: '#dc2626' }]}>{Number(v.votesNon || 0)}</Text>
                  <Text style={styles.counterLabel}>NON ({pctNon}%)</Text>
                </View>
              </View>

              {cantVote ? (
                <View style={[styles.cantVoteBox, { borderColor: `${accent}55` }]}>
                  <Text style={[styles.cantVoteText, { color: accent }]}>
                    {checkVote.reason || 'Vous ne pouvez pas voter sur ce transfert.'}
                  </Text>
                </View>
              ) : (
                <View style={styles.voteButtons}>
                  <TouchableOpacity
                    style={[styles.btnOui, { backgroundColor: accent }, isVoting && { opacity: 0.6 }]}
                    onPress={() => handleVoterGouvernance(v.id, 'oui')}
                    disabled={!!govVotingId}
                  >
                    {isVoting
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.btnOuiText}>✅  Voter OUI</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnNon, isVoting && { opacity: 0.6 }]}
                    onPress={() => handleVoterGouvernance(v.id, 'non')}
                    disabled={!!govVotingId}
                  >
                    {isVoting
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.btnNonText}>❌  Voter NON</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}

              <Text style={[styles.govTimerHelp, { color: accent }]}>
                Timer 24h : expire le {exp instanceof Date && !Number.isNaN(exp.getTime()) ? exp.toLocaleString('fr-FR') : '—'}
              </Text>
            </View>
          );
        })
      ) : null}

      {/* VOTES FINANCIERS (BLOCKCHAIN) */}
      {votes.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={{ fontSize: 48, marginBottom: 12 }}>🗳️</Text>
          <Text style={styles.emptyTitle}>Aucun vote en cours</Text>
          <Text style={styles.emptySub}>Les nouvelles propositions apparaîtront ici</Text>
        </View>
      ) : (
        votes.map(vote => {
          const dejaVote = mesVotes[vote.transactionId];
          const total = vote.votesOui + vote.votesNon;
          const pctOui = total > 0 ? Math.round(vote.votesOui / total * 100) : 0;
          const pctNon = total > 0 ? Math.round(vote.votesNon / total * 100) : 0;
          const isVoting = votingId === vote.transactionId;

          return (
            <View key={vote.transactionId} style={styles.voteCard}>
              <View style={styles.voteHeader}>
                <View style={styles.voteBadge}>
                  <Text style={styles.voteBadgeText}>⚡ Vote en cours</Text>
                </View>
                <Timer dateExpiration={vote.dateExpiration} />
              </View>

              <Text style={styles.voteTitle}>{vote.titre}</Text>
              <Text style={styles.voteMontant}>
                {vote.montant.toLocaleString('fr-FR')} FCFA
              </Text>

              <ParticipationQuorumBloc
                votesOui={vote.votesOui}
                votesNon={vote.votesNon}
                totalMembres={vote.totalMembres}
                quorumPct={vote.quorumRequis}
                accentColor={GREEN}
              />

              <View style={styles.countersRow}>
                <View style={[styles.counter, { backgroundColor: '#f0fdf4' }]}>
                  <Text style={styles.counterIcon}>✅</Text>
                  <Text style={[styles.counterNum, { color: GREEN }]}>{vote.votesOui}</Text>
                  <Text style={styles.counterLabel}>OUI ({pctOui}%)</Text>
                </View>
                <View style={[styles.counter, { backgroundColor: '#fef2f2' }]}>
                  <Text style={styles.counterIcon}>❌</Text>
                  <Text style={[styles.counterNum, { color: '#dc2626' }]}>{vote.votesNon}</Text>
                  <Text style={styles.counterLabel}>NON ({pctNon}%)</Text>
                </View>
              </View>

              {userData?.role === 'institution' ? (
                <View style={styles.dejaVoteBox}>
                  <Text style={styles.dejaVoteText}>
                    Les institutions sont en lecture seule : pas de vote sur les propositions financières.
                  </Text>
                </View>
              ) : dejaVote ? (
                <View style={styles.dejaVoteBox}>
                  <Text style={styles.dejaVoteText}>
                    ✅ Tu as voté {dejaVote.toUpperCase()} — signé cryptographiquement sur Polygon
                  </Text>
                </View>
              ) : (
                <View style={styles.voteButtons}>
                  <TouchableOpacity
                    style={[styles.btnOui, isVoting && { opacity: 0.6 }]}
                    onPress={() => handleVoter(vote.transactionId, 'oui')}
                    disabled={!!votingId}
                  >
                    {isVoting
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.btnOuiText}>✅  Voter OUI</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnNon, isVoting && { opacity: 0.6 }]}
                    onPress={() => handleVoter(vote.transactionId, 'non')}
                    disabled={!!votingId}
                  >
                    {isVoting
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.btnNonText}>❌  Voter NON</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}

              {isVoting && (
                <Text style={styles.waitingText}>
                  Signature en cours sur Polygon (~5-30 sec)...
                </Text>
              )}

              <View style={styles.blockchainNote}>
                <Text style={styles.blockchainNoteText}>
                  🔗 Chaque vote est signé cryptographiquement et enregistré sur Polygon Amoy
                </Text>
              </View>
            </View>
          );
        })
      )}

      {historique.length > 0 && (
        <View style={styles.historiqueSection}>
          <Text style={styles.historiqueTitle}>Historique récent</Text>
          {historique.map((h, idx) => {
            const approuve = h.statut === 'approuve';
            const annule = h.statut === 'annule';
            const transactionPayee = h.transactionStatut === 'valide' || h.referencePayment;
            return (
              <View key={`${h.transactionId}-${idx}`} style={styles.historiqueRow}>
                <View style={[styles.hIcon, {
                  backgroundColor: approuve ? '#dcfce7' : annule ? '#f3f4f6' : '#fee2e2',
                }]}>
                  <Text>{approuve ? '✅' : annule ? '⏸️' : '❌'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hTitle} numberOfLines={1}>{h.titre}</Text>
                  <Text style={styles.hSub}>
                    {annule ? 'Annulé — quorum non atteint' : approuve ? 'Approuvé' : 'Rejeté'}
                  </Text>
                  {approuve && userData?.role === 'tresorier' ? (
                    transactionPayee ? (
                      <View style={styles.paidBadge}>
                        <Text style={styles.paidBadgeText}>✅ Fournisseur payé</Text>
                        {h.referencePayment ? <Text style={styles.paidRef}>Réf: {h.referencePayment}</Text> : null}
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.paySupplierBtn} onPress={() => ouvrirModalPaiementFournisseur(h)}>
                        <Text style={styles.paySupplierBtnText}>💸 Payer le fournisseur</Text>
                      </TouchableOpacity>
                    )
                  ) : null}
                </View>
                <Text style={[styles.hMontant, {
                  color: approuve ? GREEN : annule ? '#6b7280' : '#dc2626',
                }]}>
                  {(h.montant / 1000).toFixed(0)}K
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ height: 100 }} />

      <Modal visible={paiementModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Payer {voteAPayer?.titre || 'la transaction'}</Text>
            <Text style={styles.modalLine}>Montant : {formaterMontant(voteAPayer?.montant || 0)}</Text>

            <Text style={styles.modalLabel}>Numéro Mobile Money du fournisseur</Text>
            <TextInput
              style={styles.modalInput}
              value={numeroFournisseur}
              onChangeText={setNumeroFournisseur}
              placeholder="+228XXXXXXXX"
              keyboardType="phone-pad"
            />
            <Text style={styles.modalHint}>Opérateur détecté : {detectOperateur(numeroFournisseur)}</Text>

            <Text style={styles.modalLabel}>Nom du fournisseur (optionnel)</Text>
            <TextInput
              style={styles.modalInput}
              value={nomFournisseur}
              onChangeText={setNomFournisseur}
              placeholder="Nom fournisseur"
            />

            <View style={styles.resumeCard}>
              <Text style={styles.resumeLine}>Destinataire : {nomFournisseur || 'Fournisseur'}</Text>
              <Text style={styles.resumeLine}>Numéro : {numeroFournisseur || '-'}</Text>
              <Text style={styles.resumeLine}>Montant : {formaterMontant(voteAPayer?.montant || 0)}</Text>
            </View>

            {soldeActuel < Number(voteAPayer?.montant || 0) ? (
              <Text style={styles.soldeKo}>
                ❌ Solde insuffisant - Solde: {formaterMontant(soldeActuel)} - Manque: {formaterMontant(Number(voteAPayer?.montant || 0) - soldeActuel)}
              </Text>
            ) : (
              <Text style={styles.soldeOk}>✅ Solde suffisant</Text>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setPaiementModalVisible(false)}>
                <Text style={styles.cancelBtnText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, (paiementLoading || soldeActuel < Number(voteAPayer?.montant || 0)) && { opacity: 0.6 }]}
                onPress={confirmerPaiementFournisseur}
                disabled={paiementLoading || soldeActuel < Number(voteAPayer?.montant || 0)}
              >
                {paiementLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmBtnText}>✅ Confirmer le paiement</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: '#6b7280', fontSize: 14 },
  header: { padding: 20, paddingBottom: 8 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#111827' },
  headerSub: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  govLoadingBox: { paddingHorizontal: 20, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  govLoadingText: { color: '#6b7280', fontWeight: '600' },
  govCard: {
    margin: 20,
    marginTop: 8,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
  },
  govHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  govBadge: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  govBadgeText: { fontSize: 12, fontWeight: '900' },
  govTimerBig: { fontSize: 12, fontWeight: '900' },
  govCandidateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  govAvatar: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  govAvatarText: { fontSize: 18, fontWeight: '900' },
  govCandidateName: { fontSize: 18, fontWeight: '900' },
  govCandidateSub: { marginTop: 3, color: '#374151', fontWeight: '700', fontSize: 12 },
  govReasonBox: { marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1 },
  govReasonTitle: { fontSize: 12, color: '#6b7280', fontWeight: '800' },
  govReasonText: { marginTop: 6, color: '#111827', fontWeight: '700', lineHeight: 18 },
  govExplain: { marginTop: 12, color: '#111827', fontWeight: '700' },
  govTimerHelp: { marginTop: 10, fontSize: 12, fontWeight: '800' },
  cantVoteBox: { marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, alignItems: 'center' },
  cantVoteText: { fontWeight: '900', textAlign: 'center' },
  emptyCard: {
    margin: 20, backgroundColor: '#fff', borderRadius: 20, padding: 40,
    alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, elevation: 3,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#374151' },
  emptySub: { fontSize: 13, color: '#9ca3af', marginTop: 6, textAlign: 'center' },
  voteCard: {
    margin: 20, marginTop: 8, backgroundColor: '#fff', borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, elevation: 6,
  },
  voteHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  voteBadge: {
    backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fbbf24',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  voteBadgeText: { fontSize: 12, fontWeight: '700', color: '#92400e' },
  timer: { fontSize: 12, color: '#dc2626', fontWeight: '600' },
  voteTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 6 },
  voteMontant: { fontSize: 28, fontWeight: '900', color: GREEN_DARK, marginBottom: 8 },
  progressSection: { marginBottom: 16 },
  progressBar: { height: 8, backgroundColor: '#e5e7eb', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', borderRadius: 4 },
  progressText: { fontSize: 12, color: '#6b7280' },
  participBox: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  participTitle: { fontSize: 13, fontWeight: '900', color: '#111827', marginBottom: 10 },
  participBarTrack: {
    height: 10,
    backgroundColor: '#e5e7eb',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 8,
  },
  participBarFill: { height: '100%', borderRadius: 6 },
  participLine: { fontSize: 13, fontWeight: '800', color: '#374151', marginBottom: 4 },
  quorumLine: { fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 8 },
  voteDetailLine: { fontSize: 13, fontWeight: '700', color: '#111827', lineHeight: 20 },
  manqueLine: { fontSize: 13, fontWeight: '900', marginTop: 10 },
  countersRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  counter: { flex: 1, borderRadius: 16, padding: 14, alignItems: 'center' },
  counterIcon: { fontSize: 22, marginBottom: 4 },
  counterNum: { fontSize: 28, fontWeight: '900' },
  counterLabel: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  voteButtons: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  btnOui: {
    flex: 1, backgroundColor: GREEN, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', shadowColor: GREEN_DARK, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, elevation: 4,
  },
  btnOuiText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  btnNon: {
    flex: 1, backgroundColor: '#dc2626', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', shadowColor: '#7f1d1d', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, elevation: 4,
  },
  btnNonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  dejaVoteBox: {
    backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#86efac',
    borderRadius: 14, padding: 14, marginBottom: 12, alignItems: 'center',
  },
  dejaVoteText: { color: GREEN_DARK, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  waitingText: { textAlign: 'center', color: '#6b7280', fontSize: 12, marginBottom: 8, fontStyle: 'italic' },
  blockchainNote: { backgroundColor: '#f0fdf4', borderRadius: 12, padding: 10 },
  blockchainNoteText: { fontSize: 11, color: GREEN, textAlign: 'center' },
  historiqueSection: {
    margin: 20, marginTop: 0, backgroundColor: '#fff', borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, elevation: 3,
  },
  historiqueTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 12 },
  historiqueRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  hIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  hTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  hSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  hMontant: { fontSize: 13, fontWeight: '700' },
  paySupplierBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: GREEN,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  paySupplierBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  paidBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#dcfce7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  paidBadgeText: { color: GREEN_DARK, fontWeight: '800', fontSize: 12 },
  paidRef: { color: '#166534', marginTop: 2, fontSize: 11 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14 },
  modalTitle: { fontSize: 16, fontWeight: '900', color: '#111827', marginBottom: 8 },
  modalLine: { color: '#374151', marginBottom: 8, fontWeight: '700' },
  modalLabel: { marginTop: 8, marginBottom: 6, fontSize: 12, fontWeight: '800', color: '#374151' },
  modalInput: {
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
  },
  modalHint: { marginTop: 6, color: '#6b7280', fontSize: 12 },
  resumeCard: { marginTop: 10, backgroundColor: '#f3f4f6', borderRadius: 10, padding: 10 },
  resumeLine: { color: '#374151', marginBottom: 3, fontSize: 12 },
  soldeKo: { marginTop: 10, color: '#b91c1c', fontWeight: '800', fontSize: 12 },
  soldeOk: { marginTop: 10, color: GREEN_DARK, fontWeight: '800', fontSize: 12 },
  modalActions: { marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  cancelBtn: { backgroundColor: '#f3f4f6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  cancelBtnText: { color: '#374151', fontWeight: '700' },
  confirmBtn: { backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  confirmBtnText: { color: '#fff', fontWeight: '800' },
});
