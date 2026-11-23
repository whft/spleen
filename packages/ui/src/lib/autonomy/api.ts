import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeUrlResolver } from '@/lib/runtime-url';

const apiFetch = (path: string, init?: RequestInit) => runtimeFetch(getRuntimeUrlResolver().api(path), init);

export type ResearchSourceKind = 'directory' | 'git' | 'file' | 'url';

export type AutonomyObjective = {
  id: string;
  title: string;
  description: string;
  directory: string;
  mode: 'finite' | 'ongoing';
  status: 'active' | 'paused' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  loopPhase: string;
  sessionId: string | null;
  turnsUsed: number;
  failureStreak: number;
  lastError: string | null;
  verificationCommands: string[];
  acceptanceCriteria: string[];
  budget: { maxTurns?: number; maxRuntimeMs?: number; maxParallel?: number; reviewIntervalMs?: number };
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type AutonomyObjectiveDetail = AutonomyObjective & {
  tasks: Array<{
    id: string;
    title: string;
    role: string;
    kind: string;
    status: string;
    dependsOn: string[];
    result: string | null;
    error: string | null;
    attempts: number;
    maxAttempts: number;
  }>;
  decisions: Array<{ id: string; kind: string; summary: string; createdAt: number }>;
  verifications: Array<{ id: string; status: string; summary: string; gitDiffSummary: string; createdAt: number }>;
};

export type ResearchSource = {
  id: string;
  name: string;
  kind: string;
  location: string;
  branch: string | null;
  commitSha: string | null;
  buildHash: string | null;
  buildVersion: string | null;
  status: string;
  docCount: number;
  lastIndexedAt: number | null;
  lastError: string | null;
};

export type ResearchSearchHit = {
  chunkId: string;
  title: string;
  excerpt: string;
  score: number;
  untrustedEvidence: boolean;
  citation: { sourceName: string; pathOrUrl: string; commitSha: string | null; buildHash: string | null };
};

export type MemFsEntry = {
  id: string;
  tier: 'working' | 'episodic' | 'semantic' | 'procedural' | 'artifact';
  scope: 'global' | 'project' | 'team' | 'agent';
  scopeId: string;
  title: string;
  body: string;
  tags: string[];
  confidence: number;
  verificationStatus: 'unverified' | 'verified' | 'contradicted' | 'stale';
  version: number;
  updatedAt: number;
};

export type DiagnosticSubsystems = {
  status?: string;
  running?: boolean;
  connected?: boolean;
  activeCount?: number;
  pendingCount?: number;
  taskCount?: number;
  guildCount?: number;
};

export type DiagnosticsOverview = {
  timestamp: string;
  uptimeSec: number;
  memoryMb: number;
  autonomy: { running: boolean; workerId: string; totalObjectives: number; counts: Record<string, number> };
  research: { sources: number; findings: number };
  memfs: { total: number; verified: number; contradicted: number };
  recovery: DiagnosticSubsystems | null;
  scheduler: DiagnosticSubsystems | null;
  discordGateway: DiagnosticSubsystems | null;
};

export type CreateObjectiveInput = {
  title: string;
  description?: string;
  directory?: string;
  sessionId?: string;
  mode?: 'finite' | 'ongoing';
  priority?: number;
  verificationCommands?: string[];
  acceptanceCriteria?: string[];
  budget?: { maxTurns?: number; maxRuntimeMs?: number; maxParallel?: number; reviewIntervalMs?: number };
};

export type AutonomySessionSummary = {
  id: string;
  title: string;
  directory: string;
  updatedAt: number;
};

export type ActiveTeamSummary = {
  id: string;
  name: string;
  status: string;
  directory?: string;
  memberCount?: number;
  members?: Array<{ id: string; name: string; role: string; status?: string }>;
};

export type SaveMemoryInput = {
  id?: string;
  tier: 'working' | 'episodic' | 'semantic' | 'procedural' | 'artifact';
  scope: 'global' | 'project' | 'team' | 'agent';
  scopeId?: string;
  title: string;
  body: string;
  tags?: string[];
  confidence?: number;
  verificationStatus?: 'unverified' | 'verified' | 'contradicted' | 'stale';
};

export type ObjectiveActionResult = {
  ok?: boolean;
  id?: string;
  status?: string;
  outcome?: string;
};

export type EmergencyStopResult = {
  ok?: boolean;
  paused?: number;
};

export type ResearchActionResult = {
  ok?: boolean;
  id?: string;
  source?: ResearchSource;
  indexedDocuments?: number;
};

const readJson = async <T,>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const rawError = payload?.error;
    const errMessage = rawError ? String(rawError).trim() : `Request failed (${response.status})`;
    throw new Error(errMessage || `Request failed (${response.status})`);
  }
  return payload;
};

