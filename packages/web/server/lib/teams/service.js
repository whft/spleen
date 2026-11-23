import crypto from 'node:crypto';
import { detectBlockedTasks, extractMentions, getReadyTasks, summarizeDag, validateDag } from './graph.js';

export const TEAM_PRESETS = Object.freeze({
  'full-stack': [
    { name: 'Lead', role: 'lead', description: 'Coordinates architecture, task breakdown, and integration across members.' },
    { name: 'Backend', role: 'backend', description: 'Implements APIs, storage, server logic, and backend tests.' },
    { name: 'Frontend', role: 'frontend', description: 'Implements UI components, stores, styling, and UX polish.' },
    { name: 'QA', role: 'qa', description: 'Verifies edge cases, writes integration tests, and audits regressions.' },
  ],
  'research-build': [
    { name: 'Lead', role: 'lead', description: 'Synthesizes findings and directs implementation.' },
    { name: 'Researcher', role: 'researcher', description: 'Explores the codebase, APIs, and constraints.' },
    { name: 'Builder', role: 'builder', description: 'Applies focused code changes cleanly.' },
    { name: 'Verifier', role: 'verifier', description: 'Runs test suites, type-checks, and validates behavior.' },
  ],
  'bug-hunt': [
    { name: 'Lead', role: 'lead', description: 'Coordinates reproduction and sign-off.' },
    { name: 'Investigator', role: 'investigator', description: 'Traces logs, stack frames, and root causes.' },
    { name: 'Fixer', role: 'fixer', description: 'Implements minimal safe fixes.' },
    { name: 'Reviewer', role: 'reviewer', description: 'Audits diffs and tests for regressions.' },
  ],
  'multi-review': [
    { name: 'Lead', role: 'lead', description: 'Aggregates audit reports into an actionable summary.' },
    { name: 'Security', role: 'security', description: 'Audits auth, input validation, path/SSRF safety, and secrets.' },
    { name: 'Performance', role: 'performance', description: 'Finds bottlenecks, leaks, and unnecessary I/O.' },
    { name: 'Correctness', role: 'correctness', description: 'Checks edge cases, error handling, and test coverage.' },
  ],
  custom: [
    { name: 'Lead', role: 'lead', description: 'Orchestrates custom team members and shared tasks.' },
  ],
});

const LINK_RELATIONS = new Set(['reference', 'supervise', 'delegate']);
const DEFAULT_LEASE_MS = 10 * 60_000;
const MAX_BOARD_MESSAGES = 200;

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const resolveAssignee = (members, raw) => {
  const key = asText(raw).toLowerCase();
  if (!key) return members[0] ?? null;
  return members.find((m) =>
    m.id.toLowerCase() === key
    || m.role.toLowerCase() === key
    || m.name.toLowerCase() === key) ?? members[0] ?? null;
};

export class TeamServiceError extends Error {
  constructor(message, status = 400, code = 'TEAM_ERROR') {
    super(message);
    this.name = 'TeamServiceError';
    this.status = status;
    this.code = code;
  }
}

