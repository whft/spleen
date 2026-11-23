import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { DraftStudioHero } from '../composer/input/ComposerDraftTitle';
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
            <DraftStudioHero heading={draftHeading} projectLabel={projectLabel} />
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
