/**
 * Logique de calcul financier unifiée pour Dashboard et RapportScreen.
 * Une seule source de vérité pour éviter les divergences.
 */

const TYPES_ENTREE = [
  'entree', 'revenu', 'cotisation', 'mobile_money',
  'main_a_main', 'vente_recolte', 'subvention', 'remboursement',
  'appel_fonds',
];

const TYPES_SORTIE = ['sortie', 'depense', 'sortie_especes'];

/**
 * Détermine si une transaction est une entrée d'argent.
 */
export function estEntree(tx) {
  if (TYPES_ENTREE.includes(tx.type)) return true;
  if (TYPES_ENTREE.includes(tx.typeTransaction)) return true;
  return false;
}

/**
 * Détermine si une transaction est une dépense.
 */
export function estDepense(tx) {
  if (TYPES_SORTIE.includes(tx.type)) return true;
  if (TYPES_SORTIE.includes(tx.typeTransaction)) return true;
  return false;
}

/**
 * Détermine si une transaction est considérée comme "comptabilisable".
 * On inclut : statut 'valide', statut absent (tx blockchain sans statut), statut 'en_cours'.
 * On exclut uniquement : 'rejete', 'annule', 'cancelled'.
 */
export function estComptabilisable(tx) {
  const s = tx.statut;
  if (!s || s === '' || s === 'valide' || s === 'en_cours' || s === 'confirme') return true;
  if (s === 'rejete' || s === 'annule' || s === 'cancelled') return false;
  return true; // par défaut on inclut
}

/**
 * Calcule revenus, dépenses et solde depuis un tableau de transactions.
 * @param {Array} transactions - tableau brut depuis Firestore
 * @param {{ start?: Date, end?: Date }} options - filtre de date optionnel
 */
export function calculerFinances(transactions, { start, end } = {}) {
  const txFiltrees = transactions.filter((tx) => {
    if (!estComptabilisable(tx)) return false;
    if (start || end) {
      const date = tx.date instanceof Date ? tx.date
        : tx.date?.toDate?.()
        ? tx.date.toDate()
        : tx.date
        ? new Date(tx.date)
        : null;
      if (!date || isNaN(date.getTime())) return false;
      if (start && date < start) return false;
      if (end && date >= end) return false;
    }
    return true;
  });

  const revenus = txFiltrees
    .filter(estEntree)
    .reduce((acc, t) => acc + Number(t.montant || 0), 0);

  const depenses = txFiltrees
    .filter(estDepense)
    .reduce((acc, t) => acc + Number(t.montant || 0), 0);

  return {
    revenus,
    depenses,
    solde: revenus - depenses,
    count: txFiltrees.length,
  };
}
