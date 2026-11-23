import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useDesktopRemoteHostActive } from '@/hooks/useDesktopRemoteHostActive';
import { DesktopInstanceMenu } from '@/components/desktop/DesktopInstanceMenu';
import { TooltipLabelWithShortcut } from '@/components/ui/action-toolbar';
import { formatShortcutForDisplay, getEffectiveShortcutCombo } from '@/lib/shortcuts';
import { useUIStore } from '@/stores/useUIStore';
import { useUpdateStore } from '@/stores/useUpdateStore';

type Props = {
  onOpenSettings: () => void;
  onOpenUpdate: () => void;
  showRuntimeButtons?: boolean;
  showUpdateButton?: boolean;
};

const footerButtonClassName = 'inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function SidebarFooter({
  onOpenSettings,
  onOpenUpdate,
  showRuntimeButtons = true,
  showUpdateButton = true,
}: Props): React.ReactNode {
  const { t } = useI18n();
  const shortcutOverrides = useUIStore((state) => state.shortcutOverrides);
  const updateInfo = useUpdateStore((state) => state.info);
  const updateDownloading = useUpdateStore((state) => state.downloading);
  const updateDownloaded = useUpdateStore((state) => state.downloaded);
  const updateProgress = useUpdateStore((state) => state.progress);
  const isDesktopRemote = useDesktopRemoteHostActive();

  if (!showRuntimeButtons && !showUpdateButton) {
    return null;
  }

  const updateLabel = isDesktopRemote ? t('sessions.sidebar.footer.actions.updateApp') : t('sessions.sidebar.footer.actions.update');
  const versionTag = updateInfo?.version ? `v${updateInfo.version.replace(/^v/, '')}` : '';
  const percent = updateProgress?.total && updateProgress.total > 0
    ? Math.min(100, Math.round((updateProgress.downloaded / updateProgress.total) * 100))
    : null;
  const pillText = updateDownloaded
    ? 'Restart to update'
    : updateDownloading
      ? (percent !== null ? `Updating ${percent}%` : 'Updating...')
      : (versionTag ? `Update ${versionTag}` : updateLabel);

  return (
    <div className="flex shrink-0 items-center justify-start gap-1.5 px-2.5 py-2">
      {showRuntimeButtons ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={onOpenSettings} className={footerButtonClassName} aria-label={t('sessions.sidebar.footer.actions.settings')}>
              <Icon name="settings-3" className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}><TooltipLabelWithShortcut label={t('sessions.sidebar.footer.actions.settings')} shortcut={formatShortcutForDisplay(getEffectiveShortcutCombo('open_settings', shortcutOverrides), '')} /></TooltipContent>
        </Tooltip>
      ) : null}
      {showUpdateButton ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenUpdate}
              data-testid="sidebar-update-button"
              className={cn(
                'inline-flex h-6 max-w-[11rem] items-center gap-1.5 rounded-full border px-2 typography-micro font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                updateDownloaded
                  ? 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)] hover:brightness-110'
                  : 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-foreground hover:bg-[var(--status-success-background)]',
              )}
              aria-label={updateLabel}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-success)]" aria-hidden="true" />
              <Icon name={updateDownloaded ? 'refresh' : 'download'} className={cn('h-3.5 w-3.5 shrink-0 text-[var(--status-success)]', updateDownloading && 'animate-pulse')} />
              <span className="truncate">{pillText}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}><p>{updateLabel}</p></TooltipContent>
        </Tooltip>
      ) : null}
      {showRuntimeButtons ? (
        <DesktopInstanceMenu className="ms-auto inline-flex h-6 min-w-0 max-w-[10rem] items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      ) : null}
    </div>
  );
}
