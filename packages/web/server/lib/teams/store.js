import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY_STATE = () => ({
  version: 1,
  teams: [],
  messages: [],
  tasks: [],
  links: [],
});

const clone = (value) => JSON.parse(JSON.stringify(value));

export const createTeamsStore = ({ filePath, fsImpl = fs } = {}) => {
  let cache = null;
  let queue = Promise.resolve();

  const readState = async () => {
    if (cache) return clone(cache);
    if (!filePath) {
      cache = EMPTY_STATE();
      return clone(cache);
    }
    try {
      const raw = await fsImpl.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      cache = {
        version: 1,
        teams: Array.isArray(parsed?.teams) ? parsed.teams : [],
        messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
        tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [],
        links: Array.isArray(parsed?.links) ? parsed.links : [],
      };
    } catch {
      cache = EMPTY_STATE();
    }
    return clone(cache);
  };

  const writeState = async (nextState) => {
    const normalized = {
      version: 1,
      teams: Array.isArray(nextState.teams) ? nextState.teams : [],
      messages: Array.isArray(nextState.messages) ? nextState.messages : [],
      tasks: Array.isArray(nextState.tasks) ? nextState.tasks : [],
      links: Array.isArray(nextState.links) ? nextState.links : [],
    };
    cache = clone(normalized);
    if (!filePath) return clone(cache);
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsImpl.writeFile(tempPath, JSON.stringify(normalized, null, 2), { mode: 0o600 });
    await fsImpl.rename(tempPath, filePath);
    return clone(cache);
  };

  const update = (mutator) => {
    const run = queue.then(async () => {
      const current = await readState();
      const draft = clone(current);
      const result = await mutator(draft);
      await writeState(draft);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  };

  return {
    read: () => queue.then(() => readState()),
    update,
  };
};
