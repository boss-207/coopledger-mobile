function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function calculerMoisActifs3DerniersMois(transactions) {
  const now = new Date();
  const months = [];
  for (let i = 0; i < 3; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${d.getMonth()}`);
  }
  const actifs = new Set();

  transactions.forEach((tx) => {
    const rawDate = tx?.date?.toDate ? tx.date.toDate() : new Date(tx?.date);
    if (Number.isNaN(rawDate.getTime())) return;
    const key = `${rawDate.getFullYear()}-${rawDate.getMonth()}`;
    if (months.includes(key)) actifs.add(key);
  });

  return actifs.size;
}

export function calculerScoreTransparence(transactions = [], votes = []) {
  const tx = Array.isArray(transactions) ? transactions : [];
  const votesList = Array.isArray(votes) ? votes : [];

  const txTotal = tx.length;
  const txAvecHash = tx.filter((t) => String(t?.hash || '').trim().length > 0).length;
  const score1 = txTotal > 0 ? (txAvecHash / txTotal) * 25 : 0;

  const votesTermines = votesList.filter((v) => v?.statut && v.statut !== 'ouvert');
  let moyenneParticipation = 0;
  if (votesTermines.length > 0) {
    const somme = votesTermines.reduce((acc, v) => {
      const totalMembres = toNumber(v?.totalMembres);
      if (!totalMembres) return acc;
      const participation = ((toNumber(v?.votesOui) + toNumber(v?.votesNon)) / totalMembres) * 100;
      return acc + participation;
    }, 0);
    moyenneParticipation = somme / votesTermines.length;
  }
  const score2 = (moyenneParticipation / 100) * 25;

  const txDepensesList = tx.filter((t) => t?.typeTransaction === 'depense');
  const txJustifiees = txDepensesList.filter(
    (t) => String(t?.justificatif?.url || '').trim().length > 0
  ).length;
  const score3 = txDepensesList.length > 0 ? (txJustifiees / txDepensesList.length) * 20 : 20;

  const moisActifs = calculerMoisActifs3DerniersMois(tx);
  const score4 = (moisActifs / 3) * 15;

  let revenus = 0;
  let depenses = 0;
  tx.forEach((t) => {
    const m = toNumber(t?.montant);
    if (t?.typeTransaction === 'depense') depenses += m;
    else revenus += m;
  });
  const solde = revenus - depenses;

  let score5 = 0;
  if (solde > 0 && revenus > depenses * 1.2) score5 = 15;
  else if (solde > 0) score5 = 10;
  else if (solde === 0) score5 = 5;
  else score5 = 0;

  const total = Math.round(score1 + score2 + score3 + score4 + score5);

  let niveau = 'Faible';
  let badge = '❌';
  let couleur = '#dc2626';
  let texte = 'Attention Requise';
  if (total >= 90) {
    niveau = 'Excellent';
    badge = '🏆';
    couleur = '#15803d';
    texte = 'Coopérative Certifiée';
  } else if (total >= 75) {
    niveau = 'Très bon';
    badge = '✅';
    couleur = '#16a34a';
    texte = 'Gouvernance Fiable';
  } else if (total >= 60) {
    niveau = 'Bon';
    badge = '👍';
    couleur = '#d97706';
    texte = 'En Progression';
  } else if (total >= 40) {
    niveau = 'Moyen';
    badge = '⚠️';
    couleur = '#f59e0b';
    texte = 'À Améliorer';
  }

  let eligible = false;
  let texteElig = '❌ Non éligible actuellement';
  if (total >= 75) {
    eligible = true;
    texteElig = '✅ Éligible au financement';
  } else if (total >= 50) {
    eligible = 'conditionnel';
    texteElig = '⚠️ Financement conditionnel';
  }

  return {
    total,
    score1: Math.round(score1),
    score2: Math.round(score2),
    score3: Math.round(score3),
    score4: Math.round(score4),
    score5: Math.round(score5),
    niveau,
    badge,
    couleur,
    texte,
    eligible,
    texteElig,
    details: {
      txTotal,
      txAvecHash,
      moyenneParticipation: Math.round(moyenneParticipation),
      txDepenses: txDepensesList.length,
      txJustifiees,
      moisActifs,
      solde,
    },
  };
}

