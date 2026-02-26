/**
 * Human-readable labels for passphrase strength levels.
 */
export type PassphraseStrengthLabel = '' | 'Weak' | 'Medium' | 'Strong';

/**
 * Strength score shown in the UI.
 * level 0 is only used for an empty passphrase.
 */
export type PassphraseStrength = {
  level: 0 | 1 | 2 | 3;
  label: PassphraseStrengthLabel;
};

function getScore(passphrase: string): number {
  let score = 0;
  if (passphrase.length >= 8) score += 1;
  if (passphrase.length >= 12) score += 1;
  if (passphrase.length >= 16) score += 1;
  if (/[a-z]/.test(passphrase) && /[A-Z]/.test(passphrase)) score += 1;
  if (/[0-9]/.test(passphrase)) score += 1;
  if (/[^a-zA-Z0-9]/.test(passphrase)) score += 1;
  return score;
}

function getLevel(score: number): 1 | 2 | 3 {
  if (score <= 2) return 1;
  if (score <= 4) return 2;
  return 3;
}

function getLabel(level: 1 | 2 | 3): Exclude<PassphraseStrengthLabel, ''> {
  if (level === 1) return 'Weak';
  if (level === 2) return 'Medium';
  return 'Strong';
}

/**
 * Calculates passphrase strength using the Figma-aligned heuristic.
 */
export function getPassphraseStrength(passphrase: string): PassphraseStrength {
  if (!passphrase) {
    return { level: 0, label: '' };
  }

  const level = getLevel(getScore(passphrase));
  return { level, label: getLabel(level) };
}
