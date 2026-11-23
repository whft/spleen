import React from 'react';
import {
  RiAddLine,
  RiChat3Line,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEditLine,
  RiPlayLine,
  RiSendPlaneLine,
  RiStopCircleLine,
  RiUserAddLine,
} from '@remixicon/react';
import { Icon } from '@/components/icon/Icon';
import { ContextPanelHeaderToolbar } from '@/components/layout/contextPanelHeaderSlot';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useProjectsStore } from '@/stores/useProjectsStore';
import {
  useAgentsStore,
  isAgentBuiltIn,
  type AgentScope,
  type AgentWithExtras,
} from '@/stores/useAgentsStore';
import { teamsApi, type TeamRecord } from './api';
import { TeamLauncher } from './TeamLauncher';
import { TeamExecutionGraph } from './TeamExecutionGraph';

type SubTab = 'topology' | 'board' | 'tasks' | 'agents';

const STATUS_BADGE: Record<string, string> = {
  active: 'border border-border bg-secondary text-foreground',
  running: 'border border-border bg-secondary text-foreground',
  working: 'border border-border bg-secondary text-foreground',
  completed: 'border border-border/80 bg-card text-muted-foreground',
  pending: 'border border-border/60 bg-muted text-muted-foreground',
  idle: 'border border-border/60 bg-muted text-muted-foreground',
  failed: 'border border-border bg-muted text-foreground',
  blocked: 'border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 text-[var(--status-warning)]',
  stopped: 'border border-border/60 bg-muted text-muted-foreground',
  cancelled: 'border border-border/60 bg-muted text-muted-foreground',
};

const isLiveStatus = (status: string): boolean => status === 'active' || status === 'running' || status === 'working';

