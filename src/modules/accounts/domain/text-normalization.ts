import { InvalidAccountName, InvalidInstitution } from './account.errors.js';

const FORBIDDEN_INVISIBLE = /[\p{Cc}\p{Cf}]/u;
const UNICODE_WHITESPACE = /\s+/gu;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function normalizeHumanText(value: string): string {
  return value.normalize('NFC').trim().replace(UNICODE_WHITESPACE, ' ');
}

export function normalizeAccountName(value: string): string {
  if (FORBIDDEN_INVISIBLE.test(value)) {
    throw new InvalidAccountName(
      'Account name contains control or invisible formatting characters.',
    );
  }
  const normalized = normalizeHumanText(value);
  if (codePointLength(normalized) < 1 || codePointLength(normalized) > 100) {
    throw new InvalidAccountName(
      'Account name must contain between 1 and 100 Unicode code points.',
    );
  }
  return normalized;
}

export function normalizeInstitution(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (FORBIDDEN_INVISIBLE.test(value)) {
    throw new InvalidInstitution(
      'Institution contains control or invisible formatting characters.',
    );
  }
  if (value.trim() === '') {
    return null;
  }
  const normalized = normalizeHumanText(value);
  if (codePointLength(normalized) < 1 || codePointLength(normalized) > 120) {
    throw new InvalidInstitution(
      'Institution must contain between 1 and 120 Unicode code points.',
    );
  }
  return normalized;
}
