import React from 'react';
import { RiAddLine, RiPushpinLine, RiSearchLine, RiSparklingLine } from '@remixicon/react';
import { discordApi, type DiscordChannel, type DiscordMessage } from '@/lib/discord/api';

export const DiscordThreads: React.FC<{
  threads: DiscordChannel[];
  pins: DiscordMessage[];
  guildId: string | null;
  channelId: string | null;
  onSelectThread: (ch: DiscordChannel) => void;
  onSendToAi: (text: string) => void;
}> = ({ threads, pins, guildId, channelId, onSelectThread, onSendToAi }) => {
  const [tab, setTab] = React.useState<'threads' | 'pins' | 'search'>('pins');
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<DiscordMessage[]>([]);
  const [searching, setSearching] = React.useState(false);

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guildId || !query.trim()) return;
    setSearching(true);
    try {
      const res = await discordApi.search(guildId, { content: query.trim(), channelId: channelId ?? undefined });
      setHits(res.messages);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  const handleNewThread = async () => {
    if (!channelId) return;
    const name = window.prompt('New thread title:');
    if (!name?.trim()) return;
    try {
      const th = await discordApi.createThread(channelId, name.trim());
      onSelectThread(th);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="flex border-b border-border/60 p-1 text-[11px]">
        {(['pins', 'threads', 'search'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded py-1 font-medium capitalize ${
              tab === t ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {tab === 'pins' ? (
          pins.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground">No pinned messages</div>
          ) : pins.map((m) => (
            <div key={m.id} className="rounded border border-border/60 bg-card/50 p-2">
              <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <RiPushpinLine className="h-3 w-3" />
                  {m.author?.globalName || m.author?.username}
                </span>
                <button
                  type="button"
                  onClick={() => onSendToAi(`[Discord Pin by ${m.author?.username}]:\n${m.content}`)}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  <RiSparklingLine className="h-3 w-3" />
                  AI
                </button>
              </div>
              <div className="whitespace-pre-wrap text-[11px]">{m.content}</div>
            </div>
          ))
        ) : null}

        {tab === 'threads' ? (
          <>
            {channelId ? (
              <button
                type="button"
                onClick={() => void handleNewThread()}
                className="flex w-full items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-[11px] hover:bg-muted"
              >
                <RiAddLine className="h-3.5 w-3.5" />
                Create Thread
              </button>
            ) : null}
            {threads.map((th) => (
              <button
                key={th.id}
                type="button"
                onClick={() => onSelectThread(th)}
                className="flex w-full items-center justify-between rounded border border-border/60 bg-card/40 px-2.5 py-2 text-start hover:bg-muted"
              >
                <span className="truncate font-medium">#{th.name}</span>
              </button>
            ))}
          </>
        ) : null}

        {tab === 'search' ? (
          <div className="space-y-2">
            <form onSubmit={(e) => void runSearch(e)} className="flex gap-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-[11px]"
              />
              <button type="submit" disabled={searching} className="rounded bg-primary px-2 py-1 text-primary-foreground">
                <RiSearchLine className="h-3.5 w-3.5" />
              </button>
            </form>
            {hits.map((m) => (
              <div key={m.id} className="rounded border border-border/60 bg-card/50 p-2">
                <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground">{m.author?.globalName || m.author?.username}</span>
                  <button
                    type="button"
                    onClick={() => onSendToAi(`[Discord Hit by ${m.author?.username}]:\n${m.content}`)}
                    className="text-primary hover:underline"
                  >
                    AI
                  </button>
                </div>
                <div className="line-clamp-4 whitespace-pre-wrap text-[11px]">{m.content}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
