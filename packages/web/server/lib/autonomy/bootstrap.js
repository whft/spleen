import path from 'node:path';
import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { createAutonomyStore } from './store.js';
import { createEvidenceVerifier } from './verifier.js';
import { createAutonomySupervisor } from './supervisor.js';
import { registerAutonomyRoutes } from './routes.js';
import { createMemFsStore } from '../agent-memory/memfs-store.js';
import { createMemoryCurator } from '../agent-memory/curator.js';
import { registerMemFsRoutes } from '../agent-memory/memfs-routes.js';
import { createResearchStore } from '../research/store.js';
import { createResearchIngestor } from '../research/ingest.js';
import { registerResearchRoutes } from '../research/routes.js';

export const bootstrapAutonomyPlatform = (app, {
  dataDir,
  requireAuthorized = null,
  broadcastEvent = null,
  getSessionRecoveryRuntime = null,
  getScheduledTasksRuntime = null,
  getDiscordGateway = null,
  executeTask = null,
  autoStart = true,
} = {}) => {
  const autonomyStore = createAutonomyStore({ dbPath: path.join(dataDir, 'autonomy.sqlite3') });
  const memfsStore = createMemFsStore({ dbPath: path.join(dataDir, 'memory.sqlite3') });
  const memoryCurator = createMemoryCurator({ memfsStore });
  const researchStore = createResearchStore({ dbPath: path.join(dataDir, 'research.sqlite3') });
  const researchIngestor = createResearchIngestor({ store: researchStore });
  const verifier = createEvidenceVerifier();

  const supervisor = createAutonomySupervisor({
    store: autonomyStore,
    verifier,
    executeTask,
    broadcastEvent,
    onObjectiveCompleted: (detail, verifyRes) => {
      memoryCurator.curateFromEpisode({
        scope: 'project',
        scopeId: detail?.directory || '',
        objectiveTitle: detail?.title || 'Objective',
        tasks: detail?.tasks || [],
        verification: verifyRes?.verification || { status: verifyRes?.status, summary: verifyRes?.summary },
      });
    },
  });

  if (autoStart) {
    supervisor.start();
  }
  registerAutonomyRoutes(app, { supervisor, requireAuthorized });
  registerMemFsRoutes(app, { memfsStore, curator: memoryCurator, requireAuthorized });
  registerResearchRoutes(app, { store: researchStore, ingestor: researchIngestor, requireAuthorized });

  app.get('/api/diagnostics/overview', async (req, res) => {
    if (requireAuthorized) {
      const ok = await requireAuthorized(req, res);
      if (!ok) return;
    }
    const recovery = getSessionRecoveryRuntime?.();
    const scheduler = getScheduledTasksRuntime?.();
    const gateway = getDiscordGateway?.();
    res.json({
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      autonomy: supervisor.getStatus(),
      research: {
        sources: researchStore.listSources().length,
        findings: researchStore.listFindings({ limit: 500 }).length,
      },
      memfs: {
        total: memfsStore.listMemories({ limit: 500 }).length,
        verified: memfsStore.listMemories({ verificationStatus: 'verified', limit: 500 }).length,
        contradicted: memfsStore.listMemories({ verificationStatus: 'contradicted', limit: 500 }).length,
      },
      recovery: recovery?.getStatus ? await Promise.resolve(recovery.getStatus()).catch(() => null) : null,
      scheduler: scheduler?.getStatus ? scheduler.getStatus() : null,
      discordGateway: gateway?.getHealth ? gateway.getHealth() : null,
    });
  });

  const handleControlAction = async (action, input = {}, context = {}) => {
    const dir = asNonEmptyString(input.directory) || asNonEmptyString(context?.contextDirectory) || process.cwd();
    switch (action) {
      case 'autonomy.create': return supervisor.createObjective({ ...input, directory: dir });
      case 'autonomy.list': return { objectives: supervisor.listObjectives({ status: asNonEmptyString(input.status), directory: asNonEmptyString(input.directory), limit: input.limit }) };
      case 'autonomy.get': return supervisor.getObjective(asNonEmptyString(input.objectiveId) || asNonEmptyString(input.id));
      case 'autonomy.addTask': return supervisor.addTask(asNonEmptyString(input.objectiveId) || asNonEmptyString(input.id), input);
      case 'autonomy.replan': return supervisor.replanObjective(asNonEmptyString(input.objectiveId) || asNonEmptyString(input.id), input);
      case 'autonomy.pause': return supervisor.pauseObjective(asNonEmptyString(input.objectiveId) || asNonEmptyString(input.id), asNonEmptyString(input.reason) || 'Paused');
      case 'autonomy.resume': return supervisor.resumeObjective(asNonEmptyString(input.objectiveId) || asNonEmptyString(input.id));
      case 'autonomy.cancel': return supervisor.cancelObjective(asNonEmptyString(input.objectiveId) || asNonEmptyString(input.id), asNonEmptyString(input.reason) || 'Cancelled');
      case 'autonomy.verify': return await supervisor.verifyObjective(asNonEmptyString(input.objectiveId) || asNonEmptyString(input.id), { autoDetect: input.autoDetect === true });
      case 'memfs.save': return memfsStore.saveMemory({ ...input, scopeId: asNonEmptyString(input.scopeId) ?? dir });
      case 'memfs.search': return { entries: memfsStore.searchMemories({ ...input, query: asNonEmptyString(input.query) || '' }) };
      case 'memfs.history': return { history: memfsStore.listHistory(asNonEmptyString(input.memoryId) || asNonEmptyString(input.id)) };
      case 'memfs.rollback': return memfsStore.rollbackMemory(asNonEmptyString(input.memoryId) || asNonEmptyString(input.id), input.version);
      case 'memfs.curate': return memoryCurator.curateFromEpisode({ ...input, scopeId: asNonEmptyString(input.scopeId) ?? dir });
      case 'research.registerSource': {
        const src = researchStore.registerSource(input);
        const stats = input.indexNow !== false && (src.kind === 'directory' || src.kind === 'git' || src.kind === 'file')
          ? await researchIngestor.indexSource(src.id)
          : null;
        return { source: researchStore.getSource(src.id), stats };
      }
      case 'research.listSources': return { sources: researchStore.listSources() };
      case 'research.refreshSource': return await researchIngestor.indexSource(asNonEmptyString(input.sourceId) || asNonEmptyString(input.id));
      case 'research.search': return { results: researchStore.search(isRecord(input) ? input : {}) };
      case 'research.recordFinding': return researchStore.recordFinding(input);
      case 'research.importAnalysis': return researchIngestor.importAnalysisArtifacts(input);
      case 'research.compareBuilds': return researchIngestor.compareBuilds(input.buildHashA, input.buildHashB);
      default: return null;
    }
  };

  const stop = () => {
    supervisor.stop();
    try { autonomyStore.close(); } catch {}
    try { memfsStore.close(); } catch {}
    try { researchStore.close(); } catch {}
  };

  return { supervisor, autonomyStore, memfsStore, memoryCurator, researchStore, researchIngestor, handleControlAction, stop };
};
