import { CommunityFeed } from '@/components/community-feed';

/** Humanity (R18): its own tab. Kudos only, no dislikes, no scores. */
export default function HumanityScreen() {
  return (
    <CommunityFeed
      slug="humanity"
      intro="The good people do for each other, democracy working, and the ways we are alike. Kudos only, no dislikes."
    />
  );
}