export const autonomyLabApi = {
  listObjectives: async (): Promise<AutonomyObjective[]> => {
    const res = await readJson<{ objectives: AutonomyObjective[] }>(await apiFetch('/api/autonomy/objectives'));
    return res.objectives ?? [];
  },
  getObjective: async (id: string): Promise<AutonomyObjectiveDetail> => (
    readJson<AutonomyObjectiveDetail>(await apiFetch(`/api/autonomy/objectives/${encodeURIComponent(id)}`))
  ),
  createObjective: async (payload: CreateObjectiveInput): Promise<AutonomyObjectiveDetail> => (
    readJson<AutonomyObjectiveDetail>(await apiFetch('/api/autonomy/objectives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))
  ),
  actionObjective: async (id: string, action: 'pause' | 'resume' | 'cancel' | 'verify' | 'run-now'): Promise<ObjectiveActionResult> => (
    readJson<ObjectiveActionResult>(await apiFetch(`/api/autonomy/objectives/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))
  ),
  attachSession: async (id: string, sessionId: string | null): Promise<AutonomyObjective> => (
    readJson<AutonomyObjective>(await apiFetch(`/api/autonomy/objectives/${encodeURIComponent(id)}/attach-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }))
  ),
  listSessions: async (): Promise<AutonomySessionSummary[]> => {
    const res = await readJson<{ sessions: AutonomySessionSummary[] }>(await apiFetch('/api/autonomy/sessions'));
    return res.sessions ?? [];
  },
  listTeams: async (): Promise<ActiveTeamSummary[]> => {
    const res = await readJson<{ teams: ActiveTeamSummary[] }>(await apiFetch('/api/teams'));
    return res.teams ?? [];
  },
  stopTeam: async (id: string): Promise<ObjectiveActionResult> => (
    readJson<ObjectiveActionResult>(await apiFetch(`/api/teams/${encodeURIComponent(id)}/stop`, { method: 'POST' }))
  ),
  emergencyStop: async (): Promise<EmergencyStopResult> => (
    readJson<EmergencyStopResult>(await apiFetch('/api/autonomy/emergency-stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))
  ),
  listSources: async (): Promise<ResearchSource[]> => {
    const res = await readJson<{ sources: ResearchSource[] }>(await apiFetch('/api/research/sources'));
    return res.sources ?? [];
  },
  registerSource: async (payload: { name: string; kind: ResearchSourceKind; location: string; offlineOnly?: boolean }): Promise<ResearchActionResult> => (
    readJson<ResearchActionResult>(await apiFetch('/api/research/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))
  ),
  refreshSource: async (id: string): Promise<ResearchActionResult> => (
    readJson<ResearchActionResult>(await apiFetch(`/api/research/sources/${encodeURIComponent(id)}/refresh`, { method: 'POST' }))
  ),
  searchResearch: async (query: string): Promise<ResearchSearchHit[]> => {
    const res = await readJson<{ results: ResearchSearchHit[] }>(
      await apiFetch(`/api/research/search?query=${encodeURIComponent(query)}`),
    );
    return res.results ?? [];
  },
  listMemories: async (query?: string, tier?: string): Promise<MemFsEntry[]> => {
    const params = new URLSearchParams();
    if (query?.trim()) params.set('query', query.trim());
    if (tier && tier !== 'all') params.set('tier', tier);
    const res = await readJson<{ entries: MemFsEntry[] }>(await apiFetch(`/api/memory-v2?${params.toString()}`));
    return res.entries ?? [];
  },
  saveMemory: async (payload: SaveMemoryInput): Promise<MemFsEntry> => (
    readJson<MemFsEntry>(await apiFetch('/api/memory-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))
  ),
  rollbackMemory: async (id: string, version: number): Promise<MemFsEntry> => (
    readJson<MemFsEntry>(await apiFetch(`/api/memory-v2/${encodeURIComponent(id)}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    }))
  ),
  getDiagnostics: async (): Promise<DiagnosticsOverview> => (
    readJson<DiagnosticsOverview>(await apiFetch('/api/diagnostics/overview'))
  ),
};
