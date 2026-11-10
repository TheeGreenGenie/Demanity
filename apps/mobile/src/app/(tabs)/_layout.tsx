import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function TabIcon({ name, color, size }: { name: IconName; color: ColorValue; size: number }) {
  // React Navigation's ColorValue and the icon library's color type describe the same values.
  return (
    <Ionicons
      name={name}
      color={color as ComponentProps<typeof Ionicons>['color']}
      size={size + 2}
    />
  );
}

/** Filled icon when the tab is active, outline otherwise. */
function StateIcon({
  focused,
  outline,
  filled,
  color,
  size,
}: {
  focused: boolean;
  outline: IconName;
  filled: IconName;
  color: ColorValue;
  size: number;
}) {
  return <TabIcon name={focused ? filled : outline} color={color} size={size} />;
}

export default function TabLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarShowLabel: true,
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
        tabBarStyle: {
          height: 72,
          paddingTop: 6,
          paddingBottom: 12,
          backgroundColor: theme.background,
          borderTopColor: theme.backgroundSelected,
        },
        headerStyle: { backgroundColor: theme.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '900', fontSize: 20 },
        headerTintColor: theme.text,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerTitle: 'Demanity',
          tabBarIcon: (p) => <StateIcon {...p} outline="home-outline" filled="home" />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: (p) => <StateIcon {...p} outline="search-outline" filled="search" />,
        }}
      />
      <Tabs.Screen
        name="bills"
        options={{
          title: 'Bills',
          headerShown: false,
          tabBarIcon: (p) => <StateIcon {...p} outline="albums-outline" filled="albums" />,
        }}
      />
      <Tabs.Screen
        name="humanity"
        options={{
          title: 'Humanity',
          headerShown: false,
          tabBarIcon: (p) => <StateIcon {...p} outline="heart-outline" filled="heart" />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: (p) => (
            <StateIcon {...p} outline="person-circle-outline" filled="person-circle" />
          ),
        }}
      />
    </Tabs>
  );
}
