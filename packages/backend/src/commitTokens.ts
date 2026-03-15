import type { Base64Url, HexString, UnixMs } from '@zerolink/shared';

import {
  constantTimeEqual,
  decodeBase64Url,
  encodeBase64Url,
  getCryptoApi,
  sha256Hex,
  toArrayBufferBytes,
  toUtf8Bytes,
} from './crypto/bytes.ts';

export type CommitCookieKind = 'lock' | 'compound';

export interface CommitCookieSignal {
  action: 'set' | 'clear';
  kind: CommitCookieKind;
  token?: string;
  exp?: UnixMs;
}

export interface CommitTokenPayload {
  v: '1';
  kind: CommitCookieKind;
  uuid: string;
  challengeId: Base64Url;
  callerKey: Base64Url;
  iat: UnixMs;
  exp: UnixMs;
}

export const COMMIT_TOKEN_MODE = 'caller-cookie-v1' as const;
export const INTERNAL_CALLER_KEY_HEADER = 'X-ZL-Caller-Key' as const;
export const INTERNAL_COMMIT_TOKEN_HEADER = 'X-ZL-Commit-Token' as const;
export const INTERNAL_COMMIT_COOKIE_ACTION_HEADER = 'X-ZL-Commit-Cookie-Action' as const;
export const INTERNAL_COMMIT_COOKIE_KIND_HEADER = 'X-ZL-Commit-Cookie-Kind' as const;
export const INTERNAL_COMMIT_COOKIE_TOKEN_HEADER = 'X-ZL-Commit-Cookie-Token' as const;
export const INTERNAL_COMMIT_COOKIE_EXP_HEADER = 'X-ZL-Commit-Cookie-Exp' as const;
export const LOCK_COMMIT_COOKIE_NAME = 'zl-lock-commit' as const;
export const COMPOUND_COMMIT_COOKIE_NAME = 'zl-compound-commit' as const;

const CALLER_KEY_DOMAIN = 'zl-caller-key-v1\0';
const COMMIT_TOKEN_DOMAIN = 'zl-commit-token-v1\0';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidUnixMs(value: unknown): value is UnixMs {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isValidBase64Url(value: unknown): value is Base64Url {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  try {
    decodeBase64Url(value);
    return true;
  } catch {
    return false;
  }
}

function serializeCommitTokenPayload(payload: CommitTokenPayload): string {
  return JSON.stringify({
    v: payload.v,
    kind: payload.kind,
    uuid: payload.uuid,
    challengeId: payload.challengeId,
    callerKey: payload.callerKey,
    iat: payload.iat,
    exp: payload.exp,
  });
}

async function signHmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  const cryptoApi = getCryptoApi();
  const key = await cryptoApi.subtle.importKey(
    'raw',
    toArrayBufferBytes(toUtf8Bytes(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await cryptoApi.subtle.sign(
    'HMAC',
    key,
    toArrayBufferBytes(toUtf8Bytes(payload))
  );
  return new Uint8Array(signature);
}

function parseCommitTokenPayload(value: unknown): CommitTokenPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const { v, kind, uuid, challengeId, callerKey, iat, exp } = value;

  if (
    v !== '1' ||
    (kind !== 'lock' && kind !== 'compound') ||
    typeof uuid !== 'string' ||
    uuid.length === 0 ||
    !isValidBase64Url(challengeId) ||
    !isValidBase64Url(callerKey) ||
    !isValidUnixMs(iat) ||
    !isValidUnixMs(exp)
  ) {
    return null;
  }

  return {
    v: '1',
    kind,
    uuid,
    challengeId,
    callerKey,
    iat,
    exp,
  };
}

export function normalizeUserAgentFamily(userAgent: string | null | undefined): string {
  const normalized = (userAgent ?? '').trim().toLowerCase();
  if (normalized === '') {
    return 'unknown';
  }

  if (normalized.includes('curl/')) {
    return 'curl';
  }

  if (
    normalized.includes('edg/') ||
    normalized.includes('edga/') ||
    normalized.includes('edgios/')
  ) {
    return 'edge';
  }

  const looksLikeAndroidWebView =
    normalized.includes('android') &&
    (normalized.includes('; wv)') ||
      normalized.includes(' version/') ||
      (normalized.includes('version/') && normalized.includes('chrome/')));
  if (looksLikeAndroidWebView) {
    return 'android-webview';
  }

  if (normalized.includes('firefox/') || normalized.includes('fxios/')) {
    return 'firefox';
  }

  if (
    normalized.includes('chrome/') ||
    normalized.includes('chromium/') ||
    normalized.includes('crios/')
  ) {
    return 'chromium';
  }

  if (
    normalized.includes('safari/') ||
    normalized.includes('iphone') ||
    normalized.includes('ipad') ||
    normalized.includes('macintosh')
  ) {
    return 'safari';
  }

  if (normalized.startsWith('mozilla/')) {
    return 'other';
  }

  return 'unknown';
}

export async function computeCallerKey(
  secret: string,
  ipAddress: string | null | undefined,
  userAgent: string | null | undefined
): Promise<Base64Url> {
  const normalizedIp = (ipAddress ?? '').trim() || 'unknown';
  const family = normalizeUserAgentFamily(userAgent);
  const signature = await signHmacSha256(secret, `${CALLER_KEY_DOMAIN}${normalizedIp}\0${family}`);
  return encodeBase64Url(signature);
}

export async function createCommitToken(
  secret: string,
  payload: Omit<CommitTokenPayload, 'v'>
): Promise<string> {
  const normalizedPayload: CommitTokenPayload = {
    v: '1',
    kind: payload.kind,
    uuid: payload.uuid,
    challengeId: payload.challengeId,
    callerKey: payload.callerKey,
    iat: payload.iat,
    exp: payload.exp,
  };
  const payloadB64u = encodeBase64Url(toUtf8Bytes(serializeCommitTokenPayload(normalizedPayload)));
  const signature = await signHmacSha256(secret, `${COMMIT_TOKEN_DOMAIN}${payloadB64u}`);
  return `${payloadB64u}.${encodeBase64Url(signature)}`;
}

export async function verifyCommitToken(
  secret: string,
  token: string
): Promise<CommitTokenPayload | null> {
  const separator = token.indexOf('.');
  if (separator <= 0 || separator >= token.length - 1 || token.indexOf('.', separator + 1) !== -1) {
    return null;
  }

  const payloadB64u = token.slice(0, separator);
  const signatureB64u = token.slice(separator + 1);
  const expectedSignature = encodeBase64Url(
    await signHmacSha256(secret, `${COMMIT_TOKEN_DOMAIN}${payloadB64u}`)
  );
  if (!constantTimeEqual(signatureB64u, expectedSignature)) {
    return null;
  }

  try {
    const payloadJson = new TextDecoder().decode(decodeBase64Url(payloadB64u));
    return parseCommitTokenPayload(JSON.parse(payloadJson));
  } catch {
    return null;
  }
}

export async function hashCommitToken(token: string): Promise<HexString> {
  return sha256Hex([toUtf8Bytes(token)]);
}

export function getCommitCookieName(kind: CommitCookieKind): string {
  return kind === 'lock' ? LOCK_COMMIT_COOKIE_NAME : COMPOUND_COMMIT_COOKIE_NAME;
}

export function getCommitCookiePaths(kind: CommitCookieKind, uuid: string): string[] {
  if (kind === 'lock') {
    return [`/api/lock_commit/${uuid}`];
  }

  return [`/api/manage/compound_commit/${uuid}`, `/api/delete_commit/${uuid}`];
}

export function extractCookieValue(
  cookieHeader: string | null | undefined,
  name: string
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed.startsWith(`${name}=`)) {
      continue;
    }

    return trimmed.slice(name.length + 1) || null;
  }

  return null;
}

