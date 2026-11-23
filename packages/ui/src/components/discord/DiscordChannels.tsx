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
  const [collapsedCategories, setCollapsedCategories] = React.useState<Record<string, boolean>>({});
  const q = filter.trim().toLowerCase();

  const toggleCategory = (catId: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  const categories = channels.filter((c) => c.type === 4);
  const regular = channels.filter((c) => c.type !== 4 && (!q || c.name.toLowerCase().includes(q)));
  const uncategorized = regular.filter((c) => !c.parentId);

  const renderChannelRow = (ch: DiscordChannel, nested = false) => {
    const childThreads = threads.filter((t) => t.parentId === ch.id);
    const active = ch.id === activeChannelId;
    return (
      <div key={ch.id} className="shrink-0">
        <button
          type="button"
          onClick={() => onSelect(ch)}
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-start text-xs transition ${
            nested ? 'ps-5' : ''
          } ${active ? 'bg-interactive-selection font-medium text-foreground' : 'text-muted-foreground hover:bg-interactive-hover hover:text-foreground'}`}
        >
          <ChannelIcon type={ch.type} nsfw={ch.nsfw} />
          <span className="truncate">{ch.name}</span>
        </button>
        {childThreads.map((th) => (
          <button
            key={th.id}
            type="button"
            onClick={() => onSelect(th)}
            className={`flex w-full items-center gap-1.5 rounded-md py-1 ps-7 pe-2 text-start text-[11px] transition ${
              th.id === activeChannelId ? 'bg-interactive-selection font-medium text-foreground' : 'text-muted-foreground hover:bg-interactive-hover hover:text-foreground'
            }`}
          >
            <span className="shrink-0 text-muted-foreground/70">↳</span>
            <span className="truncate">{th.name}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter channels…"
          className="w-full rounded-lg border border-edge bg-background px-2.5 py-1 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-border-focus"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1.5 pb-2">
        {uncategorized.map((ch) => renderChannelRow(ch))}
        {categories.map((cat) => {
          const children = regular.filter((c) => c.parentId === cat.id);
          if (children.length === 0) return null;
          const collapsed = Boolean(collapsedCategories[cat.id]) && !q;
          return (
            <div key={cat.id} className="space-y-0.5">
              <button
                type="button"
                onClick={() => toggleCategory(cat.id)}
                className="flex w-full items-center gap-1 px-1.5 pt-1 text-start text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <span className="inline-block w-3 text-center text-[9px]">{collapsed ? '▸' : '▾'}</span>
                <span className="truncate">{cat.name}</span>
              </button>
              {!collapsed ? children.map((ch) => renderChannelRow(ch, false)) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
