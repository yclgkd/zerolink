export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 128;

const EDGE_SPACE_PATTERN = /^ +| +$/gu;
const INVALID_WHITESPACE_PATTERN =
  /[\t\n\r\f\v\u00A0\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/u;

export type PassphraseValidationResult =
  | 'missing'
  | 'too_short'
  | 'too_long'
  | 'invalid_whitespace'
  | null;

export function normalizePassphrase(passphrase: string): string {
  return passphrase.replace(EDGE_SPACE_PATTERN, '');
}

export function hasInvalidPassphraseWhitespace(passphrase: string): boolean {
  return INVALID_WHITESPACE_PATTERN.test(passphrase);
}

export function validatePassphrase(passphrase: string): PassphraseValidationResult {
  if (hasInvalidPassphraseWhitespace(passphrase)) {
    return 'invalid_whitespace';
  }

  const normalizedLength = normalizePassphrase(passphrase).length;
  if (normalizedLength === 0) {
    return 'missing';
  }
  if (normalizedLength < MIN_PASSPHRASE_LENGTH) {
    return 'too_short';
  }
  if (normalizedLength > MAX_PASSPHRASE_LENGTH) {
    return 'too_long';
  }
  return null;
}

export function hasValidPassphrase(passphrase: string): boolean {
  return validatePassphrase(passphrase) === null;
}

export function getPassphraseLengthMessage(label: string = 'passphrase'): string {
  return `${label} must be at least ${MIN_PASSPHRASE_LENGTH} characters`;
}

export function getPassphraseTooLongMessage(label: string = 'passphrase'): string {
  return `${label} must be ${MAX_PASSPHRASE_LENGTH} characters or fewer`;
}

export function getPassphraseWhitespaceMessage(label: string = 'passphrase'): string {
  return `${label} can use ordinary spaces between words, but not tabs, line breaks, or special spaces`;
}

export function getPassphraseValidationMessage(
  result: Exclude<PassphraseValidationResult, null>,
  label: string = 'passphrase'
): string {
  switch (result) {
    case 'missing':
      return `${label} is required`;
    case 'too_short':
      return getPassphraseLengthMessage(label);
    case 'too_long':
      return getPassphraseTooLongMessage(label);
    case 'invalid_whitespace':
      return getPassphraseWhitespaceMessage(label);
  }
}

export function getPassphraseValidationError(
  passphrase: string,
  label: string = 'passphrase'
): string | null {
  const result = validatePassphrase(passphrase);
  return result === null ? null : getPassphraseValidationMessage(result, label);
}
