import { z } from 'zod';

import type { ToolInput } from '@/lib/opencode/model';
import { workflowRunSchema, workflowRunStateSchema } from '@/lib/workflows/model';
import { waitArgsSchema } from '@/sync/extension-waits';


const envelopeSchema = z.object({
  ok: z.boolean(),
  action: z.string().min(1),
  data: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).passthrough().optional().catch(undefined),
});

export type SpleenEnvelope = {
  ok: boolean;
  action: string;
  data: unknown;
  errorMessage: string | undefined;
};

const jsonText = z.string().transform((text, context) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: 'custom', message: 'not JSON' });
    return z.NEVER;
  }
});

export const parseSpleenEnvelope = (output: string | undefined): SpleenEnvelope | null => {
  const outer = jsonText.safeParse(output?.trim() ?? '');
  if (!outer.success) return null;
  const inner = jsonText.safeParse(outer.data);
  const parsed = envelopeSchema.safeParse(inner.success ? inner.data : outer.data);
  if (!parsed.success) return null;
  return {
    ok: parsed.data.ok,
    action: parsed.data.action,
    data: parsed.data.data,
    errorMessage: parsed.data.error?.message?.trim() || undefined,
  };
};

const text = z.string().trim().min(1).optional().catch(undefined);

const linkedEntrySchema = z.object({
  id: text,
  number: z.number().optional().catch(undefined),
  title: text,
  url: z.string().url(),
  kind: text,
});

export const linkedSchema = z.object({ linked: linkedEntrySchema });
export const unlinkedSchema = z.object({ unlinked: z.array(linkedEntrySchema).min(1) });

export const dispatchedSchema = z.object({
  sessionId: z.string().min(1),
  directory: text,
  title: text,
  agent: text,
  model: z.object({ providerID: text, modelID: text }).optional().catch(undefined),
});

export const movedSchema = z.object({
  sessionId: z.string().min(1),
  directory: text,
  worktree: z.object({ name: text, branch: text, path: text }).optional().catch(undefined),
});

export const memorySavedSchema = z.object({
  memory: z.object({
    title: text,
    type: z.enum(['fact', 'preference', 'reference']).optional().catch(undefined),
    scope: z.enum(['global', 'project']).optional().catch(undefined),
  }),
  replaced: z.boolean().optional().catch(undefined),
  warning: text,
});

export const knowledgeSavedSchema = z.object({
  todo: z.object({ text: text, completed: z.boolean().optional().catch(undefined) }).optional().catch(undefined),
  note: z.object({ body: text }).optional().catch(undefined),
  plan: z.object({ title: text, path: text }).optional().catch(undefined),
  warning: text,
}).refine((saved) => Boolean(saved.todo?.text || saved.note?.body || saved.plan?.path), 'nothing to show');

const scheduledTaskSchema = z.object({
  name: text,
  enabled: z.boolean().optional().catch(undefined),
  schedule: z.object({
    kind: z.enum(['daily', 'weekly', 'once', 'cron']),
    times: z.array(z.string()).optional().catch(undefined),
    time: text,
    date: text,
    weekdays: z.array(z.number()).optional().catch(undefined),
    cron: text,
    timezone: text,
  }),
});

export const scheduledSchema = z.object({ task: scheduledTaskSchema });

const notifiedSchema = z.object({ delivered: z.boolean() });

export const projectsListedSchema = z.object({
  projects: z.array(z.object({ id: z.string(), path: text, label: text })),
});

export const sessionsListedSchema = z.object({
  sessions: z.array(z.object({
    id: z.string().min(1),
    title: text,
    parentID: text,
    directory: text,
    location: z.object({ directory: text }).optional().catch(undefined),
  }).transform(({ location, ...session }) => ({ ...session, directory: session.directory ?? location?.directory }))),
});

const modelRefSchema = z.object({ providerID: z.string(), modelID: z.string() });

export const modelPreferencesSchema = z.object({
  defaultModel: text,
  defaultVariant: text,
  defaultAgent: text,
  favoriteModels: z.array(modelRefSchema).catch([]),
  recentModels: z.array(modelRefSchema).catch([]),
});

