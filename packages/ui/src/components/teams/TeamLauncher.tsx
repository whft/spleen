import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useAgentsStore, type AgentWithExtras } from '@/stores/useAgentsStore';
import { teamsApi, type TeamMemberInput, type TeamRecord } from './api';

type PresetMemberTemplate = {
  name: string;
  role: string;
  description: string;
  agent: string;
  model: string;
};

const PRESET_TEMPLATES: Record<string, PresetMemberTemplate[]> = {
  'full-stack': [
    { name: 'Lead', role: 'lead', description: 'Coordinates architecture, DAG tasks, and final verification.', agent: '', model: '' },
    { name: 'Backend', role: 'backend', description: 'Implements APIs, storage, server logic, and backend tests.', agent: '', model: '' },
    { name: 'Frontend', role: 'frontend', description: 'Implements UI components, stores, styling, and UX polish.', agent: '', model: '' },
    { name: 'QA', role: 'qa', description: 'Verifies edge cases, runs checks, and audits regressions.', agent: '', model: '' },
  ],
  'research-build': [
    { name: 'Lead', role: 'lead', description: 'Synthesizes findings and directs execution.', agent: '', model: '' },
    { name: 'Researcher', role: 'researcher', description: 'Explores the codebase, APIs, and system constraints.', agent: '', model: '' },
    { name: 'Builder', role: 'builder', description: 'Applies focused code changes cleanly.', agent: '', model: '' },
    { name: 'Verifier', role: 'verifier', description: 'Runs type-checks, builds, and validates behavior.', agent: '', model: '' },
  ],
  'bug-hunt': [
    { name: 'Lead', role: 'lead', description: 'Coordinates reproduction and sign-off.', agent: '', model: '' },
    { name: 'Investigator', role: 'investigator', description: 'Traces logs, stack frames, and root causes.', agent: '', model: '' },
    { name: 'Fixer', role: 'fixer', description: 'Implements minimal safe fixes.', agent: '', model: '' },
    { name: 'Reviewer', role: 'reviewer', description: 'Audits diffs and checks for regressions.', agent: '', model: '' },
  ],
  'multi-review': [
    { name: 'Lead', role: 'lead', description: 'Aggregates audit reports into an actionable summary.', agent: '', model: '' },
    { name: 'Security', role: 'security', description: 'Audits auth, input validation, and secrets safety.', agent: '', model: '' },
    { name: 'Performance', role: 'performance', description: 'Finds bottlenecks, leaks, and unnecessary I/O.', agent: '', model: '' },
    { name: 'Correctness', role: 'correctness', description: 'Checks edge cases, error handling, and reliability.', agent: '', model: '' },
  ],
  custom: [
    { name: 'Lead', role: 'lead', description: 'Orchestrates custom team members and shared DAG tasks.', agent: '', model: '' },
  ],
};

const PRESET_OPTIONS = [
  { id: 'full-stack', label: 'Full-Stack (Lead · Backend · Frontend · QA)' },
  { id: 'research-build', label: 'Research & Build (Lead · Researcher · Builder · Verifier)' },
  { id: 'bug-hunt', label: 'Bug Hunt (Lead · Investigator · Fixer · Reviewer)' },
  { id: 'multi-review', label: 'Multi-Review (Lead · Security · Performance · Correctness)' },
  { id: 'custom', label: 'Custom Roster' },
] as const;

