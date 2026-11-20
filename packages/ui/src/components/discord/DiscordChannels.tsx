import React from 'react';
import { RiHashtag, RiLockLine, RiMegaphoneLine, RiVolumeUpLine } from '@remixicon/react';
import type { DiscordChannel } from '@/lib/discord/api';

const ChannelIcon: React.FC<{ type: number; nsfw: boolean }> = ({ type, nsfw }) => {
  if (type === 2 || type === 13) return <RiVolumeUpLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  if (type === 5) return <RiMegaphoneLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  if (nsfw) return <RiLockLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  return <RiHashtag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
};

export const DiscordChannels: React.FC<{
  channels: DiscordChannel[];
  threads: DiscordChannel[];
  activeChannelId: string | null;
  onSelect: (channel: DiscordChannel) => void;
}> = ({ channels, threads, activeChannelId, onSelect }) => {
  const [filter, setFilter] = React.useState('');
  const q = filter.trim().toLowerCase();

  const categories = channels.filter((c) => c.type === 4);
  const regular = channels.filter((c) => c.type !== 4 && (!q || c.name.toLowerCase().includes(q)));
  const uncategorized = regular.filter((c) => !c.parentId);

  const renderChannelRow = (ch: DiscordChannel, nested = false) => {
    const childThreads = threads.filter((t) => t.parentId === ch.id);
    const active = ch.id === activeChannelId;
    return (
      <div key={ch.id}>
        <button
          type="button"
          onClick={() => onSelect(ch)}
          className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition ${
            nested ? 'pl-5' : ''
          } ${active ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
        >
          <ChannelIcon type={ch.type} nsfw={ch.nsfw} />
          <span className="truncate">{ch.name}</span>
        </button>
        {childThreads.map((th) => (
          <button
            key={th.id}
            type="button"
            onClick={() => onSelect(th)}
            className={`flex w-full items-center gap-1.5 rounded py-1 pl-7 pr-2 text-left text-[11px] transition ${
              th.id === activeChannelId ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            }`}
          >
            <span className="text-muted-foreground/70">↳</span>
            <span className="truncate">{th.name}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter channels…"
          className="w-full rounded border border-border/70 bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
        />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-1.5 pb-2">
        {uncategorized.map((ch) => renderChannelRow(ch))}
        {categories.map((cat) => {
          const children = regular.filter((c) => c.parentId === cat.id);
          if (children.length === 0) return null;
          return (
            <div key={cat.id} className="space-y-0.5">
              <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {cat.name}
              </div>
              {children.map((ch) => renderChannelRow(ch, false))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
