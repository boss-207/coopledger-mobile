import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';

export async function calculerSolde(cooperativeId = 'broukou') {
  const snap = await getDocs(
    query(
      collection(db, 'transactions'),
      where('cooperativeId', '==', cooperativeId),
      where('statut', '==', 'valide')
    )
  );

  let solde = 0;
  snap.docs.forEach((d) => {
    const tx = d.data();
    const entrees = ['cotisation', 'mobile_money', 'main_a_main'];
    const sorties = ['depense'];

    if (entrees.includes(tx.typeTransaction)) solde += Number(tx.montant || 0);
    else if (sorties.includes(tx.typeTransaction)) solde -= Number(tx.montant || 0);
  });

  return solde;
}

export async function verifierSolde(montant, cooperativeId = 'broukou') {
  const solde = await calculerSolde(cooperativeId);
  return {
    suffisant: solde >= montant,
    soldeActuel: solde,
    montantDemande: montant,
    difference: solde - montant,
  };
}

export function formaterMontant(montant) {
  return `${Number(montant || 0).toLocaleString('fr-FR')} FCFA`;
}
