import { toast } from '@/components/ui';
import type { I18nKey, I18nParams } from '@/lib/i18n';
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';

type TranslateFn = (key: I18nKey, params?: I18nParams) => string;

export async function restartOpenCodeWithFeedback(t: TranslateFn): Promise<void> {
  try {
    await reloadOpenCodeConfiguration({
      message: t('settings.spleen.opencodeCli.actions.restartingOpenCode'),
      scopes: ['all'],
    });
  } catch (error) {
    // SAFETY: reloadOpenCodeConfiguration tags the Error it raises with
    // `requiresManualRestart` when OpenCode runs outside Spleen.
    if ((error as Error & { requiresManualRestart?: boolean })?.requiresManualRestart) {
      toast.warning(t('settings.spleen.opencodeCli.restart.external'));
      return;
    }
    toast.error(t('settings.spleen.opencodeCli.restart.restartFailed'));
  }
}
