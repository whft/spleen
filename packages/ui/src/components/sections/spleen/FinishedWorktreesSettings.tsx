import React from 'react';
import { SettingsCheckboxRow, SettingsSection } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';

export const FinishedWorktreesSettings: React.FC = () => {
  const { t } = useI18n();
  const archiveOnDone = useUIStore((state) => state.worktreeArchiveOnDoneEnabled);
  const setArchiveOnDone = useUIStore((state) => state.setWorktreeArchiveOnDoneEnabled);
  const archiveOnMerge = useUIStore((state) => state.mergedWorktreeCleanupEnabled);
  const setArchiveOnMerge = useUIStore((state) => state.setMergedWorktreeCleanupEnabled);

  return (
    <SettingsSection
      settingsItem="sessions.finished-worktrees-section"
      title={t('settings.spleen.finishedWorktrees.title')}
      info={t('settings.spleen.finishedWorktrees.info')}
    >
      <SettingsCheckboxRow
        settingsItem="sessions.worktree-archive-on-done"
        checked={archiveOnDone}
        onChange={setArchiveOnDone}
        label={t('settings.spleen.finishedWorktrees.field.archiveOnDone')}
      />
      <SettingsCheckboxRow
        settingsItem="sessions.merged-worktree-cleanup"
        checked={archiveOnMerge}
        onChange={setArchiveOnMerge}
        label={t('settings.spleen.mergedWorktreeCleanup.field.enable')}
      />
    </SettingsSection>
  );
};
