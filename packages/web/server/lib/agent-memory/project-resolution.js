import path from 'node:path';
import { asNonEmptyString } from '../shared/guards.js';
import { createProjectIdFromPath } from '../projects/project-id.js';

const isPosixAbsolute = (value) => value.startsWith('/') && !value.startsWith('//');

const normalize = (value) => {
  const trimmed = asNonEmptyString(value);
  if (!trimmed) return '';
  if (isPosixAbsolute(trimmed)) {
    return path.posix.resolve(trimmed);
  }
  return path.resolve(trimmed);
};

const isWithinRoot = (root, candidate) => {
  const mod = isPosixAbsolute(root) && isPosixAbsolute(candidate) ? path.posix : path;
  const relative = mod.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !mod.isAbsolute(relative));
};

export const createMemoryProjectResolver = (dependencies) => {
  const { listProjectPaths, resolvePrimaryWorktreeRoot, managedProjectRoots = [] } = dependencies;
  const managedRoots = managedProjectRoots.map(normalize).filter(Boolean);

  return async (directory) => {
    const resolved = normalize(directory);
    if (!resolved) {
      return '';
    }

    const managedRoot = managedRoots.find((root) => isWithinRoot(root, resolved));
    if (managedRoot) {
      return createProjectIdFromPath(managedRoot);
    }

    let configured = [];
    try {
      configured = ((await listProjectPaths()) || []).map(normalize).filter(Boolean);
    } catch {}
    if (configured.includes(resolved)) {
      return createProjectIdFromPath(resolved);
    }

    let primaryRoot = '';
    try {
      primaryRoot = normalize((await resolvePrimaryWorktreeRoot(resolved))?.root);
    } catch {}

    return createProjectIdFromPath(primaryRoot || resolved);
  };
};
