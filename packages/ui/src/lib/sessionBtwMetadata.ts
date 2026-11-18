import type { Session } from '@/lib/opencode/model';
import { getSessionMetadata, type SessionMetadataRecord } from '@/lib/sessionReviewMetadata';

type BtwMetadata = {
  kind?: string;
  originalSessionID?: string;
  btwSessionID?: string;
  btwBoundaryMessageID?: string;
  btwPromoted?: boolean;
};

const getSpleenMetadata = (metadata: SessionMetadataRecord): BtwMetadata => {
  const value = metadata.spleen;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  // SAFETY: session metadata is persisted, externally writable data; this is
  // its parsing boundary. `BtwMetadata` only declares optional fields and
  // every reader re-validates the field it consumes in `nonEmpty`.
  return value as BtwMetadata;
};

const nonEmpty = (value: string | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

export const getBtwSessionID = (session: Session | null | undefined): string | null =>
  nonEmpty(getSpleenMetadata(getSessionMetadata(session)).btwSessionID);

export const wasPromotedBtwSession = (session: Session | null | undefined): boolean =>
  getSpleenMetadata(getSessionMetadata(session)).btwPromoted === true;

export const isBtwSession = (session: Session | null | undefined): boolean =>
  getSpleenMetadata(getSessionMetadata(session)).kind === 'btw'
  && Boolean(getBtwOriginalSessionID(session));

export const getBtwOriginalSessionID = (session: Session | null | undefined): string | null => {
  const spleen = getSpleenMetadata(getSessionMetadata(session));
  return spleen.kind === 'btw' ? nonEmpty(spleen.originalSessionID) : null;
};

export const getBtwBoundaryMessageID = (session: Session | null | undefined): string | null => {
  const spleen = getSpleenMetadata(getSessionMetadata(session));
  return spleen.kind === 'btw' ? nonEmpty(spleen.btwBoundaryMessageID) : null;
};

export const withBtwSessionLink = (
  metadata: SessionMetadataRecord,
  btwSessionID: string,
): SessionMetadataRecord => ({
  ...metadata,
  spleen: {
    ...getSpleenMetadata(metadata),
    btwSessionID,
  },
});

export const withBtwSessionMarker = (
  metadata: SessionMetadataRecord,
  originalSessionID: string,
  boundaryMessageID: string | null,
): SessionMetadataRecord => {
  const spleen: BtwMetadata = { kind: 'btw', originalSessionID };
  if (boundaryMessageID) spleen.btwBoundaryMessageID = boundaryMessageID;
  return { ...metadata, spleen };
};

export const withoutBtwSessionMarker = (metadata: SessionMetadataRecord): SessionMetadataRecord => {
  const spleen = getSpleenMetadata(metadata);
  if (spleen.kind !== 'btw') return metadata;
  const rest: BtwMetadata = { ...spleen };
  delete rest.kind;
  delete rest.originalSessionID;
  delete rest.btwBoundaryMessageID;
  rest.btwPromoted = true;
  return { ...metadata, spleen: rest };
};

export const withoutBtwSessionLink = (
  metadata: SessionMetadataRecord,
  btwSessionID: string,
): SessionMetadataRecord => {
  const spleen = getSpleenMetadata(metadata);
  if (spleen.btwSessionID !== btwSessionID) return metadata;
  const rest: BtwMetadata = { ...spleen };
  delete rest.btwSessionID;
  const next: SessionMetadataRecord = { ...metadata };
  if (Object.keys(rest).length > 0) {
    next.spleen = rest;
  } else {
    delete next.spleen;
  }
  return next;
};
