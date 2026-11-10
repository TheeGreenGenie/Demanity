import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AuthProvider, isFullyOnboarded, useAuth } from '@/lib/auth';

function RootStack() {
  // Until the stored session has been checked, guards must not redirect, or a
  // deep link to a protected screen (e.g. /compose) bounces a signed-in user.
  const { ready, token, me } = useAuth();
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="join" options={{ title: 'Join Demanity' }} />
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="c/[slug]" options={{ title: 'Community' }} />
      <Stack.Screen name="post/[id]" options={{ title: 'Post' }} />
      <Stack.Screen name="u/[username]" options={{ title: 'Profile' }} />
      {/* Onboarding needs a session; writing needs a finished sign-up. */}
      <Stack.Protected guard={!ready || token !== null}>
        <Stack.Screen name="onboarding" options={{ title: 'Finish signing up' }} />
      </Stack.Protected>
      <Stack.Protected guard={!ready || isFullyOnboarded(me)}>
        <Stack.Screen name="compose" options={{ title: 'New post', presentation: 'modal' }} />
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
