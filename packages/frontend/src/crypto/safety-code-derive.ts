import { type HexString, SAFETY_CODE, type SafetyCodeDisplay } from '@zerolink/shared';

const RECEIVER_FPR_PATTERN = /^[0-9a-f]{64}$/u;

export const DEFAULT_SAFETY_EMOJI_PALETTE = [
  '🧊',
  '🔥',
  '🌊',
  '🌲',
  '🚀',
  '🔮',
  '💎',
  '⚡',
  '🌙',
  '🎯',
  '🛰️',
  '🧭',
  '🛡️',
  '🧩',
  '🦊',
  '🐼',
] as const;

function assertReceiverFingerprint(receiverPubFpr: string): asserts receiverPubFpr is HexString {
  if (!RECEIVER_FPR_PATTERN.test(receiverPubFpr)) {
    throw new Error('receiverPubFpr must be 64 lowercase hex characters');
  }
}

function bytesFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

function toEmojiTuple(bytes: Uint8Array): SafetyCodeDisplay['emoji']['emojis'] {
  const source = bytes.slice(0, SAFETY_CODE.EMOJI_COUNT);
  if (source.length !== SAFETY_CODE.EMOJI_COUNT) {
    throw new Error('receiverPubFpr does not contain enough bytes for emoji safety code');
  }

  return [
    DEFAULT_SAFETY_EMOJI_PALETTE[source[0]! & 0x0f]!,
    DEFAULT_SAFETY_EMOJI_PALETTE[source[1]! & 0x0f]!,
    DEFAULT_SAFETY_EMOJI_PALETTE[source[2]! & 0x0f]!,
    DEFAULT_SAFETY_EMOJI_PALETTE[source[3]! & 0x0f]!,
    DEFAULT_SAFETY_EMOJI_PALETTE[source[4]! & 0x0f]!,
    DEFAULT_SAFETY_EMOJI_PALETTE[source[5]! & 0x0f]!,
    DEFAULT_SAFETY_EMOJI_PALETTE[source[6]! & 0x0f]!,
    DEFAULT_SAFETY_EMOJI_PALETTE[source[7]! & 0x0f]!,
  ];
}

function toColorCellTuple(bytes: Uint8Array): SafetyCodeDisplay['color']['cells'] {
  const cells: number[] = [];

  for (const byte of bytes.slice(0, SAFETY_CODE.COLOR_GRID_SIZE * 2)) {
    cells.push((byte >> 4) & 0x0f);
    cells.push(byte & 0x0f);
    if (cells.length >= SAFETY_CODE.COLOR_GRID_SIZE * SAFETY_CODE.COLOR_GRID_SIZE) {
      break;
    }
  }

  if (cells.length !== SAFETY_CODE.COLOR_GRID_SIZE * SAFETY_CODE.COLOR_GRID_SIZE) {
    throw new Error('receiverPubFpr does not contain enough nibbles for color safety code');
  }

  return [
    cells[0]!,
    cells[1]!,
    cells[2]!,
    cells[3]!,
    cells[4]!,
    cells[5]!,
    cells[6]!,
    cells[7]!,
    cells[8]!,
    cells[9]!,
    cells[10]!,
    cells[11]!,
    cells[12]!,
    cells[13]!,
    cells[14]!,
    cells[15]!,
  ];
}

/**
 * Derives a deterministic SafetyCodeDisplay from the receiver public-key fingerprint.
 */
export function deriveSafetyCodeDisplay(receiverPubFpr: string): SafetyCodeDisplay {
  assertReceiverFingerprint(receiverPubFpr);
  const bytes = bytesFromHex(receiverPubFpr);

  const shortPrefixLength = SAFETY_CODE.SHORT_FINGERPRINT_BYTES * 2;
  const shortFpr = `${receiverPubFpr.slice(0, shortPrefixLength)}...${receiverPubFpr.slice(-shortPrefixLength)}`;

  return {
    emoji: {
      type: 'emoji',
      emojis: toEmojiTuple(bytes),
    },
    color: {
      type: 'color',
      cells: toColorCellTuple(bytes),
    },
    shortFpr,
    fullFpr: receiverPubFpr,
  };
}
