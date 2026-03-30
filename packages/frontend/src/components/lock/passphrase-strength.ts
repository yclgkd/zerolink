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

const COMMON_WEAK_PATTERN_LIST = [
  /^password(?:\d+|[!@#$%^&*]+)*$/u,
  /^qwerty(?:\d+|[!@#$%^&*]+)*$/u,
  /^abcdef/u,
  /^admin(?:\d+|[!@#$%^&*]+)*$/u,
  /^welcome(?:\d+|[!@#$%^&*]+)*$/u,
  /(123456|654321|012345)/u,
];

function getLengthScore(normalizedLength: number): number {
  let score = 0;
  if (normalizedLength >= 12) score += 1;
  if (normalizedLength >= 16) score += 1;
  if (normalizedLength >= 24) score += 1;
  return score;
}

function getWordScore(words: string[]): number {
  let score = 0;
  if (words.length >= 4) score += 1;
  if (words.length >= 6) score += 1;
  return score;
}

function getCharacterClassScore(collapsed: string): number {
  let score = 0;
  if (/[a-z]/u.test(collapsed)) score += 1;
  if (/[A-Z]/u.test(collapsed)) score += 1;
  if (/[0-9]/u.test(collapsed)) score += 1;
  if (/[^A-Za-z0-9]/u.test(collapsed)) score += 1;
  return score;
}

function getPenalty(words: string[], collapsed: string): number {
  const collapsedLower = collapsed.toLowerCase();
  let penalty = 0;

  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  if (words.length >= 2 && uniqueWords.size === 1) {
    penalty += 2;
  }

  if (/(.)\1{3,}/u.test(collapsed)) {
    penalty += 2;
  }

  if (COMMON_WEAK_PATTERN_LIST.some((pattern) => pattern.test(collapsedLower))) {
    penalty += 2;
  }

  return penalty;
}

function getScore(passphrase: string): number {
  const normalized = normalizePassphrase(passphrase);
  const words = normalized.split(/ +/u).filter(Boolean);
  const collapsed = normalized.replace(/ /gu, '');
  const positiveScore =
    getLengthScore(normalized.length) + getWordScore(words) + getCharacterClassScore(collapsed);
  return Math.max(0, positiveScore - getPenalty(words, collapsed));
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
 * Calculates passphrase strength using a hybrid passphrase/password heuristic.
 */
export function getPassphraseStrength(passphrase: string): PassphraseStrength {
  if (!passphrase) {
    return { level: 0, label: '' };
  }

  const level = getLevel(getScore(passphrase));
  return { level, label: getLabel(level) };
}
