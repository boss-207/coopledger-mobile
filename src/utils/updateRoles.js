import { collection, doc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

function genHash() {
  return `gov_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function nowMs() {
  return Date.now();
}

function toJsDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Met à jour automatiquement les rôles quand un vote de gouvernance atteint le quorum.
 *
 * Règles :
 * - Approbation si \(votesOui / totalMembres\) >= quorumRequis
 * - Rejet si \(votesNon / totalMembres\) >= quorumRequis
 * - Annulation si dateExpiration dépassée et quorum non atteint
 *
 * Effets (si approuvé) :
 * - candidat → nouveau rôle
 * - ancien titulaire → membre
 * - vote.statut → "approuve"
 * - création d'une transaction "gouvernance" (historique)
 *
 * @param {import('firebase/firestore').DocumentReference} voteRef
 */
export async function updateRolesAfterVote(voteRef) {
  if (!voteRef) return { ok: false, reason: 'voteRef manquant' };

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(voteRef);
    if (!snap.exists()) return { ok: false, reason: 'vote introuvable' };

    const vote = snap.data();
    if (vote.statut !== 'ouvert') return { ok: true, changed: false, statut: vote.statut };

    const totalMembres = Number(vote.totalMembres || 0);
    const quorumRequis = Number(vote.quorumRequis || 60);
    const votesOui = Number(vote.votesOui || 0);
    const votesNon = Number(vote.votesNon || 0);

    const pctOui = totalMembres > 0 ? Math.round((votesOui / totalMembres) * 100) : 0;
    const pctNon = totalMembres > 0 ? Math.round((votesNon / totalMembres) * 100) : 0;

    const exp = toJsDate(vote.dateExpiration);
    const expired = exp ? exp.getTime() <= nowMs() : false;

    const candidatUid = vote.candidatUid;
    const candidatNom = vote.candidatNom || 'Candidat';
    const ancienUid = vote.ancienRoleUid;
    const ancienNom = vote.ancienRoleNom || 'Ancien titulaire';
    const nouveauRole = vote.nouveauRole; // "president" ou "tresorier"
    const type = vote.type;

    const needsGovernanceTx = (statutFinal) =>
      statutFinal === 'approuve' || statutFinal === 'rejete' || statutFinal === 'annule';

    const applyFinalStatus = (statutFinal) => {
      tx.update(voteRef, {
        statut: statutFinal,
        dateCloture: serverTimestamp(),
      });
    };

    // 1) Quorum OUI atteint → approuve + changements de rôles
    if (pctOui >= quorumRequis) {
      if (!candidatUid || !ancienUid || !nouveauRole) {
        applyFinalStatus('annule');
        return { ok: false, changed: true, statut: 'annule', reason: 'vote incomplet' };
      }

      const candidatRef = doc(db, 'users', candidatUid);
      const ancienRef = doc(db, 'users', ancienUid);

      tx.update(candidatRef, { role: nouveauRole });
      tx.update(ancienRef, { role: 'membre' });
      applyFinalStatus('approuve');

      const roleLabel = nouveauRole === 'president' ? 'Président' : 'Trésorier';
      const txRef = doc(collection(db, 'transactions'));
      tx.set(txRef, {
        titre: 'Changement de gouvernance',
        type: 'gouvernance',
        statut: 'valide',
        description: `${ancienNom} remplacé par ${candidatNom} au poste de ${roleLabel}`,
        date: serverTimestamp(),
        hash: genHash(),
        voteId: snap.id,
        voteType: type || null,
      });

      return { ok: true, changed: true, statut: 'approuve' };
    }

    // 2) Quorum NON atteint → rejet
    if (pctNon >= quorumRequis) {
      applyFinalStatus('rejete');

      if (needsGovernanceTx('rejete')) {
        const txRef = doc(collection(db, 'transactions'));
        tx.set(txRef, {
          titre: 'Changement de gouvernance',
          type: 'gouvernance',
          statut: 'valide',
          description:
            nouveauRole === 'president'
              ? `Transfert de présidence vers ${candidatNom} refusé par les membres`
              : `Changement de trésorier vers ${candidatNom} refusé par les membres`,
          date: serverTimestamp(),
          hash: genHash(),
          voteId: snap.id,
          voteType: type || null,
        });
      }

      return { ok: true, changed: true, statut: 'rejete' };
    }

    // 3) Expiré → annule (quorum non atteint)
    if (expired) {
      applyFinalStatus('annule');

      const txRef = doc(collection(db, 'transactions'));
      tx.set(txRef, {
        titre: 'Changement de gouvernance',
        type: 'gouvernance',
        statut: 'valide',
        description:
          nouveauRole === 'president'
            ? `Transfert de présidence vers ${candidatNom} annulé (quorum non atteint)`
            : `Changement de trésorier vers ${candidatNom} annulé (quorum non atteint)`,
        date: serverTimestamp(),
        hash: genHash(),
        voteId: snap.id,
        voteType: type || null,
      });

      return { ok: true, changed: true, statut: 'annule' };
    }

    // Rien à faire
    return { ok: true, changed: false, statut: 'ouvert' };
  });
}

