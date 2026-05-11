import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ImageBackground, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, Alert
} from 'react-native';
import { signInWithEmailAndPassword } from 'firebase/auth';
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const GREEN = '#15803d';
const GREEN_DARK = '#14532d';
const GREEN_LIGHT = '#dcfce7';

export default function LoginScreen() {
  const [mode, setMode] = useState('connexion'); // 'connexion' | 'demande' | 'confirmation'
  const [form, setForm] = useState({
    nom: '',
    email: '',
    telephone: '',
    message: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);

  const update = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  function isEmailValide(email) {
    const v = String(email || '').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function countChiffres(value) {
    return String(value || '').replace(/\D/g, '').length;
  }

  async function handleConnexion() {
    if (!form.email || !form.password)
      return Alert.alert('Erreur', 'Remplis tous les champs.');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, form.email, form.password);
    } catch {
      Alert.alert('Erreur', 'Email ou mot de passe incorrect.');
    }
    setLoading(false);
  }

  async function handleDemandeCompte() {
    const nom = form.nom.trim();
    const email = form.email.trim().toLowerCase();
    const telephone = form.telephone.trim();
    const message = form.message?.trim() || '';

    if (!nom) return Alert.alert('Erreur', 'Nom complet obligatoire.');
    if (!email) return Alert.alert('Erreur', 'Email obligatoire.');
    if (!isEmailValide(email)) return Alert.alert('Erreur', 'Format email invalide.');
    if (!telephone) return Alert.alert('Erreur', 'Numéro de téléphone obligatoire.');
    if (countChiffres(telephone) < 8) {
      return Alert.alert('Erreur', 'Le numéro doit contenir au moins 8 chiffres.');
    }

    setLoading(true);
    try {
      const pendingQ = query(
        collection(db, 'demandes_compte'),
        where('email', '==', email),
        where('statut', '==', 'en_attente')
      );
      const pendingSnap = await getDocs(pendingQ);
      if (!pendingSnap.empty) {
        Alert.alert('Information', 'Une demande est déjà en cours pour cet email.');
        return;
      }

      await addDoc(collection(db, 'demandes_compte'), {
        nom,
        email,
        telephone,
        cooperativeId: 'broukou',
        message,
        statut: 'en_attente',
        dateDemande: serverTimestamp(),
        walletAddress: '',
        uid: '',
        roleChoisi: '',
        raisonRefus: '',
      });

      setMode('confirmation');
      setForm((prev) => ({
        ...prev,
        nom: '',
        email: '',
        telephone: '',
        message: '',
      }));
    } catch (e) {
      Alert.alert('Erreur', 'Impossible d’envoyer la demande pour le moment.');
    }
    setLoading(false);
  }

  return (
    <ImageBackground
      source={{ uri: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=800' }}
      style={styles.bg}
    >
      <View style={styles.overlay} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* LOGO */}
          <View style={styles.logoBox}>
            <View style={styles.logoCircle}>
              <Text style={{ fontSize: 36 }}>🌱</Text>
            </View>
            <Text style={styles.logoText}>Coop<Text style={styles.logoGreen}>Ledger</Text></Text>
            <Text style={styles.logoSub}>CTA de Broukou · Région de la Kara</Text>
          </View>

          {/* CARTE */}
          <View style={styles.card}>

            {mode !== 'confirmation' ? (
              <>
                {/* TABS */}
                <View style={styles.tabs}>
                  {['connexion', 'demande'].map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.tab, mode === m && styles.tabActive]}
                      onPress={() => setMode(m)}
                    >
                      <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                        {m === 'connexion' ? 'Se connecter' : 'Demander un compte'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.cardTitle}>
                  {mode === 'connexion' ? 'Espace Membre' : 'Demande de compte'}
                </Text>

                {mode === 'demande' && (
                  <View style={styles.memberBadge}>
                    <Text style={{ fontSize: 24 }}>📨</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.badgeTitle}>Demande validée par le président</Text>
                      <Text style={styles.badgeSub}>Réponse sous 48 heures (notification par email).</Text>
                    </View>
                  </View>
                )}

                {mode === 'demande' && (
                  <>
                    <InputField
                      icon="👤"
                      placeholder="Nom complet *"
                      value={form.nom}
                      onChangeText={(v) => update('nom', v)}
                    />
                    <InputField
                      icon="📞"
                      placeholder="+228 90 XX XX XX"
                      value={form.telephone}
                      onChangeText={(v) => update('telephone', v)}
                      keyboardType="phone-pad"
                    />
                    <InputField
                      icon="🏛️"
                      placeholder="Coopérative"
                      value="CTA de Broukou"
                      editable={false}
                    />
                    <InputField
                      icon="💬"
                      placeholder="Pourquoi voulez-vous rejoindre la coopérative ? (optionnel)"
                      value={form.message}
                      onChangeText={(v) => update('message', v)}
                      multiline
                    />
                  </>
                )}

                <InputField
                  icon="✉️"
                  placeholder="votre@email.com"
                  value={form.email}
                  onChangeText={v => update('email', v)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                {mode === 'connexion' && (
                  <InputField
                    icon="🔒"
                    placeholder="Mot de passe"
                    value={form.password}
                    onChangeText={v => update('password', v)}
                    secureTextEntry
                  />
                )}

                <TouchableOpacity
                  style={styles.btn}
                  onPress={mode === 'connexion' ? handleConnexion : handleDemandeCompte}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.btnText}>
                      {mode === 'connexion' ? 'Se Connecter →' : '📨 Envoyer ma demande'}
                    </Text>
                  }
                </TouchableOpacity>

                <View style={styles.blockchainBadge}>
                  <Text style={styles.blockchainText}>✅ Certifié CoopLedger · Polygon Blockchain</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.successCard}>
                  <Text style={styles.successTitle}>✅ Demande envoyée avec succès !</Text>
                  <Text style={styles.successText}>
                    Le président de la coopérative examinera votre demande sous 48 heures.{"\n"}
                    Vous serez notifié par email.
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.btn, { marginTop: 12 }]}
                  onPress={() => setMode('connexion')}
                >
                  <Text style={styles.btnText}>Retour à la connexion</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