export const modelsFoundSchema = z.object({
  models: z.array(z.object({ id: z.string().min(1), name: text, provider: text })),
  total: z.number().optional().catch(undefined),
  next: z.number().nullable().optional().catch(undefined),
});

export const memoriesListedSchema = z.object({
  memories: z.array(z.object({
    memoryId: z.string(),
    title: text,
    type: z.enum(['fact', 'preference', 'reference']).optional().catch(undefined),
    scope: z.enum(['global', 'project']).optional().catch(undefined),
  })),
  globalUnavailable: z.boolean().optional().catch(undefined),
  projectUnavailable: z.boolean().optional().catch(undefined),
});

export const knowledgeListedSchema = z.object({
  notes: z.array(z.object({ id: z.string(), body: text })).catch([]),
  todos: z.array(z.object({ id: z.string(), text: text, completed: z.boolean().optional().catch(undefined) })).catch([]),
  plans: z.array(z.object({
    id: z.string(),
    title: text,
    path: text,
    progress: z.object({ done: z.number(), total: z.number() }).optional().catch(undefined),
  })).catch([]),
});

export const scheduleListedSchema = z.object({
  tasks: z.array(scheduledTaskSchema.extend({ id: z.string() })),
});

export const pageOpenedSchema = z.object({ url: z.string().url(), title: text });

export const screenshotSchema = z.object({
  path: z.string().trim().min(1),
  url: z.string().url().optional().catch(undefined),
  title: text,
});

const windowSchema = z.object({
  usedPercent: z.number().nullable().catch(null),
  remainingPercent: z.number().nullable().catch(null),
  resetAt: z.number().nullable().catch(null),
  resetAtFormatted: z.string().nullable().optional().catch(null),
  resetAfterFormatted: z.string().nullable().optional().catch(null),
}).passthrough();

export const usageSchema = z.object({
  providers: z.array(z.object({
    providerId: z.string(),
    providerName: text,
    ok: z.boolean(),
    error: text,
    usage: z.object({ windows: z.record(z.string(), windowSchema).optional().catch(undefined) }).nullable().optional().catch(null),
  })),
});

type UsageProviderRow = z.infer<typeof usageSchema>['providers'][number];
type UsageWindowRow = z.infer<typeof windowSchema>;

export const tightestWindow = (provider: UsageProviderRow): { key: string; window: UsageWindowRow } | null => {
  let best: { key: string; window: UsageWindowRow } | null = null;
  for (const [key, window] of Object.entries(provider.usage?.windows ?? {})) {
    if (window.usedPercent === null) continue;
    if (!best || window.usedPercent > (best.window.usedPercent ?? -1)) best = { key, window };
  }
  return best;
};

export const memoryReadSchema = z.object({
  memory: z.object({
    title: text,
    body: text,
    type: z.enum(['fact', 'preference', 'reference']).optional().catch(undefined),
    scope: z.enum(['global', 'project']).optional().catch(undefined),
  }),
});

const deletedSchema = z.object({ deleted: z.literal(true) });
const knowledgeShownSchema = z.object({ planId: z.string(), shown: z.literal(true) });

export const sessionStatusSchema = z.object({
  sessionId: z.string().min(1),
  directory: text,
  sessionStatus: z.object({ type: z.enum(['idle', 'busy', 'waiting']) }),
});

export const sessionMessagesSchema = z.object({
  sessionId: z.string().min(1),
  directory: text,
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant']),
    createdAt: z.number().nullable().catch(null),
    model: z.string().nullable().catch(null),
    text: z.string(),
  })),
});

export const prWatchedSchema = z.object({
  watching: z.object({
    url: z.string().url(),
    number: z.number().nullable().optional().catch(undefined),
    title: z.string().optional().catch(undefined),
    status: z.enum(['waking', 'unknown', 'pending', 'passed', 'failed', 'open']).optional().catch(undefined),
  }),
});