export function appendInternalCommitCookieSignal(
  headers: Headers,
  signal: CommitCookieSignal | undefined
): void {
  if (!signal) {
    return;
  }

  headers.set(INTERNAL_COMMIT_COOKIE_ACTION_HEADER, signal.action);
  headers.set(INTERNAL_COMMIT_COOKIE_KIND_HEADER, signal.kind);

  if (signal.action === 'set') {
    if (!signal.token || signal.exp === undefined) {
      throw new Error('set commit cookie signal requires token and exp');
    }

    headers.set(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER, signal.token);
    headers.set(INTERNAL_COMMIT_COOKIE_EXP_HEADER, String(signal.exp));
    return;
  }

  headers.delete(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER);
  headers.delete(INTERNAL_COMMIT_COOKIE_EXP_HEADER);
}

export function readInternalCommitCookieSignal(headers: Headers): CommitCookieSignal | null {
  const action = headers.get(INTERNAL_COMMIT_COOKIE_ACTION_HEADER);
  const kind = headers.get(INTERNAL_COMMIT_COOKIE_KIND_HEADER);
  if ((action !== 'set' && action !== 'clear') || (kind !== 'lock' && kind !== 'compound')) {
    return null;
  }

  if (action === 'clear') {
    return { action, kind };
  }

  const token = headers.get(INTERNAL_COMMIT_COOKIE_TOKEN_HEADER);
  const expValue = headers.get(INTERNAL_COMMIT_COOKIE_EXP_HEADER);
  const expNumber = expValue === null ? Number.NaN : Number(expValue);
  if (!token || !Number.isInteger(expNumber) || expNumber < 0) {
    return null;
  }

  return {
    action,
    kind,
    token,
    exp: expNumber as UnixMs,
  };
}

function serializeCookie(
  name: string,
  value: string,
  path: string,
  secure: boolean,
  expiresAt: Date,
  maxAge: number
): string {
  const attributes = [
    `${name}=${value}`,
    `Path=${path}`,
    `Expires=${expiresAt.toUTCString()}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Strict',
  ];

  if (secure) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

export function buildCommitSetCookieHeaders(
  signal: CommitCookieSignal,
  uuid: string,
  secure: boolean,
  now: number = Date.now()
): string[] {
  const name = getCommitCookieName(signal.kind);
  const paths = getCommitCookiePaths(signal.kind, uuid);

  if (signal.action === 'clear') {
    return paths.map((path) => serializeCookie(name, '', path, secure, new Date(0), 0));
  }

  if (!signal.token || signal.exp === undefined) {
    throw new Error('set commit cookie signal requires token and exp');
  }

  const maxAgeSeconds = Math.max(0, Math.ceil((signal.exp - now) / 1000));
  const expiresAt = new Date(signal.exp);
  return paths.map((path) =>
    serializeCookie(name, signal.token as string, path, secure, expiresAt, maxAgeSeconds)
  );
}
