import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { peerWord, Tabs } from '@/components/civic';
import { ErrorText } from '@/components/form';
import { CommunityIcon } from '@/components/forum';
import { PLACE_TABS, PlaceTabContent, usePlace, type PlaceTab } from '@/components/place-sections';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A place without its own community (counties, cities, court districts):
 * the same Overview / Scores / Cost of living / Leaders tabs as state pages.
 * Places that have a community (states, the nation) open on that page.
 */
export default function PlaceScreen() {
  const { slug, tab } = useLocalSearchParams<{ slug: string; tab?: PlaceTab }>();
  const theme = useTheme();
  const { place, error } = usePlace(slug);
  const [current, setCurrent] = useState<PlaceTab>(tab ?? 'overview');

  if (place?.community) {
    return (
      <Redirect
        href={{
          pathname: '/c/[slug]',
          params: tab ? { slug: place.community, tab } : { slug: place.community },
        }}
      />
    );
  }

  return (
    <Screen flush>
      <View style={[styles.banner, { backgroundColor: Brand.location }]}>
        <Ionicons name="map" size={120} color="rgba(255,255,255,0.12)" style={styles.art} />
      </View>
      <View style={styles.header}>
        <View style={[styles.iconRing, { borderColor: theme.background }]}>
          <CommunityIcon kind="location" size={64} />
        </View>
        <ThemedText type="subtitle">{place?.name ?? ''}</ThemedText>
        {place ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {peerWord(place.kind, false)[0]!.toUpperCase() + peerWord(place.kind, false).slice(1)}
            {place.parent ? ` in ${place.parent.name}` : ''}
          </ThemedText>
        ) : null}
      </View>
      <ErrorText message={error} />
      <Tabs tabs={PLACE_TABS} value={current} onChange={setCurrent} />
      {place ? <PlaceTabContent place={place} tab={current} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { height: 120, overflow: 'hidden' },
  art: { position: 'absolute', right: -10, bottom: -24 },
  header: { paddingHorizontal: Spacing.three, gap: Spacing.one, paddingBottom: Spacing.two },
  iconRing: { marginTop: -36, borderWidth: 4, borderRadius: 40, alignSelf: 'flex-start' },
});
