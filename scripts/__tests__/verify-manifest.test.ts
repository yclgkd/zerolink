import { createHash, generateKeyPairSync, sign as signData } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkManifestHash,
  fromBase64Url,
  hashBufferHex,
  verifyFileHashes,
  verifyManifestSignature,
} from '../verify-manifest';

function generateEd25519Pair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

describe('fromBase64Url', () => {
  it('decodes a base64url string back to original bytes', () => {
    const original = Buffer.from('ZeroLink verify');
    const encoded = toBase64Url(original);
    const decoded = fromBase64Url(encoded);
    expect(decoded).toEqual(original);
  });

  it('handles strings with - and _ characters', () => {
    const input = Buffer.from([0xfb, 0xff, 0xfe]);
    const encoded = '-__-';
    const decoded = fromBase64Url(encoded);
    expect(decoded).toEqual(input);
  });

  it('handles strings without padding', () => {
    const buf = Buffer.from('a');
    const encoded = toBase64Url(buf);
    expect(encoded).not.toContain('=');
    expect(fromBase64Url(encoded)).toEqual(buf);
  });
});

describe('hashBufferHex', () => {
  it('returns a 64-char hex string', () => {
    const hash = hashBufferHex(Buffer.from('hello'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('accepts a string input', () => {
    const hash = hashBufferHex('hello');
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('matches known SHA-256 value', () => {
    const expected = createHash('sha256').update(Buffer.from('test')).digest('hex');
    expect(hashBufferHex(Buffer.from('test'))).toBe(expected);
  });
});

describe('verifyManifestSignature', () => {
  it('returns true for a valid Ed25519 signature', async () => {
    const { privatePem, publicPem } = generateEd25519Pair();
    const { createPrivateKey } = await import('node:crypto');
    const privateKey = createPrivateKey(privatePem);

    const data = Buffer.from('manifest content');
    const signature = signData(null, data, privateKey);
    const signatureBase64Url = toBase64Url(signature);

    const result = await verifyManifestSignature({
      manifestBytes: data,
      signatureBase64Url,
      publicKeyPem: publicPem,
    });
    expect(result).toBe(true);
  });

  it('returns false for a tampered manifest', async () => {
    const { privatePem, publicPem } = generateEd25519Pair();
    const { createPrivateKey } = await import('node:crypto');
    const privateKey = createPrivateKey(privatePem);

    const original = Buffer.from('original manifest');
    const signature = signData(null, original, privateKey);
    const signatureBase64Url = toBase64Url(signature);

    const result = await verifyManifestSignature({
      manifestBytes: Buffer.from('tampered manifest'),
      signatureBase64Url,
      publicKeyPem: publicPem,
    });
    expect(result).toBe(false);
  });

  it('returns false when signature is wrong key', async () => {
    const { publicPem } = generateEd25519Pair();
    const { privatePem: otherPrivatePem } = generateEd25519Pair();
    const { createPrivateKey } = await import('node:crypto');
    const otherKey = createPrivateKey(otherPrivatePem);

    const data = Buffer.from('manifest');
    const signature = signData(null, data, otherKey);
    const signatureBase64Url = toBase64Url(signature);

    const result = await verifyManifestSignature({
      manifestBytes: data,
      signatureBase64Url,
      publicKeyPem: publicPem,
    });
    expect(result).toBe(false);
  });
});

describe('verifyFileHashes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zl-verify-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns ok=true for files with correct hashes', async () => {
    const content = 'app content';
    await fs.writeFile(path.join(tmpDir, 'app.js'), content);
    const hash = createHash('sha256').update(Buffer.from(content)).digest('hex');

    const manifest = {
      version: '1.0.0',
      commitHash: 'abc',
      buildTime: new Date().toISOString(),
      files: { 'app.js': hash },
    };

    const results = await verifyFileHashes(manifest, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
  });

  it('returns ok=false for a file with incorrect hash', async () => {
    await fs.writeFile(path.join(tmpDir, 'app.js'), 'actual content');

    const manifest = {
      version: '1.0.0',
      commitHash: 'abc',
      buildTime: new Date().toISOString(),
      files: { 'app.js': 'wronghash' },
    };

    const results = await verifyFileHashes(manifest, tmpDir);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.actual).not.toBe('wronghash');
  });

  it('returns FILE_NOT_FOUND as actual when file is missing', async () => {
    const manifest = {
      version: '1.0.0',
      commitHash: 'abc',
      buildTime: new Date().toISOString(),
      files: { 'missing.js': 'anyhash' },
    };

    const results = await verifyFileHashes(manifest, tmpDir);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.actual).toBe('FILE_NOT_FOUND');
  });

  it('rejects path traversal entries with ok=false and actual="PATH_TRAVERSAL"', async () => {
    const manifest = {
      version: '1.0.0',
      commitHash: 'abc',
      buildTime: new Date().toISOString(),
      files: { '../../etc/passwd': 'somehash' },
    };

    const results = await verifyFileHashes(manifest, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.actual).toBe('PATH_TRAVERSAL');
  });

  it('rejects absolute path entries with ok=false and actual="PATH_TRAVERSAL"', async () => {
    const manifest = {
      version: '1.0.0',
      commitHash: 'abc',
      buildTime: new Date().toISOString(),
      files: { '/etc/passwd': 'somehash' },
    };

    const results = await verifyFileHashes(manifest, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.actual).toBe('PATH_TRAVERSAL');
  });

  it('rejects a path that starts with distDir string but escapes it', async () => {
    // e.g. distDir = /tmp/zl-test-abc, attack = /tmp/zl-test-abc-evil/secret
    // path.resolve would produce /tmp/zl-test-abc-evil/secret which starts with
    // distDir but is NOT inside it — the sep boundary check prevents this.
    const manifest = {
      version: '1.0.0',
      commitHash: 'abc',
      buildTime: new Date().toISOString(),
      // Craft a relative path that resolves outside distDir
      files: { '../outside-file.txt': 'somehash' },
    };

    const results = await verifyFileHashes(manifest, tmpDir);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.actual).toBe('PATH_TRAVERSAL');
  });

  it('verifies multiple files concurrently', async () => {
    const files = { 'a.js': 'content-a', 'b.css': 'content-b' };
    const manifestFiles: Record<string, string> = {};

    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(tmpDir, name), content);
      manifestFiles[name] = createHash('sha256').update(Buffer.from(content)).digest('hex');
    }

    const manifest = {
      version: '1.0.0',
      commitHash: 'abc',
      buildTime: new Date().toISOString(),
      files: manifestFiles,
    };

    const results = await verifyFileHashes(manifest, tmpDir);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe('checkManifestHash', () => {
  it('returns ok=true when expectedHash is empty (no manifest-hash.txt present)', () => {
    const manifestBytes = Buffer.from('{"version":"1.0.0"}');
    const result = checkManifestHash(manifestBytes, '');
    expect(result.ok).toBe(true);
    expect(result.actual).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('returns ok=true when hashes match', () => {
    const manifestBytes = Buffer.from('{"version":"1.0.0"}');
    const expected = createHash('sha256').update(manifestBytes).digest('hex');
    const result = checkManifestHash(manifestBytes, expected);
    expect(result.ok).toBe(true);
    expect(result.actual).toBe(expected);
  });

  it('returns ok=false when hashes differ', () => {
    const manifestBytes = Buffer.from('{"version":"1.0.0"}');
    const result = checkManifestHash(manifestBytes, 'wronghash');
    expect(result.ok).toBe(false);
    expect(result.actual).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.actual).not.toBe('wronghash');
  });
});
