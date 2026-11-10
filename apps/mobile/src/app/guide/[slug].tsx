import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, describeError, type Guide } from '@/lib/api';

/** A Humanity guide: plain-language explainer with its official sources. */
export default function GuideScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const theme = useTheme();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    civic
      .guide(slug)
      .then(setGuide)
      .catch((err) => setError(describeError(err)));
  }, [slug]);
  if (!guide) return <Screen>{error ? <ErrorText message={error} /> : null}</Screen>;
  return (
    <Screen>
      <ThemedText type="caption" style={{ color: Brand.humanity, fontWeight: 800 }}>
        HUMANITY · {guide.readingMinutes} MIN READ
      </ThemedText>
      <ThemedText type="subtitle">{guide.title}</ThemedText>
      <ThemedText themeColor="textSecondary">{guide.summary}</ThemedText>
      {guide.body.split('\n\n').map((para, i) => (
        <ThemedText key={i} style={styles.para}>
          {para}
        </ThemedText>
      ))}
      {guide.sources.length > 0 ? (
        <View style={[styles.sources, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">Sources</ThemedText>
          {guide.sources.map((s) => (
            <Pressable
              key={s.url}
              accessibilityRole="link"
              onPress={() => Linking.openURL(s.url)}
              style={styles.source}
            >
              <Ionicons name="link-outline" size={15} color={Brand.primary} />
              <ThemedText type="small" style={{ color: Brand.primary, flex: 1 }}>
                {s.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ThemedText type="caption" themeColor="textSecondary">
        Updated {guide.updatedAt}.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  para: { fontSize: 17, lineHeight: 26 },
  sources: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  source: { flexDirection: 'row', gap: Spacing.one + 2, alignItems: 'flex-start' },
});
