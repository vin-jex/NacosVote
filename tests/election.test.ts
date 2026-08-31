import { describe, expect, it } from 'vitest';
import { canTransition, effectiveStatus, isVotingOpen } from '../lib/election';

const start = '2026-09-05T10:00:00Z';
const end = '2026-09-05T16:00:00Z';

describe('effectiveStatus', () => {
  it('draft and closed pass through', () => {
    expect(effectiveStatus({ status: 'draft', voting_start: start, voting_end: end })).toBe('draft');
    expect(effectiveStatus({ status: 'closed', voting_start: start, voting_end: end })).toBe('closed');
  });

  it('scheduled never auto-opens', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    expect(effectiveStatus({ status: 'scheduled', voting_start: start, voting_end: end }, now)).toBe(
      'scheduled',
    );
  });

  it('open + before window => scheduled', () => {
    const now = new Date('2026-09-05T09:59:59Z');
    expect(effectiveStatus({ status: 'open', voting_start: start, voting_end: end }, now)).toBe(
      'scheduled',
    );
  });

  it('open + inside window => open', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    expect(isVotingOpen({ status: 'open', voting_start: start, voting_end: end }, now)).toBe(true);
  });

  it('closed exactly at voting_end (boundary is start <= now < end)', () => {
    const now = new Date(end);
    expect(effectiveStatus({ status: 'open', voting_start: start, voting_end: end }, now)).toBe(
      'closed',
    );
  });

  it('one millisecond before end is still open', () => {
    const now = new Date(new Date(end).getTime() - 1);
    expect(isVotingOpen({ status: 'open', voting_start: start, voting_end: end }, now)).toBe(true);
  });

  it('open without a full window => scheduled', () => {
    expect(effectiveStatus({ status: 'open', voting_start: null, voting_end: end })).toBe('scheduled');
  });
});

describe('canTransition', () => {
  it('allows the documented transitions', () => {
    expect(canTransition('draft', 'scheduled')).toBe(true);
    expect(canTransition('draft', 'open')).toBe(true);
    expect(canTransition('scheduled', 'open')).toBe(true);
    expect(canTransition('scheduled', 'draft')).toBe(true);
    expect(canTransition('scheduled', 'closed')).toBe(true);
    expect(canTransition('open', 'closed')).toBe(true);
  });

  it('never allows reopening a closed election', () => {
    expect(canTransition('closed', 'open')).toBe(false);
    expect(canTransition('closed', 'scheduled')).toBe(false);
    expect(canTransition('closed', 'draft')).toBe(false);
  });

  it('does not allow open => draft', () => {
    expect(canTransition('open', 'draft')).toBe(false);
  });
});
