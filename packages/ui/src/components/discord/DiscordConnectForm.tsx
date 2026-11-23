import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { discordApi, type DiscordStatus } from '@/lib/discord/api';

export const DiscordConnectForm: React.FC<{ onConnected: (status: DiscordStatus) => void }> = ({ onConnected }) => {
  const { t } = useI18n();
  const [token, setToken] = React.useState('');
  const [tokenType, setTokenType] = React.useState<'user' | 'bot'>('user');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const next = await discordApi.connect(token.trim(), tokenType);
      setToken('');
      onConnected(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Discord');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mx-auto flex w-full max-w-sm flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 text-xs">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon name="discord" className="h-5 w-5 shrink-0 text-foreground" />
        <span>{t('discord.connect.title')}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t('discord.connect.subtitle')}</p>

      <div className="flex gap-1.5 rounded-lg bg-muted p-1">
        {(['user', 'bot'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setTokenType(kind)}
            className={`flex-1 rounded-md py-1 text-[11px] font-medium transition ${
              tokenType === kind ? 'bg-secondary text-foreground shadow-sm border border-border/70' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {kind === 'user' ? t('discord.connect.tokenTypeUser') : t('discord.connect.tokenTypeBot')}
          </button>
        ))}
      </div>

      <input
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder={t('discord.connect.tokenPlaceholder')}
        className="rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:border-foreground/40"
      />

      {error ? <div className="rounded bg-destructive/15 px-2 py-1.5 text-[11px] text-destructive">{error}</div> : null}

      <button
        type="submit"
        disabled={loading || !token.trim()}
        className="rounded-md bg-primary py-2 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? '...' : t('discord.connect.connect')}
      </button>
    </form>
  );
};
