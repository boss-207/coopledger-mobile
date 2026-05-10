require('@nomicfoundation/hardhat-toolbox');
const path = require('path');
// Charger .env depuis la racine du projet (coopledger-mobile/), même si Hardhat change le cwd
require('dotenv').config({ path: path.join(__dirname, '.env') });

/** Lit DEPLOYER_PRIVATE_KEY : trim, sans espace après "=" dans .env, préfixe 0x si besoin */
function amoyAccounts() {
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw || typeof raw !== 'string') return [];
  const pk = raw.trim().replace(/^["']|["']$/g, '');
  if (!pk || /^your_|placeholder/i.test(pk)) return [];
  const normalized = pk.startsWith('0x') ? pk : `0x${pk}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    console.warn(
      '[hardhat] DEPLOYER_PRIVATE_KEY invalide (attendu : 0x + 64 caractères hex). Réseau amoy sans compte.'
    );
    return [];
  }
  return [normalized];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    amoy: {
      url: 'https://rpc-amoy.polygon.technology',
      chainId: 80002,
      accounts: amoyAccounts(),
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
  },
  paths: {
    sources: './contracts',
    scripts: './scripts',
    artifacts: './artifacts',
  },
};
