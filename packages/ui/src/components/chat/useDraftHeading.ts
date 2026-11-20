import { useI18n } from '@/lib/i18n';

/** The new-session heading: crisp, direct project or workspace prompt without gimmicks. */
export function useDraftHeading(projectLabel: string | null): string {
  const { t } = useI18n();
  if (!projectLabel) return t('chat.emptyState.draftTitle');
  return t('chat.emptyState.draftTitleWithProject', { project: projectLabel });
}
