import { describe, expect, test } from 'bun:test';
import type { Session } from '@/lib/opencode/model';
import {
  getBtwBoundaryMessageID,
  getBtwOriginalSessionID,
  getBtwSessionID,
  isBtwSession,
  withBtwSessionLink,
  withBtwSessionMarker,
  withoutBtwSessionLink,
  wasPromotedBtwSession,
  withoutBtwSessionMarker,
} from './sessionBtwMetadata';

const sessionWith = (metadata: unknown): Session => ({ id: 's', metadata }) as unknown as Session;

describe('parent link', () => {
  test('withBtwSessionLink preserves unrelated spleen metadata', () => {
    const next = withBtwSessionLink({ spleen: { reviewSessionID: 'r-1' }, other: 1 }, 'fork-1');
    expect(next).toEqual({ spleen: { reviewSessionID: 'r-1', btwSessionID: 'fork-1' }, other: 1 });
  });

  test('getBtwSessionID reads the link and rejects blank values', () => {
    expect(getBtwSessionID(sessionWith({ spleen: { btwSessionID: 'fork-1' } }))).toBe('fork-1');
    expect(getBtwSessionID(sessionWith({ spleen: { btwSessionID: '  ' } }))).toBeNull();
    expect(getBtwSessionID(sessionWith(undefined))).toBeNull();
    expect(getBtwSessionID(null)).toBeNull();
  });

  test('withoutBtwSessionLink removes only a matching link', () => {
    const linked = { spleen: { btwSessionID: 'fork-1', reviewSessionID: 'r-1' } };
    expect(withoutBtwSessionLink(linked, 'fork-2')).toBe(linked);
    expect(withoutBtwSessionLink(linked, 'fork-1')).toEqual({ spleen: { reviewSessionID: 'r-1' } });
  });

  test('withoutBtwSessionLink drops an emptied spleen object', () => {
    expect(withoutBtwSessionLink({ spleen: { btwSessionID: 'fork-1' } }, 'fork-1')).toEqual({});
  });
});

describe('fork marker', () => {
  test('withBtwSessionMarker replaces inherited spleen metadata', () => {
    const inherited = { spleen: { btwSessionID: 'stale', reviewSessionID: 'r-1' }, other: 1 };
    expect(withBtwSessionMarker(inherited, 'parent-1', 'msg-9')).toEqual({
      spleen: { kind: 'btw', originalSessionID: 'parent-1', btwBoundaryMessageID: 'msg-9' },
      other: 1,
    });
  });

  test('withBtwSessionMarker omits a null boundary (empty parent)', () => {
    expect(withBtwSessionMarker({}, 'parent-1', null)).toEqual({
      spleen: { kind: 'btw', originalSessionID: 'parent-1' },
    });
  });

  test('marker readers only apply to btw-kind sessions', () => {
    const fork = sessionWith({ spleen: { kind: 'btw', originalSessionID: 'parent-1', btwBoundaryMessageID: 'msg-9' } });
    expect(isBtwSession(fork)).toBe(true);
    expect(getBtwOriginalSessionID(fork)).toBe('parent-1');
    expect(getBtwBoundaryMessageID(fork)).toBe('msg-9');

    const review = sessionWith({ spleen: { kind: 'review', originalSessionID: 'parent-1', btwBoundaryMessageID: 'msg-9' } });
    expect(isBtwSession(review)).toBe(false);
    expect(getBtwOriginalSessionID(review)).toBeNull();
    expect(getBtwBoundaryMessageID(review)).toBeNull();
  });

  test('withoutBtwSessionMarker strips the marker, keeps other keys, and records the promotion', () => {
    const marked = { spleen: { kind: 'btw', originalSessionID: 'parent-1', btwBoundaryMessageID: 'msg-9', btwSessionID: 'nested' } };
    expect(withoutBtwSessionMarker(marked)).toEqual({ spleen: { btwSessionID: 'nested', btwPromoted: true } });
    expect(withoutBtwSessionMarker({ spleen: { kind: 'btw', originalSessionID: 'parent-1' } })).toEqual({ spleen: { btwPromoted: true } });
    const plain = { spleen: { kind: 'review' } };
    expect(withoutBtwSessionMarker(plain)).toBe(plain);
  });

  test('wasPromotedBtwSession only reports a session that went through promotion', () => {
    expect(wasPromotedBtwSession(sessionWith({ spleen: { btwPromoted: true } }))).toBe(true);
    // Still a live btw fork: the boundary applies, the notice must not.
    expect(wasPromotedBtwSession(sessionWith({ spleen: { kind: 'btw', originalSessionID: 'p-1' } }))).toBe(false);
    expect(wasPromotedBtwSession(sessionWith({ spleen: {} }))).toBe(false);
    expect(wasPromotedBtwSession(sessionWith(undefined))).toBe(false);
    expect(wasPromotedBtwSession(null)).toBe(false);
  });
});
