import React from 'react';
import { Icon } from '@/components/icon/Icon';
import type { TeamDagTask, TeamMember } from './api';

export interface TeamExecutionGraphProps {
  teamName: string;
  teamStatus: string;
  members: TeamMember[];
  tasks: TeamDagTask[];
  onSelectMember?: (member: TeamMember) => void;
}

const isMemberActive = (member: TeamMember, tasks: TeamDagTask[]): boolean => {
  if (member.status === 'working' || member.status === 'running' || member.status === 'active') return true;
  return tasks.some((task) => task.assignee === member.id && task.status === 'running');
};

const summarizeMemberTasks = (memberId: string, tasks: TeamDagTask[]) => {
  let running: TeamDagTask | null = null;
  let completed = 0;
  let pending = 0;
  let blockedOrFailed = 0;
  for (const task of tasks) {
    if (task.assignee !== memberId) continue;
    if (task.status === 'running') running = task;
    else if (task.status === 'completed') completed += 1;
    else if (task.status === 'pending') pending += 1;
    else if (task.status === 'failed' || task.status === 'blocked') blockedOrFailed += 1;
  }
  return { running, completed, pending, blockedOrFailed };
};

export const TeamExecutionGraph: React.FC<TeamExecutionGraphProps> = React.memo(
  ({ teamName, teamStatus, members, tasks, onSelectMember }) => {
    const leadIndex = Math.max(0, members.findIndex((m) => m.role === 'lead'));
    const lead = members[leadIndex] ?? null;
    const workers = members.filter((_, idx) => idx !== leadIndex);

    const completedCount = tasks.filter((t) => t.status === 'completed').length;
    const runningCount = tasks.filter((t) => t.status === 'running').length;
    const blockedCount = tasks.filter((t) => t.status === 'blocked' || t.status === 'failed').length;
    const progressPct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

    const renderNodeCard = (member: TeamMember, isLead: boolean) => {
      const active = isMemberActive(member, tasks);
      const stats = summarizeMemberTasks(member.id, tasks);
      return (
        <button
          key={member.id}
          type="button"
          onClick={() => onSelectMember?.(member)}
          disabled={!member.sessionId}
          className={`group flex w-full flex-col gap-1.5 rounded-xl border p-3 text-start transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background pointer-coarse:min-h-11 motion-reduce:transition-none ${
            active
              ? 'border-[var(--status-success)]/45 bg-surface-subtle/80 hover:border-[var(--status-success)]/70'
              : 'border-edge-muted bg-surface-elevated/70 hover:border-border-hover hover:bg-surface-elevated'
          } disabled:cursor-default disabled:hover:border-edge-muted`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  active
                    ? 'bg-[var(--status-success)]'
                    : stats.blockedOrFailed > 0
                      ? 'bg-[var(--status-warning)]'
                      : 'bg-muted-foreground/50'
                }`}
              />
              <span className="truncate text-xs font-medium text-foreground">{member.name}</span>
              <span className="shrink-0 rounded-full bg-surface-subtle px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
                {isLead ? 'supervisor' : member.role}
              </span>
            </div>
            {member.sessionId ? (
              <Icon name="arrow-right-up" className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60 transition group-hover:opacity-100" />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
            {member.agent ? <span>@{member.agent}</span> : null}
            {member.model ? <span className="truncate">{member.model}</span> : null}
            {stats.running ? (
              <span className="truncate text-foreground">running: {stats.running.title}</span>
            ) : (
              <span>
                {stats.completed} done
                {stats.pending > 0 ? ` · ${stats.pending} queued` : ''}
                {stats.blockedOrFailed > 0 ? ` · ${stats.blockedOrFailed} blocked` : ''}
              </span>
            )}
          </div>
        </button>
      );
    };

    return (
      <div className="flex flex-col gap-2.5 rounded-xl border border-edge bg-surface-subtle/50 p-3">
        {/* Compact execution summary strip */}
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{teamName}</span>
            <span>·</span>
            <span>{runningCount} running</span>
            <span>·</span>
            <span>{completedCount}/{tasks.length} done</span>
            {blockedCount > 0 ? (
              <>
                <span>·</span>
                <span className="text-[var(--status-warning)]">{blockedCount} blocked/failed</span>
              </>
            ) : null}
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">{teamStatus}</span>
        </div>

        {/* Hairline progress bar */}
        <div
          role="progressbar"
          aria-label={`${teamName} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
          className="h-1 w-full overflow-hidden rounded-full bg-surface-subtle"
        >
          <div
            className="h-full bg-[var(--status-success)] transition-all duration-300 motion-reduce:transition-none"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Supervisor node */}
        {lead ? (
          <div className="flex flex-col gap-2">
            {renderNodeCard(lead, true)}
            {workers.length > 0 ? (
              <div className="border-s border-border/70 ps-3">
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Workers ({workers.length})
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {workers.map((worker) => renderNodeCard(worker, false))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
);

export default TeamExecutionGraph;
