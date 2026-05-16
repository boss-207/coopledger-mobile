/**
 * Rôles utilisateur — source unique pour comparaisons et affichage.
 */

export const ROLES = {
  PRESIDENT: 'president',
  TRESORIER: 'tresorier',
  MEMBRE: 'membre',
  INSTITUTION: 'institution',
};

const ROLES_CREATION_TRANSACTION = [ROLES.PRESIDENT, ROLES.TRESORIER];

/** Alias reconnus après normalisation (sans accents, a-z uniquement). */
const ALIAS_VERS_CANONIQUE = {
  president: ROLES.PRESIDENT,
  presidence: ROLES.PRESIDENT,
  tresorier: ROLES.TRESORIER,
  tresoriere: ROLES.TRESORIER,
  treasurer: ROLES.TRESORIER,
  caissier: ROLES.TRESORIER,
  caissiere: ROLES.TRESORIER,
  membre: ROLES.MEMBRE,
  institution: ROLES.INSTITUTION,
};

/**
 * Normalise un rôle pour comparaison : minuscules, sans accents, sans espaces parasites.
 */
export function normaliserRole(role) {
  if (role == null || role === '') return '';
  return String(role)
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
}

/**
 * Retourne le rôle canonique Firestore (president | tresorier | membre | institution).
 */
export function roleCanonique(role) {
  const n = normaliserRole(role);
  if (!n) return '';
  if (ALIAS_VERS_CANONIQUE[n]) return ALIAS_VERS_CANONIQUE[n];
  if (n.includes('president')) return ROLES.PRESIDENT;
  if (n.includes('tresorier') || n.includes('treasurer') || n.includes('caissier')) {
    return ROLES.TRESORIER;
  }
  if (n.includes('institution')) return ROLES.INSTITUTION;
  return n;
}

export function estPresidentOuTresorier(userData) {
  return peutCreerTransaction(userData);
}

export function peutCreerTransaction(userData) {
  if (!userData?.uid) return false;
  const canon = roleCanonique(userData.role);
  return ROLES_CREATION_TRANSACTION.includes(canon);
}

export function estMembreOuInstitution(userData) {
  const canon = roleCanonique(userData?.role);
  return canon === ROLES.MEMBRE || canon === ROLES.INSTITUTION;
}
