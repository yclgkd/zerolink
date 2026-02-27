const CHANNEL_UUID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const CHANNEL_UUID_LENGTH = 21;

/**
 * Generates a 21-character base64url-safe channel UUID.
 */
export function generateChannelUuid(): string {
  const bytes = new Uint8Array(CHANNEL_UUID_LENGTH);

  crypto.getRandomValues(bytes);

  let value = '';
  for (const byte of bytes) {
    value += CHANNEL_UUID_ALPHABET[byte & 63]!;
  }

  return value;
}
