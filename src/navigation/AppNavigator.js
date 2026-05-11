import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { View, Text, Platform, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import DashboardScreen from '../screens/DashboardScreen';
import VoteScreen from '../screens/VoteScreen';
import HistoriqueScreen from '../screens/HistoriqueScreen';
import ProfileScreen from '../screens/ProfileScreen';
import NouvelleTransactionScreen from '../screens/NouvelleTransactionScreen';
import AppelDeFondsScreen from '../screens/AppelDeFondsScreen';
import PaiementAppelScreen from '../screens/PaiementAppelScreen';
import MainAMainScreen from '../screens/MainAMainScreen';
import RapportScreen from '../screens/RapportScreen';
import MembresScreen from '../screens/MembresScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();
const GREEN = '#15803d';
const GREEN_DARK = '#14532d';

function TabIcon({ emoji, label, focused }) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: Platform.OS === 'android' ? 8 : 6,
        minWidth: 56,
      }}
    >
      <Text style={{ fontSize: 24 }}>{emoji}</Text>
      <Text
        style={{
          fontSize: 10,
          fontWeight: focused ? '700' : '500',
          color: focused ? GREEN : '#9ca3af',
          marginTop: 2,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

function VideOngletNouvelleTx() {
  return <View style={{ flex: 1 }} />;
}

function BoutonOngletNouvelleTransaction(props) {
  const navigation = useNavigation();
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      accessibilityRole="button"
      {...props}
      onPress={() => navigation.navigate('Accueil', { screen: 'NouvelleTransaction' })}
      style={[
        props.style,
        {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
        },
      ]}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: '#15803d',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
          elevation: 8,
          shadowColor: '#15803d',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 8,
        }}
      >
        <Text style={{ fontSize: 28, color: 'white' }}>➕</Text>
      </View>
    </TouchableOpacity>
  );
}

function DashboardStack({ userData }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DashboardMain">
        {props => <DashboardScreen {...props} userData={userData} />}
      </Stack.Screen>
      <Stack.Screen
        name="NouvelleTransaction"
        options={{
          headerShown: true,
          headerTitle: '➕ Nouvelle Transaction',
          headerStyle: { backgroundColor: GREEN_DARK },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '800', fontSize: 16 },
        }}
      >
        {props => <NouvelleTransactionScreen {...props} userData={userData} />}
      </Stack.Screen>
      <Stack.Screen
        name="MainAMain"
        options={{ headerShown: false }}
      >
        {props => <MainAMainScreen {...props} userData={userData} />}
      </Stack.Screen>
      <Stack.Screen name="AppelDeFonds" options={{ headerShown: false }}>
        {props => <AppelDeFondsScreen {...props} userData={userData} />}
      </Stack.Screen>
      <Stack.Screen name="PaiementAppel" options={{ headerShown: false }}>
        {props => <PaiementAppelScreen {...props} userData={userData} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function ProfilStack({ userData }) {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: GREEN_DARK },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '800' },
      }}
    >
      <Stack.Screen
        name="ProfileMain"
        options={{ headerShown: false }}
      >
        {props => <ProfileScreen {...props} userData={userData} />}
      </Stack.Screen>
      <Stack.Screen
        name="RapportMensuel"
        options={{ headerTitle: '📄 Rapport mensuel' }}
      >
        {props => <RapportScreen {...props} userData={userData} />}
      </Stack.Screen>
      <Stack.Screen
        name="MembresGestion"
        options={{ headerTitle: '👥 Membres' }}
      >
        {props => <MembresScreen {...props} userData={userData} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

export default function AppNavigator({ userData }) {
  const insets = useSafeAreaInsets();
  const tabBarBottomPadding = 20 + insets.bottom;
  const tabBarHeight = 80 + insets.bottom;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: tabBarHeight,
          backgroundColor: '#ffffff',
          borderTopWidth: 1,
          borderTopColor: '#f1f5f9',
          paddingBottom: tabBarBottomPadding,
          paddingTop: 8,
          elevation: 20,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.1,
          shadowRadius: 12,
          zIndex: 999,
        },
      }}
    >
      <Tab.Screen
        name="Accueil"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" label="Accueil" focused={focused} />,
        }}
      >
        {() => <DashboardStack userData={userData} />}
      </Tab.Screen>

      <Tab.Screen
        name="Votes"
        options={{
          headerShown: true,
          headerTitle: '🗳️ Gouvernance',
          headerStyle: { backgroundColor: GREEN_DARK },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '800' },
          tabBarIcon: ({ focused }) => <TabIcon emoji="🗳️" label="Votes" focused={focused} />,
        }}
      >
        {() => <VoteScreen userData={userData} />}
      </Tab.Screen>

      <Tab.Screen
        name="NouvelleTx"
        component={VideOngletNouvelleTx}
        options={{
          tabBarLabel: '',
          tabBarButton: (props) => <BoutonOngletNouvelleTransaction {...props} />,
        }}
      />

      <Tab.Screen
        name="Historique"
        options={{
          headerShown: true,
          headerTitle: '📋 Registre',
          headerStyle: { backgroundColor: GREEN_DARK },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '800' },
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" label="Registre" focused={focused} />,
        }}
      >
        {() => <HistoriqueScreen userData={userData} />}
      </Tab.Screen>

      <Tab.Screen
        name="Profil"
        options={{
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" label="Profil" focused={focused} />,
        }}
      >
        {() => <ProfilStack userData={userData} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
