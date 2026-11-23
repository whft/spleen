import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { looksLikeInjection } from '../agent-memory/threat-patterns.js';

const execFileAsync = promisify(execFile);

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', '.turbo', 'coverage', '__pycache__']);
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.rst', '.json', '.yaml', '.yml', '.toml', '.csv',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rs', '.go', '.c', '.h',
  '.cpp', '.hpp', '.cs', '.java', '.sql', '.sh', '.ps1', '.html', '.htm', '.xml', '.css',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CHUNK_SIZE = 1_200;
const CHUNK_OVERLAP = 150;

export const stripHtmlToText = (html) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ')
  .trim();

export const extractPdfTextBasic = (buffer) => {
  const latin = buffer.toString('latin1');
  const matches = latin.match(/\(([^()\\]{3,})\)/g) || [];
  return matches.map((m) => m.slice(1, -1)).join(' ').replace(/\s+/g, ' ').trim();
};

export const chunkText = (text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) => {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks = [];
  let cursor = 0;
  while (cursor < clean.length) {
    const end = Math.min(clean.length, cursor + size);
    chunks.push(clean.slice(cursor, end));
    if (end >= clean.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }
  return chunks;
};

const readGitMetadata = async (dir) => {
  try {
    const [branch, commitSha] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, timeout: 5_000, windowsHide: true }).then((r) => r.stdout.trim()).catch(() => null),
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir, timeout: 5_000, windowsHide: true }).then((r) => r.stdout.trim()).catch(() => null),
    ]);
    return { branch: asNonEmptyString(branch), commitSha: asNonEmptyString(commitSha) };
  } catch {
    return { branch: null, commitSha: null };
  }
};