const waitEntrySchema = z.object({
  waitId: z.string().min(1),
  source: z.string().min(1),
  extension: z.string().nullable().optional().catch(undefined),
  title: z.string().min(1),
  label: z.string().nullable().optional().catch(undefined),
  args: waitArgsSchema.optional().catch(undefined),
  status: z.enum(['waiting', 'waking']).optional().catch(undefined),
});
export type WaitEntry = z.infer<typeof waitEntrySchema>;

export const waitStartedSchema = z.union([prWatchedSchema, z.object({ waiting: waitEntrySchema })]);

export const waitListedSchema = z.object({
  waiting: z.array(waitEntrySchema),
  sources: z.array(z.object({
    source: z.string().min(1),
    extension: z.string().nullable().optional().catch(undefined),
    title: z.string().min(1),
  })),
});

const waitStoppedSchema = z.object({ stopped: z.number() });

const prUnwatchedSchema = z.object({ watching: z.union([z.literal(false), z.array(z.unknown())]), stopped: z.boolean() });

export const workNamedSchema = z.object({
  title: text,
  named: z.boolean(),
  reason: text,
  branch: text,
});

export const fileOpenedSchema = z.object({ path: z.string().trim().min(1), opened: z.literal(true) });

export const scheduleRanSchema = z.object({
  task: scheduledTaskSchema,
  sessionId: z.string().min(1),
  directory: text,
  persistError: text,
});

const scheduleDeletedSchema = z.object({ deleted: z.literal(true), tasks: z.array(z.unknown()) });

const pageSchema = z.object({ url: z.string().url().optional().catch(undefined) });

export const browserSnapshotSchema = pageSchema.extend({
  title: text,
  elements: z.array(z.unknown()).catch([]),
  viewport: z.object({ width: z.number().nullable(), height: z.number().nullable() }).optional().catch(undefined),
  consoleProblems: z.array(z.object({ level: z.string(), message: z.string() })).optional().catch(undefined),
});

export const browserClickedSchema = pageSchema.extend({ clicked: text, label: text });
export const browserTypedSchema = pageSchema.extend({ selector: z.string().min(1) });
export const browserSelectedSchema = pageSchema.extend({ selector: z.string().min(1), label: text, value: z.string().optional().catch(undefined) });
export const browserScrolledSchema = z.object({
  scrollY: z.number(),
  maxScrollY: z.number(),
  atTop: z.boolean().optional().catch(undefined),
  atBottom: z.boolean().optional().catch(undefined),
});
export const browserNavigatedSchema = z.object({ title: z.string(), settled: z.boolean().optional().catch(undefined) });
export const browserInspectedSchema = z.object({
  selector: z.string().min(1),
  tag: text,
  label: text,
  styles: z.record(z.string(), z.string()).catch({}),
});
export const browserResizedSchema = z.object({
  viewport: z.object({ width: z.number().nullable(), height: z.number().nullable() }),
});
const browserClosedSchema = z.object({ closed: z.literal(true) });

export const workflowCheckedSchema = z.object({
  name: z.string(),
  description: text,
  phases: z.array(z.string()).catch([]),
});

export const workflowListedSchema = z.object({
  workflows: z.array(z.object({ name: z.string(), description: text, error: text })).catch([]),
  runs: z.array(z.object({ runId: z.string(), name: z.string(), state: workflowRunStateSchema.optional().catch(undefined) })).catch([]),
});

export const workflowResultSchema = z.union([
  z.object({ runId: z.string(), agent: z.object({ label: z.string(), state: z.string(), result: z.json().optional().catch(undefined), error: text }) }),
  z.object({ runId: z.string(), state: workflowRunStateSchema, result: z.json().optional().catch(undefined), error: text }),
]);

export const workflowStoppedSchema = z.object({ runId: z.string(), state: z.string(), reused: z.number().optional().catch(undefined) });
export const workflowSavedSchema = z.object({ name: z.string(), path: z.string() });

