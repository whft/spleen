import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useWaitingBlink } from '@/hooks/useDurationTicker';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useRecoveryStore } from '@/stores/useRecoveryStore';

const formatRemaining = (targetMs: number, nowMs: number): string => {
  const remainingSec = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  if (remainingSec < 60) return `${remainingSec}s`;
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
};

interface RecoveryStatusBannerProps {
  sessionId?: string | null;
  variant?: 'composerRow' | 'floating';
}

export const RecoveryStatusBanner: React.FC<RecoveryStatusBannerProps> = ({
  sessionId,
  variant = 'composerRow',
}) => {
  const { t } = useI18n();
  const entry = useRecoveryStore((state) => (sessionId ? state.sessionsById[sessionId] ?? null : null));
  const pausedChildCount = useRecoveryStore((state) => {
    if (!sessionId) return 0;
    let count = 0;
    for (const item of Object.values(state.sessionsById)) {
      if (item.parentSessionID === sessionId) count += 1;
    }
    return count;
  });
  const busy = useRecoveryStore((state) => (sessionId ? Boolean(state.busySessionIds[sessionId]) : false));
  const resumeNow = useRecoveryStore((state) => state.resumeNow);
  const dismiss = useRecoveryStore((state) => state.dismiss);
  const wakeAll = useRecoveryStore((state) => state.wakeAll);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  const nextWakeAt = entry?.nextWakeAt ?? null;
  const isWaiting = Boolean(entry && (entry.state === 'waiting_provider' || entry.state === 'waiting_parent'));
  const blinkDimmed = useWaitingBlink(isWaiting);

  React.useEffect(() => {
    if (!entry || !nextWakeAt || nextWakeAt <= Date.now()) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [entry, nextWakeAt]);

  if (!sessionId || (!entry && pausedChildCount === 0)) return null;

  const countdown = nextWakeAt && nextWakeAt > nowMs ? formatRemaining(nextWakeAt, nowMs) : null;
  let title = t('chat.recovery.waitingProvider');
  if (!entry && pausedChildCount > 0) {
    title = pausedChildCount === 1
      ? '1 subagent paused on usage limit'
      : `${pausedChildCount} subagents paused on usage limit`;
  } else if (entry?.state === 'recovering') {
    title = t('chat.recovery.recovering');
  } else if (entry?.state === 'needs_review') {
    title = t('chat.recovery.needsReview');
  } else if (entry?.state === 'waiting_parent') {
    title = t('chat.recovery.waitingParent');
  } else if (countdown) {
    title = t('chat.recovery.resumingIn', { time: countdown });
  }

  const isWarning = entry?.state === 'needs_review';
  const isRecovering = entry?.state === 'recovering';

  const handleContinue = () => {
    if (entry) {
      void resumeNow(sessionId);
    } else {
      void wakeAll();
    }
  };

  return (
    <div
      role="status"
      data-recovery-banner={entry?.state ?? 'subagents_waiting'}
      className={cn(
        'flex min-w-0 items-center justify-between gap-2.5 text-xs',
        variant === 'composerRow'
          ? 'oc-composer-row border-b border-edge ps-3 pe-1.5 bg-[var(--status-info-background)]/45'
          : 'chat-input-column mb-2 rounded-xl border border-edge bg-surface-elevated px-3 py-2 oc-glass-floating',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {isRecovering ? (
          <Spinner className="h-3.5 w-3.5 shrink-0 text-[var(--status-info)]" aria-hidden="true" />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 shrink-0 rounded-full transition-opacity duration-200 motion-reduce:transition-none',
              isWarning ? 'bg-[var(--status-warning)]' : 'bg-[var(--status-success)]',
              blinkDimmed && 'opacity-35',
            )}
          />
        )}
        <span className="min-w-0 truncate font-medium tabular-nums text-foreground" title={entry?.reason ?? title}>
          {title}
        </span>
        {entry && pausedChildCount > 0 ? (
          <span className="shrink-0 rounded-full bg-surface-subtle px-1.5 py-0.5 typography-micro tabular-nums text-muted-foreground">
            +{pausedChildCount} subagent{pausedChildCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={handleContinue}
          onMouseDown={(event) => event.preventDefault()}
          className="h-6 gap-1 px-2 text-foreground hover:bg-interactive-hover"
        >
          <Icon name="play" className="size-3" aria-hidden="true" />
          {t('chat.recovery.continueNow')}
        </Button>
        {entry ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => void dismiss(sessionId)}
            onMouseDown={(event) => event.preventDefault()}
            aria-label={t('chat.recovery.dismiss')}
            title={t('chat.recovery.dismiss')}
            className="h-6 w-6 px-0 text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
          >
            <Icon name="close" className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
};
