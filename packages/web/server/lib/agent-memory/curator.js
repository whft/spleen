import { asNonEmptyString } from '../shared/guards.js';

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'were', 'not', 'but', 'have', 'has', 'had', 'use', 'using', 'should', 'must', 'always', 'never']);
const NEGATION_RE = /\b(?:never|not|avoid|deprecated|removed|broken|disabled|false|cannot|don't|do not|no longer)\b/i;

const stripRecalled = (text) => (
  String(text ?? '')
    .replace(/<spleen-recalled-context>[\s\S]*?<\/spleen-recalled-context>/gi, '')
    .trim()
);

const tokenize = (text) => new Set(
  stripRecalled(text)
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
    originClass = 'agent',
    sessionKind = 'autonomy',
  } = {}) => {
    const verified = verification?.status === 'passed';
    const taskLines = tasks
      .map((t) => `- [${t.status}] ${t.title}: ${stripRecalled(t.result || t.error || '').slice(0, 320)}`)
      .join('\n');
    const cleanTitle = asNonEmptyString(stripRecalled(objectiveTitle)) || 'Objective';
    const episode = memfsStore.saveMemory({
      tier: 'episodic',
      scope,
      scopeId,
      title: `Episode: ${cleanTitle}`,
      body: `Verification: ${verification?.status || 'unverified'} (${stripRecalled(verification?.summary || 'none')})\n${taskLines}`.trim(),
      tags: ['episode', verification?.status || 'unverified'],
      confidence: verified ? 0.9 : 0.5,
      importance: verified ? 0.7 : 0.45,
      originClass,
      sessionKind,
      verificationStatus: verified ? 'verified' : 'unverified',
      sources: [{ kind: 'verification', ref: verification?.id || 'none' }],
      reason: 'episode curation',
    });

    const failureLessons = [];
    for (const failedTask of tasks.filter((t) => (t?.status === 'failed' || t?.status === 'blocked') && asNonEmptyString(t?.error))) {
      const errClean = stripRecalled(failedTask.error).slice(0, 400);
      if (!errClean) continue;
      const slug = String(failedTask.title || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      const lesson = memfsStore.saveMemory({
        tier: 'procedural',
        scope,
        scopeId,
        title: `Avoid Failed Approach: ${String(failedTask.title).slice(0, 100)}`,
        body: `Task "${failedTask.title}" failed with: ${errClean}. Diagnose root cause and avoid repeating the same failing approach.`,
        tags: ['failure-lesson', 'caution'],
        confidence: 0.7,
        importance: 0.75,
        originClass: 'agent',
        sessionKind,
        supersessionKey: `failure-lesson:${slug}`,
        verificationStatus: 'unverified',
        sources: [{ kind: 'task', ref: failedTask.id || slug }],
        reason: 'captured unsuccessful approach',
      });
      failureLessons.push(lesson.id);
    }

    const existingSemantic = memfsStore.listMemories({ tier: 'semantic', scope, scopeId, limit: 200 });
    const saved = [];
    const merged = [];
    const contradictions = [];
    const quarantined = [];

    for (const finding of Array.isArray(findings) ? findings : []) {
      const title = asNonEmptyString(stripRecalled(finding?.title));
      const body = asNonEmptyString(stripRecalled(finding?.body));
      if (!title || !body) continue;
      const findingOrigin = finding?.originClass || originClass;
      if (findingOrigin === 'untrusted') {
        const q = memfsStore.saveMemory({
          tier: 'working',
          scope,
          scopeId,
          title,
          body,
          tags: [...new Set([...(finding.tags || []), 'untrusted-quarantine'])],
          sources: finding.sources || [],
          confidence: 0.3,
          originClass: 'untrusted',
          sessionKind,
          verificationStatus: 'unverified',
          reason: 'untrusted provenance blocked from semantic core',
        });
        quarantined.push(q.id);
        continue;
      }

      const newTokens = tokenize(`${title} ${body}`);
      const newNeg = NEGATION_RE.test(body);
      const hasEvidence = verified && Array.isArray(finding.sources) && finding.sources.length > 0;
      const status = hasEvidence ? 'verified' : 'unverified';
      const confidence = hasEvidence ? Math.max(0.75, Number(finding.confidence) || 0.85) : Math.min(0.55, Number(finding.confidence) || 0.45);
      const importance = Number.isFinite(Number(finding.importance)) ? Number(finding.importance) : (hasEvidence ? 0.75 : 0.5);

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
          triggerPhrases: finding.triggerPhrases || matched.triggerPhrases || [],
          sources: [...(matched.sources || []), ...(finding.sources || [])],
          confidence: Math.max(matched.confidence, confidence),
          importance: Math.max(matched.importance ?? 0.5, importance),
          originClass: findingOrigin,
          sessionKind,
          supersessionKey: finding.supersessionKey || matched.supersessionKey,
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
          originClass: contradicted.originClass,
          sessionKind: contradicted.sessionKind,
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
          originClass: findingOrigin,
          sessionKind,
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
          triggerPhrases: finding.triggerPhrases || [],
          supersessionKey: finding.supersessionKey,
          sources: finding.sources || [],
          confidence,
          importance,
          originClass: findingOrigin,
          sessionKind,
          verificationStatus: status,
          reason: 'curator discovery',
        });
        saved.push(created.id);
        existingSemantic.push(created);
      }
    }

    return { episodeId: episode.id, saved, merged, contradictions, quarantined, failureLessons };
  };

  const consolidateMemories = ({ scope = 'project', scopeId = '', minRecallCount = 2 } = {}) => {
    const episodes = memfsStore.listMemories({ tier: 'episodic', scope, scopeId, limit: 200 });
    const promoted = [];
    for (const ep of episodes) {
      if (ep.originClass === 'untrusted' || ep.originClass === 'system') continue;
      if (ep.flagged || ep.verificationStatus !== 'verified') continue;
      if ((ep.recallCount ?? 0) < minRecallCount) continue;
      const promotedEntry = memfsStore.saveMemory({
        tier: 'semantic',
        scope,
        scopeId,
        title: ep.title.replace(/^Episode:\s*/i, 'Consolidated: '),
        body: ep.body,
        tags: [...new Set([...(ep.tags || []), 'consolidated'])],
        sources: [...(ep.sources || []), { kind: 'memory', ref: ep.id }],
        confidence: Math.min(0.95, ep.confidence + 0.05),
        importance: Math.max(0.75, ep.importance ?? 0.5),
        originClass: ep.originClass,
        sessionKind: ep.sessionKind,
        supersessionKey: `consolidated:${ep.id}`,
        verificationStatus: 'verified',
        reason: `promoted from verified episode after ${ep.recallCount} recalls`,
      });
      promoted.push(promotedEntry.id);
    }
    return { promoted };
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
          originClass: mem.originClass,
          sessionKind: mem.sessionKind,
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
    originClass = 'agent',
    validationCheck = null,
  } = {}) => {
    const skillName = asNonEmptyString(stripRecalled(name));
    if (!skillName) throw new Error('Skill name is required');
    const body = [
      asNonEmptyString(stripRecalled(description)) || skillName,
      ...steps.map((s, idx) => `${idx + 1}. ${stripRecalled(s)}`),
    ].join('\n');

    let passed = false;
    let validationMessage = 'No validation check provided; kept as unverified draft.';
    if (originClass === 'untrusted') {
      validationMessage = 'Untrusted provenance cannot be promoted to procedural skill.';
    } else if (validationCheck) {
      const outcome = await Promise.resolve(validationCheck()).catch((err) => ({ ok: false, error: err?.message || String(err) }));
      passed = outcome?.ok === true;
      validationMessage = passed ? 'Validation check passed; promoted to verified procedural skill.' : (outcome?.error || 'Validation check failed');
    }

    const entry = memfsStore.saveMemory({
      tier: originClass === 'untrusted' ? 'working' : 'procedural',
      scope,
      scopeId,
      title: `Skill: ${skillName}`,
      body,
      tags: ['skill-proposal', passed ? 'promoted' : 'draft'],
      sources: evidenceMemoryIds.map((id) => ({ kind: 'memory', ref: id })),
      confidence: passed ? 0.9 : 0.4,
      importance: passed ? 0.85 : 0.45,
      originClass,
      verificationStatus: passed ? 'verified' : 'unverified',
      reason: validationMessage,
    });
    return { promoted: passed, validationMessage, memory: entry };
  };

  return { curateFromEpisode, consolidateMemories, detectStaleMemories, proposeProceduralSkill };
};
