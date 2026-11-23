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

  React.useEffect(() => {
    setBroken(false);
  }, [url]);

  if (url && !broken) {
    return (
      <img
        src={url}
        alt={label}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        style={{ width: size, height: size, minWidth: size, minHeight: size }}
        className="aspect-square shrink-0 rounded-full object-cover bg-[#171B1D]"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
      className="flex aspect-square shrink-0 items-center justify-center rounded-full border border-border/70 bg-[#171B1D] text-[11px] font-semibold text-foreground select-none"
    >
      {initials}
    </div>
  );
};
