export const validateDag = (tasks) => {
  const list = Array.isArray(tasks) ? tasks : [];
  const byId = new Map(list.map((task) => [task.id, task]));

  for (const task of list) {
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    for (const depId of deps) {
      if (depId === task.id) {
        return { valid: false, code: 'SELF_DEPENDENCY', error: `Task ${task.id} cannot depend on itself` };
      }
      if (!byId.has(depId)) {
        return { valid: false, code: 'MISSING_DEPENDENCY', error: `Task ${task.id} depends on unknown task ${depId}` };
      }
    }
  }

  const state = new Map(); // 0/undefined = unvisited, 1 = visiting, 2 = visited
  const order = [];

  const visit = (taskId) => {
    const mark = state.get(taskId) ?? 0;
    if (mark === 1) return false;
    if (mark === 2) return true;
    state.set(taskId, 1);
    const task = byId.get(taskId);
    const deps = Array.isArray(task?.dependsOn) ? task.dependsOn : [];
    for (const depId of deps) {
      if (!visit(depId)) return false;
    }
    state.set(taskId, 2);
    order.push(taskId);
    return true;
  };

  for (const task of list) {
    if (!visit(task.id)) {
      return { valid: false, code: 'CYCLE_DETECTED', error: `Cycle detected involving task ${task.id}` };
    }
  }

  return { valid: true, order };
};

export const getReadyTasks = (tasks, maxParallel = 3) => {
  const list = Array.isArray(tasks) ? tasks : [];
  const byId = new Map(list.map((task) => [task.id, task]));
  const runningTasks = list.filter((task) => task.status === 'running');
  const busyAssignees = new Set(runningTasks.map((task) => task.assignee).filter(Boolean));
  const slots = Math.max(0, (Number(maxParallel) || 1) - runningTasks.length);
  if (slots === 0) return [];

  const ready = [];
  for (const task of list) {
    if (task.status !== 'pending') continue;
    if (task.assignee && busyAssignees.has(task.assignee)) continue;
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    const depsMet = deps.every((depId) => byId.get(depId)?.status === 'completed');
    if (depsMet) {
      ready.push(task);
      if (task.assignee) busyAssignees.add(task.assignee);
      if (ready.length >= slots) break;
    }
  }
  return ready;
};

const BLOCKING_DEP_STATUSES = new Set(['failed', 'cancelled', 'blocked']);

/**
 * Find pending tasks that can never start because an upstream dependency
 * failed, was cancelled, or is already blocked.
 */
export const detectBlockedTasks = (tasks) => {
  const list = Array.isArray(tasks) ? tasks : [];
  const byId = new Map(list.map((task) => [task.id, task]));
  const blockedIds = new Map();

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const task of list) {
      if (task.status !== 'pending' || blockedIds.has(task.id)) continue;
      const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
      for (const depId of deps) {
        const dep = byId.get(depId);
        if (!dep) {
          blockedIds.set(task.id, { taskId: task.id, depId, depStatus: 'missing' });
          progressed = true;
          break;
        }
        if (BLOCKING_DEP_STATUSES.has(dep.status) || blockedIds.has(depId)) {
          blockedIds.set(task.id, {
            taskId: task.id,
            depId,
            depStatus: blockedIds.has(depId) ? 'blocked' : dep.status,
          });
          progressed = true;
          break;
        }
      }
    }
  }
  return Array.from(blockedIds.values());
};

export const summarizeDag = (tasks) => {
  const list = Array.isArray(tasks) ? tasks : [];
  const counts = { total: list.length, pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, blocked: 0 };
  for (const task of list) {
    if (task.status in counts) counts[task.status] += 1;
  }
  return counts;
};

export const extractMentions = (text, members = []) => {
  if (typeof text !== 'string' || !text.trim()) return [];
  const tokens = new Set();
  for (const match of text.matchAll(/(?:^|\s)@([a-zA-Z0-9._-]+)/g)) {
    tokens.add(match[1].toLowerCase());
  }
  if (tokens.has('all') || tokens.has('everyone') || tokens.has('team')) {
    return members.map((member) => member.id);
  }
  const matchedIds = [];
  for (const member of members) {
    const candidates = [member.name, member.role, member.id]
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim().toLowerCase().replace(/\s+/g, '-'));
    const rawNames = [member.name, member.role, member.id]
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim().toLowerCase());
    if (candidates.some((c) => tokens.has(c)) || rawNames.some((c) => tokens.has(c))) {
      matchedIds.push(member.id);
    }
  }
  return matchedIds;
};
