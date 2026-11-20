import React from 'react';
import { RiUserAddLine } from '@remixicon/react';
import { useI18n } from '@/lib/i18n';
import { discordApi, type DiscordChannel } from '@/lib/discord/api';
import { DiscordAvatar } from './DiscordAvatar';

export const DiscordDirect: React.FC<{
  dms: DiscordChannel[];
  activeChannelId: string | null;
  onSelect: (ch: DiscordChannel) => void;
  onCreatedDm: (ch: DiscordChannel) => void;
}> = ({ dms, activeChannelId, onSelect, onCreatedDm }) => {
  const { t } = useI18n();
  const handleNewDm = async () => {
    const userId = window.prompt('Enter Discord user ID to open DM:');
    if (!userId?.trim()) return;
    try {
      const ch = await discordApi.createDm(userId.trim());
      onCreatedDm(ch);
    } catch {
      // ignore invalid user
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-2 text-[11px] font-semibold text-muted-foreground">
        <span>{t('discord.directMessages')}</span>
        <button type="button" onClick={() => void handleNewDm()} className="rounded p-0.5 hover:bg-muted hover:text-foreground">
          <RiUserAddLine className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {dms.map((dm) => {
          const peer = dm.recipients[0] ?? null;
          const active = dm.id === activeChannelId;
          return (
            <button
              key={dm.id}
              type="button"
              onClick={() => onSelect(dm)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                active ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
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
