import React from 'react';
import { toast } from '@/components/ui';
import { discordApi, type DiscordChannel, type DiscordForumPost } from '@/lib/discord/api';

export const useForumPosts = ({
  channelId,
  guildId,
  archivedMode,
  selectedTags,
  cachedThreads,
}: {
  channelId: string;
  guildId: string | null;
  archivedMode: boolean;
  selectedTags: string[];
  cachedThreads: DiscordChannel[];
}) => {
  const [posts, setPosts] = React.useState<DiscordForumPost[]>([]);
  const [loading, setLoading] = React.useState(true);

  const loadPosts = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await discordApi.forumPosts(channelId, {
        guildId,
        archived: archivedMode,
        limit: 30,
        tags: selectedTags,
      });
      setPosts(res.posts);
    } catch (err) {
      setPosts(cachedThreads.filter((th) => th.parentId === channelId));
      toast.error(err instanceof Error ? err.message : 'Failed to load forum posts');
    } finally {
      setLoading(false);
    }
  }, [channelId, guildId, archivedMode, selectedTags, cachedThreads]);

  React.useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  return { posts, loading, reload: loadPosts };
};
