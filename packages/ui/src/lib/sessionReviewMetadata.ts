import type { Metadata, Session } from '@/lib/opencode/model';

export type SessionMetadataRecord = Metadata;

type SpleenMetadata = {
  kind?: 'review';
  originalSessionID?: string;
  reviewSessionID?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const getSessionMetadata = (session: Session | null | undefined): SessionMetadataRecord => (
  session?.metadata ?? {}
);

const getSpleenMetadata = (metadata: SessionMetadataRecord): SpleenMetadata => {
  const value = metadata.spleen;
  return isRecord(value) ? value as SpleenMetadata : {};
};

export const getReviewSessionID = (session: Session | null | undefined): string | null => {
  const value = getSpleenMetadata(getSessionMetadata(session)).reviewSessionID;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const getOriginalSessionID = (session: Session | null | undefined): string | null => {
  const value = getSpleenMetadata(getSessionMetadata(session)).originalSessionID;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const isReviewSession = (session: Session | null | undefined): boolean =>
  getSpleenMetadata(getSessionMetadata(session)).kind === 'review' && Boolean(getOriginalSessionID(session));

export const withReviewSessionLink = (
  metadata: SessionMetadataRecord,
  reviewSessionID: string,
): SessionMetadataRecord => {
  const current = getSpleenMetadata(metadata);
  return {
    ...metadata,
    spleen: {
      ...current,
      reviewSessionID,
    },
  };
};

export const withReviewSessionMarker = (
  metadata: SessionMetadataRecord,
  originalSessionID: string,
): SessionMetadataRecord => {
  const current = getSpleenMetadata(metadata);
  return {
    ...metadata,
    spleen: {
      ...current,
      kind: 'review' as const,
      originalSessionID,
    },
  };
};

export const withoutReviewSessionLink = (
  metadata: SessionMetadataRecord,
  reviewSessionID: string,
): SessionMetadataRecord => {
  const current = getSpleenMetadata(metadata);
  if (current.reviewSessionID !== reviewSessionID) return metadata;

  const restSpleen = { ...current };
  delete restSpleen.reviewSessionID;
  const next: SessionMetadataRecord = { ...metadata };
  if (Object.keys(restSpleen).length > 0) {
    next.spleen = restSpleen;
  } else {
    delete next.spleen;
  }
  return next;
};
