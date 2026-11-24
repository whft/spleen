import React from 'react';
import { cn } from '@/lib/utils';
import {
  autonomyLabApi,
  type ActiveModelFailover,
  type CoordinatorOverview,
  type DiagnosticsOverview,
  type FreeZenModelItem,
  type MemFsEntry,
  type ProviderCooldownItem,
  type ResearchSearchHit,
  type ResearchSource,
  type ResearchSourceKind,
} from '@/lib/autonomy/api';
import type { AutonomyLabTab } from '@/hooks/useAutonomyLabData';

const parseSourceKind = (value: string): ResearchSourceKind => {
  if (value === 'git' || value === 'file' || value === 'url') return value;
  return 'directory';
};

type SecondaryPanelsProps = {
  tab: AutonomyLabTab;
  busyAction: boolean;
  sourceName: string;
  setSourceName: (value: string) => void;
  sourceKind: ResearchSourceKind;
  setSourceKind: (value: ResearchSourceKind) => void;
  sourceLocation: string;
  setSourceLocation: (value: string) => void;
  onRegisterSource: (e: React.FormEvent) => Promise<void>;
  researchQuery: string;
  setResearchQuery: (value: string) => void;
  onSearchResearch: (query: string) => Promise<void>;
  searchHits: ResearchSearchHit[];
  sources: ResearchSource[];
  onRefreshResearch: () => Promise<void>;
  memoryTier: string;
  setMemoryTier: (tier: string) => void;
  memoryQuery: string;
  setMemoryQuery: (value: string) => void;
  onSearchMemories: (query: string) => Promise<void>;
  onConsolidateMemories: () => Promise<void>;
  memories: MemFsEntry[];
  diagnostics: DiagnosticsOverview | null;
  coordinator: CoordinatorOverview | null;
  activeCooldowns: ProviderCooldownItem[];
  activeFailovers: ActiveModelFailover[];
  freeZenModels: FreeZenModelItem[];
  onClearCooldowns: () => Promise<void>;
  getStatusBadge: (status: string) => string;
  formatWakeTime: (epochMs?: number | null) => string | null;
};