export const createTeamsService = ({
  store,
  sessionService = null,
  readSessionStatus = null,
  readLastAssistantMessage = null,
  broadcastEvent = () => {},
  now = Date.now,
} = {}) => {
  const emitUpdate = (detail = {}) => {
    broadcastEvent({ type: 'spleen:teams-updated', properties: { at: now(), ...detail } });
  };

  const createMemberSession = async ({ teamName, member, directory, useWorktrees }) => {
    if (!sessionService?.create) {
      return { sessionId: null, directory };
    }
    const created = await sessionService.create({
      directory,
      title: `${teamName} · ${member.name}`,
      ...(member.model ? { model: member.model } : {}),
      ...(member.agent ? { agent: member.agent } : {}),
    });
    const sessionId = created?.sessionId || created?.id || null;
    let memberDir = created?.directory || directory;
    if (sessionId && useWorktrees === true && member.role !== 'lead' && sessionService.moveToWorktree) {
      try {
        const slug = `${teamName}-${member.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'worker';
        const moved = await sessionService.moveToWorktree(sessionId, {
          directory,
          worktree: { name: `team-${slug}-${crypto.randomUUID().slice(0, 4)}` },
        });
        if (moved?.worktree?.path) memberDir = moved.worktree.path;
      } catch {
        // Non-git directories or unavailable worktree service fall back cleanly to checkout directory.
      }
    }
    return { sessionId, directory: memberDir };
  };

  const buildLeadKickoffPrompt = (team) => {
    const rosterLines = team.members.map((m) => {
      const extras = [
        m.agent ? `agent=${m.agent}` : null,
        m.model ? `model=${m.model}` : null,
        m.description ? m.description : null,
      ].filter(Boolean).join(' · ');
      return `- **${m.name}** (role: \`${m.role}\`, id: \`${m.id}\`)${extras ? `: ${extras}` : ''}`;
    });
    return [
      `You are the **Lead Manager & Orchestrator** of AI Team **"${team.name}"** (\`teamId: "${team.id}"\`).`,
      `Workspace directory: \`${team.directory}\``,
      `Team goal: ${team.goal}`,
      '',
      '### Active Roster',
      ...rosterLines,
      '',
      '### Orchestration Protocol',
      `1. Decompose the goal into clear, well-scoped DAG tasks using \`spleen_control\` action \`team.addTask\` (\`teamId: "${team.id}"\`, \`title\`, \`prompt\`, \`assignee\` by role or member id, optional \`dependsOn\` task IDs, and \`acceptance\`). Run independent tasks in parallel (up to \`maxParallel: ${team.maxParallel}\`).`,
      `2. If a specialized role is missing, you can create a reusable project-scoped agent with \`agent.create\` (\`agentScope: "project"\`) and recruit new members with \`team.addMember\`.`,
      `3. Post brief coordination updates and milestones on the shared board with \`team.post\` (\`teamId: "${team.id}"\`, using \`@role\` or \`@all\` to notify teammates).`,
      `4. Monitor execution with \`team.get\` (\`teamId: "${team.id}"\`), review outputs, resolve blockers, and deliver a concise final report once all acceptance criteria pass.`,
    ].join('\n');
  };

  const dispatchPrompt = async (sessionId, directory, prompt, meta = {}) => {
    if (!sessionId || !sessionService?.send) return { dispatched: false };
    try {
      await sessionService.send({ sessionId, directory, prompt, ...meta });
      return { dispatched: true };
    } catch (error) {
      return { dispatched: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const buildTeamDetail = (state, teamId) => {
    const team = state.teams.find((t) => t.id === teamId);
    if (!team) return null;
    const messages = state.messages.filter((m) => m.teamId === teamId);
    const tasks = state.tasks.filter((t) => t.teamId === teamId);
    return {
      ...team,
      messages,
      tasks,
      dagSummary: summarizeDag(tasks),
    };
  };

  const listTeams = async () => {
    const state = await store.read();
    return state.teams
      .slice()
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .map((team) => ({
        ...team,
        dagSummary: summarizeDag(state.tasks.filter((t) => t.teamId === team.id)),
        messageCount: state.messages.filter((m) => m.teamId === team.id).length,
      }));
  };

  const getTeam = async (teamId) => {
    const state = await store.read();
    const detail = buildTeamDetail(state, teamId);
    if (!detail) throw new TeamServiceError('Team not found', 404, 'TEAM_NOT_FOUND');
    return detail;
  };

  const createTeam = async (input = {}) => {
    const name = asText(input.name) || 'AI Team';
    const goal = asText(input.goal);
    const directory = asText(input.directory);
    if (!directory) throw new TeamServiceError('directory is required', 400);
    const presetKey = asText(input.preset) || 'full-stack';
    const template = Array.isArray(input.members) && input.members.length > 0
      ? input.members
      : (TEAM_PRESETS[presetKey] ?? TEAM_PRESETS['full-stack']);
    const maxParallel = Math.max(1, Math.min(8, Number.parseInt(String(input.maxParallel ?? 3), 10) || 3));
    const useWorktrees = input.useWorktrees === true;
    const at = now();
    const teamId = `team_${crypto.randomUUID().slice(0, 8)}`;

    const resolvedMembers = [];
    for (const raw of template) {
      const mName = asText(raw?.name) || asText(raw?.role) || `Member ${resolvedMembers.length + 1}`;
      const mRole = (asText(raw?.role) || mName).toLowerCase().replace(/\s+/g, '-');
      const mDesc = asText(raw?.description);
      const sessionInfo = await createMemberSession({
        teamName: name,
        member: { name: mName, role: mRole, description: mDesc, model: asText(raw?.model), agent: asText(raw?.agent) },
        directory,
        useWorktrees,
      });
      resolvedMembers.push({
        id: `mem_${crypto.randomUUID().slice(0, 8)}`,
        name: mName,
        role: mRole,
        description: mDesc,
        model: asText(raw?.model) || null,
        agent: asText(raw?.agent) || null,
        sessionId: sessionInfo.sessionId,
        directory: sessionInfo.directory,
        status: 'idle',
        createdAt: at,
      });
    }

    const team = {
      id: teamId,
      name,
      goal,
      directory,
      preset: TEAM_PRESETS[presetKey] ? presetKey : 'custom',
      status: 'active',
      maxParallel,
      useWorktrees,
      members: resolvedMembers,
      createdAt: at,
      updatedAt: at,
    };

    const initialTasksInput = Array.isArray(input.initialTasks) ? input.initialTasks : [];
    const preparedTasks = initialTasksInput.map((task, idx) => {
      const matched = resolveAssignee(resolvedMembers, task?.assignee);
      return {
        id: asText(task?.id) || `task_${crypto.randomUUID().slice(0, 8)}_${idx}`,
        teamId,
        title: asText(task?.title) || `Task ${idx + 1}`,
        prompt: asText(task?.prompt) || asText(task?.title) || goal || `Work on ${name}`,
        assignee: matched?.id || null,
        dependsOn: Array.isArray(task?.dependsOn) ? task.dependsOn.map((d) => asText(d)).filter(Boolean) : [],
        acceptance: asText(task?.acceptance) || null,
        idempotencyKey: asText(task?.idempotencyKey) || null,
        status: 'pending',
        retries: 0,
        maxRetries: Number.isInteger(task?.maxRetries) ? task.maxRetries : 1,
        checkpoint: null,
        result: null,
        error: null,
        createdAt: at,
        updatedAt: at,
        dispatchedAt: null,
        leaseUntil: null,
      };
    });

    if (preparedTasks.length > 0) {
      const check = validateDag(preparedTasks);
      if (!check.valid) throw new TeamServiceError(check.error, 400, check.code);
    }

    const detail = await store.update((draft) => {
      draft.teams.push(team);
      for (const t of preparedTasks) draft.tasks.push(t);
      if (goal) {
        draft.messages.push({
          id: `msg_${crypto.randomUUID().slice(0, 8)}`,
          teamId,
          author: 'system',
          body: `Team **${name}** started (${team.preset}). Goal: ${goal}`,
          mentions: [],
          createdAt: at,
        });
      }
      return buildTeamDetail(draft, teamId);
    });

    emitUpdate({ action: 'created', teamId });
    if (goal && sessionService?.send) {
      const lead = resolvedMembers.find((m) => m.role === 'lead' && m.sessionId) || resolvedMembers.find((m) => m.sessionId);
      if (lead?.sessionId) {
        void dispatchPrompt(lead.sessionId, lead.directory || directory, buildLeadKickoffPrompt(team));
      }
    }
    if (preparedTasks.length > 0) {
      await tickScheduler(teamId);
      return getTeam(teamId);
    }
    return detail;
  };

  const updateTeam = async (teamId, patch = {}) => {
    const detail = await store.update((draft) => {
      const team = draft.teams.find((t) => t.id === teamId);
      if (!team) throw new TeamServiceError('Team not found', 404, 'TEAM_NOT_FOUND');
      if (typeof patch.name === 'string' && patch.name.trim()) team.name = patch.name.trim();
      if (typeof patch.goal === 'string') team.goal = patch.goal.trim();
      if (typeof patch.status === 'string' && ['active', 'paused', 'completed', 'stopped'].includes(patch.status)) {
        team.status = patch.status;
      }
      if (patch.maxParallel !== undefined) {
        team.maxParallel = Math.max(1, Math.min(8, Number.parseInt(String(patch.maxParallel), 10) || team.maxParallel));
      }
      team.updatedAt = now();
      return buildTeamDetail(draft, teamId);
    });
    emitUpdate({ action: 'updated', teamId });
    return detail;
  };

  const stopTeam = async (teamId) => {
    const state = await store.read();
    const team = state.teams.find((t) => t.id === teamId);
    if (!team) throw new TeamServiceError('Team not found', 404, 'TEAM_NOT_FOUND');
    if (sessionService?.abort) {
      for (const member of team.members) {
        if (member.sessionId) {
          await Promise.resolve(sessionService.abort(member.sessionId, { directory: member.directory || team.directory })).catch(() => {});
        }
      }
    }
    const detail = await store.update((draft) => {
      const target = draft.teams.find((t) => t.id === teamId);
      if (!target) return null;
      const at = now();
      target.status = 'stopped';
      target.updatedAt = at;
      for (const member of target.members) member.status = 'stopped';
      for (const task of draft.tasks) {
        if (task.teamId === teamId && (task.status === 'running' || task.status === 'pending')) {
          task.status = 'cancelled';
          task.updatedAt = at;
        }
      }
      draft.messages.push({
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        teamId,
        author: 'system',
        body: 'Team stopped.',
        mentions: [],
        createdAt: at,
      });
      return buildTeamDetail(draft, teamId);
    });
    emitUpdate({ action: 'stopped', teamId });
    return detail;
  };

  const deleteTeam = async (teamId) => {
    const removed = await store.update((draft) => {
      const index = draft.teams.findIndex((t) => t.id === teamId);
      if (index === -1) throw new TeamServiceError('Team not found', 404, 'TEAM_NOT_FOUND');
      draft.teams.splice(index, 1);
      draft.messages = draft.messages.filter((m) => m.teamId !== teamId);
      draft.tasks = draft.tasks.filter((t) => t.teamId !== teamId);
      return true;
    });
    emitUpdate({ action: 'deleted', teamId });
    return { deleted: removed, teamId };
  };

  const addMember = async (teamId, input = {}) => {
    const state = await store.read();
    const team = state.teams.find((t) => t.id === teamId);
    if (!team) throw new TeamServiceError('Team not found', 404, 'TEAM_NOT_FOUND');
    const name = asText(input.name) || asText(input.role);
    if (!name) throw new TeamServiceError('member name or role is required', 400);
    const role = (asText(input.role) || name).toLowerCase().replace(/\s+/g, '-');
    const description = asText(input.description);
    const sessionInfo = await createMemberSession({
      teamName: team.name,
      member: { name, role, description, model: asText(input.model), agent: asText(input.agent) },
      directory: team.directory,
      useWorktrees: input.useWorktrees === true || input.useWorktree === true || team.useWorktrees,
    });
    const at = now();
    const member = {
      id: `mem_${crypto.randomUUID().slice(0, 8)}`,
      name,
      role,
      description,
      model: asText(input.model) || null,
      agent: asText(input.agent) || null,
      sessionId: sessionInfo.sessionId,
      directory: sessionInfo.directory,
      status: 'idle',
      createdAt: at,
    };
    const detail = await store.update((draft) => {
      const target = draft.teams.find((t) => t.id === teamId);
      if (!target) throw new TeamServiceError('Team not found', 404, 'TEAM_NOT_FOUND');
      target.members.push(member);
      target.updatedAt = at;
      return buildTeamDetail(draft, teamId);
    });
    emitUpdate({ action: 'member_added', teamId, memberId: member.id });
    return detail;
  };

  const removeMember = async (teamId, memberId) => {
    const pre = await store.read();
    const preTeam = pre.teams.find((t) => t.id === teamId);
    if (!preTeam) throw new TeamServiceError('Team not found', 404, 'TEAM_NOT_FOUND');
    const removedMember = preTeam.members.find((m) => m.id === memberId);
    if (!removedMember) throw new TeamServiceError('Member not found', 404, 'MEMBER_NOT_FOUND');

    if (removedMember.sessionId && sessionService?.abort) {
      await Promise.resolve(sessionService.abort(removedMember.sessionId, { directory: removedMember.directory || preTeam.directory })).catch(() => {});
    }

    const at = now();
    const detail = await store.update((draft) => {
      const target = draft.teams.find((t) => t.id === teamId);
      if (!target) throw new TeamServiceError('Team not found', 404, 'TEAM_NOT_FOUND');
      const idx = target.members.findIndex((m) => m.id === memberId);
      if (idx === -1) throw new TeamServiceError('Member not found', 404, 'MEMBER_NOT_FOUND');
      target.members.splice(idx, 1);
      const fallbackAssignee = target.members.find((m) => m.role === 'lead')?.id ?? target.members[0]?.id ?? null;
      for (const task of draft.tasks) {
        if (task.teamId !== teamId || task.assignee !== memberId) continue;
        if (task.status === 'pending') {
          task.assignee = fallbackAssignee;
          task.updatedAt = at;
        } else if (task.status === 'running') {
          task.status = 'failed';
          task.error = `Assigned member ${removedMember.name} was removed`;
          task.leaseUntil = null;
          task.updatedAt = at;
        }
      }
      target.updatedAt = at;
      return buildTeamDetail(draft, teamId);
    });
    emitUpdate({ action: 'member_removed', teamId, memberId });
    await tickScheduler(teamId);
    return detail;
  };

  const postBoardMessage = async ({ teamId, author = 'user', body, mentions } = {}) => {
    const text = asText(body);
    if (!text) throw new TeamServiceError('Message body is required', 400);
    const at = now();
    const result = await store.update((draft) => {
      const team = draft.teams.find((t) => t.id === teamId);
      if (!team) throw new TeamServiceError('Team not found', 404, 'TEAM_NOT_FOUND');
      const resolvedMentions = Array.isArray(mentions) && mentions.length > 0
        ? mentions
        : extractMentions(text, team.members);
      const message = {
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        teamId,
        author: asText(author) || 'user',
        body: text,
        mentions: resolvedMentions,
        createdAt: at,
      };
      draft.messages.push(message);
      const teamMsgs = draft.messages.filter((m) => m.teamId === teamId);
      if (teamMsgs.length > MAX_BOARD_MESSAGES) {
        const dropIds = new Set(teamMsgs.slice(0, teamMsgs.length - MAX_BOARD_MESSAGES).map((m) => m.id));
        draft.messages = draft.messages.filter((m) => !dropIds.has(m.id));
      }
      team.updatedAt = at;
      return { message, team: { ...team }, targetMembers: team.members.filter((m) => resolvedMentions.includes(m.id)) };
    });

    for (const member of result.targetMembers) {
      if (member.sessionId && member.sessionId !== author) {
        const delivery = [
          `[Team Board · ${result.team.name}] Message from ${result.message.author}:`,
          result.message.body,
          `(Reply on the team board with \`team.post\` using \`teamId: "${teamId}"\` if another member needs an update.)`,
        ].join('\n');
        void dispatchPrompt(member.sessionId, member.directory || result.team.directory, delivery);
      }
    }
    emitUpdate({ action: 'board_message', teamId, messageId: result.message.id });
    return result.message;
  };

  const addTask = async (teamId, input = {}) => {
    const title = asText(input.title);
    const prompt = asText(input.prompt) || title;
    if (!title && !prompt) throw new TeamServiceError('Task title or prompt is required', 400);
    const at = now();
    const idempotencyKey = asText(input.idempotencyKey) || null;
    const dependsOn = Array.isArray(input.dependsOn) ? input.dependsOn.map((d) => asText(d)).filter(Boolean) : [];

    const task = await store.update((draft) => {
      const team = draft.teams.find((t) => t.id === teamId);
      if (!team) throw new TeamServiceError('Team not found', 404, 'TEAM_NOT_FOUND');
      if (idempotencyKey) {
        const existing = draft.tasks.find((t) => t.teamId === teamId && t.idempotencyKey === idempotencyKey);
        if (existing) return existing;
      }
      const matchedMember = resolveAssignee(team.members, input.assignee);
      const created = {
        id: asText(input.id) || `task_${crypto.randomUUID().slice(0, 8)}`,
        teamId,
        title: title || prompt.slice(0, 60),
        prompt,
        assignee: matchedMember?.id || team.members[0]?.id || null,
        dependsOn,
        acceptance: asText(input.acceptance) || null,
        idempotencyKey,
        status: 'pending',
        retries: 0,
        maxRetries: Number.isInteger(input.maxRetries) ? Math.max(0, input.maxRetries) : 1,
        checkpoint: null,
        result: null,
        error: null,
        createdAt: at,
        updatedAt: at,
        dispatchedAt: null,
        leaseUntil: null,
      };
      const teamTasks = [...draft.tasks.filter((t) => t.teamId === teamId), created];
      const validation = validateDag(teamTasks);
      if (!validation.valid) throw new TeamServiceError(validation.error, 400, validation.code);
      draft.tasks.push(created);
      team.updatedAt = at;
      return created;
    });

    emitUpdate({ action: 'task_added', teamId, taskId: task.id });
    await tickScheduler(teamId);
    const state = await store.read();
    return state.tasks.find((t) => t.id === task.id) ?? task;
  };

  const updateTask = async (teamId, taskId, patch = {}) => {
    const at = now();
    const updated = await store.update((draft) => {
      const task = draft.tasks.find((t) => t.teamId === teamId && t.id === taskId);
      if (!task) throw new TeamServiceError('Task not found', 404, 'TASK_NOT_FOUND');
      if (patch.status && ['pending', 'running', 'completed', 'failed', 'cancelled', 'blocked'].includes(patch.status)) {
        task.status = patch.status;
        if (patch.status === 'completed' || patch.status === 'failed' || patch.status === 'cancelled' || patch.status === 'blocked') {
          task.leaseUntil = null;
          const team = draft.teams.find((t) => t.id === teamId);
          const m = team?.members.find((x) => x.id === task.assignee);
          if (m && m.status === 'working') m.status = 'idle';
        }
      }
      if (patch.result !== undefined) task.result = typeof patch.result === 'string' ? patch.result : JSON.stringify(patch.result);
      if (patch.error !== undefined) task.error = patch.error ? String(patch.error) : null;
      if (patch.checkpoint !== undefined) task.checkpoint = patch.checkpoint;
      if (patch.heartbeat === true && task.status === 'running') {
        task.leaseUntil = at + DEFAULT_LEASE_MS;
      }
      task.updatedAt = at;
      return task;
    });
    emitUpdate({ action: 'task_updated', teamId, taskId });
    await tickScheduler(teamId);
    return updated;
  };

  const retryTask = async (teamId, taskId) => {
    const at = now();
    await store.update((draft) => {
      const task = draft.tasks.find((t) => t.teamId === teamId && t.id === taskId);
      if (!task) throw new TeamServiceError('Task not found', 404, 'TASK_NOT_FOUND');
      task.status = 'pending';
      task.error = null;
      task.dispatchedAt = null;
      task.leaseUntil = null;
      task.updatedAt = at;

      // Unblock downstream tasks that were blocked by this task (transitively)
      const unblocked = new Set([taskId]);
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const candidate of draft.tasks) {
          if (candidate.teamId !== teamId || candidate.status !== 'blocked') continue;
          if (Array.isArray(candidate.dependsOn) && candidate.dependsOn.some((dep) => unblocked.has(dep))) {
            candidate.status = 'pending';
            candidate.error = null;
            candidate.updatedAt = at;
            unblocked.add(candidate.id);
            progressed = true;
          }
        }
      }

      const team = draft.teams.find((t) => t.id === teamId);
      if (team && team.status !== 'active') {
        team.status = 'active';
        team.updatedAt = at;
      }
    });
    emitUpdate({ action: 'task_retried', teamId, taskId });
    await tickScheduler(teamId);
    const state = await store.read();
    return state.tasks.find((t) => t.id === taskId);
  };

  const cancelTask = async (teamId, taskId) => {
    const pre = await store.read();
    const preTeam = pre.teams.find((t) => t.id === teamId);
    const preTask = pre.tasks.find((t) => t.teamId === teamId && t.id === taskId);
    if (!preTask) throw new TeamServiceError('Task not found', 404, 'TASK_NOT_FOUND');

    if (preTask.status === 'running' && preTeam && sessionService?.abort) {
      const member = preTeam.members.find((m) => m.id === preTask.assignee);
      if (member?.sessionId) {
        await Promise.resolve(sessionService.abort(member.sessionId, { directory: member.directory || preTeam.directory })).catch(() => {});
      }
    }

    const at = now();
    const updated = await store.update((draft) => {
      const task = draft.tasks.find((t) => t.teamId === teamId && t.id === taskId);
      if (!task) throw new TeamServiceError('Task not found', 404, 'TASK_NOT_FOUND');
      task.status = 'cancelled';
      task.leaseUntil = null;
      task.updatedAt = at;
      const team = draft.teams.find((t) => t.id === teamId);
      const member = team?.members.find((m) => m.id === task.assignee);
      if (member && member.status === 'working') member.status = 'idle';
      return task;
    });
    emitUpdate({ action: 'task_cancelled', teamId, taskId });
    await tickScheduler(teamId);
    return updated;
  };

  const tickScheduler = async (onlyTeamId = null) => {
    const state = await store.read();
    const at = now();
    const teams = onlyTeamId
      ? state.teams.filter((t) => t.id === onlyTeamId && t.status === 'active')
      : state.teams.filter((t) => t.status === 'active');

    let changed = false;

    for (const team of teams) {
      const teamTasks = state.tasks.filter((t) => t.teamId === team.id);
      if (teamTasks.length === 0) continue;

      // 1. Poll running tasks for session completion or lease expiration.
      for (const task of teamTasks) {
        if (task.status !== 'running') continue;
        const member = team.members.find((m) => m.id === task.assignee) ?? team.members[0];
        if (member?.sessionId && readSessionStatus) {
          const status = await Promise.resolve(readSessionStatus(member.sessionId, member.directory || team.directory)).catch(() => null);
          if (status && status.type === 'idle' && at > (task.dispatchedAt || 0)) {
            const reply = readLastAssistantMessage
              ? await Promise.resolve(readLastAssistantMessage(member.sessionId, member.directory || team.directory)).catch(() => null)
              : null;
            if (reply && Number(reply.completedAt || 0) >= (task.dispatchedAt || 0)) {
              await store.update((draft) => {
                const target = draft.tasks.find((t) => t.id === task.id);
                if (!target || target.status !== 'running') return;
                target.status = 'completed';
                target.result = asText(reply.text) || 'Completed';
                target.leaseUntil = null;
                target.updatedAt = at;
                const m = draft.teams.find((x) => x.id === team.id)?.members.find((x) => x.id === member.id);
                if (m) m.status = 'idle';
              });
              changed = true;
              continue;
            }
          }
        }
        if (Number(task.leaseUntil) > 0 && at > Number(task.leaseUntil)) {
          await store.update((draft) => {
            const target = draft.tasks.find((t) => t.id === task.id);
            if (!target || target.status !== 'running') return;
            if (target.retries < target.maxRetries) {
              target.retries += 1;
              target.status = 'pending';
              target.error = 'lease expired; retrying';
            } else {
              target.status = 'failed';
              target.error = 'lease expired';
            }
            target.leaseUntil = null;
            target.updatedAt = at;
          });
          changed = true;
        }
      }

      // 2. Propagate blocked status when upstream dependencies failed/cancelled and escalate to Lead.
      const preDispatch = await store.read();
      const preDispatchTeam = preDispatch.teams.find((t) => t.id === team.id);
      if (!preDispatchTeam || preDispatchTeam.status !== 'active') continue;
      const blockedEntries = detectBlockedTasks(preDispatch.tasks.filter((t) => t.teamId === team.id));
      if (blockedEntries.length > 0) {
        const blockTime = now();
        await store.update((draft) => {
          for (const entry of blockedEntries) {
            const target = draft.tasks.find((t) => t.teamId === team.id && t.id === entry.taskId);
            if (!target || target.status !== 'pending') continue;
            target.status = 'blocked';
            target.error = `Blocked by ${entry.depStatus} dependency ${entry.depId}`;
            target.updatedAt = blockTime;
          }
        });
        changed = true;
        const summaryLines = blockedEntries.map((e) => `- \`${e.taskId}\` blocked by \`${e.depId}\` (${e.depStatus})`);
        await postBoardMessage({
          teamId: team.id,
          author: 'system',
          body: `@lead Dependency blocker detected:\n${summaryLines.join('\n')}\nRetry the failed task or add a replacement task to unblock.`,
        }).catch(() => {});
      }

      // 3. Refresh snapshot & dispatch ready tasks.
      const refreshed = await store.read();
      const freshTeam = refreshed.teams.find((t) => t.id === team.id);
      if (!freshTeam || freshTeam.status !== 'active') continue;
      const freshTasks = refreshed.tasks.filter((t) => t.teamId === team.id);
      const ready = getReadyTasks(freshTasks, freshTeam.maxParallel);

      for (const task of ready) {
        const assignee = freshTeam.members.find((m) => m.id === task.assignee) ?? freshTeam.members[0];
        if (!assignee) continue;
        const depOutputs = (task.dependsOn || [])
          .map((depId) => freshTasks.find((t) => t.id === depId))
          .filter(Boolean)
          .map((dep) => `- ${dep.title} (${dep.id}): ${asText(dep.result) || 'done'}`);

        const promptLines = [
          `[Team Task · ${freshTeam.name}] ${task.title} (id: ${task.id})`,
          freshTeam.goal ? `Team goal: ${freshTeam.goal}` : '',
          depOutputs.length > 0 ? `Completed dependency outputs:\n${depOutputs.join('\n')}` : '',
          `Task instructions:\n${task.prompt}`,
          task.acceptance ? `Acceptance criteria: ${task.acceptance}` : '',
        ].filter(Boolean);

        const dispatchTime = now();
        await store.update((draft) => {
          const target = draft.tasks.find((t) => t.id === task.id);
          if (!target || target.status !== 'pending') return;
          target.status = 'running';
          target.assignee = assignee.id;
          target.dispatchedAt = dispatchTime;
          target.leaseUntil = dispatchTime + DEFAULT_LEASE_MS;
          target.updatedAt = dispatchTime;
          const m = draft.teams.find((x) => x.id === freshTeam.id)?.members.find((x) => x.id === assignee.id);
          if (m) m.status = 'working';
        });
        changed = true;

        if (assignee.sessionId) {
          const sent = await dispatchPrompt(assignee.sessionId, assignee.directory || freshTeam.directory, promptLines.join('\n\n'));
          if (!sent.dispatched) {
            await store.update((draft) => {
              const target = draft.tasks.find((t) => t.id === task.id);
              if (!target) return;
              target.status = 'failed';
              target.error = sent.error || 'dispatch failed';
              target.leaseUntil = null;
              target.updatedAt = now();
              const m = draft.teams.find((x) => x.id === freshTeam.id)?.members.find((x) => x.id === assignee.id);
              if (m && m.status === 'working') m.status = 'idle';
            });
          }
        }
      }

      // 4. Mark team settled once every DAG task has reached a non-active state.
      const finalSnapshot = await store.read();
      const finalTasks = finalSnapshot.tasks.filter((t) => t.teamId === team.id);
      const settledStatuses = new Set(['completed', 'failed', 'cancelled', 'blocked']);
      if (finalTasks.length > 0 && finalTasks.every((t) => settledStatuses.has(t.status))) {
        const hasFailures = finalTasks.some((t) => t.status === 'failed' || t.status === 'blocked');
        await store.update((draft) => {
          const target = draft.teams.find((t) => t.id === team.id);
          if (!target || target.status !== 'active') return;
          target.status = hasFailures ? 'failed' : 'completed';
          target.updatedAt = now();
        });
        changed = true;
      }
    }

    if (changed) emitUpdate({ action: 'scheduler_tick', teamId: onlyTeamId });
  };

  const linkSessions = async ({ sourceSessionId, targetSessionId, relation = 'reference', note = '' } = {}) => {
    const source = asText(sourceSessionId);
    const target = asText(targetSessionId);
    if (!source || !target) throw new TeamServiceError('sourceSessionId and targetSessionId are required', 400);
    if (source === target) throw new TeamServiceError('Cannot link a session to itself', 400);
    if (!LINK_RELATIONS.has(relation)) throw new TeamServiceError('relation must be reference, supervise, or delegate', 400);
    const at = now();
    const link = await store.update((draft) => {
      const existing = draft.links.find((l) => l.sourceSessionId === source && l.targetSessionId === target && l.relation === relation);
      if (existing) {
        existing.note = asText(note) || existing.note;
        existing.updatedAt = at;
        return existing;
      }
      const created = {
        id: `link_${crypto.randomUUID().slice(0, 8)}`,
        sourceSessionId: source,
        targetSessionId: target,
        relation,
        note: asText(note) || null,
        createdAt: at,
        updatedAt: at,
      };
      draft.links.push(created);
      return created;
    });
    emitUpdate({ action: 'session_linked', linkId: link.id });
    return link;
  };

  const listLinks = async (sessionId = null) => {
    const state = await store.read();
    const filterId = asText(sessionId);
    if (!filterId) return state.links;
    return state.links.filter((l) => l.sourceSessionId === filterId || l.targetSessionId === filterId);
  };

  const unlinkSessions = async (linkId) => {
    const id = asText(linkId);
    if (!id) throw new TeamServiceError('linkId is required', 400);
    const removed = await store.update((draft) => {
      const idx = draft.links.findIndex((l) => l.id === id);
      if (idx === -1) throw new TeamServiceError('Session link not found', 404, 'LINK_NOT_FOUND');
      draft.links.splice(idx, 1);
      return true;
    });
    emitUpdate({ action: 'session_unlinked', linkId: id });
    return { deleted: removed, id };
  };

  return {
    presets: TEAM_PRESETS,
    listTeams,
    getTeam,
    createTeam,
    updateTeam,
    stopTeam,
    deleteTeam,
    addMember,
    removeMember,
    postBoardMessage,
    addTask,
    updateTask,
    retryTask,
    cancelTask,
    tickScheduler,
    linkSessions,
    listLinks,
    unlinkSessions,
  };
};
