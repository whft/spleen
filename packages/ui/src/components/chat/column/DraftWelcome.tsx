import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { SpleenLogo } from '@/components/ui/SpleenLogo';
import { DraftProjectName } from '@/components/chat/DraftProjectName';
import { DraftPresetChips } from '../DraftPresetChips';
import { useI18n } from '@/lib/i18n';
import { useInputStore } from '@/sync/input-store';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { normalizeContextPanelDirectoryKey, useUIStore } from '@/stores/useUIStore';
import { cn, formatDirectoryName } from '@/lib/utils';
import { useDraftHeading } from '../useDraftHeading';

const getProjectDisplayLabel = (project: { label?: string; path: string }): string => {
    const label = project.label?.trim();
    return label || formatDirectoryName(project.path);
};

const renderDraftTitle = (title: string, projectLabel: string | null): React.ReactNode => {
    if (!projectLabel) return title;
    const projectIndex = title.indexOf(projectLabel);
    if (projectIndex === -1) return title;

    return (
        <>
            {title.slice(0, projectIndex)}
            <DraftProjectName label={projectLabel} />
            {title.slice(projectIndex + projectLabel.length)}
        </>
    );
};

export const DraftWelcome: React.FC<{ exiting?: boolean }> = ({ exiting = false }) => {
    const { t } = useI18n();
    const draftTarget = useSessionUIStore((state) => state.newSessionDraft.target);
    const selectedProjectId = useSessionUIStore((state) => state.newSessionDraft.selectedProjectId ?? null);
    const activeProject = useProjectsStore(React.useCallback((state) => {
        if (draftTarget === 'chat') return null;
        const projectId = selectedProjectId ?? state.activeProjectId;
        return (projectId
            ? state.projects.find((candidate) => candidate.id === projectId)
            : null) ?? state.projects[0] ?? null;
    }, [draftTarget, selectedProjectId]));
    const projectLabel = activeProject ? getProjectDisplayLabel(activeProject) : null;
    const draftHeading = useDraftHeading(projectLabel);

    const openTeamsLauncher = React.useCallback(() => {
        const dirPath = activeProject?.path ?? useProjectsStore.getState().getActiveProject()?.path ?? useProjectsStore.getState().projects[0]?.path;
        if (!dirPath) return;
        useUIStore.getState().openContextPanelTab(normalizeContextPanelDirectoryKey(dirPath), { mode: 'teams' });
    }, [activeProject]);

    return (
        <div className={cn(
            'oc-draft-center flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center transition-opacity duration-[120ms] ease-out motion-reduce:transition-none',
            exiting && 'pointer-events-none opacity-0',
        )}>
            <div className="oc-studio-emblem mb-5 grid size-16 shrink-0 place-items-center rounded-2xl bg-surface-elevated sm:mb-6 sm:size-[76px]">
                <SpleenLogo width={46} height={46} />
            </div>
            <h1 className="max-w-[24ch] text-balance text-[clamp(1.75rem,4vw,2.875rem)] font-medium leading-[1.08] tracking-[-0.045em] text-foreground">
                {renderDraftTitle(draftHeading, projectLabel)}
            </h1>
            <DraftPresetChips
                onSubmit={(starter) => useInputStore.getState().requestPresetSubmit(starter.submitText, starter.ref.type)}
                className="oc-draft-starters mt-8 max-w-md"
            />
            <button
                type="button"
                onClick={openTeamsLauncher}
                className="mt-4 inline-flex min-h-8 items-center gap-2 rounded-lg bg-interactive-hover px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-interactive-selection hover:text-foreground focus-visible:text-foreground motion-reduce:transition-none pointer-coarse:min-h-11"
            >
                <Icon name="ai-teams" className="h-3.5 w-3.5 text-foreground" />
                {t('teams.launcher.startAction')}
            </button>
        </div>
    );
};
