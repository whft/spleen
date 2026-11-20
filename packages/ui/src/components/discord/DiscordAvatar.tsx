import React from 'react';
import type { DiscordUser } from '@/lib/discord/api';

export const DiscordAvatar: React.FC<{
  user?: DiscordUser | null;
  name?: string;
  src?: string | null;
  size?: number;
}> = ({ user, name, src, size = 32 }) => {
  const url = src ?? user?.avatarUrl ?? null;
  const label = user?.globalName || user?.username || name || '?';
  const initials = label.slice(0, 2).toUpperCase();
  const [broken, setBroken] = React.useState(false);

  if (url && !broken) {
    return (
      <img
        src={url}
        alt={label}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover bg-muted"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-semibold text-primary select-none"
    >
      {initials}
    </div>
  );
};
