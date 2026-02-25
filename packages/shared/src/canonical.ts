import type { HexString } from './types.ts';

/**
 * Produces a deterministic JSON string with recursively sorted object keys.
 * Arrays preserve element order. `undefined` values are omitted.
 * Used to compute intent hashes that both frontend and backend can reproduce.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * Computes SHA-256 of the canonical JSON representation of an intent object.
 * Returns the hash as a lowercase hex string.
 *
 * Both frontend (browser WebCrypto) and backend (Cloudflare Workers) call this
 * with the same TypeScript types, ensuring identical hash output.
 */
export async function computeIntentHash(intent: Record<string, unknown>): Promise<HexString> {
  const canonical = canonicalJsonStringify(intent);
  const encoded = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') as HexString;
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();

    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        sorted[key] = sortKeys(v);
      }
    }

    return sorted;
  }

  return value;
}
