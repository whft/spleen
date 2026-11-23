import { asNonEmptyString } from '../shared/guards.js';

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'were', 'not', 'but', 'have', 'has', 'had', 'use', 'using', 'should', 'must', 'always', 'never']);
const NEGATION_RE = /\b(?:never|not|avoid|deprecated|removed|broken|disabled|false|cannot|don't|do not|no longer)\b/i;

const tokenize = (text) => new Set(
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
);

const jaccard = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
};

export const createMemoryCurator = ({ memfsStore } = {}) => {
  const curateFromEpisode = ({
    scope = 'project',
    scopeId = '',
    objectiveTitle,
    tasks = [],
    verification = null,
    findings = [],
  } = {}) => {
    const verified = verification?.status === 'passed';
    const taskLines = tasks.map((t) => `- [${t.status}] ${t.title}: ${t.result || t.error || ''}`).join('\n');
    const episode = memfsStore.saveMemory({
      tier: 'episodic',
      scope,
      scopeId,
      title: `Episode: ${asNonEmptyString(objectiveTitle) || 'Objective'}`,
      body: `Verification: ${verification?.status || 'unverified'} (${verification?.summary || 'none'})\n${taskLines}`.trim(),
      tags: ['episode', verification?.status || 'unverified'],
      confidence: verified ? 0.9 : 0.5,
      verificationStatus: verified ? 'verified' : 'unverified',
      sources: [{ kind: 'verification', ref: verification?.id || 'none' }],
      reason: 'episode curation',
    });

    const existingSemantic = memfsStore.listMemories({ tier: 'semantic', scope, scopeId, limit: 200 });
    const saved = [];
    const merged = [];
    const contradictions = [];

    for (const finding of Array.isArray(findings) ? findings : []) {
      const title = asNonEmptyString(finding?.title);
      const body = asNonEmptyString(finding?.body);
      if (!title || !body) continue;
      const newTokens = tokenize(`${title} ${body}`);
      const newNeg = NEGATION_RE.test(body);
      const hasEvidence = verified && Array.isArray(finding.sources) && finding.sources.length > 0;
      const status = hasEvidence ? 'verified' : 'unverified';
      const confidence = hasEvidence ? Math.max(0.75, Number(finding.confidence) || 0.85) : Math.min(0.55, Number(finding.confidence) || 0.45);

      let matched = null;
      let contradicted = null;
      for (const ex of existingSemantic) {
        const sim = jaccard(newTokens, tokenize(`${ex.title} ${ex.body}`));
        if (sim >= 0.75) {
          matched = ex;
          break;
        }
        if (sim >= 0.35 && NEGATION_RE.test(ex.body) !== newNeg) {
          contradicted = ex;
        }
      }

      if (matched) {
        const updated = memfsStore.saveMemory({
          id: matched.id,
          tier: 'semantic',
          scope,
          scopeId,
          title,
          body,
          tags: [...new Set([...(matched.tags || []), ...(finding.tags || [])])],
          sources: [...(matched.sources || []), ...(finding.sources || [])],
          confidence: Math.max(matched.confidence, confidence),
          verificationStatus: matched.verificationStatus === 'verified' || status === 'verified' ? 'verified' : 'unverified',
          reason: 'curator dedup merge',
        });
        merged.push(updated.id);
      } else if (contradicted) {
        memfsStore.saveMemory({
          id: contradicted.id,
          tier: contradicted.tier,
          scope: contradicted.scope,
          scopeId: contradicted.scopeId,
          title: contradicted.title,
          body: contradicted.body,
          tags: [...new Set([...(contradicted.tags || []), 'contradiction'])],
          sources: contradicted.sources,
          confidence: Math.min(contradicted.confidence, 0.4),
          verificationStatus: 'contradicted',
          reason: `contradicted by new finding "${title}"`,
        });
        const created = memfsStore.saveMemory({
          tier: 'semantic',
          scope,
          scopeId,
          title,
          body,
          tags: [...new Set([...(finding.tags || []), 'contradiction'])],
          sources: finding.sources || [],
          confidence: 0.4,
          verificationStatus: 'contradicted',
          reason: `contradicts ${contradicted.id}`,
        });
        contradictions.push({ existingId: contradicted.id, newId: created.id });
      } else {
        const created = memfsStore.saveMemory({
          tier: 'semantic',
          scope,
          scopeId,
          title,
          body,
          tags: finding.tags || [],
          sources: finding.sources || [],
          confidence,
          verificationStatus: status,
          reason: 'curator discovery',
        });
        saved.push(created.id);
        existingSemantic.push(created);
      }
    }

    return { episodeId: episode.id, saved, merged, contradictions };
  };

  const detectStaleMemories = ({ scope = 'project', scopeId = '', changedPaths = [] } = {}) => {
    const normalizedPaths = (Array.isArray(changedPaths) ? changedPaths : [])
      .map((p) => String(p).replace(/\\/g, '/').toLowerCase())
      .filter(Boolean);
    if (normalizedPaths.length === 0) return { staleIds: [] };

    const candidates = memfsStore.listMemories({ scope, scopeId, limit: 500 });
    const staleIds = [];
    for (const mem of candidates) {
      if (mem.verificationStatus === 'stale') continue;
      const refs = (mem.sources || []).map((s) => String(s?.ref || s?.path || '').replace(/\\/g, '/').toLowerCase());
      const touched = refs.some((r) => r && normalizedPaths.some((p) => p.endsWith(r) || r.endsWith(p)));
      if (touched) {
        memfsStore.saveMemory({
          id: mem.id,
          tier: mem.tier,
          scope: mem.scope,
          scopeId: mem.scopeId,
          title: mem.title,
          body: mem.body,
          tags: mem.tags,
          sources: mem.sources,
          confidence: Math.min(mem.confidence, 0.35),
          verificationStatus: 'stale',
          reason: 'cited source file changed',
        });
        staleIds.push(mem.id);
      }
    }
    return { staleIds };
  };

  const proposeProceduralSkill = async ({
    scope = 'project',
    scopeId = '',
    name,
    description,
    steps = [],
    evidenceMemoryIds = [],
    validationCheck = null,
  } = {}) => {
    const skillName = asNonEmptyString(name);
    if (!skillName) throw new Error('Skill name is required');
    const body = [
      asNonEmptyString(description) || skillName,
      ...steps.map((s, idx) => `${idx + 1}. ${s}`),
    ].join('\n');

    let passed = false;
    let validationMessage = 'No validation check provided; kept as unverified draft.';
    if (validationCheck) {
      const outcome = await Promise.resolve(validationCheck()).catch((err) => ({ ok: false, error: err?.message || String(err) }));
      passed = outcome?.ok === true;
      validationMessage = passed ? 'Validation check passed; promoted to verified procedural skill.' : (outcome?.error || 'Validation check failed');
    }

    const entry = memfsStore.saveMemory({
      tier: 'procedural',
      scope,
      scopeId,
      title: `Skill: ${skillName}`,
      body,
      tags: ['skill-proposal', passed ? 'promoted' : 'draft'],
      sources: evidenceMemoryIds.map((id) => ({ kind: 'memory', ref: id })),
      confidence: passed ? 0.9 : 0.4,
      verificationStatus: passed ? 'verified' : 'unverified',
      reason: validationMessage,
    });
    return { promoted: passed, validationMessage, memory: entry };
  };

  return { curateFromEpisode, detectStaleMemories, proposeProceduralSkill };
};
