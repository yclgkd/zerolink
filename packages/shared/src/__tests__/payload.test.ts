import { describe, expect, it } from 'vitest';

import {
  decodeSharePayload,
  encodeFileSharePayload,
  encodeTextSharePayload,
} from '../payload.ts';

describe('share payload envelope', () => {
  it('round-trips text payloads', () => {
    const payload = encodeTextSharePayload('ZeroLink text payload');
    expect(decodeSharePayload(payload)).toEqual({
      kind: 'text',
      text: 'ZeroLink text payload',
    });
  });

  it('round-trips file payloads', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const payload = encodeFileSharePayload({
      fileName: 'secret.bin',
      mediaType: 'application/octet-stream',
      bytes,
    });

    expect(decodeSharePayload(payload)).toEqual({
      kind: 'file',
      fileName: 'secret.bin',
      mediaType: 'application/octet-stream',
      size: 5,
      bytes,
    });
  });

  it('treats payloads without the magic header as legacy text', () => {
    const legacy = new TextEncoder().encode('legacy plaintext');
    expect(decodeSharePayload(legacy)).toEqual({
      kind: 'text',
      text: 'legacy plaintext',
    });
  });

  it('rejects file envelopes with mismatched declared size', () => {
    const payload = encodeFileSharePayload({
      fileName: 'secret.bin',
      mediaType: 'application/octet-stream',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const tampered = payload.slice();
    const headerLengthOffset = 4;
    const headerLength = new DataView(tampered.buffer).getUint32(headerLengthOffset, false);
    const headerStart = 8;
    const headerEnd = headerStart + headerLength;
    const parsedHeader = JSON.parse(new TextDecoder().decode(tampered.subarray(headerStart, headerEnd))) as {
      kind: 'file';
      fileName: string;
      mediaType: string;
      size: number;
    };
    parsedHeader.size = 9;
    const updatedHeader = new TextEncoder().encode(JSON.stringify(parsedHeader));
    expect(updatedHeader.byteLength).toBe(headerLength);
    tampered.set(updatedHeader, headerStart);

    expect(() => decodeSharePayload(tampered)).toThrow('payload file size does not match body length');
  });
});
