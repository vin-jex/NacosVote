/**
 * Identity normalisation used for voter verification.
 *
 * Matric number: uppercased, every whitespace character removed. So
 * "csc/2023/12345", " CSC / 2023 / 12345 " and "CSC/2023/12345" all compare
 * equal. Stored values are normalised the same way on write.
 *
 * Name: trimmed, internal whitespace runs collapsed to one space, lowercased.
 * So "  John   Doe " matches "John Doe". The name is a second identity factor,
 * NOT a secret - it only raises the bar for someone guessing a matric number.
 */

export function normalizeMatric(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function namesMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}