export const TeamLauncher: React.FC<{
  directory: string;
  onCreated: (team: TeamRecord) => void;
  onCancel?: () => void;
}> = ({ directory, onCreated, onCancel }) => {
  const { t } = useI18n();
  const projects = useProjectsStore((s) => s.projects);
  const loadAgents = useAgentsStore((s) => s.loadAgents);
  const getVisibleAgents = useAgentsStore((s) => s.getVisibleAgents);
  // Subscribe to directory cache updates
  const agentsByDirectory = useAgentsStore((s) => s.agentsByDirectory);

  const defaultDir = React.useMemo(() => {
    if (directory?.trim()) return directory.trim();
    return projects[0]?.path?.trim() || '';
  }, [directory, projects]);

  const [selectedDirectory, setSelectedDirectory] = React.useState(defaultDir);
  const [name, setName] = React.useState('');
  const [goal, setGoal] = React.useState('');
  const [preset, setPreset] = React.useState<string>('full-stack');
  const [roster, setRoster] = React.useState<PresetMemberTemplate[]>(() =>
    PRESET_TEMPLATES['full-stack'].map((m) => ({ ...m })),
  );
  const [showRosterEditor, setShowRosterEditor] = React.useState(false);
  const [maxParallel, setMaxParallel] = React.useState(3);
  const [useWorktrees, setUseWorktrees] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!selectedDirectory && defaultDir) {
      setSelectedDirectory(defaultDir);
    }
  }, [defaultDir, selectedDirectory]);

  React.useEffect(() => {
    if (selectedDirectory) {
      void loadAgents(selectedDirectory);
    }
  }, [selectedDirectory, loadAgents]);

  const availableAgents = React.useMemo(() => {
    void agentsByDirectory;
    return getVisibleAgents(selectedDirectory || undefined) as AgentWithExtras[];
  }, [agentsByDirectory, getVisibleAgents, selectedDirectory]);

  const handlePresetChange = (nextPreset: string) => {
    setPreset(nextPreset);
    const tpl = PRESET_TEMPLATES[nextPreset] ?? PRESET_TEMPLATES.custom;
    setRoster(tpl.map((m) => ({ ...m })));
    if (nextPreset === 'custom') setShowRosterEditor(true);
  };

  const updateRosterRow = (idx: number, patch: Partial<PresetMemberTemplate>) => {
    setRoster((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const addRosterRow = () => {
    setRoster((prev) => [
      ...prev,
      { name: `Specialist ${prev.length}`, role: `specialist-${prev.length}`, description: '', agent: '', model: '' },
    ]);
    setShowRosterEditor(true);
  };

  const removeRosterRow = (idx: number) => {
    setRoster((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetDir = selectedDirectory.trim();
    if (!targetDir) {
      setError('Select a project workspace directory first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const members: TeamMemberInput[] = roster
        .filter((m) => m.name.trim() || m.role.trim())
        .map((m) => ({
          name: m.name.trim() || m.role.trim(),
          role: (m.role.trim() || m.name.trim()).toLowerCase().replace(/\s+/g, '-'),
          description: m.description.trim() || undefined,
          agent: m.agent.trim() || undefined,
          model: m.model.trim() || undefined,
        }));
      const team = await teamsApi.create({
        name: name.trim() || 'AI Team',
        goal: goal.trim(),
        directory: targetDir,
        preset,
        useWorktrees,
        maxParallel,
        members: members.length > 0 ? members : undefined,
      });
      onCreated(team);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3.5 rounded-2xl border border-edge bg-surface-elevated p-4 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Icon name="ai-teams" className="h-4 w-4 text-foreground" />
          <span>{t('teams.launcher.newTeam')}</span>
        </div>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground">
            {t('teams.action.cancel')}
          </button>
        ) : null}
      </div>

      {/* Workspace / Project Picker */}
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Project Workspace</span>
        {projects.length > 0 ? (
          <select
            value={selectedDirectory}
            onChange={(e) => setSelectedDirectory(e.target.value)}
            className="oc-raised oc-field rounded-[10px] bg-background px-3 py-2 text-xs text-foreground outline-none"
          >
            {directory && !projects.some((p) => p.path === directory) ? (
              <option value={directory}>{directory}</option>
            ) : null}
            {projects.map((project) => (
              <option key={project.id} value={project.path}>
                {project.label || project.path.split(/[\\/]/).filter(Boolean).pop() || project.path} — {project.path}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={selectedDirectory}
            onChange={(e) => setSelectedDirectory(e.target.value)}
            placeholder="C:\path\to\project"
            className="oc-raised oc-field rounded-[10px] bg-background px-3 py-2 font-mono text-xs text-foreground outline-none"
          />
        )}
      </label>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{t('teams.launcher.nameLabel')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('teams.launcher.namePlaceholder')}
            className="oc-raised oc-field rounded-[10px] bg-background px-3 py-2 text-xs text-foreground outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{t('teams.launcher.presetLabel')}</span>
          <select
            value={preset}
            onChange={(e) => handlePresetChange(e.target.value)}
            className="oc-raised oc-field rounded-[10px] bg-background px-3 py-2 text-xs text-foreground outline-none"
          >
            {PRESET_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{t('teams.launcher.goalLabel')}</span>
        <textarea
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder={t('teams.launcher.goalPlaceholder')}
          className="oc-raised oc-field resize-y rounded-[10px] bg-background px-3 py-2 text-xs text-foreground outline-none"
        />
      </label>

      {/* Roster customization */}
      <div className="rounded-xl border border-edge-muted bg-background/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowRosterEditor((v) => !v)}
            className="text-start text-[11px] font-medium text-foreground hover:opacity-80"
          >
            {showRosterEditor ? '▾' : '▸'} Agents & Roster ({roster.length})
          </button>
          <button
            type="button"
            onClick={addRosterRow}
            className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-subtle px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon name="add" className="h-3 w-3" />
            Add Role
          </button>
        </div>

        {showRosterEditor ? (
          <div className="mt-2.5 space-y-2">
            {roster.map((member, idx) => (
              <div key={idx} className="rounded-xl border border-edge-muted bg-surface-elevated/60 p-2.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={member.name}
                    onChange={(e) => updateRosterRow(idx, { name: e.target.value })}
                    placeholder="Display Name"
                    className="rounded-lg border border-edge bg-background px-2 py-1 text-[11px] outline-none focus:border-foreground/50"
                  />
                  <div className="flex gap-1">
                    <input
                      value={member.role}
                      onChange={(e) => updateRosterRow(idx, { role: e.target.value })}
                      placeholder="role (e.g. lead, reviewer)"
                      className="min-w-0 flex-1 rounded-lg border border-edge bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-foreground/50"
                    />
                    {roster.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeRosterRow(idx)}
                        title="Remove member"
                        className="rounded-lg px-1 text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
                      >
                        <Icon name="close" className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <select
                    value={member.agent}
                    onChange={(e) => updateRosterRow(idx, { agent: e.target.value })}
                    className="rounded-lg border border-edge bg-background px-2 py-1 text-[11px] outline-none focus:border-foreground/50"
                  >
                    <option value="">Agent: Default (build)</option>
                    {availableAgents.map((ag) => (
                      <option key={ag.name} value={ag.name}>
                        {ag.name}{ag.scope ? ` (${ag.scope})` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    value={member.model}
                    onChange={(e) => updateRosterRow(idx, { model: e.target.value })}
                    placeholder="Model override (optional)"
                    className="rounded-lg border border-edge bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-foreground/50"
                  />
                </div>
                <input
                  value={member.description}
                  onChange={(e) => updateRosterRow(idx, { description: e.target.value })}
                  placeholder="Role instructions / responsibility"
                  className="mt-1.5 w-full rounded-lg border border-edge bg-background px-2 py-1 text-[11px] outline-none focus:border-foreground/50"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {roster.map((m, idx) => (
              <span key={idx} className="rounded-full border border-edge-muted bg-surface-subtle px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {m.name}{m.agent ? ` · ${m.agent}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Parallelism & Worktrees */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={useWorktrees}
            onChange={(e) => setUseWorktrees(e.target.checked)}
            className="rounded border-border"
          />
          <span>{t('teams.launcher.worktrees')}</span>
        </label>
        <label className="flex items-center gap-1.5 font-mono">
          <span>Max parallel:</span>
          <input
            type="number"
            min={1}
            max={8}
            value={maxParallel}
            onChange={(e) => setMaxParallel(Math.max(1, Math.min(8, Number(e.target.value) || 3)))}
            className="w-12 rounded-lg border border-edge bg-background px-1.5 py-0.5 text-center text-[11px] tabular-nums text-foreground"
          />
        </label>
      </div>

      {error ? <div className="rounded-[10px] bg-[var(--status-error-background)] px-3 py-1.5 text-[var(--status-error)]">{error}</div> : null}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={submitting || !selectedDirectory.trim()}
          className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 active:scale-[0.985] disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted-foreground disabled:opacity-80"
        >
          {submitting ? 'Launching Team…' : t('teams.launcher.create')}
        </button>
      </div>
    </form>
  );
};
