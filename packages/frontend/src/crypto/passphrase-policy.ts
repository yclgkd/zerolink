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

/** i18n key + interpolation params for a validation error. */
export type PassphraseValidationI18n = {
  key: string;
  params: { label: string; min: number; max: number };
};

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

const I18N_KEY_MAP: Record<Exclude<PassphraseValidationResult, null>, string> = {
  missing: 'passphrase.errorRequired',
  too_short: 'passphrase.errorTooShort',
  too_long: 'passphrase.errorTooLong',
  invalid_whitespace: 'passphrase.errorInvalidWhitespace',
};

/**
 * Returns a `{ key, params }` pair for use with `t(key, params)`.
 * Keeps the crypto layer free of i18n runtime dependencies.
 */
export function getPassphraseValidationI18n(
  result: Exclude<PassphraseValidationResult, null>,
  label: string
): PassphraseValidationI18n {
  return {
    key: I18N_KEY_MAP[result],
    params: { label, min: MIN_PASSPHRASE_LENGTH, max: MAX_PASSPHRASE_LENGTH },
  };
}

/**
 * Validates and returns `{ key, params }` for the first error, or `null` if valid.
 */
export function getPassphraseValidationErrorI18n(
  passphrase: string,
  label: string
): PassphraseValidationI18n | null {
  const result = validatePassphrase(passphrase);
  return result === null ? null : getPassphraseValidationI18n(result, label);
}

/**
 * Returns a hard-coded English validation message.
 * Used by orchestrator internals that have no access to `t()`.
 */
export function getPassphraseValidationMessage(
  result: Exclude<PassphraseValidationResult, null>,
  label: string = 'passphrase'
): string {
  switch (result) {
    case 'missing':
      return `${label} is required`;
    case 'too_short':
      return `${label} must be at least ${MIN_PASSPHRASE_LENGTH} characters`;
    case 'too_long':
      return `${label} must be ${MAX_PASSPHRASE_LENGTH} characters or fewer`;
    case 'invalid_whitespace':
      return `${label} can use ordinary spaces between words, but not tabs, line breaks, or special spaces`;
  }
}

/**
 * Validates and returns a hard-coded English error message, or `null` if valid.
 * Used by orchestrator internals that have no access to `t()`.
 */
export function getPassphraseValidationError(
  passphrase: string,
  label: string = 'passphrase'
): string | null {
  const result = validatePassphrase(passphrase);
  return result === null ? null : getPassphraseValidationMessage(result, label);
}
