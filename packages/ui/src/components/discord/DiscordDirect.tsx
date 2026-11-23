import React from 'react';
import { RiUserAddLine } from '@remixicon/react';
import { useI18n } from '@/lib/i18n';
import { discordApi, type DiscordChannel } from '@/lib/discord/api';
import { setDiscordDragData } from '@/lib/discord/dragRef';
import { DiscordAvatar } from './DiscordAvatar';

export const DiscordDirect: React.FC<{
  dms: DiscordChannel[];
  activeChannelId: string | null;
  onSelect: (ch: DiscordChannel) => void;
  onCreatedDm: (ch: DiscordChannel) => void;
}> = ({ dms, activeChannelId, onSelect, onCreatedDm }) => {
  const { t } = useI18n();
  const [showNewDm, setShowNewDm] = React.useState(false);
  const [newUserId, setNewUserId] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const handleCreateDm = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUserId.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const ch = await discordApi.createDm(trimmed);
      setNewUserId('');
      setShowNewDm(false);
      onCreatedDm(ch);
    } catch {
      // ignore invalid user
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-2 text-[11px] font-semibold text-muted-foreground">
        <span>{t('discord.directMessages')}</span>
        <button
          type="button"
          title="Start Direct Message"
          onClick={() => setShowNewDm((v) => !v)}
          className="rounded-lg p-1 text-muted-foreground transition hover:bg-interactive-hover hover:text-foreground"
        >
          <RiUserAddLine className="h-3.5 w-3.5" />
        </button>
      </div>
      {showNewDm ? (
        <form onSubmit={(e) => void handleCreateDm(e)} className="flex items-center gap-1 border-b border-border/60 p-1.5">
          <input
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            placeholder="Discord User ID…"
            autoFocus
            className="oc-raised oc-field min-w-0 flex-1 rounded-lg px-2.5 py-1 text-[11px] text-foreground outline-none focus:border-foreground/50"
          />
          <button
            type="submit"
            disabled={creating || !newUserId.trim()}
            className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground disabled:opacity-45"
          >
            Go
          </button>
        </form>
      ) : null}
      <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {dms.map((dm) => {
          const peer = dm.recipients[0] ?? null;
          const active = dm.id === activeChannelId;
          return (
            <button
              key={dm.id}
              type="button"
              draggable
              onDragStart={(e) => {
                setDiscordDragData(e.dataTransfer, {
                  kind: 'dm',
                  channelId: dm.id,
                  name: dm.name,
                  recipientId: peer?.id ?? null,
                });
              }}
              title={`${dm.name} — drag to AI composer to reference`}
              onClick={() => onSelect(dm)}
              className={`flex w-full shrink-0 cursor-grab items-center gap-2 rounded-[10px] px-2 py-1.5 text-start text-xs transition active:cursor-grabbing ${
                active ? 'bg-interactive-selection font-medium text-foreground' : 'text-muted-foreground hover:bg-interactive-hover hover:text-foreground'
              }`}
            >
              <DiscordAvatar user={peer} name={dm.name} size={24} />
              <span className="truncate">{dm.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
