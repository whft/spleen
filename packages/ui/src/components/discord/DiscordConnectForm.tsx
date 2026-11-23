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
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="mx-auto flex w-full max-w-sm flex-col gap-3.5 rounded-2xl border border-edge bg-surface-elevated p-5 text-xs oc-glass-floating"
    >
      <div className="flex items-center gap-2.5 text-sm font-medium tracking-tight text-foreground">
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-surface-subtle text-foreground">
          <Icon name="discord" className="h-4 w-4 shrink-0" />
        </span>
        <span>{t('discord.connect.title')}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('discord.connect.subtitle')}</p>

      <div className="flex gap-1 rounded-[10px] bg-sidebar p-1">
        {(['user', 'bot'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setTokenType(kind)}
            className={`flex-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors duration-150 ${
              tokenType === kind
                ? 'bg-interactive-selection text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
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
        className="oc-raised oc-field rounded-[10px] bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none"
      />

      {error ? (
        <div className="rounded-[10px] bg-[var(--status-error-background)] px-3 py-2 text-[11px] text-[var(--status-error)]">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading || !token.trim()}
        className="rounded-[10px] bg-primary py-2 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:opacity-90 active:scale-[0.985] disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted-foreground disabled:opacity-80"
      >
        {loading ? '...' : t('discord.connect.connect')}
      </button>
    </form>
  );
};
