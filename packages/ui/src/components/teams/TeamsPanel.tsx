import React from 'react';
import {
  RiAddLine,
  RiChat3Line,
  RiCloseLine,
  RiDeleteBinLine,
  RiPlayLine,
  RiRefreshLine,
  RiSendPlaneLine,
  RiStopCircleLine,
  RiTeamLine,
  RiUserAddLine,
} from '@remixicon/react';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { teamsApi, type TeamRecord } from './api';
import { TeamLauncher } from './TeamLauncher';

type SubTab = 'roster' | 'board' | 'tasks';

const STATUS_BADGE: Record<string, string> = {
  active: 'border border-border bg-secondary text-foreground',
  running: 'border border-border bg-secondary text-foreground',
  working: 'border border-border bg-secondary text-foreground',
  completed: 'border border-border/80 bg-card text-muted-foreground',
  pending: 'border border-border/60 bg-muted text-muted-foreground',
  idle: 'border border-border/60 bg-muted text-muted-foreground',
  failed: 'border border-destructive/30 bg-destructive/12 text-destructive',
  stopped: 'border border-border/60 bg-muted text-muted-foreground',
  cancelled: 'border border-border/60 bg-muted text-muted-foreground',
};

const isLiveStatus = (status: string): boolean => status === 'active' || status === 'running' || status === 'working';

