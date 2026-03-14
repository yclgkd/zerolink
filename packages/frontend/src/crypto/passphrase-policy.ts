export const MIN_PASSPHRASE_LENGTH = 8;

export type PassphraseValidationResult = 'missing' | 'too_short' | null;

export function validatePassphrase(passphrase: string): PassphraseValidationResult {
  const trimmedLength = passphrase.trim().length;
  if (trimmedLength === 0) {
    return 'missing';
  }
  if (trimmedLength < MIN_PASSPHRASE_LENGTH) {
    return 'too_short';
  }
  return null;
}

export function hasRequiredPassphraseLength(passphrase: string): boolean {
  return validatePassphrase(passphrase) === null;
}

export function getPassphraseLengthMessage(label: string = 'passphrase'): string {
  return `${label} must be at least ${MIN_PASSPHRASE_LENGTH} characters`;
}
