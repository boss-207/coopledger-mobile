import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  deleteField,
} from 'firebase/firestore';
import { db } from '../config/firebase';

function estInstitution(role) {
  return role === 'institution';
}

/**
 * Nombre de membres actifs hors institutions (quorum / votes Firestore).
 */
export async function getNombreMembres(cooperativeId = 'broukou') {
  const snap = await getDocs(
    query(
      collection(db, 'users'),
      where('cooperativeId', '==', cooperativeId),
      where('statut', '==', 'actif')
    )
  );
  return snap.docs.filter((d) => !estInstitution(d.data().role)).length;
}

/**
 * Liste des profils membres actifs, institutions exclues.
 */
export async function getMembresActifs(cooperativeId = 'broukou') {
  const snap = await getDocs(
    query(
      collection(db, 'users'),
      where('cooperativeId', '==', cooperativeId),
      where('statut', '==', 'actif')
    )
  );
  return snap.docs
    .filter((d) => !estInstitution(d.data().role))
    .map((d) => ({
      uid: d.id,
      ...d.data(),
    }));
}

/**
 * Nombre d’institutions actives (lecture seule, hors quorum).
 */
export async function getNombreInstitutions(cooperativeId = 'broukou') {
  const snap = await getDocs(
    query(
      collection(db, 'users'),
      where('cooperativeId', '==', cooperativeId),
      where('role', '==', 'institution'),
      where('statut', '==', 'actif')
    )
  );
  return snap.size;
}

/**
 * Totaux membres + institutions et libellé pour l’interface.
 */
export async function getStatsMembres(cooperativeId = 'broukou') {
  const totalMembres = await getNombreMembres(cooperativeId);
  const totalInstitutions = await getNombreInstitutions(cooperativeId);
  const total = totalMembres + totalInstitutions;

  let label = `${total} personne${total > 1 ? 's' : ''}`;
  if (totalInstitutions > 0) {
    label += ` dont ${totalInstitutions} institution${totalInstitutions > 1 ? 's' : ''}`;
  } else {
    label += ' dans la coopérative';
  }

  return {
    totalMembres,
    totalInstitutions,
    total,
    label,
  };
}

/**
 * Quorum : votes « Oui » requis (arrondi supérieur) pour atteindre le pourcentage du collège.
 */
export function quorumAtteint(votesOui, totalMembres, pourcentage = 60) {
  const minimum = Math.ceil(totalMembres * (pourcentage / 100));
  return {
    atteint: votesOui >= minimum,
    votesNecessaires: minimum,
    votesActuels: votesOui,
    pourcentageActuel:
      totalMembres > 0 ? Math.round((votesOui / totalMembres) * 100) : 0,
  };
}

/** Départ volontaire : profil inactif, traçabilité minimale. */
export async function quitterCooperative(uid) {
  await updateDoc(doc(db, 'users', uid), {
    statut: 'inactif',
    dateDepart: new Date(),
    raisonDepart: 'Départ volontaire',
  });
}

/** Exclusion par le président (statut distinct, historique séparé). */
export async function exclureMembre(
  uid,
  raisonExclusion,
  presidentNom
) {
  await updateDoc(doc(db, 'users', uid), {
    statut: 'exclu',
    dateExclusion: new Date(),
    raisonExclusion: raisonExclusion || '',
    excluPar: presidentNom || '',
  });
}

/** Réintégration par le président : retour à « actif », champs de sortie nettoyés. */
export async function reintegrerMembre(uid) {
  await updateDoc(doc(db, 'users', uid), {
    statut: 'actif',
    dateDepart: deleteField(),
    raisonDepart: deleteField(),
    dateExclusion: deleteField(),
    raisonExclusion: deleteField(),
    excluPar: deleteField(),
  });
}