export const TeamsPanel: React.FC<{ directory: string; visible?: boolean }> = ({ directory, visible = true }) => {
  const { t } = useI18n();
  const [teams, setTeams] = React.useState<TeamRecord[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeTeam, setActiveTeam] = React.useState<TeamRecord | null>(null);
  const [subTab, setSubTab] = React.useState<SubTab>('board');
  const [showLauncher, setShowLauncher] = React.useState(false);
  const [boardInput, setBoardInput] = React.useState('');
  const [showTaskForm, setShowTaskForm] = React.useState(false);
  const [taskTitle, setTaskTitle] = React.useState('');
  const [taskPrompt, setTaskPrompt] = React.useState('');
  const [taskAssignee, setTaskAssignee] = React.useState('');
  const [taskDeps, setTaskDeps] = React.useState('');

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

  React.useEffect(() => subscribeSpleenEvents((event) => {
    if (event.type === 'teams-updated') {
      void loadTeams();
    }
  }), [loadTeams]);

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
      });
      setTaskTitle('');
      setTaskPrompt('');
      setTaskDeps('');
      setShowTaskForm(false);
      await loadTeams();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add task');
    }
  };

  const handleAddMember = async () => {
    if (!activeTeam) return;
    const role = window.prompt('Member role or name (e.g. Security, QA, Reviewer):');
    if (!role?.trim()) return;
    try {
      await teamsApi.addMember(activeTeam.id, { name: role.trim(), role: role.trim().toLowerCase() });
      await loadTeams();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add member');
    }
  };

  const openSession = (sessionId: string | null, dir: string) => {
    if (!sessionId) return;
    useSessionUIStore.getState().setCurrentSession(sessionId, dir);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <RiTeamLine className="h-4 w-4 shrink-0 text-primary" />
          {teams.length > 0 ? (
            <select
              value={selectedId ?? ''}
              onChange={(e) => void selectTeam(e.target.value)}
              className="max-w-[200px] truncate rounded border border-border bg-card px-2 py-1 text-xs font-medium text-foreground"
            >
              {teams.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.status})
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs font-semibold">{t('contextPanel.mode.teams')}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowLauncher((v) => !v)}
            className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
          >
            <RiAddLine className="h-3.5 w-3.5" />
            {t('teams.launcher.newTeam')}
          </button>
          <button
            type="button"
            onClick={() => void loadTeams()}
            aria-label="Refresh"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RiRefreshLine className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        {showLauncher ? (
          <TeamLauncher
            directory={directory}
            onCreated={(created) => {
              setSelectedId(created.id);
              setActiveTeam(created);
              setShowLauncher(false);
              void loadTeams();
            }}
            onCancel={teams.length > 0 ? () => setShowLauncher(false) : undefined}
          />
        ) : !activeTeam ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <RiTeamLine className="h-10 w-10 text-muted-foreground/50" />
            <div className="text-sm font-medium">{t('teams.empty.title')}</div>
            <div className="max-w-xs text-xs text-muted-foreground">{t('teams.empty.description')}</div>
            <TeamLauncher
              directory={directory}
              onCreated={(created) => {
                setSelectedId(created.id);
                setActiveTeam(created);
                void loadTeams();
              }}
            />
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-3">
            {/* Team summary bar */}
            <div className="flex items-start justify-between gap-2 rounded-lg border border-border/60 bg-card/50 p-2.5 text-xs">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{activeTeam.name}</span>
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[activeTeam.status] ?? 'bg-muted'}`}>
                    {isLiveStatus(activeTeam.status) ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--spleen-accent,#C8FA62)]" /> : null}
                    {activeTeam.status}
                  </span>
                  {activeTeam.dagSummary ? (
                    <span className="text-[11px] text-muted-foreground">
                      {activeTeam.dagSummary.completed}/{activeTeam.dagSummary.total}
                    </span>
                  ) : null}
                </div>
                {activeTeam.goal ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{activeTeam.goal}</p>
                ) : null}
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
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                >
                  <RiDeleteBinLine className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Sub-navigation */}
            <div className="flex items-center gap-1 border-b border-border/60 pb-1.5 text-xs">
              {(['board', 'tasks', 'roster'] as SubTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSubTab(tab)}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${
                    subTab === tab ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(`teams.tab.${tab}`)}
                </button>
              ))}
            </div>

            {subTab === 'roster' ? (
              <div className="flex flex-col gap-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleAddMember()}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                  >
                    <RiUserAddLine className="h-3.5 w-3.5" />
                    {t('teams.action.addMember')}
                  </button>
                </div>
                {activeTeam.members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 text-xs">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <span>{member.name}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{member.role}</span>
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[member.status] ?? 'bg-muted'}`}>
                          {isLiveStatus(member.status) ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--spleen-accent,#C8FA62)]" /> : null}
                          {member.status}
                        </span>
                      </div>
                      {member.description ? (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{member.description}</div>
                      ) : null}
                    </div>
                    {member.sessionId ? (
                      <button
                        type="button"
                        onClick={() => openSession(member.sessionId, member.directory || activeTeam.directory)}
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                      >
                        <RiChat3Line className="h-3.5 w-3.5" />
                        {t('teams.action.openSession')}
                      </button>
                    ) : null}
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
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    @all
                  </button>
                  {activeTeam.members.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setBoardInput((prev) => `${prev ? `${prev} ` : ''}@${m.role} `)}
                      className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      @{m.role}
                    </button>
                  ))}
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-border/50 bg-card/30 p-2.5">
                  {(activeTeam.messages ?? []).map((msg) => (
                    <div key={msg.id} className="rounded-md border border-border/40 bg-background/80 p-2 text-xs">
                      <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="font-semibold text-foreground">{msg.author}</span>
                        <span>{new Date(msg.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <div className="whitespace-pre-wrap text-xs">{msg.body}</div>
                    </div>
                  ))}
                </div>
                <form onSubmit={(e) => void handlePostBoard(e)} className="flex gap-1.5">
                  <input
                    value={boardInput}
                    onChange={(e) => setBoardInput(e.target.value)}
                    placeholder={t('teams.board.placeholder')}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
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
                      className="rounded border border-border bg-background px-2 py-1 text-xs"
                    />
                    <textarea
                      rows={2}
                      value={taskPrompt}
                      onChange={(e) => setTaskPrompt(e.target.value)}
                      placeholder={t('teams.tasks.promptPlaceholder')}
                      className="rounded border border-border bg-background px-2 py-1 text-xs"
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
                        className="rounded border border-border bg-background px-2 py-1 text-xs"
                      />
                    </div>
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
                {(activeTeam.tasks ?? []).map((task) => {
                  const member = activeTeam.members.find((m) => m.id === task.assignee);
                  return (
                    <div key={task.id} className="rounded-lg border border-border/60 bg-card/40 p-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{task.title}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
                            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[task.status] ?? 'bg-muted'}`}>
                              {isLiveStatus(task.status) ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--spleen-accent,#C8FA62)]" /> : null}
                              {task.status}
                            </span>
                            {member ? (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">@{member.role}</span>
                            ) : null}
                          </div>
                          {task.dependsOn.length > 0 ? (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              depends: {task.dependsOn.join(', ')}
                            </div>
                          ) : null}
                          {task.error ? <div className="mt-1 text-[11px] text-destructive">{task.error}</div> : null}
                          {task.result ? (
                            <div className="mt-1 line-clamp-3 whitespace-pre-wrap rounded bg-background/70 p-1.5 text-[11px] text-muted-foreground">
                              {task.result}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
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
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                            >
                              <RiCloseLine className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
