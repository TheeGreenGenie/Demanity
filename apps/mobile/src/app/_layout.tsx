import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AuthProvider, isFullyOnboarded, useAuth } from '@/lib/auth';

function RootStack() {
  const { token, me } = useAuth();
  return (
    <Stack screenOptions={{ title: 'Demanity' }}>
      <Stack.Screen name="index" options={{ title: 'Demanity' }} />
      <Stack.Screen name="join" options={{ title: 'Join Demanity' }} />
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      {/* Onboarding needs a session; the account screen needs a finished sign-up. */}
      <Stack.Protected guard={token !== null}>
        <Stack.Screen name="onboarding" options={{ title: 'Finish signing up' }} />
      </Stack.Protected>
      <Stack.Protected guard={isFullyOnboarded(me)}>
        <Stack.Screen name="account" options={{ title: 'Your account' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </ThemeProvider>
  );
}
