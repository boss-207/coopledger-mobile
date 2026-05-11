export function formaterNumero(numero) {
  const brut = String(numero || '').replace(/\s/g, '');
  if (!brut) return '';
  if (brut.startsWith('+228')) return brut;
  if (brut.startsWith('228')) return `+${brut}`;
  if (brut.startsWith('0')) return `+228${brut.slice(1)}`;
  return `+228${brut}`;
}

export function validerNumeroTogolais(numero) {
  const formate = formaterNumero(numero);
  const valide = /^\+228\d{8}$/.test(formate);
  return {
    valide,
    numeroFormate: formate,
    erreur: valide ? null : 'Numero togolais invalide (format attendu: +228XXXXXXXX)',
  };
}

export function detecterOperateur(numero) {
  const n = formaterNumero(numero).replace('+228', '');
  if (n.length < 2) return 'INCONNU';
  const prefix = n.slice(0, 2);
  const moov = ['90', '91', '92', '93', '98', '99', '70', '71'];
  const tmoney = ['96', '97', '95', '94'];
  if (moov.includes(prefix)) return 'MOOV';
  if (tmoney.includes(prefix)) return 'TMONEY';
  return 'INCONNU';
}

export function estimerFrais(montant) {
  const m = Number(montant || 0);
  if (!m || m <= 0) return 0;
  if (m < 5000) return 50;
  if (m < 50000) return Math.round(m * 0.01);
  return Math.round(m * 0.008);
}

