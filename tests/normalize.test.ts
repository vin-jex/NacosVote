import { describe, expect, it } from 'vitest';
import { namesMatch, normalizeMatric, normalizeName } from '../lib/normalize';

describe('normalizeMatric', () => {
  it('uppercases and strips all whitespace', () => {
    expect(normalizeMatric(' csc / 2023 / 12345 ')).toBe('CSC/2023/12345');
    expect(normalizeMatric('csc\t2023\n001')).toBe('CSC2023001');
  });
});

describe('normalizeName / namesMatch', () => {
  it('collapses whitespace and is case-insensitive', () => {
    expect(normalizeName('  John   Doe ')).toBe('john doe');
    expect(namesMatch('John Doe', 'john   doe')).toBe(true);
    expect(namesMatch('JOHN DOE', ' John Doe ')).toBe(true);
  });

  it('does not match different names', () => {
    expect(namesMatch('John Doe', 'Jane Doe')).toBe(false);
    expect(namesMatch('John Doe', 'John')).toBe(false);
  });
});
