import { z } from 'zod';

import { parseMetadata } from '@/lib/metadataParse';
import type { Metadata, PermissionRuleset, Session } from '@/lib/opencode/model';
import { withSessionWorkState } from '@/lib/sessionWorkMetadata';

const operatorChildLinkSchema = z.object({
  spleen: z.object({ kind: z.literal('operator-child'), parentID: z.string().min(1) }),
});

const OPERATOR_CHILD_DENIED_TOOLS = new Set(['question', 'spleen_secret']);

const spleenSchema = z.object({ spleen: z.record(z.string(), z.json()) });

export const operatorChildParentId = (metadata: Metadata | undefined): string | undefined => (
  parseMetadata(operatorChildLinkSchema, metadata).data?.spleen.parentID
);

export const isOperatorChildSession = (session: Session | null | undefined): boolean => (
  operatorChildParentId(session?.metadata) !== undefined
);

export const metadataAfterTakeOver = (metadata: Metadata, now: number): Metadata => {
  const { kind: _kind, parentID: _parentID, ...namespace } = spleenSchema.safeParse(metadata).data?.spleen ?? {};
  return withSessionWorkState({ ...metadata, spleen: namespace }, 'open', now);
};

export const permissionsAfterTakeOver = (permissions: PermissionRuleset | undefined): PermissionRuleset => (
  (permissions ?? []).filter((rule) => !(OPERATOR_CHILD_DENIED_TOOLS.has(rule.action) && rule.resource === '*' && rule.effect === 'deny'))
);
