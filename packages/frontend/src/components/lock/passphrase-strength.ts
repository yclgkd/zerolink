import { normalizePassphrase } from '../../crypto/passphrase-policy';

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
  const normalized = normalizePassphrase(passphrase);
  const words = normalized.split(/ +/u).filter(Boolean);
  const collapsed = normalized.replace(/ /gu, '');
  let score = 0;

  if (normalized.length >= 12) score += 1;
  if (normalized.length >= 16) score += 1;
  if (normalized.length >= 24) score += 1;
  if (words.length >= 4) score += 1;
  if (words.length >= 6 || normalized.length >= 32) score += 1;

  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  if (words.length >= 2 && uniqueWords.size === 1) {
    score = Math.max(1, score - 2);
  } else if (/(.)\1{4,}/u.test(collapsed)) {
    score = Math.max(1, score - 1);
  }

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
