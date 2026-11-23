import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { cn } from '@/lib/utils';
import { autonomyLabApi, type ResearchSourceKind } from '@/lib/autonomy/api';
import { useUIStore } from '@/stores/useUIStore';
import { useAutonomyLabData, type AutonomyLabTab } from '@/hooks/useAutonomyLabData';

const STATUS_BADGE = {
  active: 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
  completed: 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
  passed: 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
  verified: 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
  ready: 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
  paused: 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]',
  waiting: 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]',
  stale: 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]',
  unverified: 'border-border bg-surface-muted text-muted-foreground',
  blocked: 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]',
  failed: 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]',
  contradicted: 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]',
  error: 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]',
  cancelled: 'border-border bg-surface-muted text-muted-foreground',
} as const;

const STATUS_BADGE_MAP = new Map<string, string>(Object.entries(STATUS_BADGE));

const getStatusBadge = (status: string): string => STATUS_BADGE_MAP.get(status) ?? STATUS_BADGE.unverified;

const parseSourceKind = (value: string): ResearchSourceKind => {
  if (value === 'git' || value === 'file' || value === 'url') return value;
  return 'directory';
};

const TABS: ReadonlyArray<{ id: AutonomyLabTab; label: string; icon: 'compass-3' | 'search' | 'archive' | 'bar-chart' }> = [
  { id: 'objectives', label: 'Autonomy Center', icon: 'compass-3' },
  { id: 'research', label: 'Research Library', icon: 'search' },
  { id: 'memory', label: 'MemFS Learning', icon: 'archive' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'bar-chart' },
];

