import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { LoadingScreen } from './src/components/UI';
import LoginScreen from './src/screens/shared/LoginScreen';
import { getNavigatorForRole } from './src/navigation/AppNavigator';
import { colors } from './src/theme';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const navTheme = {
  dark: true,
  colors: {
    primary: colors.primary,
    background: colors.bg,
    card: colors.bg2,
    text: colors.text,
    border: colors.border,
    notification: colors.red,
  },
};

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <LoginScreen />;

  const Navigator = getNavigatorForRole(user.role);
  return (
    <NavigationContainer theme={navTheme}>
      <Navigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AppContent />
    </AuthProvider>
  );
}