const VIEW_SCHEMAS: ReadonlyMap<string, z.ZodType> = new Map<string, z.ZodType>([
  ['session.link', linkedSchema],
  ['session.unlink', unlinkedSchema],
  ['session.create', dispatchedSchema],
  ['session.send', dispatchedSchema],
  ['session.fork', dispatchedSchema],
  ['session.moveToWorktree', movedSchema],
  ['session.markDone', dispatchedSchema],
  ['session.track', dispatchedSchema],
  ['memory.save', memorySavedSchema],
  ['knowledge.save', knowledgeSavedSchema],
  ['schedule.create', scheduledSchema],
  ['schedule.update', scheduledSchema],
  ['notify.send', notifiedSchema],
  ['usage.read', usageSchema],
  ['projects.list', projectsListedSchema],
  ['session.list', sessionsListedSchema],
  ['models.list', modelPreferencesSchema],
  ['models.search', modelsFoundSchema],
  ['memory.list', memoriesListedSchema],
  ['knowledge.list', knowledgeListedSchema],
  ['schedule.list', scheduleListedSchema],
  ['browser.open', pageOpenedSchema],
  ['browser.capture', screenshotSchema],
  ['memory.read', memoryReadSchema],
  ['memory.delete', deletedSchema],
  ['knowledge.show', knowledgeShownSchema],
  ['knowledge.delete', deletedSchema],
  ['session.status', sessionStatusSchema],
  ['session.messages', sessionMessagesSchema],
  ['pr.watch', prWatchedSchema],
  ['pr.unwatch', prUnwatchedSchema],
  ['wait.start', waitStartedSchema],
  ['wait.list', waitListedSchema],
  ['wait.stop', waitStoppedSchema],
  ['work.name', workNamedSchema],
  ['file.open', fileOpenedSchema],
  ['schedule.run', scheduleRanSchema],
  ['schedule.delete', scheduleDeletedSchema],
  ['schedule.toggle', scheduledSchema],
  ['browser.snapshot', browserSnapshotSchema],
  ['browser.click', browserClickedSchema],
  ['browser.type', browserTypedSchema],
  ['browser.select', browserSelectedSchema],
  ['browser.scroll', browserScrolledSchema],
  ['browser.back', browserNavigatedSchema],
  ['browser.forward', browserNavigatedSchema],
  ['browser.inspect', browserInspectedSchema],
  ['browser.resize', browserResizedSchema],
  ['browser.close', browserClosedSchema],
  ['workflow.check', workflowCheckedSchema],
  ['workflow.status', workflowRunSchema],
  ['workflow.result', workflowResultSchema],
  ['workflow.list', workflowListedSchema],
  ['workflow.stop', workflowStoppedSchema],
  ['workflow.resume', workflowStoppedSchema],
  ['workflow.save', workflowSavedSchema],
]);

