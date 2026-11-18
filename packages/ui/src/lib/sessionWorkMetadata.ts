import { z } from 'zod';
import { parseMetadata } from '@/lib/metadataParse';
import type { Metadata, Session } from '@/lib/opencode/model';

const workSchema = z.object({
  state: z.enum(['open', 'done']),
  openedAt: z.number().optional(),
  openedBy: z.enum(['auto', 'jev', 'user']).optional(),
  doneAt: z.number().optional(),
  suggestDoneAt: z.number().optional(),
});

export type SessionWork = z.infer<typeof workSchema>;

const namespaceSchema = z.object({ spleen: z.object({ work: workSchema }) });

export function getSessionWork(session: Session | null | undefined): SessionWork | null {
  return parseMetadata(namespaceSchema, session?.metadata).data?.spleen.work ?? null;
}

const inWorkSchema = z.object({ spleen: z.object({ work: z.object({ state: z.literal('open') }) }) });

export function isSessionInWork(session: Session | null | undefined): boolean {
  return parseMetadata(inWorkSchema, session?.metadata).success;
}

export function isDoneSuggested(session: Session | null | undefined): boolean {
  const work = getSessionWork(session);
  return work?.state === 'open' && isHintCurrent(session, work.suggestDoneAt);
}

const reviewOfferSchema = z.object({ spleen: z.object({ reviewOffer: z.object({ at: z.number() }) }) });

export function isReviewSuggested(session: Session | null | undefined): boolean {
  const offeredAt = parseMetadata(reviewOfferSchema, session?.metadata).data?.spleen.reviewOffer.at;
  return isHintCurrent(session, offeredAt) && !isDoneSuggested(session);
}

function isHintCurrent(session: Session | null | undefined, writtenAt: number | undefined): boolean {
  if (!session || writtenAt === undefined) return false;
  return writtenAt >= (session.time?.idle ?? 0);
}

const spleenSchema = z.object({ spleen: z.record(z.string(), z.json()) });

export function withSessionWorkClosed(metadata: Metadata, now: number): Metadata {
  return inWorkSchema.safeParse(metadata).success ? withSessionWorkState(metadata, 'done', now) : metadata;
}

export function withSessionWorkState(metadata: Metadata, state: SessionWork['state'], now: number): Metadata {
  const namespace = spleenSchema.safeParse(metadata).data?.spleen ?? {};
  const current = namespaceSchema.safeParse(metadata).data?.spleen.work ?? null;
  if (current?.state === state) return metadata;
  if (state === 'open') {
    return { ...metadata, spleen: { ...namespace, work: { state: 'open', openedAt: now, openedBy: 'user' } } };
  }
  const work: Metadata = { state: 'done', doneAt: now };
  if (current?.openedAt !== undefined) work.openedAt = current.openedAt;
  if (current?.openedBy !== undefined) work.openedBy = current.openedBy;
  return { ...metadata, spleen: { ...namespace, work } };
}
