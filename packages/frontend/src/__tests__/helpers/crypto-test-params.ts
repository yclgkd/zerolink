import type { Argon2idKdfParams } from '@zerolink/shared/crypto/kdf';

export const FAST_TEST_ARGON2ID_KDF_PARAMS = {
  m: 1_024,
  t: 1,
  p: 1,
  version: 19,
} satisfies Argon2idKdfParams;