export const AutonomySecondaryPanels: React.FC<SecondaryPanelsProps> = ({
  tab,
  busyAction,
  sourceName,
  setSourceName,
  sourceKind,
  setSourceKind,
  sourceLocation,
  setSourceLocation,
  onRegisterSource,
  researchQuery,
  setResearchQuery,
  onSearchResearch,
  searchHits,
  sources,
  onRefreshResearch,
  memoryTier,
  setMemoryTier,
  memoryQuery,
  setMemoryQuery,
  onSearchMemories,
  onConsolidateMemories,
  memories,
  diagnostics,
  coordinator,
  activeCooldowns,
  activeFailovers,
  freeZenModels,
  onClearCooldowns,
  getStatusBadge,
  formatWakeTime,
}) => {
  if (tab === 'research') {
    return (
      <div className="space-y-4">
        <form onSubmit={onRegisterSource} className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 md:grid-cols-12">
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
            onKeyDown={(e) => { if (e.key === 'Enter') void onSearchResearch(researchQuery); }}
            placeholder="Search indexed sources with citations (prompt-injection quarantined)..."
            className="flex-1 rounded-md border border-border bg-card px-3 py-1.5 typography-meta"
          />
          <button type="button" onClick={() => void onSearchResearch(researchQuery)} className="rounded-md border border-border bg-card px-3 py-1.5 typography-micro hover:bg-interactive-hover/50">Search</button>
        </div>

        {searchHits.length > 0 ? (
          <div className="space-y-2">
            {searchHits.map((hit) => (
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
          {sources.map((src) => (
            <div key={src.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
              <div className="min-w-0">
                <p className="truncate typography-ui-label font-medium">{src.name}</p>
                <p className="truncate typography-micro text-muted-foreground">{src.kind} · {src.location} · {src.docCount} doc(s){src.branch ? ` · ${src.branch}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('rounded-full border px-2 py-0.5 typography-micro', getStatusBadge(src.status))}>{src.status}</span>
                <button type="button" onClick={async () => { await autonomyLabApi.refreshSource(src.id); await onRefreshResearch(); }} className="rounded-md border border-border px-2 py-1 typography-micro hover:bg-interactive-hover/50">Refresh</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'memory') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'working', 'episodic', 'semantic', 'procedural', 'artifact'] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setMemoryTier(tier)}
              className={cn(
                'rounded-full border px-3 py-1 typography-micro capitalize',
                memoryTier === tier ? 'border-ring bg-surface-elevated text-foreground' : 'border-border bg-card text-muted-foreground',
              )}
            >
              {tier}
            </button>
          ))}
          <button
            type="button"
            disabled={busyAction}
            onClick={() => void onConsolidateMemories()}
            className="rounded-md border border-border bg-card px-2.5 py-1 typography-micro hover:bg-interactive-hover/50"
          >
            Consolidate Verified Episodes
          </button>
          <input
            value={memoryQuery}
            onChange={(e) => setMemoryQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void onSearchMemories(memoryQuery); }}
            placeholder="Search MemFS (hybrid FTS5 + recency + importance)..."
            className="ms-auto min-w-[14rem] rounded-md border border-border bg-card px-3 py-1 typography-micro"
          />
        </div>

        <div className="space-y-2">
          {memories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center typography-meta text-muted-foreground">
              No tiered MemFS memories recorded for this filter yet.
            </div>
          ) : memories.map((mem) => (
            <div key={mem.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="typography-ui-label font-medium">{mem.title}</span>
                  <span className="rounded border border-border px-1.5 py-0.5 typography-micro text-muted-foreground">
                    {mem.tier} · {mem.scope} · {mem.originClass ?? 'agent'} · v{mem.version}
                    {mem.recallCount ? ` · ${mem.recallCount} recalls` : ''}
                  </span>
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
    );
  }

  if (tab === 'diagnostics') {
    return (
      <div className="space-y-4">
        {diagnostics ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="typography-micro text-muted-foreground">Server Runtime</p>
              <p className="mt-1 typography-ui-header font-semibold">{diagnostics.memoryMb} MB RSS</p>
              <p className="typography-micro text-muted-foreground">Uptime: {diagnostics.uptimeSec}s</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="typography-micro text-muted-foreground">Autonomous Supervisor</p>
              <p className="mt-1 typography-ui-header font-semibold">{diagnostics.autonomy.running ? 'Running' : 'Stopped'}</p>
              <p className="typography-micro text-muted-foreground">
                Objectives: {diagnostics.autonomy.totalObjectives} · Active: {diagnostics.autonomy.counts.active ?? 0} · In-flight tasks: {diagnostics.autonomy.inFlightTasks ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="typography-micro text-muted-foreground">MemFS &amp; Research</p>
              <p className="mt-1 typography-ui-header font-semibold">{diagnostics.memfs.total} Memories · {diagnostics.research.sources} Sources</p>
              <p className="typography-micro text-muted-foreground">Verified: {diagnostics.memfs.verified} · Contradictions: {diagnostics.memfs.contradicted}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 typography-meta text-muted-foreground">
            Loading diagnostics...
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="typography-ui-label font-semibold">Execution Coordinator Lanes</h3>
              <span className="typography-micro text-muted-foreground">
                {coordinator?.activeSessions.length ?? 0} active session lock(s)
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(coordinator?.lanes ?? {}).map(([laneName, lane]) => (
                <div key={laneName} className="rounded-lg border border-border bg-background px-2.5 py-2">
                  <p className="typography-micro font-medium capitalize">{laneName}</p>
                  <p className="typography-micro text-muted-foreground">
                    Active: {lane.active}/{lane.limit} · Queued: {lane.queued}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="typography-ui-label font-semibold">OpenCode Zen Free Pool &amp; Cooldowns</h3>
              {activeCooldowns.length > 0 ? (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void onClearCooldowns()}
                  className="rounded-md border border-border px-2 py-0.5 typography-micro hover:bg-interactive-hover/50"
                >
                  Clear Cooldowns
                </button>
              ) : null}
            </div>
            <p className="typography-micro text-muted-foreground">
              Verified $0-cost Zen models discovered: {freeZenModels.length > 0 ? freeZenModels.map((m) => m.id).join(', ') : 'auto-discovered on catalog connect'}
            </p>
            {activeCooldowns.length === 0 && activeFailovers.length === 0 ? (
              <p className="typography-micro text-muted-foreground">No active provider cooldowns or model failovers.</p>
            ) : (
              <div className="space-y-1.5">
                {activeCooldowns.map((cd) => (
                  <div key={cd.scopeKey} className="flex items-center justify-between rounded border border-border bg-background px-2.5 py-1.5 typography-micro">
                    <span className="truncate">{cd.providerID}{cd.modelID ? `/${cd.modelID}` : ''} · {cd.errorType ?? 'limit'}</span>
                    <span className="shrink-0 text-muted-foreground">resets {formatWakeTime(cd.resetAt)}</span>
                  </div>
                ))}
                {activeFailovers.map((fo) => (
                  <div key={fo.sessionID} className="flex items-center justify-between rounded border border-border bg-background px-2.5 py-1.5 typography-micro">
                    <span className="truncate">{fo.sessionID.slice(0, 12)}: {fo.originalModelID} → {fo.activeModelID}</span>
                    <span className="shrink-0 text-muted-foreground">restores {formatWakeTime(fo.restoreAfter)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
};