function InputField({ icon, ...props }) {
  return (
    <View style={styles.inputGroup}>
      <View style={styles.inputBox}>
        <Text style={{ fontSize: 18, marginRight: 10 }}>{icon}</Text>
        <TextInput style={styles.input} placeholderTextColor="#9ca3af" {...props} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 }, flex: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,83,45,0.80)' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: 60 },
  logoBox: { alignItems: 'center', marginBottom: 28 },
  logoCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: GREEN,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, elevation: 8 },
  logoText: { fontSize: 32, fontWeight: '900', color: '#fff' },
  logoGreen: { color: '#4ade80' },
  logoSub: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  card: { backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, elevation: 12 },
  tabs: { flexDirection: 'row', backgroundColor: '#f3f4f6', borderRadius: 16, padding: 4, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  tabActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, elevation: 3 },
  tabText: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  tabTextActive: { color: '#111827' },
  cardTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 16 },
  memberBadge: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#dcfce7',
    borderWidth: 1, borderColor: '#86efac', borderRadius: 16, padding: 14, marginBottom: 16 },
  badgeTitle: { fontSize: 14, fontWeight: '700', color: '#166534' },
  badgeSub: { fontSize: 12, color: '#15803d', marginTop: 2 },
  inputGroup: { marginBottom: 14 },
  inputBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#e5e7eb',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fafafa' },
  input: { flex: 1, fontSize: 15, color: '#111827' },
  btn: { backgroundColor: GREEN, borderRadius: 16, paddingVertical: 16, alignItems: 'center',
    marginTop: 8, marginBottom: 16,
    shadowColor: GREEN_DARK, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, elevation: 6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  blockchainBadge: { alignItems: 'center', backgroundColor: '#dcfce7', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: '#86efac' },
  blockchainText: { fontSize: 12, color: GREEN, fontWeight: '600' },
  successCard: {
    backgroundColor: GREEN_LIGHT,
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 18,
    padding: 16,
  },
  successTitle: { fontSize: 16, fontWeight: '900', color: '#166534' },
  successText: { marginTop: 8, color: '#15803d', fontWeight: '700', lineHeight: 20 },
});
