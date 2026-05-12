export const TYPES_TRANSACTION = {
  cotisation: {
    label: 'Cotisation',
    emoji: '💰',
    couleur: '#15803d',
    fondCouleur: '#f0fdf4',
    signe: '+',
  },
  depense: {
    label: 'Dépense',
    emoji: '📉',
    couleur: '#dc2626',
    fondCouleur: '#fef2f2',
    signe: '-',
  },
  mobile_money: {
    label: 'Mobile Money',
    emoji: '📱',
    couleur: '#2563eb',
    fondCouleur: '#eff6ff',
    signe: '+',
  },
  main_a_main: {
    label: 'Main à main',
    emoji: '🤝',
    couleur: '#d97706',
    fondCouleur: '#fffbeb',
    signe: '+',
  },
  gouvernance: {
    label: 'Gouvernance',
    emoji: '🏛️',
    couleur: '#7c3aed',
    fondCouleur: '#f5f3ff',
    signe: '',
  },
  vente_recolte: {
    label: 'Vente récolte',
    emoji: '🌾',
    couleur: '#d97706',
    fondCouleur: '#fffbeb',
    signe: '+',
  },
  subvention: {
    label: 'Subvention',
    emoji: '🏛️',
    couleur: '#7c3aed',
    fondCouleur: '#f5f3ff',
    signe: '+',
  },
  remboursement: {
    label: 'Remboursement',
    emoji: '🔄',
    couleur: '#0891b2',
    fondCouleur: '#ecfeff',
    signe: '+',
  },
};

export function getBadgeType(typeTransaction) {
  return TYPES_TRANSACTION[typeTransaction] || TYPES_TRANSACTION.cotisation;
}