export const TeamsPanel: React.FC<{ directory: string; visible?: boolean }> = ({ directory, visible = true }) => {
  const { t } = useI18n();
  const projects = useProjectsStore((s) => s.projects);
  const loadAgents = useAgentsStore((s) => s.loadAgents);
  const getVisibleAgents = useAgentsStore((s) => s.getVisibleAgents);
  const createAgent = useAgentsStore((s) => s.createAgent);
  const updateAgent = useAgentsStore((s) => s.updateAgent);
  const deleteAgent = useAgentsStore((s) => s.deleteAgent);
  const fetchAgentEntity = useAgentsStore((s) => s.fetchAgentEntity);
  const agentsByDirectory = useAgentsStore((s) => s.agentsByDirectory);

  const [teams, setTeams] = React.useState<TeamRecord[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeTeam, setActiveTeam] = React.useState<TeamRecord | null>(null);
  const [subTab, setSubTab] = React.useState<SubTab>('topology');
  const [showLauncher, setShowLauncher] = React.useState(false);

  // Board state
  const [boardInput, setBoardInput] = React.useState('');

  // Inline Task form
  const [showTaskForm, setShowTaskForm] = React.useState(false);
  const [taskTitle, setTaskTitle] = React.useState('');
  const [taskPrompt, setTaskPrompt] = React.useState('');
  const [taskAssignee, setTaskAssignee] = React.useState('');
  const [taskDeps, setTaskDeps] = React.useState('');
  const [taskAcceptance, setTaskAcceptance] = React.useState('');

  // Inline Add Member form (replaces window.prompt)
  const [showMemberForm, setShowMemberForm] = React.useState(false);
  const [memberName, setMemberName] = React.useState('');
  const [memberRole, setMemberRole] = React.useState('');
  const [memberAgent, setMemberAgent] = React.useState('');
  const [memberModel, setMemberModel] = React.useState('');
  const [memberDesc, setMemberDesc] = React.useState('');
  const [memberWorktree, setMemberWorktree] = React.useState(false);
  const [addingMember, setAddingMember] = React.useState(false);

  // Project Agents CRUD form
  const [agentFormOpen, setAgentFormOpen] = React.useState(false);
  const [editingAgentName, setEditingAgentName] = React.useState<string | null>(null);
  const [agentName, setAgentName] = React.useState('');
  const [agentScope, setAgentScope] = React.useState<AgentScope>('project');
  const [agentMode, setAgentMode] = React.useState<'primary' | 'subagent' | 'all'>('subagent');
  const [agentModel, setAgentModel] = React.useState('');
  const [agentDescription, setAgentDescription] = React.useState('');
  const [agentSystemPrompt, setAgentSystemPrompt] = React.useState('');
  const [savingAgent, setSavingAgent] = React.useState(false);

  const effectiveDirectory = React.useMemo(
    () => activeTeam?.directory || directory?.trim() || projects[0]?.path?.trim() || '',
    [activeTeam?.directory, directory, projects],
  );

  const loadTeams = React.useCallback(async () => {
    try {
      const list = await teamsApi.list();
      setTeams(list);
      const nextId = selectedId && list.some((x) => x.id === selectedId) ? selectedId : (list[0]?.id ?? null);
      if (nextId !== selectedId) setSelectedId(nextId);
      if (nextId) {
        const detail = await teamsApi.get(nextId);
        setActiveTeam(detail);
      } else {
        setActiveTeam(null);
      }
    } catch {
      // ignore initial error
    }
  }, [selectedId]);

  React.useEffect(() => {
    if (!visible) return;
    void loadTeams();
  }, [visible, loadTeams]);

  React.useEffect(() => {
    if (!visible || !effectiveDirectory) return;
    void loadAgents(effectiveDirectory);
  }, [visible, effectiveDirectory, loadAgents]);

  React.useEffect(() => subscribeSpleenEvents((event) => {
    if (event.type === 'teams-updated') {
      void loadTeams();
    }
  }), [loadTeams]);

  const projectAgents = React.useMemo(() => {
    void agentsByDirectory;
    return getVisibleAgents(effectiveDirectory || undefined) as AgentWithExtras[];
  }, [agentsByDirectory, getVisibleAgents, effectiveDirectory]);

  const selectTeam = async (id: string) => {
    setSelectedId(id);
    setShowLauncher(false);
    try {
      setActiveTeam(await teamsApi.get(id));
    } catch {
      // ignore
    }
  };

  const handlePostBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam || !boardInput.trim()) return;
    const text = boardInput.trim();
    setBoardInput('');
    try {
      await teamsApi.postBoard(activeTeam.id, text);
      await loadTeams();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post');
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam || !taskTitle.trim()) return;
    try {
      await teamsApi.addTask(activeTeam.id, {
        title: taskTitle.trim(),
        prompt: taskPrompt.trim() || taskTitle.trim(),
        assignee: taskAssignee || undefined,
        dependsOn: taskDeps.split(',').map((s) => s.trim()).filter(Boolean),
        acceptance: taskAcceptance.trim() || undefined,
      });
      setTaskTitle('');
      setTaskPrompt('');
      setTaskDeps('');
      setTaskAcceptance('');
      setShowTaskForm(false);
      await loadTeams();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add task');
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam || !memberName.trim()) return;
    setAddingMember(true);
    try {
      await teamsApi.addMember(activeTeam.id, {
        name: memberName.trim(),
        role: (memberRole.trim() || memberName.trim()).toLowerCase().replace(/\s+/g, '-'),
        agent: memberAgent.trim() || undefined,
        model: memberModel.trim() || undefined,
        description: memberDesc.trim() || undefined,
        useWorktree: memberWorktree,
      });
      setMemberName('');
      setMemberRole('');
      setMemberAgent('');
      setMemberModel('');
      setMemberDesc('');
      setMemberWorktree(false);
      setShowMemberForm(false);
      await loadTeams();
      toast.success('Added member to team');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRecruitAgentToTeam = async (agent: AgentWithExtras) => {
    if (!activeTeam) {
      toast.error('Create or select an active team first.');
      return;
    }
    try {
      await teamsApi.addMember(activeTeam.id, {
        name: agent.name,
        role: agent.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
        agent: agent.name,
        description: agent.description || undefined,
      });
      await loadTeams();
      setSubTab('topology');
      toast.success(`Recruited ${agent.name} into ${activeTeam.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to recruit agent');
    }
  };

  const resetAgentForm = () => {
    setEditingAgentName(null);
    setAgentName('');
    setAgentScope('project');
    setAgentMode('subagent');
    setAgentModel('');
    setAgentDescription('');
    setAgentSystemPrompt('');
    setAgentFormOpen(false);
  };

  const startEditAgent = async (agent: AgentWithExtras) => {
    setEditingAgentName(agent.name);
    setAgentName(agent.name);
    setAgentScope(agent.scope ?? 'project');
    setAgentMode((agent.mode as 'primary' | 'subagent' | 'all') || 'subagent');
    setAgentDescription(agent.description || '');
    setAgentModel(agent.model ? `${agent.model.providerID}/${agent.model.id}` : '');
    setAgentSystemPrompt(agent.system || '');
    setAgentFormOpen(true);
    const entity = await fetchAgentEntity(agent.name, effectiveDirectory || undefined);
    if (entity?.config) {
      setAgentDescription(entity.config.description || '');
      setAgentModel(entity.config.model || '');
      setAgentSystemPrompt(entity.config.system || '');
      if (entity.config.mode) setAgentMode(entity.config.mode);
      if (entity.scope) setAgentScope(entity.scope);
    }
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = agentName.trim();
    if (!cleaned || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(cleaned)) {
      toast.error('Agent name must start with a letter or number and only use letters, numbers, ., _, -');
      return;
    }
    if (agentScope === 'project' && !effectiveDirectory) {
      toast.error('Select a project workspace before saving a project-scoped agent.');
      return;
    }
    setSavingAgent(true);
    try {
      const payload = {
        description: agentDescription.trim() || undefined,
        mode: agentMode,
        model: agentModel.trim() || null,
        system: agentSystemPrompt.trim() || undefined,
        scope: agentScope,
      };
      const result = editingAgentName
        ? await updateAgent(editingAgentName, payload, effectiveDirectory || undefined)
        : await createAgent({ name: cleaned, ...payload }, effectiveDirectory || undefined);
      if (!result.ok) {
        toast.error('Failed to save agent configuration.');
        return;
      }
      await loadAgents(effectiveDirectory || undefined);
      toast.success(editingAgentName ? `Updated agent ${cleaned}` : `Created ${agentScope} agent ${cleaned}`);
      resetAgentForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setSavingAgent(false);
    }
  };

  const handleDeleteAgent = async (agent: AgentWithExtras) => {
    try {
      const res = await deleteAgent(agent.name, agent.scope, effectiveDirectory || undefined);
      if (!res.ok) {
        toast.error(`Could not delete ${agent.name}`);
        return;
      }
      await loadAgents(effectiveDirectory || undefined);
      toast.success(`Deleted agent ${agent.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete agent');
    }
  };

  const openSession = (sessionId: string | null, dir: string) => {
    if (!sessionId) return;
    useSessionUIStore.getState().setCurrentSession(sessionId, dir);
  };

  const renderAgentsManager = () => (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">Project & Custom Agents</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {effectiveDirectory ? `${effectiveDirectory}\\.opencode\\agents` : 'No project selected (user scope only)'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (agentFormOpen && !editingAgentName) {
              resetAgentForm();
            } else {
              resetAgentForm();
              setAgentFormOpen(true);
            }
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
        >
          <RiAddLine className="h-3.5 w-3.5" />
          New Agent
        </button>
      </div>

      {agentFormOpen ? (
        <form onSubmit={(e) => void handleSaveAgent(e)} className="flex flex-col gap-2 rounded-lg border border-border bg-card/70 p-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">
              {editingAgentName ? `Edit Agent · ${editingAgentName}` : 'Create Custom Agent'}
            </span>
            <button type="button" onClick={resetAgentForm} className="text-muted-foreground hover:text-foreground">
              <RiCloseLine className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              disabled={Boolean(editingAgentName)}
              placeholder="agent-name (e.g. security-auditor)"
              className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-foreground/50 disabled:opacity-60"
            />
            <div className="grid grid-cols-2 gap-1">
              <select
                value={agentScope}
                onChange={(e) => setAgentScope(e.target.value as AgentScope)}
                disabled={Boolean(editingAgentName)}
                className="rounded border border-border bg-background px-1.5 py-1 text-[11px] outline-none"
              >
                <option value="project">Project</option>
                <option value="user">Global</option>
              </select>
              <select
                value={agentMode}
                onChange={(e) => setAgentMode(e.target.value as 'primary' | 'subagent' | 'all')}
                className="rounded border border-border bg-background px-1.5 py-1 text-[11px] outline-none"
              >
                <option value="subagent">Subagent</option>
                <option value="primary">Primary</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              value={agentDescription}
              onChange={(e) => setAgentDescription(e.target.value)}
              placeholder="Short description / specialty"
              className="rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-foreground/50"
            />
            <input
              value={agentModel}
              onChange={(e) => setAgentModel(e.target.value)}
              placeholder="Model (optional, provider/model)"
              className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-foreground/50"
            />
          </div>
          <textarea
            rows={4}
            value={agentSystemPrompt}
            onChange={(e) => setAgentSystemPrompt(e.target.value)}
            placeholder="System prompt & instructions for this agent..."
            className="resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] outline-none focus:border-foreground/50"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={resetAgentForm} className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingAgent || !agentName.trim()}
              className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {savingAgent ? 'Saving…' : editingAgentName ? 'Update Agent' : 'Create Agent'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="space-y-1.5">
        {projectAgents.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-card/30 p-3 text-center text-[11px] text-muted-foreground">
            No agents loaded for this directory yet. Create a project agent above.
          </div>
        ) : (
          projectAgents.map((agent) => {
            const builtIn = isAgentBuiltIn(agent);
            return (
              <div
                key={`${agent.scope ?? 'builtin'}:${agent.name}`}
                className="flex items-start justify-between gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-semibold text-foreground">{agent.name}</span>
                    <span className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                      {builtIn ? 'built-in' : (agent.scope ?? 'custom')}
                    </span>
                    {agent.mode ? (
                      <span className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                        {agent.mode}
                      </span>
                    ) : null}
                    {agent.model ? (
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {agent.model.providerID}/{agent.model.id}
                      </span>
                    ) : null}
                  </div>
                  {agent.description ? (
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{agent.description}</div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {activeTeam ? (
                    <button
                      type="button"
                      onClick={() => void handleRecruitAgentToTeam(agent)}
                      title={`Add ${agent.name} to ${activeTeam.name}`}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted"
                    >
                      <RiUserAddLine className="h-3 w-3" />
                      Recruit
                    </button>
                  ) : null}
                  {!builtIn ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void startEditAgent(agent)}
                        title="Edit agent"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <RiEditLine className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteAgent(agent)}
                        title="Delete agent"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <RiDeleteBinLine className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <ContextPanelHeaderToolbar>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="ai-teams" className="h-4 w-4 shrink-0 text-foreground" />
            {teams.length > 0 ? (
              <select
                value={selectedId ?? ''}
                onChange={(e) => void selectTeam(e.target.value)}
                className="max-w-[190px] truncate rounded-lg border border-edge bg-surface-elevated px-2 py-1 text-xs font-medium text-foreground outline-none"
              >
                {teams.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.status})
                  </option>
                ))}
              </select>
            ) : (
              <span className="truncate typography-ui-label font-medium text-foreground">{t('contextPanel.mode.teams')}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setShowLauncher((v) => !v)}
              className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
            >
              <Icon name="add" className="h-3.5 w-3.5" />
              {t('teams.launcher.newTeam')}
            </Button>
            <button
              type="button"
              onClick={() => {
                void loadTeams();
                if (effectiveDirectory) void loadAgents(effectiveDirectory);
              }}
              aria-label="Refresh"
              title="Refresh"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground"
            >
              <Icon name="refresh" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </ContextPanelHeaderToolbar>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3.5">
        {showLauncher ? (
          <TeamLauncher
            directory={effectiveDirectory}
            onCreated={(created) => {
              setSelectedId(created.id);
              setActiveTeam(created);
              setShowLauncher(false);
              setSubTab('topology');
              void loadTeams();
            }}
            onCancel={teams.length > 0 ? () => setShowLauncher(false) : undefined}
          />
        ) : !activeTeam ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 pt-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/80 bg-card">
                <Icon name="ai-teams" className="h-5 w-5 text-foreground" />
              </div>
              <div className="text-sm font-medium">{t('teams.empty.title')}</div>
              <div className="max-w-xs text-xs text-muted-foreground">{t('teams.empty.description')}</div>
            </div>
            <TeamLauncher
              directory={effectiveDirectory}
              onCreated={(created) => {
                setSelectedId(created.id);
                setActiveTeam(created);
                setSubTab('topology');
                void loadTeams();
              }}
            />
            <div className="border-t border-border/60 pt-3">
              {renderAgentsManager()}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-3">
            {/* Team summary bar */}
            <div className="flex items-start justify-between gap-2 rounded-lg border border-border/60 bg-card/50 p-2.5 text-xs">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold">{activeTeam.name}</span>
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[activeTeam.status] ?? 'bg-muted'}`}>
                    {isLiveStatus(activeTeam.status) ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success)]" /> : null}
                    {activeTeam.status}
                  </span>
                  {activeTeam.dagSummary ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {activeTeam.dagSummary.completed}/{activeTeam.dagSummary.total} tasks
                    </span>
                  ) : null}
                </div>
                {activeTeam.goal ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{activeTeam.goal}</p>
                ) : null}
                <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/80">
                  {activeTeam.directory}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {activeTeam.status === 'active' ? (
                  <button
                    type="button"
                    title={t('teams.action.stop')}
                    onClick={() => void teamsApi.stop(activeTeam.id).then(loadTeams)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <RiStopCircleLine className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  title={t('teams.action.delete')}
                  onClick={() => void teamsApi.remove(activeTeam.id).then(loadTeams)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <RiDeleteBinLine className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Sub-navigation */}
            <div className="flex items-center gap-1 border-b border-border/60 pb-1.5 text-xs">
              {(
                [
                  { id: 'topology', label: 'Topology' },
                  { id: 'board', label: `${t('teams.tab.board')} (${activeTeam.messages?.length ?? 0})` },
                  { id: 'tasks', label: `${t('teams.tab.tasks')} (${activeTeam.tasks?.length ?? 0})` },
                  { id: 'agents', label: `Agents (${projectAgents.length})` },
                ] as Array<{ id: SubTab; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubTab(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                    subTab === tab.id
                      ? 'border border-border/80 bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {subTab === 'topology' ? (
              <div className="flex flex-col gap-2.5">
                <TeamExecutionGraph
                  teamName={activeTeam.name}
                  teamStatus={activeTeam.status}
                  members={activeTeam.members}
                  tasks={activeTeam.tasks ?? []}
                  onSelectMember={(member) => openSession(member.sessionId, member.directory || activeTeam.directory)}
                />

                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Roster ({activeTeam.members.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowMemberForm((v) => !v)}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                  >
                    <RiUserAddLine className="h-3.5 w-3.5" />
                    {t('teams.action.addMember')}
                  </button>
                </div>

                {showMemberForm ? (
                  <form onSubmit={(e) => void handleAddMember(e)} className="flex flex-col gap-2 rounded-lg border border-border bg-card/70 p-2.5 text-xs">
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        value={memberName}
                        onChange={(e) => setMemberName(e.target.value)}
                        placeholder="Member name (e.g. Security)"
                        className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground/50"
                      />
                      <input
                        value={memberRole}
                        onChange={(e) => setMemberRole(e.target.value)}
                        placeholder="Role tag (e.g. security)"
                        className="rounded border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-foreground/50"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        value={memberAgent}
                        onChange={(e) => setMemberAgent(e.target.value)}
                        className="rounded border border-border bg-background px-2 py-1 text-xs outline-none"
                      >
                        <option value="">Agent: Default (build)</option>
                        {projectAgents.map((ag) => (
                          <option key={ag.name} value={ag.name}>
                            {ag.name}{ag.scope ? ` (${ag.scope})` : ''}
                          </option>
                        ))}
                      </select>
                      <input
                        value={memberModel}
                        onChange={(e) => setMemberModel(e.target.value)}
                        placeholder="Model override (optional)"
                        className="rounded border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-foreground/50"
                      />
                    </div>
                    <input
                      value={memberDesc}
                      onChange={(e) => setMemberDesc(e.target.value)}
                      placeholder="Responsibility / focus"
                      className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground/50"
                    />
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={memberWorktree}
                          onChange={(e) => setMemberWorktree(e.target.checked)}
                        />
                        Isolate in git worktree
                      </label>
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => setShowMemberForm(false)} className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={addingMember || !memberName.trim()}
                          className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                        >
                          {addingMember ? 'Spawning…' : 'Spawn Member'}
                        </button>
                      </div>
                    </div>
                  </form>
                ) : null}

                {activeTeam.members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 text-xs">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium">
                        <span>{member.name}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{member.role}</span>
                        {member.agent ? (
                          <span className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                            @{member.agent}
                          </span>
                        ) : null}
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[member.status] ?? 'bg-muted'}`}>
                          {isLiveStatus(member.status) ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success)]" /> : null}
                          {member.status}
                        </span>
                      </div>
                      {member.description ? (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{member.description}</div>
                      ) : null}
                      {member.model ? (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">{member.model}</div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {member.sessionId ? (
                        <button
                          type="button"
                          onClick={() => openSession(member.sessionId, member.directory || activeTeam.directory)}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                        >
                          <RiChat3Line className="h-3.5 w-3.5" />
                          {t('teams.action.openSession')}
                        </button>
                      ) : null}
                      {member.role !== 'lead' ? (
                        <button
                          type="button"
                          title="Remove member"
                          onClick={() => void teamsApi.removeMember(activeTeam.id, member.id).then(loadTeams)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <RiCloseLine className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {subTab === 'board' ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setBoardInput((prev) => `${prev ? `${prev} ` : ''}@all `)}
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    @all
                  </button>
                  {activeTeam.members.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setBoardInput((prev) => `${prev ? `${prev} ` : ''}@${m.role} `)}
                      className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      @{m.role}
                    </button>
                  ))}
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-border/50 bg-card/30 p-2.5">
                  {(activeTeam.messages ?? []).length === 0 ? (
                    <div className="py-6 text-center text-[11px] text-muted-foreground">
                      No messages yet. Tag <span className="font-mono">@lead</span> or <span className="font-mono">@all</span> to instruct the team.
                    </div>
                  ) : (
                    (activeTeam.messages ?? []).map((msg) => (
                      <div key={msg.id} className="rounded-md border border-border/40 bg-background/80 p-2 text-xs">
                        <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="font-semibold text-foreground">{msg.author}</span>
                          <span className="font-mono">{new Date(msg.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <div className="whitespace-pre-wrap text-xs">{msg.body}</div>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={(e) => void handlePostBoard(e)} className="flex gap-1.5">
                  <input
                    value={boardInput}
                    onChange={(e) => setBoardInput(e.target.value)}
                    placeholder={t('teams.board.placeholder')}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-foreground/50"
                  />
                  <button
                    type="submit"
                    disabled={!boardInput.trim()}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    <RiSendPlaneLine className="h-3.5 w-3.5" />
                    {t('teams.board.send')}
                  </button>
                </form>
              </div>
            ) : null}

            {subTab === 'tasks' ? (
              <div className="flex flex-col gap-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowTaskForm((v) => !v)}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                  >
                    <RiAddLine className="h-3.5 w-3.5" />
                    {t('teams.action.addTask')}
                  </button>
                </div>
                {showTaskForm ? (
                  <form onSubmit={(e) => void handleAddTask(e)} className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-2.5 text-xs">
                    <input
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      placeholder={t('teams.tasks.titlePlaceholder')}
                      className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground/50"
                    />
                    <textarea
                      rows={2}
                      value={taskPrompt}
                      onChange={(e) => setTaskPrompt(e.target.value)}
                      placeholder={t('teams.tasks.promptPlaceholder')}
                      className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground/50"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={taskAssignee}
                        onChange={(e) => setTaskAssignee(e.target.value)}
                        className="rounded border border-border bg-background px-2 py-1 text-xs"
                      >
                        <option value="">Auto-assign</option>
                        {activeTeam.members.map((m) => (
                          <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                        ))}
                      </select>
                      <input
                        value={taskDeps}
                        onChange={(e) => setTaskDeps(e.target.value)}
                        placeholder={t('teams.tasks.dependsOnPlaceholder')}
                        className="rounded border border-border bg-background px-2 py-1 font-mono text-xs"
                      />
                    </div>
                    <input
                      value={taskAcceptance}
                      onChange={(e) => setTaskAcceptance(e.target.value)}
                      placeholder="Acceptance criteria (optional)"
                      className="rounded border border-border bg-background px-2 py-1 text-xs"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={() => setShowTaskForm(false)} className="rounded px-2 py-1 text-muted-foreground hover:text-foreground">
                        {t('teams.action.cancel')}
                      </button>
                      <button type="submit" className="rounded bg-primary px-2.5 py-1 font-medium text-primary-foreground">
                        {t('teams.action.addTask')}
                      </button>
                    </div>
                  </form>
                ) : null}
                {(activeTeam.tasks ?? []).length === 0 ? (
                  <div className="rounded-lg border border-border/60 bg-card/30 p-4 text-center text-[11px] text-muted-foreground">
                    No DAG tasks queued yet. The Lead Manager creates tasks automatically when given a goal, or add one manually above.
                  </div>
                ) : (
                  (activeTeam.tasks ?? []).map((task) => {
                    const member = activeTeam.members.find((m) => m.id === task.assignee);
                    return (
                      <div key={task.id} className="rounded-lg border border-border/60 bg-card/40 p-2.5 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium">{task.title}</span>
                              <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
                              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[task.status] ?? 'bg-muted'}`}>
                                {isLiveStatus(task.status) ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success)]" /> : null}
                                {task.status}
                              </span>
                              {member ? (
                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">@{member.role}</span>
                              ) : null}
                            </div>
                            {task.dependsOn.length > 0 ? (
                              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                depends: {task.dependsOn.join(', ')}
                              </div>
                            ) : null}
                            {task.acceptance ? (
                              <div className="mt-0.5 text-[10px] text-muted-foreground">
                                acceptance: {task.acceptance}
                              </div>
                            ) : null}
                            {task.error ? <div className="mt-1 text-[11px] text-foreground/90">{task.error}</div> : null}
                            {task.result ? (
                              <div className="mt-1 line-clamp-3 whitespace-pre-wrap rounded bg-background/70 p-1.5 text-[11px] text-muted-foreground">
                                {task.result}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {task.status === 'running' || task.status === 'pending' ? (
                              <button
                                type="button"
                                title="Mark completed"
                                onClick={() => void teamsApi.updateTask(activeTeam.id, task.id, { status: 'completed' }).then(loadTeams)}
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <RiCheckLine className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                            {(task.status === 'failed' || task.status === 'cancelled') ? (
                              <button
                                type="button"
                                title={t('teams.action.retry')}
                                onClick={() => void teamsApi.retryTask(activeTeam.id, task.id).then(loadTeams)}
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <RiPlayLine className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                            {(task.status === 'pending' || task.status === 'running') ? (
                              <button
                                type="button"
                                title={t('teams.action.cancel')}
                                onClick={() => void teamsApi.cancelTask(activeTeam.id, task.id).then(loadTeams)}
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <RiCloseLine className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}

            {subTab === 'agents' ? renderAgentsManager() : null}
          </div>
        )}
      </div>
    </div>
  );
};
