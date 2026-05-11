import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { View, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DashboardScreen from '../screens/DashboardScreen';
import VoteScreen from '../screens/VoteScreen';
import HistoriqueScreen from '../screens/HistoriqueScreen';
import ProfileScreen from '../screens/ProfileScreen';
import NouvelleTransactionScreen from '../screens/NouvelleTransactionScreen';
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
        name="Rapport"
        options={{
          headerShown: true,
          headerTitle: 'Rapport Mensuel',
          headerStyle: { backgroundColor: GREEN_DARK },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '800' },
          tabBarIcon: ({ focused }) => <TabIcon emoji="📄" label="Rapport" focused={focused} />,
        }}
      >
        {() => <RapportScreen userData={userData} />}
      </Tab.Screen>

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
        name="Membres"
        options={{
          headerShown: true,
          headerTitle: '👥 Membres',
          headerStyle: { backgroundColor: GREEN_DARK },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '800' },
          tabBarIcon: ({ focused }) => <TabIcon emoji="👥" label="Membres" focused={focused} />,
        }}
      >
        {() => <MembresScreen userData={userData} />}
      </Tab.Screen>

      <Tab.Screen
        name="Profil"
        options={{
          headerShown: true,
          headerTitle: '👤 Mon Profil',
          headerStyle: { backgroundColor: GREEN_DARK },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '800' },
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" label="Profil" focused={focused} />,
        }}
      >
        {() => <ProfileScreen userData={userData} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
