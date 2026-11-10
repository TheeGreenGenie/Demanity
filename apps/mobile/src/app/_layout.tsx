import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Brand } from '@/constants/theme';
import { useIsDark, useTheme } from '@/hooks/use-theme';
import { AuthProvider, isFullyOnboarded, useAuth } from '@/lib/auth';

/** Banner pages: transparent header (no background) so the banner reaches the top edge. */
const bannerHeader = {
  title: '',
  headerTransparent: true,
  headerStyle: { backgroundColor: 'transparent' },
} as const;

function RootStack() {
  // Until the stored session has been checked, guards must not redirect, or a
  // deep link to a protected screen (e.g. /compose) bounces a signed-in user.
  const { ready, token, me } = useAuth();
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800' },
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="join" options={{ title: '' }} />
      <Stack.Screen name="sign-in" options={{ title: '' }} />
      <Stack.Screen name="c/[slug]" options={bannerHeader} />
      <Stack.Screen name="post/[id]" options={{ title: 'Post' }} />
      <Stack.Screen name="u/[username]" options={bannerHeader} />
      <Stack.Screen name="place/[slug]" options={bannerHeader} />
      <Stack.Screen name="leader/[slug]" options={bannerHeader} />
      <Stack.Screen name="bill/[id]" options={{ title: 'Bill' }} />
      <Stack.Screen name="guide/[slug]" options={{ title: '' }} />
      <Stack.Screen name="election/[id]" options={{ title: 'Election' }} />
      <Stack.Screen name="log" options={{ title: 'Moderation log' }} />
      <Stack.Screen name="orders" options={{ title: '' }} />
      <Stack.Screen name="ideas" options={{ title: '' }} />
      <Stack.Screen name="compare" options={{ title: 'Compare' }} />
      <Stack.Screen name="org" options={{ title: '' }} />
      {/* Onboarding needs a session; writing needs a finished sign-up. */}
      <Stack.Protected guard={!ready || token !== null}>
        <Stack.Screen name="onboarding" options={{ title: '' }} />
      </Stack.Protected>
      <Stack.Protected guard={!ready || isFullyOnboarded(me)}>
        <Stack.Screen name="compose" options={{ title: 'New post', presentation: 'modal' }} />
        <Stack.Screen name="cite" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="moderation" options={{ title: 'Moderation' }} />
        <Stack.Screen name="contribute" options={{ title: '' }} />
        <Stack.Screen name="feed-settings" options={{ title: '' }} />
        <Stack.Screen name="claim" options={{ title: '', presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const dark = useIsDark();
  const theme = useTheme();
  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: Brand.primary,
      background: theme.background,
      card: theme.background,
      text: theme.text,
      border: theme.backgroundSelected,
    },
  };
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </ThemeProvider>
  );
}
