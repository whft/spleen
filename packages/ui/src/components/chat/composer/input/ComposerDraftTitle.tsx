import React from 'react';
import { DraftProjectName } from '@/components/chat/DraftProjectName';
import { SpleenLogo } from '@/components/ui/SpleenLogo';
import { cn } from '@/lib/utils';

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

interface DraftStudioHeroProps {
    heading: string;
    projectLabel: string | null;
    className?: string;
}

export const DraftStudioHero: React.FC<DraftStudioHeroProps> = ({ heading, projectLabel, className }) => (
    <div className={cn('flex flex-col items-center text-center', className)}>
        <div className="oc-studio-emblem mb-5 grid size-16 shrink-0 place-items-center rounded-2xl bg-surface-elevated sm:mb-6 sm:size-[76px]">
            <SpleenLogo width={46} height={46} />
        </div>
        <h1 className="max-w-[24ch] text-balance text-[clamp(1.75rem,4vw,2.875rem)] font-medium leading-[1.08] tracking-[-0.045em] text-foreground">
            {renderDraftTitle(heading, projectLabel)}
        </h1>
    </div>
);
