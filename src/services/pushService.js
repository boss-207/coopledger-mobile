const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Envoie une notification push à plusieurs tokens Expo.
 */
export async function envoyerNotifPush({
  tokens,
  titre,
  message,
  data = {},
}) {
  if (!tokens || tokens.length === 0) return;

  const tokensValides = tokens.filter(
    (t) => t && t.startsWith('ExponentPushToken[')
  );
  if (tokensValides.length === 0) return;

  const chunks = [];
  for (let i = 0; i < tokensValides.length; i += 100) {
    chunks.push(tokensValides.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const messages = chunk.map((token) => ({
      to: token,
      sound: 'default',
      title: titre,
      body: message,
      data: { ...data, timestamp: Date.now() },
      priority: 'high',
      channelId: 'votes',
    }));

    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
      });
    } catch (err) {
      console.error('Push error:', err);
    }
  }
}

/**
 * Récupère tous les tokens Expo des membres actifs d'une coopérative.
 * @param {string} cooperativeId
 * @param {import('firebase/firestore').Firestore} db
 * @param {typeof import('firebase/firestore').collection} collection
 * @param {typeof import('firebase/firestore').query} query
 * @param {typeof import('firebase/firestore').where} where
 * @param {typeof import('firebase/firestore').getDocs} getDocs
 */
export async function getTokensMembres(
  cooperativeId = 'broukou',
  db,
  collection,
  query,
  where,
  getDocs
) {
  const snap = await getDocs(
    query(
      collection(db, 'users'),
      where('cooperativeId', '==', cooperativeId),
      where('statut', '==', 'actif')
    )
  );
  return snap.docs
    .map((d) => d.data().expoPushToken)
    .filter(Boolean);
}
