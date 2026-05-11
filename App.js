import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';
import { useAuth } from './src/hooks/useAuth';
import { useNotifications } from './src/hooks/useNotifications';
import LoginScreen from './src/screens/LoginScreen';
import AppNavigator from './src/navigation/AppNavigator';
import InstitutionDashboard from './src/screens/InstitutionDashboard';

const navigationRef = createNavigationContainerRef();

export default function App() {
  const { user, userData, loading } = useAuth();

  useNotifications({ userData, navigationRef });

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        await NavigationBar.setBackgroundColorAsync('#ffffff');
        await NavigationBar.setButtonStyleAsync('dark');
      } catch {
        // Ignorer si non supporté (Expo Go / ancien device)
      }
    })();
  }, []);

  return (
    <SafeAreaProvider>
      {loading ? (
        <View style={styles.splash}>
          <View style={styles.splashCircle}>
            <Text style={styles.splashEmoji}>🌱</Text>
          </View>
          <Text style={styles.splashTitle}>
            Coop<Text style={styles.splashGreen}>Ledger</Text>
          </Text>
          <Text style={styles.splashSub}>CTA de Broukou · Région de la Kara</Text>
          <ActivityIndicator color="#4ade80" size="large" style={{ marginTop: 32 }} />
          <Text style={styles.splashLoading}>Connexion à la blockchain...</Text>
        </View>
      ) : !user ? (
        <LoginScreen />
      ) : userData?.role === 'institution' ? (
        <InstitutionDashboard userData={userData} />
      ) : (
        <NavigationContainer ref={navigationRef}>
          <AppNavigator userData={userData} />
        </NavigationContainer>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#14532d',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  splashCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#15803d',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 12,
  },
  splashEmoji: { fontSize: 52 },
  splashTitle: { fontSize: 42, fontWeight: '900', color: '#fff' },
  splashGreen: { color: '#4ade80' },
  splashSub: { fontSize: 14, color: 'rgba(255,255,255,0.55)', marginTop: 8 },
  splashLoading: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 12 },
});
