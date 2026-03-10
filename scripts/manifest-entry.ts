const MODULE_SCRIPT_PATTERN = /<script\b([^>]*)><\/script>/giu;
const MODULE_TYPE_PATTERN = /\btype\s*=\s*(['"])module\1/iu;
const SCRIPT_SRC_PATTERN = /\bsrc\s*=\s*(['"])([^"']+)\1/iu;

function isSafeEntryAssetPath(relativePath: string): boolean {
  if (!/^[A-Za-z0-9._/-]+$/u.test(relativePath)) {
    return false;
  }
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('./') ||
    relativePath.includes('//')
  ) {
    return false;
  }
  const segments = relativePath.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function normalizeEntryAssetPath(src: string): string {
  if (src.includes('?') || src.includes('#')) {
    throw new Error('index.html module entry script must not use query or hash suffixes');
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(src) || src.startsWith('//')) {
    throw new Error('index.html module entry script must point to a same-origin asset path');
  }

  const normalized = src.startsWith('/') ? src.slice(1) : src;
  if (!isSafeEntryAssetPath(normalized)) {
    throw new Error('index.html module entry script must use a safe asset path');
  }

  return normalized;
}

export function extractEntryAssetPath(html: string): string {
  for (const match of html.matchAll(MODULE_SCRIPT_PATTERN)) {
    const attributes = match[1] ?? '';
    if (!MODULE_TYPE_PATTERN.test(attributes)) {
      continue;
    }

    const srcMatch = attributes.match(SCRIPT_SRC_PATTERN);
    if (!srcMatch?.[2]) {
      throw new Error('index.html module entry script is missing a src attribute');
    }

    return normalizeEntryAssetPath(srcMatch[2]);
  }

  throw new Error('index.html does not contain a module entry script');
}