const walkFiles = async (rootDir, maxFiles = 500) => {
  const results = [];
  const queue = [rootDir];
  while (queue.length > 0 && results.length < maxFiles) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push(path.join(current, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (TEXT_EXTENSIONS.has(ext) || ext === '.pdf') {
          results.push(path.join(current, entry.name));
        }
      }
    }
  }
  return results;
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const createResearchIngestor = ({ store, fetchImpl = fetch, embedText = null } = {}) => {
  const indexLocalFile = async (sourceId, filePath, rootDir = null) => {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) return { skipped: true, reason: 'too_large' };
    const ext = path.extname(filePath).toLowerCase();
    const rawBuf = await fs.readFile(filePath);
    let text = '';
    let mimeType = 'text/plain';
    if (ext === '.pdf') {
      text = extractPdfTextBasic(rawBuf);
      mimeType = 'application/pdf';
    } else if (ext === '.html' || ext === '.htm') {
      text = stripHtmlToText(rawBuf.toString('utf8'));
      mimeType = 'text/html';
    } else {
      text = rawBuf.toString('utf8');
      mimeType = ext === '.md' || ext === '.markdown' ? 'text/markdown' : 'text/plain';
    }
    const relPath = rootDir ? path.relative(rootDir, filePath).replace(/\\/g, '/') : filePath;
    const title = path.basename(filePath);
    const contentHash = sha256(rawBuf);
    const injectionDetected = looksLikeInjection(title, text);
    const rawChunks = chunkText(text);
    const chunks = [];
    for (const c of rawChunks) {
      const embedding = embedText ? await Promise.resolve(embedText(c)).catch(() => null) : null;
      chunks.push(embedding ? { content: c, embedding } : { content: c });
    }
    return store.upsertDocument({
      sourceId,
      pathOrUrl: relPath,
      title,
      contentHash,
      mimeType,
      byteSize: stat.size,
      injectionDetected,
      metadata: { absolutePath: filePath, ext },
      chunks,
    });
  };

  const indexSource = async (sourceId, { maxFiles = 500 } = {}) => {
    const source = store.getSource(sourceId);
    if (!source) throw new Error(`Research source not found: ${sourceId}`);
    store.updateSource(sourceId, { status: 'indexing', lastError: null });
    try {
      if (source.kind === 'directory' || source.kind === 'git') {
        const gitMeta = await readGitMetadata(source.location);
        const files = await walkFiles(source.location, maxFiles);
        const activePaths = new Set();
        let indexed = 0;
        let skipped = 0;
        for (const file of files) {
          const rel = path.relative(source.location, file).replace(/\\/g, '/');
          activePaths.add(rel);
          const res = await indexLocalFile(sourceId, file, source.location);
          if (res.skipped) skipped += 1;
          else indexed += 1;
        }
        const staleMarked = store.markMissingDocsStale(sourceId, activePaths);
        const docs = store.listDocumentsBySource(sourceId).filter((d) => !d.stale);
        store.updateSource(sourceId, {
          status: 'ready',
          branch: gitMeta.branch,
          commitSha: gitMeta.commitSha,
          lastIndexedAt: Date.now(),
          docCount: docs.length,
        });
        return { sourceId, indexed, skipped, staleMarked, totalDocs: docs.length, ...gitMeta };
      }

      if (source.kind === 'file') {
        const res = await indexLocalFile(sourceId, source.location, null);
        store.updateSource(sourceId, { status: 'ready', lastIndexedAt: Date.now(), docCount: 1 });
        return { sourceId, indexed: res.skipped ? 0 : 1, skipped: res.skipped ? 1 : 0, staleMarked: 0, totalDocs: 1 };
      }

      if (source.kind === 'url') {
        if (source.offlineOnly) {
          throw new Error('Source is configured as offlineOnly; enable network refresh to fetch remote URLs');
        }
        const response = await fetchImpl(source.location, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${source.location}`);
        const rawText = await response.text();
        const ct = response.headers.get('content-type') || 'text/plain';
        const clean = ct.includes('html') ? stripHtmlToText(rawText) : rawText;
        const injectionDetected = looksLikeInjection(source.name, clean);
        store.upsertDocument({
          sourceId,
          pathOrUrl: source.location,
          title: source.name,
          contentHash: sha256(rawText),
          mimeType: ct,
          byteSize: Buffer.byteLength(rawText),
          injectionDetected,
          chunks: chunkText(clean).map((content) => ({ content })),
        });
        store.updateSource(sourceId, { status: 'ready', lastIndexedAt: Date.now(), docCount: 1 });
        return { sourceId, indexed: 1, skipped: 0, staleMarked: 0, totalDocs: 1 };
      }

      store.updateSource(sourceId, { status: 'ready', lastIndexedAt: Date.now() });
      return { sourceId, indexed: 0, skipped: 0, staleMarked: 0, totalDocs: source.docCount };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      store.updateSource(sourceId, { status: 'error', lastError: msg });
      throw error;
    }
  };

  const importAnalysisArtifacts = ({
    name,
    buildHash,
    buildVersion = null,
    architecture = null,
    symbols = [],
    functions = [],
    strings = [],
    references = [],
    pseudocode = [],
    annotations = [],
  } = {}) => {
    const hash = asNonEmptyString(buildHash);
    if (!hash) throw new Error('buildHash is required to isolate analysis artifacts by build');
    const source = store.registerSource({
      name: asNonEmptyString(name) || `Analysis ${hash.slice(0, 12)}`,
      kind: 'analysis_export',
      location: `analysis://${hash}`,
      buildHash: hash,
      buildVersion,
      offlineOnly: true,
      metadata: {
        architecture: asNonEmptyString(architecture),
        counts: {
          symbols: symbols.length,
          functions: functions.length,
          strings: strings.length,
          references: references.length,
          pseudocode: pseudocode.length,
          annotations: annotations.length,
        },
      },
    });

    const buckets = [
      { key: 'symbols', title: 'Symbols', items: symbols },
      { key: 'functions', title: 'Functions', items: functions },
      { key: 'strings', title: 'Strings', items: strings },
      { key: 'references', title: 'Cross-References', items: references },
      { key: 'pseudocode', title: 'Pseudocode', items: pseudocode },
      { key: 'annotations', title: 'Annotations', items: annotations },
    ];

    let docsWritten = 0;
    for (const bucket of buckets) {
      if (!Array.isArray(bucket.items) || bucket.items.length === 0) continue;
      const body = bucket.items.map((item) => (isRecord(item) ? JSON.stringify(item) : String(item))).join('\n');
      store.upsertDocument({
        sourceId: source.id,
        pathOrUrl: `analysis://${hash}/${bucket.key}`,
        title: `${source.name} — ${bucket.title}`,
        contentHash: sha256(body),
        mimeType: 'application/json',
        byteSize: Buffer.byteLength(body),
        injectionDetected: looksLikeInjection(body),
        metadata: { bucket: bucket.key, buildHash: hash, buildVersion, items: bucket.items },
        chunks: chunkText(body).map((content) => ({ content })),
      });
      docsWritten += 1;
    }

    return store.updateSource(source.id, { status: 'ready', lastIndexedAt: Date.now(), docCount: docsWritten });
  };

  const compareBuilds = (buildHashA, buildHashB) => {
    const sources = store.listSources();
    const srcA = sources.find((s) => s.buildHash === buildHashA);
    const srcB = sources.find((s) => s.buildHash === buildHashB);
    if (!srcA || !srcB) throw new Error('Both buildHashA and buildHashB must be imported before comparison');

    const extractNames = (srcId, bucket) => {
      const doc = store.listDocumentsBySource(srcId).find((d) => d.metadata?.bucket === bucket);
      const items = Array.isArray(doc?.metadata?.items) ? doc.metadata.items : [];
      return new Set(items.map((item) => (isRecord(item) ? String(item.name ?? item.symbol ?? item.value ?? JSON.stringify(item)) : String(item))));
    };

    const diffSet = (a, b) => ({
      added: [...b].filter((x) => !a.has(x)),
      removed: [...a].filter((x) => !b.has(x)),
      unchangedCount: [...a].filter((x) => b.has(x)).length,
    });

    return {
      buildA: { hash: srcA.buildHash, version: srcA.buildVersion, name: srcA.name },
      buildB: { hash: srcB.buildHash, version: srcB.buildVersion, name: srcB.name },
      symbols: diffSet(extractNames(srcA.id, 'symbols'), extractNames(srcB.id, 'symbols')),
      functions: diffSet(extractNames(srcA.id, 'functions'), extractNames(srcB.id, 'functions')),
      strings: diffSet(extractNames(srcA.id, 'strings'), extractNames(srcB.id, 'strings')),
    };
  };

  return { indexSource, importAnalysisArtifacts, compareBuilds };
};
