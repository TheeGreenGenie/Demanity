import { useLocalSearchParams } from 'expo-router';

import { CommunityFeed } from '@/components/community-feed';

export default function CommunityScreen() {
  const { slug, tab } = useLocalSearchParams<{ slug: string; tab?: string }>();
  return (
    <CommunityFeed key={`${slug}:${tab ?? ''}`} slug={slug} {...(tab ? { initialTab: tab } : {})} />
  );
}
