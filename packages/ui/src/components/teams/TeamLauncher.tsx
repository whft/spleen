import React from 'react';
import { RiTeamLine } from '@remixicon/react';
import { useI18n } from '@/lib/i18n';
import { teamsApi, type TeamRecord } from './api';

const PRESET_OPTIONS = [
  { id: 'full-stack', label: 'Full-Stack (Lead · Backend · Frontend · QA)' },
  { id: 'research-build', label: 'Research & Build (Lead · Researcher · Builder · Verifier)' },
  { id: 'bug-hunt', label: 'Bug Hunt (Lead · Investigator · Fixer · Reviewer)' },
  { id: 'multi-review', label: 'Multi-Review (Lead · Security · Performance · Correctness)' },
  { id: 'custom', label: 'Custom (Lead)' },
] as const;

export const TeamLauncher: React.FC<{
  directory: string;
  onCreated: (team: TeamRecord) => void;
  onCancel?: () => void;
}> = ({ directory, onCreated, onCancel }) => {
  const { t } = useI18n();
  const [name, setName] = React.useState('');
  const [goal, setGoal] = React.useState('');
  const [preset, setPreset] = React.useState<string>('full-stack');
  const [useWorktrees, setUseWorktrees] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directory) return;
    setSubmitting(true);
    setError(null);
    try {
      const team = await teamsApi.create({
        name: name.trim() || 'AI Team',
        goal: goal.trim(),
        directory,
        preset,
        useWorktrees,
      });
      onCreated(team);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-3.5 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <RiTeamLine className="h-4 w-4 text-primary" />
          <span>{t('teams.launcher.newTeam')}</span>
        </div>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            {t('teams.action.cancel')}
          </button>
        ) : null}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">{t('teams.launcher.nameLabel')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('teams.launcher.namePlaceholder')}
          className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">{t('teams.launcher.presetLabel')}</span>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
        >
          {PRESET_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">{t('teams.launcher.goalLabel')}</span>
        <textarea
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder={t('teams.launcher.goalPlaceholder')}
          className="resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
        />
      </label>

      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={useWorktrees}
          onChange={(e) => setUseWorktrees(e.target.checked)}
          className="rounded border-border"
        />
        <span>{t('teams.launcher.worktrees')}</span>
      </label>

      {error ? <div className="rounded bg-destructive/15 px-2 py-1 text-destructive">{error}</div> : null}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={submitting || !directory}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {t('teams.launcher.create')}
        </button>
      </div>
    </form>
  );
};
