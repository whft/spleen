import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { cn } from '@/lib/utils';
import { autonomyLabApi, type ResearchSourceKind } from '@/lib/autonomy/api';
import { useUIStore } from '@/stores/useUIStore';
import { useAutonomyLabData, type AutonomyLabTab } from '@/hooks/useAutonomyLabData';
import { AutonomySecondaryPanels } from './AutonomySecondaryPanels';

const STATUS_BADGE = {
  active: 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
  completed: 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
  passed: 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
  verified: 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
  ready: 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
  running: 'border-[var(--status-info-border)] bg-[var(--status-info-background)] text-[var(--status-info)]',
  waiting_provider: 'border-[var(--status-info-border)] bg-[var(--status-info-background)] text-[var(--status-info)]',
  paused: 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]',
  waiting: 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]',
  stale: 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]',
  unverified: 'border-border bg-surface-muted text-muted-foreground',
  pending: 'border-border bg-surface-muted text-muted-foreground',
  blocked: 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]',
  failed: 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]',
  contradicted: 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]',
  error: 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]',
  cancelled: 'border-border bg-surface-muted text-muted-foreground',
} as const;

const STATUS_BADGE_MAP = new Map<string, string>(Object.entries(STATUS_BADGE));

const getStatusBadge = (status: string): string => STATUS_BADGE_MAP.get(status) ?? STATUS_BADGE.unverified;

const formatTurns = (turnsUsed: number, maxTurns?: number | null, mode?: string): string => {
  if (maxTurns === null || maxTurns === undefined) {
    return mode === 'ongoing' ? `${turnsUsed} / ∞` : `${turnsUsed}`;
  }
  return `${turnsUsed} / ${maxTurns}`;
};

const formatWakeTime = (epochMs?: number | null): string | null => {
  if (!epochMs || epochMs <= 0) return null;
  try {
    return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return null;
  }
};

const TABS: ReadonlyArray<{ id: AutonomyLabTab; label: string; icon: 'compass-3' | 'search' | 'archive' | 'bar-chart' }> = [
  { id: 'objectives', label: 'Autonomy Center', icon: 'compass-3' },
  { id: 'research', label: 'Research Library', icon: 'search' },
  { id: 'memory', label: 'MemFS Learning', icon: 'archive' },
  { id: 'diagnostics', label: 'Coordinator & Diagnostics', icon: 'bar-chart' },
];

