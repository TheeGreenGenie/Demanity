import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { bills, describeError, type ExecutiveOrder } from '@/lib/api';

/** Presidential executive orders, newest first, each linked to the official document. */
export default function OrdersScreen() {
  const theme = useTheme();
  const [orders, setOrders] = useState<ExecutiveOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    bills
      .executiveOrders()
      .then((r) => setOrders(r.orders))
      .catch((err) => setError(describeError(err)));
  }, []);
  return (
    <Screen title="Executive orders" subtitle="Signed by the President, from the Federal Register.">
      <ErrorText message={error} />
      {orders.length === 0 && !error ? (
        <ThemedText themeColor="textSecondary">No executive orders synced yet.</ThemedText>
      ) : null}
      {orders.map((o) => (
        <Pressable
          key={o.documentNumber}
          accessibilityRole="link"
          accessibilityLabel={`${o.title}. Open in the Federal Register`}
          onPress={() => Linking.openURL(o.url)}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: theme.backgroundElement },
            pressed && { opacity: 0.8 },
          ]}
        >
          <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
            {o.number ? `EXECUTIVE ORDER ${o.number}` : 'EXECUTIVE ORDER'}
            {o.signingDate ? ` · SIGNED ${o.signingDate}` : ''}
          </ThemedText>
          <ThemedText type="headline">{o.title}</ThemedText>
          {o.abstract ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
              {o.abstract}
            </ThemedText>
          ) : null}
          <View style={styles.source}>
            <ThemedText type="caption" themeColor="textSecondary">
              {o.president} · published {o.publicationDate}
            </ThemedText>
            <View style={styles.flex} />
            <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
              {o.sourceName} ↗
            </ThemedText>
            <Ionicons name="open-outline" size={13} color={Brand.primary} />
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.one + 2 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
