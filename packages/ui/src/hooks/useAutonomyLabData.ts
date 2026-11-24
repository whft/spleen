import React from 'react';
import {
  autonomyLabApi,
  type ActiveTeamSummary,
  type AutonomyObjective,
  type AutonomyObjectiveDetail,
  type AutonomySessionSummary,
  type CoordinatorOverview,
  type DiagnosticsOverview,
  type MemFsEntry,
  type ResearchSearchHit,
  type ResearchSource,
} from '@/lib/autonomy/api';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';
import { useUIStore } from '@/stores/useUIStore';

export type AutonomyLabTab = 'objectives' | 'research' | 'memory' | 'diagnostics';

export function useAutonomyLabData(activeTab: AutonomyLabTab, isOpen = true) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [objectives, setObjectives] = React.useState<AutonomyObjective[]>([]);
  const [selectedObjective, setSelectedObjective] = React.useState<AutonomyObjectiveDetail | null>(null);
  const [sessions, setSessions] = React.useState<AutonomySessionSummary[]>([]);
  const [teams, setTeams] = React.useState<ActiveTeamSummary[]>([]);
  const [coordinator, setCoordinator] = React.useState<CoordinatorOverview | null>(null);
  const [sources, setSources] = React.useState<ResearchSource[]>([]);
  const [searchHits, setSearchHits] = React.useState<ResearchSearchHit[]>([]);
  const [memories, setMemories] = React.useState<MemFsEntry[]>([]);
  const [memoryTier, setMemoryTier] = React.useState<string>('all');
  const [diagnostics, setDiagnostics] = React.useState<DiagnosticsOverview | null>(null);

  const refresh = React.useCallback(async (tab: AutonomyLabTab = activeTab, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      if (tab === 'objectives') {
        const [list, sessionList, teamList, coord] = await Promise.all([
          autonomyLabApi.listObjectives(),
          autonomyLabApi.listSessions().catch(() => []),
          autonomyLabApi.listTeams().catch(() => []),
          autonomyLabApi.getCoordinator().catch(() => null),
        ]);
        setObjectives(list);
        setSessions(sessionList);
        setTeams(teamList);
        setCoordinator(coord);
        if (list.length > 0) {
          const targetId = selectedObjective?.id && list.some((o) => o.id === selectedObjective.id)
            ? selectedObjective.id
            : list[0].id;
          setSelectedObjective(await autonomyLabApi.getObjective(targetId));
        } else {
          setSelectedObjective(null);
        }
      } else if (tab === 'research') {
        setSources(await autonomyLabApi.listSources());
      } else if (tab === 'memory') {
        setMemories(await autonomyLabApi.listMemories(undefined, memoryTier));
      } else if (tab === 'diagnostics') {
        const [diag, coord] = await Promise.all([
          autonomyLabApi.getDiagnostics(),
          autonomyLabApi.getCoordinator().catch(() => null),
        ]);
        setDiagnostics(diag);
        setCoordinator(coord);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeTab, memoryTier, selectedObjective?.id]);

  React.useEffect(() => {
    if (!isOpen) return;
    void refresh(activeTab);
  }, [activeTab, isOpen, memoryTier, refresh]);

  React.useEffect(() => {
    if (!isOpen) return;
    const unsubscribe = subscribeSpleenEvents((event) => {
      if (
        event.type.startsWith('autonomy:')
        || event.type.startsWith('team:')
        || event.type.startsWith('spleen:recovery')
        || event.type.startsWith('spleen:provider-cooldown')
        || event.type === 'recovery'
        || event.type === 'event-stream-ready'
      ) {
        void refresh(activeTab, true);
      }
    });
    const onFocus = () => { void refresh(activeTab, true); };
    window.addEventListener('focus', onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [activeTab, isOpen, refresh]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        useUIStore.getState().setAutonomyLabOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const selectObjective = React.useCallback(async (id: string) => {
    try {
      setSelectedObjective(await autonomyLabApi.getObjective(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load objective');
    }
  }, []);

  const searchResearch = React.useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchHits([]);
      return;
    }
    try {
      setSearchHits(await autonomyLabApi.searchResearch(query));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
  }, []);

  const searchMemories = React.useCallback(async (query: string) => {
    try {
      setMemories(await autonomyLabApi.listMemories(query, memoryTier));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Memory search failed');
    }
  }, [memoryTier]);

  return {
    loading,
    error,
    setError,
    objectives,
    selectedObjective,
    sessions,
    teams,
    coordinator,
    sources,
    searchHits,
    memories,
    memoryTier,
    setMemoryTier,
    diagnostics,
    refresh,
    selectObjective,
    searchResearch,
    searchMemories,
  };
}