export const AutonomyLabView: React.FC = () => {
  const [tab, setTab] = React.useState<AutonomyLabTab>('objectives');
  const [newTitle, setNewTitle] = React.useState('');
  const [newDir, setNewDir] = React.useState('');
  const [newVerifyCmd, setNewVerifyCmd] = React.useState('');
  const [newMode, setNewMode] = React.useState<'finite' | 'ongoing'>('finite');
  const [sourceName, setSourceName] = React.useState('');
  const [sourceLocation, setSourceLocation] = React.useState('');
  const [sourceKind, setSourceKind] = React.useState<'directory' | 'git' | 'file' | 'url'>('directory');
  const [researchQuery, setResearchQuery] = React.useState('');
  const [memoryQuery, setMemoryQuery] = React.useState('');
  const [busyAction, setBusyAction] = React.useState(false);

  const data = useAutonomyLabData(tab);

  const handleCreateObjective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setBusyAction(true);
    try {
      await autonomyLabApi.createObjective({
        title: newTitle.trim(),
        description: newTitle.trim(),
        directory: newDir.trim() || undefined,
        mode: newMode,
        verificationCommands: newVerifyCmd.trim() ? [newVerifyCmd.trim()] : [],
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

  const handleObjectiveAction = async (id: string, action: 'pause' | 'resume' | 'cancel' | 'verify') => {
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
                    <option value="finite">Finite objective</option>
                    <option value="ongoing">Ongoing research</option>
                  </select>
                </div>
                <input
                  value={newVerifyCmd}
                  onChange={(e) => setNewVerifyCmd(e.target.value)}
                  placeholder="Verification command (e.g. bun test)"
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 typography-micro"
                />
                <button
                  type="submit"
                  disabled={busyAction || !newTitle.trim()}
                  className="w-full rounded-md bg-primary px-3 py-1.5 typography-meta font-medium text-primary-foreground disabled:opacity-50"
                >
                  Create Objective
                </button>
              </form>

              <div className="space-y-2">
                {data.objectives.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center typography-meta text-muted-foreground">
                    No autonomous objectives yet. Create one above to start persistent supervised execution.
                  </div>
                ) : data.objectives.map((obj) => (
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
                      <span className={cn('rounded-full border px-2 py-0.5 typography-micro', getStatusBadge(obj.status))}>
                        {obj.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 typography-micro text-muted-foreground">
                      <span>Phase: {obj.loopPhase}</span>
                      <span>Mode: {obj.mode}</span>
                      <span>Turns: {obj.turnsUsed}/{obj.budget?.maxTurns ?? 25}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-4 lg:col-span-7">
              {data.selectedObjective ? (
                <div className="space-y-4 rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="typography-ui-header font-semibold">{data.selectedObjective.title}</h2>
                      <p className="typography-micro text-muted-foreground">{data.selectedObjective.directory}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => void handleObjectiveAction(data.selectedObjective!.id, 'verify')} className="rounded-md border border-border px-2.5 py-1 typography-micro hover:bg-interactive-hover/50">Verify Now</button>
                      {data.selectedObjective.status === 'active' ? (
                        <button type="button" onClick={() => void handleObjectiveAction(data.selectedObjective!.id, 'pause')} className="rounded-md border border-border px-2.5 py-1 typography-micro hover:bg-interactive-hover/50">Pause</button>
                      ) : (
                        <button type="button" onClick={() => void handleObjectiveAction(data.selectedObjective!.id, 'resume')} className="rounded-md border border-border px-2.5 py-1 typography-micro hover:bg-interactive-hover/50">Resume</button>
                      )}
                      <button type="button" onClick={() => void handleObjectiveAction(data.selectedObjective!.id, 'cancel')} className="rounded-md border border-[var(--status-error-border)] px-2.5 py-1 typography-micro text-[var(--status-error)]">Cancel</button>
                    </div>
                  </div>
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
                        <div key={task.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate typography-meta font-medium">{task.title}</p>
                            <p className="typography-micro text-muted-foreground">Role: {task.role} · Kind: {task.kind} · Attempts: {task.attempts}/{task.maxAttempts}</p>
                          </div>
                          <span className={cn('rounded-full border px-2 py-0.5 typography-micro', getStatusBadge(task.status))}>{task.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
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
                  Select an objective to inspect its task DAG, decisions, and verification evidence.
                </div>
              )}
            </section>
          </div>
        ) : null}

        {tab === 'research' ? (
          <div className="space-y-4">
            <form onSubmit={handleRegisterSource} className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 md:grid-cols-12">
              <input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="Source name" className="rounded-md border border-border bg-background px-2.5 py-1.5 typography-micro md:col-span-3" />
              <select value={sourceKind} onChange={(e) => setSourceKind(parseSourceKind(e.target.value))} className="rounded-md border border-border bg-background px-2.5 py-1.5 typography-micro md:col-span-2">
                <option value="directory">Directory</option>
                <option value="git">Git Repo</option>
                <option value="file">File</option>
                <option value="url">URL</option>
              </select>
              <input value={sourceLocation} onChange={(e) => setSourceLocation(e.target.value)} placeholder="Local path or https:// URL..." className="rounded-md border border-border bg-background px-2.5 py-1.5 typography-micro md:col-span-5" />
              <button type="submit" disabled={busyAction || !sourceLocation.trim()} className="rounded-md bg-primary px-3 py-1.5 typography-micro font-medium text-primary-foreground md:col-span-2">
                Index Source
              </button>
            </form>

            <div className="flex gap-2">
              <input
                value={researchQuery}
                onChange={(e) => setResearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void data.searchResearch(researchQuery); }}
                placeholder="Search indexed sources with citations (prompt-injection quarantined)..."
                className="flex-1 rounded-md border border-border bg-card px-3 py-1.5 typography-meta"
              />
              <button type="button" onClick={() => void data.searchResearch(researchQuery)} className="rounded-md border border-border bg-card px-3 py-1.5 typography-micro hover:bg-interactive-hover/50">Search</button>
            </div>

            {data.searchHits.length > 0 ? (
              <div className="space-y-2">
                {data.searchHits.map((hit) => (
                  <div key={hit.chunkId} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="typography-ui-label font-medium">{hit.title}</span>
                      <span className="typography-micro text-muted-foreground">{hit.citation.sourceName} · {hit.citation.pathOrUrl}</span>
                    </div>
                    <p className="mt-1 typography-micro text-muted-foreground">{hit.excerpt}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {data.sources.map((src) => (
                <div key={src.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
                  <div className="min-w-0">
                    <p className="truncate typography-ui-label font-medium">{src.name}</p>
                    <p className="truncate typography-micro text-muted-foreground">{src.kind} · {src.location} · {src.docCount} doc(s){src.branch ? ` · ${src.branch}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded-full border px-2 py-0.5 typography-micro', getStatusBadge(src.status))}>{src.status}</span>
                    <button type="button" onClick={async () => { await autonomyLabApi.refreshSource(src.id); await data.refresh('research'); }} className="rounded-md border border-border px-2 py-1 typography-micro hover:bg-interactive-hover/50">Refresh</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {tab === 'memory' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'working', 'episodic', 'semantic', 'procedural', 'artifact'] as const).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => data.setMemoryTier(tier)}
                  className={cn(
                    'rounded-full border px-3 py-1 typography-micro capitalize',
                    data.memoryTier === tier ? 'border-ring bg-surface-elevated text-foreground' : 'border-border bg-card text-muted-foreground',
                  )}
                >
                  {tier}
                </button>
              ))}
              <input
                value={memoryQuery}
                onChange={(e) => setMemoryQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void data.searchMemories(memoryQuery); }}
                placeholder="Search MemFS (FTS5)..."
                className="ms-auto min-w-[14rem] rounded-md border border-border bg-card px-3 py-1 typography-micro"
              />
            </div>

            <div className="space-y-2">
              {data.memories.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center typography-meta text-muted-foreground">
                  No tiered MemFS memories recorded for this filter yet.
                </div>
              ) : data.memories.map((mem) => (
                <div key={mem.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="typography-ui-label font-medium">{mem.title}</span>
                      <span className="rounded border border-border px-1.5 py-0.5 typography-micro text-muted-foreground">{mem.tier} · {mem.scope} · v{mem.version}</span>
                    </div>
                    <span className={cn('rounded-full border px-2 py-0.5 typography-micro', getStatusBadge(mem.verificationStatus))}>
                      {mem.verificationStatus} ({Math.round(mem.confidence * 100)}%)
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap typography-micro text-muted-foreground">{mem.body}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {tab === 'diagnostics' ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {data.diagnostics ? (
              <>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="typography-micro text-muted-foreground">Server Runtime</p>
                  <p className="mt-1 typography-ui-header font-semibold">{data.diagnostics.memoryMb} MB RSS</p>
                  <p className="typography-micro text-muted-foreground">Uptime: {data.diagnostics.uptimeSec}s</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="typography-micro text-muted-foreground">Autonomous Supervisor</p>
                  <p className="mt-1 typography-ui-header font-semibold">{data.diagnostics.autonomy.running ? 'Running' : 'Stopped'}</p>
                  <p className="typography-micro text-muted-foreground">Objectives: {data.diagnostics.autonomy.totalObjectives} · Active: {data.diagnostics.autonomy.counts.active ?? 0}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="typography-micro text-muted-foreground">MemFS &amp; Research</p>
                  <p className="mt-1 typography-ui-header font-semibold">{data.diagnostics.memfs.total} Memories · {data.diagnostics.research.sources} Sources</p>
                  <p className="typography-micro text-muted-foreground">Verified: {data.diagnostics.memfs.verified} · Contradictions: {data.diagnostics.memfs.contradicted}</p>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-6 typography-meta text-muted-foreground">
                Loading diagnostics...
              </div>
            )}
          </div>
        ) : null}
      </ScrollableOverlay>
    </div>
  );
};
