import { useLocalSearchParams } from 'expo-router';

import { CommunityFeed } from '@/components/community-feed';

export default function CommunityScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <CommunityFeed slug={slug} />;
}
