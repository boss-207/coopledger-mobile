import hre from "hardhat";

async function main() {
  const { ethers } = hre;

  // Récupérer le déployeur
  const [deployer] = await ethers.getSigners();
  console.log("Déploiement depuis :", deployer.address);

  // Vérifier le solde
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Solde :", ethers.formatEther(balance), "POL");

  if (balance === 0n) {
    console.error("❌ Solde insuffisant ! Va sur faucet.polygon.technology");
    process.exit(1);
  }

  // Déployer le contrat
  console.log("\n🚀 Déploiement de CoopLedger...");
  const CoopLedger = await ethers.getContractFactory("CoopLedger");
  const contract = await CoopLedger.deploy(
    deployer.address,
    process.env.PRESIDENT_NOM || "Président CoopLedger"
  );

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ CoopLedger déployé avec succès !");
  console.log("Adresse du contrat :", address);
  console.log("Réseau : Polygon Amoy Testnet");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n👉 Copie cette adresse dans src/config/blockchain.js");
  console.log(
    "👉 Vérifie sur : https://amoy.polygonscan.com/address/" + address
  );
}

main().catch((error) => {
  console.error("❌ Erreur :", error.message);
  process.exit(1);
});