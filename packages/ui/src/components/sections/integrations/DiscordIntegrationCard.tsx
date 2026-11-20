import React from 'react';
import { RiDiscordLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { discordApi, type DiscordStatus } from '@/lib/discord/api';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { normalizeContextPanelDirectoryKey, useUIStore } from '@/stores/useUIStore';

export const DiscordIntegrationCard: React.FC = () => {
  const { t } = useI18n();
  const [status, setStatus] = React.useState<DiscordStatus | null>(null);

  React.useEffect(() => {
    void discordApi.status().then(setStatus).catch(() => {});
  }, []);

  const openDiscordPanel = () => {
    const ui = useUIStore.getState();
    ui.setSettingsDialogOpen(false);
    const dirPath = useProjectsStore.getState().getActiveProject()?.path ?? useProjectsStore.getState().projects[0]?.path;
    if (dirPath) {
      ui.openContextPanelTab(normalizeContextPanelDirectoryKey(dirPath), { mode: 'discord' });
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/50 p-3.5 text-xs">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/80 bg-secondary text-foreground">
          <RiDiscordLine className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold text-foreground">{t('contextPanel.mode.discord')}</div>
          <div className="text-[11px] text-muted-foreground">
            {status?.connected
              ? `Connected as ${status.user?.globalName || status.user?.username || 'Discord'} (${status.tokenType})`
              : t('discord.connect.subtitle')}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={openDiscordPanel}>
          {t('discord.action.openPanel')}
        </Button>
        {status?.connected ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void discordApi.disconnect().then(setStatus)}
          >
            {t('discord.connect.disconnect')}
          </Button>
        ) : null}
      </div>
    </div>
  );
};
