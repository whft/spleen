import { formatAgentStatus, type AgentStatus } from '@/lib/agentStatus';
import { useI18n } from '@/lib/i18n';

export function useAgentStatusLabel(status: AgentStatus | null, modelName?: string | null): string | null {
  const { t, locale } = useI18n();
  if (!status) return null;
  return formatAgentStatus(t, locale, status, modelName);
}
