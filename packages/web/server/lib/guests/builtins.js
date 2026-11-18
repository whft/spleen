import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const BUILTIN_PREFIX = 'spleen-builtin-';
// The desktop sidecar ships the directory as a resource; the source tree keeps it beside the server.
export const DEFAULT_BUILTIN_ROOT = process.env.SPLEEN_BUILTIN_EXTENSIONS_DIR?.trim()
  || fileURLToPath(new URL('../../built-in-extensions/', import.meta.url));
export const builtInExtensionSchema = z.object({
  id: z.string().regex(/^spleen-builtin-[a-z][a-z0-9-]*$/),
  directory: z.string().regex(/^[a-z][a-z0-9-]*$/),
});
export const builtInRegistrySchema = z.object({
  version: z.literal(1),
  extensions: z.array(builtInExtensionSchema),
}).superRefine(({ extensions }, context) => {
  const ids = new Set();
  const directories = new Set();
  for (const entry of extensions) {
    if (ids.has(entry.id) || directories.has(entry.directory)) {
      context.addIssue({ code: 'custom', message: 'Built-in extension IDs and directories must be unique' });
    }
    ids.add(entry.id);
    directories.add(entry.directory);
  }
});

export const isReservedBuiltInId = (id) => id.startsWith(BUILTIN_PREFIX);

export const readBuiltInRegistry = async (root = DEFAULT_BUILTIN_ROOT) => {
  const realRoot = await fs.realpath(root);
  const registry = builtInRegistrySchema.parse(JSON.parse(await fs.readFile(path.join(realRoot, 'registry.json'), 'utf8')));
  return { root: realRoot, extensions: registry.extensions };
};
