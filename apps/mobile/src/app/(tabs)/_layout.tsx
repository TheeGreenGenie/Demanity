import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { Brand } from '@/constants/theme';

type IconProps = ComponentProps<typeof Ionicons>;

function TabIcon({
  name,
  color,
  size,
}: {
  name: IconProps['name'];
  color: ColorValue;
  size: number;
}) {
  // React Navigation's ColorValue and the icon library's color type describe the same values.
  return <Ionicons name={name} color={color as IconProps['color']} size={size} />;
}

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: Brand.primary }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: (p) => <TabIcon name="home-outline" {...p} /> }}
      />
      <Tabs.Screen
        name="communities"
        options={{
          title: 'Communities',
          tabBarIcon: (p) => <TabIcon name="people-outline" {...p} />,
        }}
      />
      <Tabs.Screen
        name="humanity"
        options={{ title: 'Humanity', tabBarIcon: (p) => <TabIcon name="heart-outline" {...p} /> }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: (p) => <TabIcon name="person-circle-outline" {...p} />,
        }}
      />
    </Tabs>
  );
}
