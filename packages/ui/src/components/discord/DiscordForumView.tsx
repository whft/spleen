import React from 'react';
import {
  RiAddLine,
  RiAttachment2,
  RiChat3Line,
  RiCloseLine,
  RiDiscussLine,
  RiLockLine,
  RiRefreshLine,
  RiSearchLine,
  RiSparklingLine,
} from '@remixicon/react';
import { toast } from '@/components/ui';
import { discordApi, type DiscordChannel } from '@/lib/discord/api';
import { setDiscordDragData } from '@/lib/discord/dragRef';
import { useForumPosts } from '@/lib/discord/useForumPosts';

type DiscordForumViewProps = {
  channel: DiscordChannel;
  guildId: string | null;
  guildName: string | null;
  cachedThreads: DiscordChannel[];
  onOpenPost: (post: DiscordChannel) => void;
  onPostCreated: (post: DiscordChannel) => void;
  onSendToAi: (text: string) => void;
};

export const DiscordForumView: React.FC<DiscordForumViewProps> = ({
  channel,
  guildId,
  guildName,
  cachedThreads,
  onOpenPost,
  onPostCreated,
  onSendToAi,
}) => {
  const [archivedMode, setArchivedMode] = React.useState(false);
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState('');
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState('');
  const [newBody, setNewBody] = React.useState('');
  const [newTags, setNewTags] = React.useState<string[]>([]);
  const [creating, setCreating] = React.useState(false);

  const { posts, loading, reload: loadPosts } = useForumPosts({
    channelId: channel.id,
    guildId,
    archivedMode,
    selectedTags,
    cachedThreads,
  });

  const availableTags = React.useMemo(() => channel.availableTags ?? [], [channel.availableTags]);
  const tagMap = React.useMemo(() => {
    const map = new Map<string, { name: string; emojiName: string | null }>();
    for (const tag of availableTags) map.set(tag.id, { name: tag.name, emojiName: tag.emojiName });
    return map;
  }, [availableTags]);

  const toggleFilterTag = (tagId: string) => {
    setSelectedTags((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const toggleCreateTag = (tagId: string) => {
    setNewTags((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    const content = newBody.trim();
    if (!title || !content || creating) return;
    setCreating(true);
    try {
      const created = await discordApi.createForumPost(channel.id, {
        name: title,
        content,
        appliedTags: newTags.length > 0 ? newTags : undefined,
      });
      setNewTitle('');
      setNewBody('');
      setNewTags([]);
      setComposerOpen(false);
      toast.success(`Created post "${created.name}"`);
      onPostCreated(created);
      onOpenPost(created);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create forum post');
    } finally {
      setCreating(false);
    }
  };

  const needle = query.trim().toLowerCase();
  const visiblePosts = React.useMemo(() => {
    if (!needle) return posts;
    return posts.filter((post) => {
      if (post.name.toLowerCase().includes(needle)) return true;
      if (post.firstMessage?.content?.toLowerCase().includes(needle)) return true;
      return false;
    });
  }, [posts, needle]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="shrink-0 space-y-2 border-b border-edge-muted px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[160px] flex-1">
            <RiSearchLine className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search posts in ${channel.name}…`}
              className="w-full rounded-lg border border-edge bg-surface-elevated py-1.5 ps-8 pe-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-border-focus"
            />
          </div>
          <div role="tablist" aria-label="Forum post status" className="inline-flex rounded-lg border border-edge bg-surface-subtle p-0.5 text-[11px]">
            <button
              type="button"
              role="tab"
              aria-selected={!archivedMode}
              onClick={() => setArchivedMode(false)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${!archivedMode ? 'oc-selected text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Active
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={archivedMode}
              onClick={() => setArchivedMode(true)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${archivedMode ? 'oc-selected text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Archived
            </button>
          </div>
          <button
            type="button"
            onClick={() => setComposerOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {composerOpen ? <RiCloseLine className="h-3.5 w-3.5" /> : <RiAddLine className="h-3.5 w-3.5" />}
            {composerOpen ? 'Cancel' : 'New Post'}
          </button>
          <button
            type="button"
            onClick={() => void loadPosts()}
            aria-label="Refresh forum posts"
            title="Refresh posts"
            className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground"
          >
            <RiRefreshLine className="h-3.5 w-3.5" />
          </button>
        </div>

        {availableTags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {availableTags.map((tag) => {
              const active = selectedTags.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleFilterTag(tag.id)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    active
                      ? 'border-primary/60 bg-interactive-selection font-medium text-foreground'
                      : 'border-edge bg-surface-elevated/70 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tag.emojiName ? <span>{tag.emojiName}</span> : null}
                  <span>{tag.name}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {composerOpen ? (
          <form onSubmit={(e) => void handleCreatePost(e)} className="space-y-2 rounded-xl border border-edge bg-surface-elevated p-3">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Post title…"
              maxLength={100}
              className="w-full rounded-lg border border-edge bg-background px-2.5 py-1.5 text-xs font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-border-focus"
            />
            <textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Write the starter message…"
              rows={3}
              className="w-full resize-none rounded-lg border border-edge bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-border-focus"
            />
            {availableTags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {availableTags.filter((tag) => !tag.moderated).map((tag) => {
                  const chosen = newTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleCreateTag(tag.id)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                        chosen ? 'border-primary/60 bg-interactive-selection text-foreground' : 'border-edge text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {tag.emojiName ? <span>{tag.emojiName}</span> : null}
                      <span>{tag.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !newTitle.trim() || !newBody.trim()}
                className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {creating ? 'Posting…' : 'Create Post'}
              </button>
            </div>
          </form>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {loading ? (
          <div className="py-10 text-center text-xs text-muted-foreground">Loading forum posts…</div>
        ) : visiblePosts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-edge-muted bg-surface-subtle/40 px-4 py-10 text-center">
            <RiDiscussLine className="h-6 w-6 text-muted-foreground" />
            <div className="text-xs font-medium text-foreground">
              {archivedMode ? 'No archived posts found' : 'No active forum posts found'}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {archivedMode ? 'Try switching to Active or clearing tag filters.' : 'Switch to Archived or create a new post above.'}
            </div>
          </div>
        ) : (
          visiblePosts.map((post) => {
            const starter = post.firstMessage;
            const author = starter?.author?.globalName || starter?.author?.username || null;
            const postTags = (post.appliedTags ?? [])
              .map((id) => ({ id, ...(tagMap.get(id) ?? { name: id, emojiName: null }) }));
            return (
              <div
                key={post.id}
                draggable
                onDragStart={(e) => {
                  setDiscordDragData(e.dataTransfer, {
                    kind: 'thread',
                    channelId: post.id,
                    threadName: post.name,
                    guildId: post.guildId ?? guildId,
                    guildName,
                  });
                }}
                onClick={() => onOpenPost(post)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenPost(post);
                  }
                }}
                role="button"
                tabIndex={0}
                title={`${post.name} — click to open post, drag to AI composer to reference`}
                className="group cursor-pointer rounded-xl border border-edge-muted bg-surface-elevated/70 p-3 text-start transition-colors hover:border-border-hover hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-foreground">{post.name}</span>
                      {post.locked ? <RiLockLine className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
                      {post.archived ? (
                        <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted-foreground">Archived</span>
                      ) : null}
                    </div>
                    {postTags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {postTags.map((tag) => (
                          <span key={tag.id} className="inline-flex items-center gap-0.5 rounded-full bg-surface-subtle px-2 py-0.5 text-[10px] text-muted-foreground">
                            {tag.emojiName ? <span>{tag.emojiName}</span> : null}
                            <span>{tag.name}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {starter?.content ? (
                      <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {author ? <span className="font-medium text-foreground/85">{author}: </span> : null}
                        {starter.content}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const preview = starter?.content ? `\n${author ? `${author}: ` : ''}${starter.content}` : '';
                      onSendToAi(`[Discord Forum #${channel.name} / Post "${post.name}" (channel ${post.id})]${preview}`);
                    }}
                    aria-label={`Send ${post.name} to AI`}
                    title="Send post to AI composer"
                    className="shrink-0 rounded-lg p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-interactive-hover hover:text-primary group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <RiSparklingLine className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] tabular-nums text-muted-foreground">
                  {post.messageCount != null ? (
                    <span className="inline-flex items-center gap-1">
                      <RiChat3Line className="h-3 w-3" />
                      {post.messageCount}
                    </span>
                  ) : null}
                  {starter && starter.attachments.length > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <RiAttachment2 className="h-3 w-3" />
                      {starter.attachments.length}
                    </span>
                  ) : null}
                  {post.createTimestamp ? (
                    <span>{new Date(post.createTimestamp).toLocaleDateString()}</span>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
