import { runtimeFetch } from '@/lib/runtime-fetch';

export type TeamMember = {
  id: string;
  name: string;
  role: string;
  description?: string;
  model: string | null;
  agent: string | null;
  sessionId: string | null;
  directory: string;
  status: string;
  createdAt: number;
};

export type TeamBoardMessage = {
  id: string;
  teamId: string;
  author: string;
  body: string;
  mentions: string[];
  createdAt: number;
};

export type TeamDagTask = {
  id: string;
  teamId: string;
  title: string;
  prompt: string;
  assignee: string | null;
  dependsOn: string[];
  acceptance: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  retries: number;
  result: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TeamDagSummary = {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
};

export type TeamMemberInput = {
  name: string;
  role?: string;
  description?: string;
  model?: string;
  agent?: string;
  useWorktree?: boolean;
  useWorktrees?: boolean;
};

export type TeamRecord = {
  id: string;
  name: string;
  goal: string;
  directory: string;
  preset: string;
  status: string;
  maxParallel: number;
  useWorktrees: boolean;
  members: TeamMember[];
  createdAt: number;
  updatedAt: number;
  dagSummary?: TeamDagSummary;
  messageCount?: number;
  messages?: TeamBoardMessage[];
  tasks?: TeamDagTask[];
};

const jsonHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await runtimeFetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? jsonHeaders : {}), ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status})`);
  }
  return payload as T;
};

export const teamsApi = {
  list: () => requestJson<{ teams: TeamRecord[] }>('/api/teams').then((r) => r.teams),
  get: (teamId: string) => requestJson<TeamRecord>(`/api/teams/${encodeURIComponent(teamId)}`),
  create: (input: {
    name: string;
    goal: string;
    directory: string;
    preset: string;
    useWorktrees: boolean;
    maxParallel?: number;
    members?: TeamMemberInput[];
  }) => requestJson<TeamRecord>('/api/teams', { method: 'POST', body: JSON.stringify(input) }),
  stop: (teamId: string) => requestJson<TeamRecord>(`/api/teams/${encodeURIComponent(teamId)}/stop`, { method: 'POST' }),
  remove: (teamId: string) => requestJson<{ deleted: boolean }>(`/api/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' }),
  addMember: (teamId: string, input: TeamMemberInput) =>
    requestJson<TeamRecord>(`/api/teams/${encodeURIComponent(teamId)}/members`, { method: 'POST', body: JSON.stringify(input) }),
  removeMember: (teamId: string, memberId: string) =>
    requestJson<TeamRecord>(`/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}`, { method: 'DELETE' }),
  postBoard: (teamId: string, body: string, author = 'user') =>
    requestJson<TeamBoardMessage>(`/api/teams/${encodeURIComponent(teamId)}/board`, { method: 'POST', body: JSON.stringify({ author, body }) }),
  addTask: (teamId: string, input: { title: string; prompt: string; assignee?: string; dependsOn?: string[]; acceptance?: string }) =>
    requestJson<TeamDagTask>(`/api/teams/${encodeURIComponent(teamId)}/tasks`, { method: 'POST', body: JSON.stringify(input) }),
  updateTask: (teamId: string, taskId: string, patch: { status?: string; result?: string; assignee?: string }) =>
    requestJson<TeamDagTask>(`/api/teams/${encodeURIComponent(teamId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  retryTask: (teamId: string, taskId: string) =>
    requestJson<TeamDagTask>(`/api/teams/${encodeURIComponent(teamId)}/tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST' }),
  cancelTask: (teamId: string, taskId: string) =>
    requestJson<TeamDagTask>(`/api/teams/${encodeURIComponent(teamId)}/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }),
};