export const AutonomyLabView: React.FC = () => {
  const isOpen = useUIStore((state) => state.isAutonomyLabOpen);
  const [tab, setTab] = React.useState<AutonomyLabTab>('objectives');
  const [newTitle, setNewTitle] = React.useState('');
  const [newDir, setNewDir] = React.useState('');
  const [newSessionId, setNewSessionId] = React.useState('');
  const [newVerifyCmd, setNewVerifyCmd] = React.useState('');
  const [newMode, setNewMode] = React.useState<'finite' | 'ongoing'>('ongoing');
  const [newCadenceSec, setNewCadenceSec] = React.useState(30);
  const [newMaxParallel, setNewMaxParallel] = React.useState(2);
  const [newUseWorktrees, setNewUseWorktrees] = React.useState(false);
  const [continueNote, setContinueNote] = React.useState('');
  const [editVerifyCmd, setEditVerifyCmd] = React.useState('');
  const [sourceName, setSourceName] = React.useState('');
  const [sourceLocation, setSourceLocation] = React.useState('');
  const [sourceKind, setSourceKind] = React.useState<ResearchSourceKind>('directory');
  const [researchQuery, setResearchQuery] = React.useState('');
  const [memoryQuery, setMemoryQuery] = React.useState('');
  const [busyAction, setBusyAction] = React.useState(false);

  const data = useAutonomyLabData(tab, isOpen);

  if (!isOpen) return null;

  const handleCreateObjective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setBusyAction(true);
    try {
      await autonomyLabApi.createObjective({
        title: newTitle.trim(),
        description: newTitle.trim(),
        directory: newDir.trim() || undefined,
        sessionId: newSessionId.trim() || undefined,
        mode: newMode,
        useWorktrees: newUseWorktrees,
        verificationCommands: newVerifyCmd.trim() ? [newVerifyCmd.trim()] : [],
        budget: newMode === 'ongoing'
          ? { reviewIntervalMs: newCadenceSec * 1000, maxTurns: null, maxParallel: newMaxParallel }
          : { maxParallel: newMaxParallel },
      });
      setNewTitle('');
      setNewVerifyCmd('');
      await data.refresh('objectives');
    } catch (err) {
      data.setError(err instanceof Error ? err.message : 'Failed to create objective');
    } finally {
      setBusyAction(false);
    }
  };

  const handleContinueObjective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data.selectedObjective) return;
    setBusyAction(true);
    try {
      await autonomyLabApi.continueObjective(data.selectedObjective.id, continueNote.trim());
      setContinueNote('');
      await data.refresh('objectives');
    } catch (err) {
      data.setError(err instanceof Error ? err.message : 'Failed to send continuation');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveVerifyCmd = async (id: string, cmdText: string) => {
    setBusyAction(true);
    try {
      const cleaned = cmdText.trim();
      await autonomyLabApi.updateObjective(id, { verificationCommands: cleaned ? [cleaned] : [] });
      setEditVerifyCmd('');
      await data.refresh('objectives');
    } catch (err) {
      data.setError(err instanceof Error ? err.message : 'Failed to update verification command');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSelectTargetSession = (sessionId: string) => {
    setNewSessionId(sessionId);
    const matched = data.sessions.find((s) => s.id === sessionId);
    if (matched?.directory && !newDir.trim()) {
      setNewDir(matched.directory);
    }
  };

  const handleObjectiveAction = async (id: string, action: 'pause' | 'resume' | 'cancel' | 'verify' | 'run-now') => {
    setBusyAction(true);
    try {
      await autonomyLabApi.actionObjective(id, action);
      await data.refresh('objectives');
    } catch (err) {
      data.setError(err instanceof Error ? err.message : `Action ${action} failed`);
    } finally {
      setBusyAction(false);
    }
  };

  const handleAttachSession = async (id: string, sessionId: string) => {
    setBusyAction(true);
    try {
      await autonomyLabApi.attachSession(id, sessionId.trim() || null);
      await data.refresh('objectives');
    } catch (err) {
      data.setError(err instanceof Error ? err.message : 'Failed to attach chat session');
    } finally {
      setBusyAction(false);
    }
  };

  const handleStopTeam = async (teamId: string) => {
    setBusyAction(true);
    try {
      await autonomyLabApi.stopTeam(teamId);
      await data.refresh('objectives');
    } catch (err) {
      data.setError(err instanceof Error ? err.message : 'Failed to stop team');
    } finally {
      setBusyAction(false);
    }
  };

  const handleClearCooldowns = async () => {
    setBusyAction(true);
    try {
      await autonomyLabApi.clearCooldowns();
      await data.refresh(tab);
    } catch (err) {
      data.setError(err instanceof Error ? err.message : 'Failed to clear provider cooldowns');
    } finally {
      setBusyAction(false);
    }
  };

  const handleConsolidateMemories = async () => {
    setBusyAction(true);
    try {
      await autonomyLabApi.consolidateMemories();
      await data.refresh('memory');
    } catch (err) {
      data.setError(err instanceof Error ? err.message : 'Failed to consolidate memories');
    } finally {
      setBusyAction(false);
    }
  };

  const handleRegisterSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceLocation.trim()) return;
    setBusyAction(true);
    try {
      await autonomyLabApi.registerSource({
        name: sourceName.trim() || sourceLocation.trim(),
        kind: sourceKind,
        location: sourceLocation.trim(),
        offlineOnly: sourceKind !== 'url',
      });
      setSourceName('');
      setSourceLocation('');
      await data.refresh('research');
    } catch (err) {
      data.setError(err instanceof Error ? err.message : 'Failed to register source');
    } finally {
      setBusyAction(false);
    }
  };

  const activeCooldowns = data.coordinator?.cooldowns ?? [];
  const activeFailovers = data.coordinator?.activeFailovers ?? [];
  const freeZenModels = data.coordinator?.freeZenModels ?? [];

  return (
    <div className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="typography-ui-header font-semibold text-foreground">Autonomy &amp; Research Lab</h1>
          <nav className="flex items-center gap-1 rounded-lg border border-border bg-surface-muted p-0.5" aria-label="Autonomy Lab sections">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 typography-micro font-medium transition-colors',
                  tab === item.id ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon name={item.icon} className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {activeCooldowns.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleClearCooldowns()}
              disabled={busyAction}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--status-info-border)] bg-[var(--status-info-background)] px-2.5 py-1 typography-micro text-[var(--status-info)]"
              title="Provider rate-limit cooldown active — click to retry immediately"
            >
              <span>{activeCooldowns.length} quota wait</span>
              <span className="underline">Wake now</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void data.refresh(tab)}
            disabled={data.loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 typography-micro text-foreground hover:bg-interactive-hover/50"
          >
            <Icon name="refresh" className={cn('h-3.5 w-3.5', data.loading && 'animate-spin')} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => useUIStore.getState().setAutonomyLabOpen(false)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground"
            aria-label="Close Autonomy Lab"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      </header>

      {data.error ? (
        <div className="mx-5 mt-3 rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-3 py-2 typography-meta text-[var(--status-error)]">
          {data.error}
        </div>
      ) : null}

      <ScrollableOverlay className="min-h-0 flex-1 px-5 py-4">
        {tab === 'objectives' ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <section className="space-y-4 lg:col-span-5">
              <form onSubmit={handleCreateObjective} className="space-y-2.5 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <h2 className="typography-ui-label font-semibold">New Autonomous Objective</h2>
                  <button
                    type="button"
                    onClick={async () => { await autonomyLabApi.emergencyStop(); await data.refresh('objectives'); }}
                    className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-2 py-0.5 typography-micro text-[var(--status-error)]"
                  >
                    Emergency Stop All
                  </button>
                </div>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Objective title & measurable goal..."
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 typography-meta"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newDir}
                    onChange={(e) => setNewDir(e.target.value)}
                    placeholder="Project directory (optional)"
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 typography-micro"
                  />
                  <select
                    value={newMode}
                    onChange={(e) => setNewMode(e.target.value === 'ongoing' ? 'ongoing' : 'finite')}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 typography-micro"
                  >
                    <option value="ongoing">Ongoing autonomous (unlimited turns)</option>
                    <option value="finite">Finite objective (stops on verified pass)</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={data.sessions.some((s) => s.id === newSessionId) ? newSessionId : ''}
                    onChange={(e) => handleSelectTargetSession(e.target.value)}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 typography-micro"
                  >
                    <option value="">Target chat: Auto-create new</option>
                    {data.sessions.map((s) => (
                      <option key={s.id} value={s.id}>{s.title.slice(0, 42)} ({s.id.slice(0, 10)})</option>
                    ))}
                  </select>
                  <input
                    value={newSessionId}
                    onChange={(e) => setNewSessionId(e.target.value)}
                    placeholder="Or paste session ID (ses_...)"
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 typography-micro"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newVerifyCmd}
                    onChange={(e) => setNewVerifyCmd(e.target.value)}
                    placeholder="Verification cmd (optional, e.g. bun test)"
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 typography-micro"
                  />
                  {newMode === 'ongoing' ? (
                    <select
                      value={newCadenceSec}
                      onChange={(e) => setNewCadenceSec(Number(e.target.value) || 30)}
                      className="rounded-md border border-border bg-background px-2.5 py-1.5 typography-micro"
                    >
                      <option value={15}>Review every 15s (continuous)</option>
                      <option value={30}>Review every 30s (fast)</option>
                      <option value={60}>Review every 1 min</option>
                      <option value={300}>Review every 5 min</option>
                      <option value={900}>Review every 15 min</option>
                      <option value={3600}>Review every 60 min</option>
                    </select>
                  ) : (
                    <div className="flex items-center rounded-md border border-dashed border-border px-2.5 py-1.5 typography-micro text-muted-foreground">
                      Completes only when checks pass
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="typography-micro text-muted-foreground">Parallel workers:</span>
                    <select
                      value={newMaxParallel}
                      onChange={(e) => setNewMaxParallel(Number(e.target.value) || 2)}
                      className="rounded-md border border-border bg-background px-2 py-1 typography-micro"
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                      <option value={4}>4</option>
                      <option value={6}>6</option>
                    </select>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 typography-micro text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={newUseWorktrees}
                      onChange={(e) => setNewUseWorktrees(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span>Git worktree isolation</span>
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={busyAction || !newTitle.trim()}
                  className="w-full rounded-md bg-primary px-3 py-1.5 typography-meta font-medium text-primary-foreground disabled:opacity-50"
                >
                  Create &amp; Start Objective
                </button>
              </form>

              {data.teams.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                  <h3 className="typography-micro font-semibold uppercase tracking-wide text-muted-foreground">
                    AI Teams ({data.teams.length})
                  </h3>
                  {data.teams.map((team) => (
                    <div key={team.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate typography-micro font-medium">{team.name}</p>
                        <p className="typography-micro text-muted-foreground">
                          {team.status} · {team.members?.length ?? team.memberCount ?? 0} chats
                        </p>
                      </div>
                      {team.status !== 'stopped' ? (
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => void handleStopTeam(team.id)}
                          className="rounded-md border border-[var(--status-error-border)] px-2 py-0.5 typography-micro text-[var(--status-error)] hover:bg-[var(--status-error-background)]"
                        >
                          Stop Team
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="space-y-2">
                {data.objectives.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center typography-meta text-muted-foreground">
                    No autonomous objectives yet. Create one above to start persistent supervised execution.
                  </div>
                ) : data.objectives.map((obj) => {
                  const isWaitingQuota = obj.waitingReason === 'waiting_provider';
                  const badgeKey = isWaitingQuota ? 'waiting_provider' : obj.status;
                  const badgeText = isWaitingQuota ? 'waiting quota' : obj.status;
                  const wakeLabel = formatWakeTime(obj.waitingUntil ?? obj.nextReviewAt);
                  return (
                    <button
                      key={obj.id}
                      type="button"
                      onClick={() => void data.selectObjective(obj.id)}
                      className={cn(
                        'w-full rounded-xl border p-3 text-start transition-colors',
                        data.selectedObjective?.id === obj.id ? 'border-ring bg-surface-elevated' : 'border-border bg-card hover:bg-interactive-hover/30',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate typography-ui-label font-medium">{obj.title}</span>
                        <span className={cn('rounded-full border px-2 py-0.5 typography-micro', getStatusBadge(badgeKey))}>
                          {badgeText}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 typography-micro text-muted-foreground">
                        <span>Phase: {obj.loopPhase}</span>
                        <span>Mode: {obj.mode}</span>
                        <span>Turns: {formatTurns(obj.turnsUsed, obj.budget?.maxTurns, obj.mode)}</span>
                        {wakeLabel && (isWaitingQuota || obj.status === 'waiting') ? (
                          <span>Wake: {wakeLabel}</span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-4 lg:col-span-7">
              {data.selectedObjective ? (
                <div className="space-y-4 rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="typography-ui-header font-semibold">{data.selectedObjective.title}</h2>
                      <p className="typography-micro text-muted-foreground">
                        {data.selectedObjective.directory}
                        {data.selectedObjective.useWorktrees ? ' · Worktree-isolated' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => void handleObjectiveAction(data.selectedObjective!.id, 'run-now')} className="rounded-md border border-border px-2.5 py-1 typography-micro hover:bg-interactive-hover/50">Run Turn Now</button>
                      <button type="button" onClick={() => void handleObjectiveAction(data.selectedObjective!.id, 'verify')} className="rounded-md border border-border px-2.5 py-1 typography-micro hover:bg-interactive-hover/50">Verify Now</button>
                      {data.selectedObjective.status === 'active' ? (
                        <button type="button" onClick={() => void handleObjectiveAction(data.selectedObjective!.id, 'pause')} className="rounded-md border border-border px-2.5 py-1 typography-micro hover:bg-interactive-hover/50">Pause</button>
                      ) : (
                        <button type="button" onClick={() => void handleObjectiveAction(data.selectedObjective!.id, 'resume')} className="rounded-md border border-border px-2.5 py-1 typography-micro hover:bg-interactive-hover/50">Resume</button>
                      )}
                      <button type="button" onClick={() => void handleObjectiveAction(data.selectedObjective!.id, 'cancel')} className="rounded-md border border-[var(--status-error-border)] px-2.5 py-1 typography-micro text-[var(--status-error)]">Cancel</button>
                    </div>
                  </div>

                  {data.selectedObjective.waitingReason === 'waiting_provider' ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--status-info-border)] bg-[var(--status-info-background)] px-3 py-2 typography-micro text-[var(--status-info)]">
                      <span>
                        Execution state preserved while waiting for provider quota replenishment
                        {formatWakeTime(data.selectedObjective.waitingUntil) ? ` (resumes automatically at ${formatWakeTime(data.selectedObjective.waitingUntil)})` : ''}.
                        No retry attempts were consumed.
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleObjectiveAction(data.selectedObjective!.id, 'resume')}
                        className="shrink-0 rounded border border-[var(--status-info-border)] px-2 py-0.5 font-medium"
                      >
                        Resume Now
                      </button>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                    <span className="typography-micro text-muted-foreground">Target Chat:</span>
                    <select
                      value={data.selectedObjective.sessionId ?? ''}
                      onChange={(e) => void handleAttachSession(data.selectedObjective!.id, e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 typography-micro"
                    >
                      <option value="">Auto-create dedicated chat</option>
                      {data.selectedObjective.sessionId && !data.sessions.some((s) => s.id === data.selectedObjective?.sessionId) ? (
                        <option value={data.selectedObjective.sessionId}>{data.selectedObjective.sessionId}</option>
                      ) : null}
                      {data.sessions.map((s) => (
                        <option key={s.id} value={s.id}>{s.title.slice(0, 48)} ({s.id.slice(0, 12)})</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                    <span className="typography-micro text-muted-foreground">Verification Cmd:</span>
                    <input
                      value={editVerifyCmd}
                      onChange={(e) => setEditVerifyCmd(e.target.value)}
                      placeholder={data.selectedObjective.verificationCommands[0] || 'None (informational research only)'}
                      className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 typography-micro"
                    />
                    <button
                      type="button"
                      disabled={busyAction || !editVerifyCmd.trim()}
                      onClick={() => void handleSaveVerifyCmd(data.selectedObjective!.id, editVerifyCmd)}
                      className="rounded-md border border-border px-2 py-1 typography-micro hover:bg-interactive-hover/50 disabled:opacity-50"
                    >
                      Set
                    </button>
                    {data.selectedObjective.verificationCommands.length > 0 ? (
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => void handleSaveVerifyCmd(data.selectedObjective!.id, '')}
                        className="rounded-md border border-border px-2 py-1 typography-micro text-muted-foreground hover:bg-interactive-hover/50"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>

                  <form onSubmit={handleContinueObjective} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-2">
                    <input
                      value={continueNote}
                      onChange={(e) => setContinueNote(e.target.value)}
                      placeholder="Optional guidance note for next autonomous turn..."
                      className="min-w-0 flex-1 rounded-md border border-border bg-card px-2.5 py-1 typography-micro"
                    />
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="rounded-md bg-primary px-3 py-1 typography-micro font-medium text-primary-foreground disabled:opacity-50"
                    >
                      Continue / Steer
                    </button>
                  </form>

                  {data.selectedObjective.lastError ? (
                    <p className="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] px-3 py-1.5 typography-micro text-[var(--status-warning)]">
                      {data.selectedObjective.lastError}
                    </p>
                  ) : null}

                  <div>
                    <h3 className="mb-2 typography-micro font-semibold uppercase tracking-wide text-muted-foreground">Tasks ({data.selectedObjective.tasks.length})</h3>
                    <div className="space-y-1.5">
                      {data.selectedObjective.tasks.length === 0 ? (
                        <p className="typography-micro text-muted-foreground">No tasks queued yet.</p>
                      ) : data.selectedObjective.tasks.map((task) => (
                        <div key={task.id} className="space-y-1 rounded-lg border border-border bg-background px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate typography-meta font-medium">{task.title}</p>
                              <p className="typography-micro text-muted-foreground">
                                Role: {task.role} · Kind: {task.kind} · Attempts: {task.attempts}/{task.maxAttempts}
                                {task.providerWaits ? ` · Quota waits: ${task.providerWaits}` : ''}
                                {task.worktreePath ? ' · Worktree' : ''}
                              </p>
                            </div>
                            <span className={cn('rounded-full border px-2 py-0.5 typography-micro', getStatusBadge(task.status))}>{task.status}</span>
                          </div>
                          {task.error ? (
                            <p className="rounded border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-2 py-1 typography-micro text-[var(--status-error)]">
                              Error: {task.error}
                            </p>
                          ) : null}
                          {task.result ? (
                            <p className="line-clamp-3 rounded bg-surface-muted px-2 py-1 typography-micro text-muted-foreground">
                              {task.result}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  {data.selectedObjective.checkpoints && data.selectedObjective.checkpoints.length > 0 ? (
                    <div>
                      <h3 className="mb-2 typography-micro font-semibold uppercase tracking-wide text-muted-foreground">
                        Durable Checkpoints ({data.selectedObjective.checkpoints.length})
                      </h3>
                      <div className="space-y-1">
                        {data.selectedObjective.checkpoints.slice(0, 4).map((chk) => (
                          <div key={chk.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-2.5 py-1.5 typography-micro">
                            <span className="truncate">{chk.summary}</span>
                            <span className="shrink-0 text-muted-foreground">{chk.kind}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {data.selectedObjective.decisions.length > 0 ? (
                    <div>
                      <h3 className="mb-2 typography-micro font-semibold uppercase tracking-wide text-muted-foreground">Recent Activity ({data.selectedObjective.decisions.length})</h3>
                      <div className="space-y-1">
                        {data.selectedObjective.decisions.slice(0, 6).map((dec) => (
                          <div key={dec.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-2.5 py-1.5 typography-micro">
                            <span className="truncate">{dec.summary}</span>
                            <span className="shrink-0 text-muted-foreground">{dec.kind}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <h3 className="mb-2 typography-micro font-semibold uppercase tracking-wide text-muted-foreground">Verification Evidence ({data.selectedObjective.verifications.length})</h3>
                    <div className="space-y-1.5">
                      {data.selectedObjective.verifications.length === 0 ? (
                        <p className="typography-micro text-muted-foreground">No verification runs recorded yet.</p>
                      ) : data.selectedObjective.verifications.map((ver) => (
                        <div key={ver.id} className="rounded-lg border border-border bg-background px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="typography-meta">{ver.summary}</span>
                            <span className={cn('rounded-full border px-2 py-0.5 typography-micro', getStatusBadge(ver.status))}>{ver.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-8 text-center typography-meta text-muted-foreground">
                  Select an objective to inspect its task DAG, durable checkpoints, decisions, and verification evidence.
                </div>
              )}
            </section>
          </div>
        ) : null}

        {tab !== 'objectives' ? (
          <AutonomySecondaryPanels
            tab={tab}
            busyAction={busyAction}
            sourceName={sourceName}
            setSourceName={setSourceName}
            sourceKind={sourceKind}
            setSourceKind={setSourceKind}
            sourceLocation={sourceLocation}
            setSourceLocation={setSourceLocation}
            onRegisterSource={handleRegisterSource}
            researchQuery={researchQuery}
            setResearchQuery={setResearchQuery}
            onSearchResearch={data.searchResearch}
            searchHits={data.searchHits}
            sources={data.sources}
            onRefreshResearch={async () => { await data.refresh('research'); }}
            memoryTier={data.memoryTier}
            setMemoryTier={data.setMemoryTier}
            memoryQuery={memoryQuery}
            setMemoryQuery={setMemoryQuery}
            onSearchMemories={data.searchMemories}
            onConsolidateMemories={handleConsolidateMemories}
            memories={data.memories}
            diagnostics={data.diagnostics}
            coordinator={data.coordinator}
            activeCooldowns={activeCooldowns}
            activeFailovers={activeFailovers}
            freeZenModels={freeZenModels}
            onClearCooldowns={handleClearCooldowns}
            getStatusBadge={getStatusBadge}
            formatWakeTime={formatWakeTime}
          />
        ) : null}
      </ScrollableOverlay>
    </div>
  );
};
