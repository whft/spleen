import React from 'react';
import { RiCloseLine, RiPlayLine, RiTimeLine } from '@remixicon/react';
import { useI18n } from '@/lib/i18n';
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

export const RecoveryStatusBanner: React.FC<{ sessionId?: string | null }> = ({ sessionId }) => {
  const { t } = useI18n();
  const entry = useRecoveryStore((state) => (sessionId ? state.sessionsById[sessionId] ?? null : null));
  const busy = useRecoveryStore((state) => (sessionId ? Boolean(state.busySessionIds[sessionId]) : false));
  const resumeNow = useRecoveryStore((state) => state.resumeNow);
  const dismiss = useRecoveryStore((state) => state.dismiss);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  const nextWakeAt = entry?.nextWakeAt ?? null;
  React.useEffect(() => {
    if (!entry || !nextWakeAt || nextWakeAt <= Date.now()) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [entry, nextWakeAt]);

  if (!entry || !sessionId) return null;

  const countdown = nextWakeAt && nextWakeAt > nowMs ? formatRemaining(nextWakeAt, nowMs) : null;
  let title = t('chat.recovery.waitingProvider');
  if (entry.state === 'recovering') {
    title = t('chat.recovery.recovering');
  } else if (entry.state === 'needs_review') {
    title = t('chat.recovery.needsReview');
  } else if (entry.state === 'waiting_parent') {
    title = t('chat.recovery.waitingParent');
  } else if (countdown) {
    title = t('chat.recovery.resumingIn', { time: countdown });
  }

  const isWarning = entry.state === 'needs_review';

  return (
    <div
      role="status"
      data-recovery-banner={entry.state}
      className="mx-auto mb-2 flex w-full max-w-3xl items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
    >
      <div className="flex min-w-0 items-center gap-2">
        <RiTimeLine className={isWarning ? 'h-4 w-4 shrink-0 text-amber-500' : 'h-4 w-4 shrink-0 text-primary'} />
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{title}</div>
          {entry.reason ? (
            <div className="truncate text-[11px] text-muted-foreground">{entry.reason}</div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void resumeNow(sessionId)}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          <RiPlayLine className="h-3.5 w-3.5" />
          {t('chat.recovery.continueNow')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void dismiss(sessionId)}
          aria-label={t('chat.recovery.dismiss')}
          title={t('chat.recovery.dismiss')}
          className="inline-flex items-center justify-center rounded-md border border-border/60 p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <RiCloseLine className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