export const hasSpleenView = (envelope: SpleenEnvelope): boolean => {
  if (!envelope.ok) return false;
  const schema = VIEW_SCHEMAS.get(envelope.action);
  return schema ? schema.safeParse(envelope.data).success : false;
};
const secretRunSchema = z.object({
  answer: z.union([
    z.object({
      status: z.literal('ran'),
      outcome: z.enum(['exited', 'timeout', 'killed', 'not-started']).catch('killed'),
      exitCode: z.number().int().nullable().catch(null),
    }),
    z.object({ status: z.literal('declined') }),
    z.object({ answered: z.literal(false) }),
  ]),
  stdout: z.string().optional().catch(undefined),
  stderr: z.string().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

type SecretRunVerbKey =
  | 'chat.toolPart.spleen.action.secretRun'
  | 'chat.toolPart.spleen.action.secretRunFailed'
  | 'chat.toolPart.spleen.action.secretRunTimedOut'
  | 'chat.toolPart.spleen.action.secretRunNotStarted'
  | 'chat.toolPart.spleen.action.secretRunStopped'
  | 'chat.toolPart.spleen.action.secretRunDeclined'
  | 'chat.toolPart.spleen.action.secretRunNotRun'
  | 'chat.toolPart.spleen.action.secretRequestSaved'
  | 'chat.toolPart.spleen.action.secretRequestDeclined'
  | 'chat.toolPart.spleen.action.secretRequestNotGiven';

const secretRequestSchema = z.object({
  answer: z.union([
    z.object({ status: z.literal('saved'), file: z.string().optional().catch(undefined) }),
    z.object({ status: z.literal('declined') }),
    z.object({ answered: z.literal(false) }),
  ]),
});

export const secretRowView = (
  envelope: Pick<SpleenEnvelope, 'ok' | 'action'> & { data?: unknown } | null,
): { key: SecretRunVerbKey; code?: number; output?: string; file?: string } | null => {
  if (envelope?.ok !== true) return null;
  if (envelope.action === 'secret.request') {
    const request = secretRequestSchema.safeParse(envelope.data);
    if (!request.success) return null;
    const { answer } = request.data;
    if ('answered' in answer) return { key: 'chat.toolPart.spleen.action.secretRequestNotGiven' };
    if (answer.status === 'declined') return { key: 'chat.toolPart.spleen.action.secretRequestDeclined' };
    return { key: 'chat.toolPart.spleen.action.secretRequestSaved', file: answer.file };
  }
  if (envelope.action !== 'secret.run') return null;
  const parsed = secretRunSchema.safeParse(envelope.data);
  if (!parsed.success) return null;
  const { answer, stdout = '', stderr = '', error = '' } = parsed.data;
  const output = [stdout, stderr, error].map((part) => part.trimEnd()).filter(Boolean).join('\n');
  if ('answered' in answer) return { key: 'chat.toolPart.spleen.action.secretRunNotRun', output };
  if (answer.status === 'declined') return { key: 'chat.toolPart.spleen.action.secretRunDeclined', output };
  if (answer.outcome === 'timeout') return { key: 'chat.toolPart.spleen.action.secretRunTimedOut', output };
  if (answer.outcome === 'not-started') return { key: 'chat.toolPart.spleen.action.secretRunNotStarted', output };
  if (answer.outcome === 'killed' || answer.exitCode === null) return { key: 'chat.toolPart.spleen.action.secretRunStopped', output };
  if (answer.exitCode !== 0) return { key: 'chat.toolPart.spleen.action.secretRunFailed', code: answer.exitCode, output };
  return { key: 'chat.toolPart.spleen.action.secretRun', output };
};

export const SPLEEN_ACTION_VERB_KEYS = {
  'projects.list': 'chat.toolPart.spleen.action.projectsList',
  'models.list': 'chat.toolPart.spleen.action.modelsList',
  'models.search': 'chat.toolPart.spleen.action.modelsSearch',
  'session.list': 'chat.toolPart.spleen.action.sessionList',
  'session.create': 'chat.toolPart.spleen.action.sessionCreate',
  'session.send': 'chat.toolPart.spleen.action.sessionSend',
  'session.fork': 'chat.toolPart.spleen.action.sessionFork',
  'session.status': 'chat.toolPart.spleen.action.sessionStatus',
  'session.messages': 'chat.toolPart.spleen.action.sessionMessages',
  'session.moveToWorktree': 'chat.toolPart.spleen.action.sessionMoveToWorktree',
  'session.link': 'chat.toolPart.spleen.action.sessionLink',
  'session.unlink': 'chat.toolPart.spleen.action.sessionUnlink',
  'session.markDone': 'chat.toolPart.spleen.action.sessionMarkDone',
  'session.track': 'chat.toolPart.spleen.action.sessionTrack',
  'pr.watch': 'chat.toolPart.spleen.action.prWatch',
  'pr.unwatch': 'chat.toolPart.spleen.action.prUnwatch',
  'wait.list': 'chat.toolPart.spleen.action.waitList',
  'wait.start': 'chat.toolPart.spleen.action.waitStart',
  'wait.stop': 'chat.toolPart.spleen.action.waitStop',
  'work.name': 'chat.toolPart.spleen.action.workName',
  'file.open': 'chat.toolPart.spleen.action.fileOpen',
  'schedule.list': 'chat.toolPart.spleen.action.scheduleList',
  'schedule.create': 'chat.toolPart.spleen.action.scheduleCreate',
  'schedule.update': 'chat.toolPart.spleen.action.scheduleUpdate',
  'schedule.run': 'chat.toolPart.spleen.action.scheduleRun',
  'schedule.delete': 'chat.toolPart.spleen.action.scheduleDelete',
  'schedule.toggle': 'chat.toolPart.spleen.action.scheduleToggle',
  'knowledge.list': 'chat.toolPart.spleen.action.knowledgeList',
  'knowledge.save': 'chat.toolPart.spleen.action.knowledgeSave',
  'knowledge.delete': 'chat.toolPart.spleen.action.knowledgeDelete',
  'knowledge.show': 'chat.toolPart.spleen.action.knowledgeShow',
  'memory.read': 'chat.toolPart.spleen.action.memoryRead',
  'memory.list': 'chat.toolPart.spleen.action.memoryList',
  'memory.save': 'chat.toolPart.spleen.action.memorySave',
  'memory.delete': 'chat.toolPart.spleen.action.memoryDelete',
  'notify.send': 'chat.toolPart.spleen.action.notifySend',
  'usage.read': 'chat.toolPart.spleen.action.usageRead',
  'browser.open': 'chat.toolPart.spleen.action.browserOpen',
  'browser.snapshot': 'chat.toolPart.spleen.action.browserSnapshot',
  'browser.click': 'chat.toolPart.spleen.action.browserClick',
  'browser.type': 'chat.toolPart.spleen.action.browserType',
  'browser.select': 'chat.toolPart.spleen.action.browserSelect',
  'browser.scroll': 'chat.toolPart.spleen.action.browserScroll',
  'browser.back': 'chat.toolPart.spleen.action.browserBack',
  'browser.forward': 'chat.toolPart.spleen.action.browserForward',
  'browser.inspect': 'chat.toolPart.spleen.action.browserInspect',
  'browser.capture': 'chat.toolPart.spleen.action.browserCapture',
  'browser.resize': 'chat.toolPart.spleen.action.browserResize',
  'browser.close': 'chat.toolPart.spleen.action.browserClose',
  'image.generate': 'chat.toolPart.spleen.action.imageGenerate',
  'render.page': 'chat.toolPart.spleen.action.renderPage',
  'secret.request': 'chat.toolPart.spleen.action.secretRequest',
  'secret.forget': 'chat.toolPart.spleen.action.secretForget',
  'workflow.check': 'chat.toolPart.spleen.action.workflowCheck',
  'workflow.run': 'chat.toolPart.spleen.action.workflowRun',
  'workflow.status': 'chat.toolPart.spleen.action.workflowStatus',
  'workflow.result': 'chat.toolPart.spleen.action.workflowResult',
  'workflow.stop': 'chat.toolPart.spleen.action.workflowStop',
  'workflow.resume': 'chat.toolPart.spleen.action.workflowResume',
  'workflow.save': 'chat.toolPart.spleen.action.workflowSave',
  'workflow.list': 'chat.toolPart.spleen.action.workflowList',
} as const;

const VERB_KEYS = new Map(Object.entries(SPLEEN_ACTION_VERB_KEYS));

export const spleenVerbKey = (action: string | undefined) => (action ? VERB_KEYS.get(action) : undefined);

const callFields = z.object({
  projectId: text,
  directory: text,
  title: text,
  body: text,
  carry: z.array(z.string()).optional().catch(undefined),
  kind: z.enum(['note', 'todo', 'plan']).optional().catch(undefined),
});
const callInputSchema = callFields.extend({ parameters: callFields.optional().catch(undefined) }).catch({});

export type SpleenCallInput = z.infer<typeof callFields>;

export const readSpleenCallInput = (input: ToolInput | undefined): SpleenCallInput => {
  const parsed = callInputSchema.parse(input ?? {});
  return {
    projectId: parsed.parameters?.projectId ?? parsed.projectId,
    directory: parsed.parameters?.directory ?? parsed.directory,
    title: parsed.parameters?.title ?? parsed.title,
    body: parsed.parameters?.body ?? parsed.body,
    carry: parsed.parameters?.carry ?? parsed.carry,
    kind: parsed.parameters?.kind ?? parsed.kind,
  };
};
