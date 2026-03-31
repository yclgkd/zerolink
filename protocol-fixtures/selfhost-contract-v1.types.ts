export interface SelfHostContractFixture {
  version: number;
  canonicalJson: Array<{
    name: string;
    input: Record<string, unknown>;
    canonical: string;
    sha256Hex: string;
  }>;
  aad: Array<{
    name: string;
    parts: {
      uuid: string;
      version: number;
      receiverPubFpr: string;
    };
    string: string;
    utf8Hex: string;
  }>;
  challengeDerivation: {
    lock: {
      uuid: string;
      lockSecretB64u: string;
      lockChallengeId: string;
      lockChallengeB64u: string;
      lockKeyB64u: string;
      lockProofHex: string;
    };
    compound: {
      uuid: string;
      challengeId: string;
      challengeSeedB64u: string;
      intentHash: string;
      expectedChallengeB64u: string;
    };
    deliveryProof: {
      uuid: string;
      intentHash: string;
      expectedChallengeB64u: string;
    };
  };
  ws: {
    serverMessages: Array<{ name: string; payload: unknown }>;
    clientMessages: Array<{ name: string; payload: unknown }>;
  };
}
