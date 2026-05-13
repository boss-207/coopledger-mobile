# CoopLedger — Firebase Web + Mobile (plan Spark, sans Blaze)

Tu as **un seul projet Firebase** (`coopledger-3cf7c` dans `.firebaserc`) utilisé par :

- l’**app web** dans `coopledger-app/`
- l’**app mobile** dans `coopledger-mobile/`

Les deux dossiers sont côte à côte sous `CoopLedger/`. C’est normal de lancer `firebase deploy` depuis le **web** (`coopledger-app`), car c’est là que se trouvent **hosting** et souvent la config Firebase CLI.

---

## 1. Ce que Spark interdit

Sur le plan **Spark (gratuit)**, tu **ne peux pas** déployer les **Cloud Functions v2** (erreur Cloud Build / Blaze).

**À ne pas lancer** tant que tu restes en Spark :

```bash
firebase deploy --only functions
```

---

## 2. Ce que tu déploies depuis le web (`coopledger-app`)

À la racine de **`coopledger-app`** :

### Hébergement du site (build React / etc.)

```bash
cd ~/Documents/CoopLedger/coopledger-app
firebase deploy --only hosting
```

(Adapte le chemin si ton disque est différent.)

### Règles Firestore (partagées avec le mobile)

Le fichier `firebase.json` du **web** pointe vers les règles du **mobile** :

`../coopledger-mobile/firestore.rules`

Donc tu **édites** les règles dans **`coopledger-mobile/firestore.rules`**, puis tu déploies **depuis le dossier web** :

```bash
cd ~/Documents/CoopLedger/coopledger-app
firebase deploy --only firestore:rules
```

**Important** : les deux dossiers `coopledger-app` et `coopledger-mobile` doivent rester **au même niveau** (frères), sinon change le chemin dans `coopledger-app/firebase.json`.

### Les deux en une commande (sans Functions)

```bash
cd ~/Documents/CoopLedger/coopledger-app
firebase deploy --only hosting,firestore:rules
```

---

## 3. Ce que tu fais depuis le mobile (`coopledger-mobile`)

Tu **n’as pas besoin** de redéployer Firebase depuis le mobile pour le site.

Tu peux quand même utiliser (optionnel, doublon avec le web) :

```bash
cd ~/Documents/CoopLedger/coopledger-mobile
npm run deploy:rules
```

…si tu préfères pousser **uniquement** les règles depuis le dépôt mobile (il a son propre `firebase.json` + `firestore.rules` local).

---

## 4. Rapport e-mail sans Functions (Spark)

| Canal | Fichier / lieu |
|--------|----------------|
| **Envoi depuis l’app mobile** | `src/screens/RapportScreen.js` + **`.env`** avec `EXPO_PUBLIC_RESEND_KEY=...` puis redémarrage Expo. |
| **Envoi automatique (cron)** | Dépot **mobile** : `.github/workflows/rapport-mensuel.yml` + secrets GitHub (`RESEND_API_KEY`, compte de service Firebase, etc.). |

Le dossier **`coopledger-mobile/functions/`** sert de **référence** (ou pour un futur passage en Blaze) ; **pas de `firebase deploy --only functions`** en Spark.

---

## 5. Config Firebase dans le code (web vs mobile)

- **Web** : config Firebase habituelle du projet (souvent `src/firebase.js` ou équivalent dans `coopledger-app`).
- **Mobile** : `src/config/firebase.js` (ou équivalent) dans `coopledger-mobile`.

Les deux doivent utiliser le **même `projectId`** (`coopledger-3cf7c`) pour lire/écrire les **mêmes collections** Firestore.

---

## 6. Résumé des clés Resend

- **Expo (mobile)** : `coopledger-mobile/.env` → `EXPO_PUBLIC_RESEND_KEY`
- **GitHub Actions** : secret `RESEND_API_KEY` (dépôt qui contient le workflow, en pratique le mobile)
- **Ne pas** committer de vraies clés dans `.env.example` ni dans `functions/index.js`

---

## 7. Si tu déménages un des dossiers

Mets à jour le chemin dans **`coopledger-app/firebase.json`** :

```json
"firestore": {
  "rules": "../coopledger-mobile/firestore.rules"
}
```

…pour qu’il pointe toujours vers le bon `firestore.rules`.
