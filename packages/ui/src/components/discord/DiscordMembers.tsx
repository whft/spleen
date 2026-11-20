import React from 'react';
import type { DiscordMember, DiscordRole } from '@/lib/discord/api';
import { DiscordAvatar } from './DiscordAvatar';

export const DiscordMembers: React.FC<{
  members: DiscordMember[];
  roles: DiscordRole[];
}> = ({ members, roles }) => {
  const [query, setQuery] = React.useState('');
  const roleMap = React.useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const q = query.trim().toLowerCase();
  const visible = members.filter((m) => {
    const label = `${m.nick ?? ''} ${m.user.globalName ?? ''} ${m.user.username}`.toLowerCase();
    return !q || label.includes(q);
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Members (${members.length})…`}
          className="w-full rounded border border-border/70 bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
        />
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {visible.map((m) => {
          const topRole = m.roles.map((id) => roleMap.get(id)).find((r) => r && r.color > 0);
          return (
            <div key={m.user.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50">
              <DiscordAvatar user={m.user} size={24} />
              <div className="min-w-0 flex-1">
                <div
                  style={topRole ? { color: `#${topRole.color.toString(16).padStart(6, '0')}` } : undefined}
                  className="truncate font-medium"
                >
                  {m.nick || m.user.globalName || m.user.username}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">@{m.user.username}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
