import type { Page } from '@playwright/test';

export interface VirtualAuthenticatorHandle {
  teardown: () => Promise<void>;
}

/**
 * Installs a deterministic in-page WebAuthn emulator for Chromium E2E.
 * The returned attestation/assertion payloads are structurally valid for the
 * sender-auth fingerprinting and delivery-proof verification flows.
 */
export async function installVirtualAuthenticator(page: Page): Promise<VirtualAuthenticatorHandle> {
  await page.addInitScript(() => {
    const textEncoder = new TextEncoder();
    const STORAGE_KEY = '__zl_e2e_webauthn_state__';

    type ByteLike = ArrayBuffer | ArrayBufferView | Uint8Array;

    interface CredentialState {
      id: string;
      idBytes: Uint8Array;
      privateKey: CryptoKey;
      publicKeyCose: Uint8Array;
      publicKeySpki: Uint8Array;
    }

    interface PersistedCredentialState {
      id: string;
      privateKeyPkcs8: string;
      publicKeyCose: string;
      publicKeySpki?: string;
    }

    interface SerializedAttestationResponse {
      clientDataJSON: string;
      attestationObject: string;
      authenticatorData: string;
      publicKey: string;
      publicKeyAlgorithm: number;
      transports: string[];
    }

    interface SerializedAssertionResponse {
      clientDataJSON: string;
      authenticatorData: string;
      signature: string;
      userHandle: string;
    }

    let credentialStatePromise: Promise<CredentialState> | null = null;
    let signCount = 0;

    function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;

      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return merged;
    }

    function toUint8Array(value: ByteLike | null | undefined): Uint8Array {
      if (!value) {
        return new Uint8Array();
      }
      if (value instanceof Uint8Array) {
        return Uint8Array.from(value);
      }
      if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      }
      return new Uint8Array(value);
    }

    function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
      return Uint8Array.from(bytes).buffer;
    }

    function serializeByteLike(value: ByteLike): string {
      return encodeBase64Url(toUint8Array(value));
    }

    function encodeBase64Url(bytes: Uint8Array): string {
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

      return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    }

    function decodeBase64Url(value: string): Uint8Array {
      const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }

    function encodeCborLength(majorType: number, length: number): Uint8Array {
      if (length < 24) {
        return Uint8Array.of((majorType << 5) | length);
      }

      if (length < 256) {
        return Uint8Array.of((majorType << 5) | 24, length);
      }

      throw new Error('unsupported CBOR length');
    }

    function encodeCborInteger(value: number): Uint8Array {
      if (value >= 0) {
        return encodeCborLength(0, value);
      }

      return encodeCborLength(1, -1 - value);
    }

    function encodeCborText(value: string): Uint8Array {
      const bytes = textEncoder.encode(value);
      return concatBytes([encodeCborLength(3, bytes.byteLength), bytes]);
    }

    function encodeCborBytes(value: Uint8Array): Uint8Array {
      return concatBytes([encodeCborLength(2, value.byteLength), value]);
    }

    function encodeCborMap(entries: readonly [Uint8Array, Uint8Array][]): Uint8Array {
      return concatBytes([encodeCborLength(5, entries.length), ...entries.flat()]);
    }

    function encodeUint16(value: number): Uint8Array {
      return Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
    }

    function encodeUint32(value: number): Uint8Array {
      return Uint8Array.of(
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff
      );
    }

    async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
      return new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes)));
    }

    function encodeCredentialPublicKey(x: Uint8Array, y: Uint8Array): Uint8Array {
      return encodeCborMap([
        [encodeCborInteger(1), encodeCborInteger(2)],
        [encodeCborInteger(3), encodeCborInteger(-7)],
        [encodeCborInteger(-1), encodeCborInteger(1)],
        [encodeCborInteger(-2), encodeCborBytes(x)],
        [encodeCborInteger(-3), encodeCborBytes(y)],
      ]);
    }

    function buildAttestationObject(authData: Uint8Array): Uint8Array {
      return encodeCborMap([
        [encodeCborText('fmt'), encodeCborText('none')],
        [encodeCborText('attStmt'), encodeCborMap([])],
        [encodeCborText('authData'), encodeCborBytes(authData)],
      ]);
    }

    async function buildPublicKeyMaterial(publicJwk: { x: string; y: string }): Promise<{
      publicKeyCose: Uint8Array;
      publicKeySpki: Uint8Array;
    }> {
      const publicKeyCose = encodeCredentialPublicKey(
        decodeBase64Url(publicJwk.x),
        decodeBase64Url(publicJwk.y)
      );
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        {
          crv: 'P-256',
          ext: true,
          key_ops: ['verify'],
          kty: 'EC',
          x: publicJwk.x,
          y: publicJwk.y,
        },
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify']
      );

      return {
        publicKeyCose,
        publicKeySpki: new Uint8Array(await crypto.subtle.exportKey('spki', publicKey)),
      };
    }

    async function ensureCredentialState(): Promise<CredentialState> {
      if (credentialStatePromise) {
        return credentialStatePromise;
      }

      credentialStatePromise = (async () => {
        try {
          const persistedRaw = window.sessionStorage.getItem(STORAGE_KEY);
          if (persistedRaw) {
            const persisted = JSON.parse(persistedRaw) as PersistedCredentialState;
            const privateKey = await crypto.subtle.importKey(
              'pkcs8',
              toArrayBuffer(decodeBase64Url(persisted.privateKeyPkcs8)),
              { name: 'ECDSA', namedCurve: 'P-256' },
              true,
              ['sign']
            );
            const idBytes = decodeBase64Url(persisted.id);
            const publicKeySpki =
              persisted.publicKeySpki === undefined
                ? null
                : decodeBase64Url(persisted.publicKeySpki);
            const publicKeyCose = decodeBase64Url(persisted.publicKeyCose);

            if (publicKeySpki) {
              return {
                id: persisted.id,
                idBytes,
                privateKey,
                publicKeyCose,
                publicKeySpki,
              };
            }

            const privateJwk = (await crypto.subtle.exportKey('jwk', privateKey)) as {
              x: string;
              y: string;
            };
            const publicKeyMaterial = await buildPublicKeyMaterial(privateJwk);

            try {
              window.sessionStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                  id: persisted.id,
                  privateKeyPkcs8: persisted.privateKeyPkcs8,
                  publicKeyCose: encodeBase64Url(publicKeyMaterial.publicKeyCose),
                  publicKeySpki: encodeBase64Url(publicKeyMaterial.publicKeySpki),
                } satisfies PersistedCredentialState)
              );
            } catch {
              // Ignore storage upgrade failures in the emulator.
            }

            return {
              id: persisted.id,
              idBytes,
              privateKey,
              publicKeyCose: publicKeyMaterial.publicKeyCose,
              publicKeySpki: publicKeyMaterial.publicKeySpki,
            };
          }
        } catch {
          try {
            window.sessionStorage.removeItem(STORAGE_KEY);
          } catch {
            // Ignore storage cleanup failures in the emulator.
          }
        }

        const keyPair = await crypto.subtle.generateKey(
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['sign', 'verify']
        );
        const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as {
          x: string;
          y: string;
        };
        const idBytes = crypto.getRandomValues(new Uint8Array(16));
        const id = encodeBase64Url(idBytes);
        const publicKeyMaterial = await buildPublicKeyMaterial(publicJwk);

        try {
          const privateKeyPkcs8 = new Uint8Array(
            await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
          );
          window.sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              id,
              privateKeyPkcs8: encodeBase64Url(privateKeyPkcs8),
              publicKeyCose: encodeBase64Url(publicKeyMaterial.publicKeyCose),
              publicKeySpki: encodeBase64Url(publicKeyMaterial.publicKeySpki),
            } satisfies PersistedCredentialState)
          );
        } catch {
          // The emulator still works without persistence; same-document flows keep the in-memory key.
        }

        return {
          id,
          idBytes,
          privateKey: keyPair.privateKey,
          publicKeyCose: publicKeyMaterial.publicKeyCose,
          publicKeySpki: publicKeyMaterial.publicKeySpki,
        };
      })();

      return credentialStatePromise;
    }

    function createAttestationCredential(
      state: CredentialState,
      response: AuthenticatorAttestationResponse,
      responseJson: SerializedAttestationResponse
    ): PublicKeyCredential {
      return {
        id: state.id,
        rawId: toArrayBuffer(state.idBytes),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        response,
        getClientExtensionResults: () => ({}),
        toJSON: () => ({
          id: state.id,
          rawId: encodeBase64Url(state.idBytes),
          type: 'public-key',
          authenticatorAttachment: 'platform',
          clientExtensionResults: {},
          response: responseJson,
        }),
      };
    }

    function createAssertionCredential(
      state: CredentialState,
      response: AuthenticatorAssertionResponse,
      responseJson: SerializedAssertionResponse
    ): PublicKeyCredential {
      return {
        id: state.id,
        rawId: toArrayBuffer(state.idBytes),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        response,
        getClientExtensionResults: () => ({}),
        toJSON: () => ({
          id: state.id,
          rawId: encodeBase64Url(state.idBytes),
          type: 'public-key',
          authenticatorAttachment: 'platform',
          clientExtensionResults: {},
          response: responseJson,
        }),
      };
    }

    async function buildCreateResponse(
      options: CredentialCreationOptions | undefined
    ): Promise<PublicKeyCredential> {
      if (!options?.publicKey) {
        throw new DOMException('missing publicKey options', 'NotSupportedError');
      }

      const state = await ensureCredentialState();
      const rpId = options.publicKey.rp.id ?? window.location.hostname;
      const rpIdHash = await sha256(textEncoder.encode(rpId));
      const flags = Uint8Array.of(0x45);
      const signCountBytes = encodeUint32(0);
      const aaguid = new Uint8Array(16);
      const credentialIdLength = encodeUint16(state.idBytes.byteLength);
      const authData = concatBytes([
        rpIdHash,
        flags,
        signCountBytes,
        aaguid,
        credentialIdLength,
        state.idBytes,
        state.publicKeyCose,
      ]);
      const challenge = encodeBase64Url(toUint8Array(options.publicKey.challenge));
      const clientDataJSON = textEncoder.encode(
        JSON.stringify({
          type: 'webauthn.create',
          challenge,
          origin: window.location.origin,
          crossOrigin: false,
        })
      );
      const attestationObject = buildAttestationObject(authData);
      const clientDataBuffer = toArrayBuffer(clientDataJSON);
      const attestationBuffer = toArrayBuffer(attestationObject);
      const authDataBuffer = toArrayBuffer(authData);
      const publicKeyBuffer = toArrayBuffer(state.publicKeySpki);
      const response: AuthenticatorAttestationResponse = {
        clientDataJSON: clientDataBuffer,
        attestationObject: attestationBuffer,
        getAuthenticatorData: () => authDataBuffer,
        getPublicKey: () => publicKeyBuffer,
        getPublicKeyAlgorithm: () => -7,
        getTransports: () => ['internal'],
      };

      return createAttestationCredential(state, response, {
        clientDataJSON: serializeByteLike(clientDataBuffer),
        attestationObject: serializeByteLike(attestationBuffer),
        authenticatorData: serializeByteLike(authDataBuffer),
        publicKey: serializeByteLike(publicKeyBuffer),
        publicKeyAlgorithm: -7,
        transports: ['internal'],
      });
    }

    async function buildGetResponse(
      options: CredentialRequestOptions | undefined
    ): Promise<PublicKeyCredential> {
      if (!options?.publicKey) {
        throw new DOMException('missing publicKey options', 'NotSupportedError');
      }

      const state = await ensureCredentialState();
      signCount += 1;
      const rpId = options.publicKey.rpId ?? window.location.hostname;
      const rpIdHash = await sha256(textEncoder.encode(rpId));
      const authenticatorData = concatBytes([
        rpIdHash,
        Uint8Array.of(0x05),
        encodeUint32(signCount),
      ]);
      const challenge = encodeBase64Url(toUint8Array(options.publicKey.challenge));
      const clientDataJSON = textEncoder.encode(
        JSON.stringify({
          type: 'webauthn.get',
          challenge,
          origin: window.location.origin,
          crossOrigin: false,
        })
      );
      const clientDataHash = await sha256(clientDataJSON);
      const signedPayload = concatBytes([authenticatorData, clientDataHash]);
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          state.privateKey,
          toArrayBuffer(signedPayload)
        )
      );
      const clientDataBuffer = toArrayBuffer(clientDataJSON);
      const authenticatorDataBuffer = toArrayBuffer(authenticatorData);
      const signatureBuffer = toArrayBuffer(signature);
      const userHandleBuffer = toArrayBuffer(Uint8Array.of(0x01));
      const response: AuthenticatorAssertionResponse = {
        clientDataJSON: clientDataBuffer,
        authenticatorData: authenticatorDataBuffer,
        signature: signatureBuffer,
        userHandle: userHandleBuffer,
      };

      return createAssertionCredential(state, response, {
        clientDataJSON: serializeByteLike(clientDataBuffer),
        authenticatorData: serializeByteLike(authenticatorDataBuffer),
        signature: serializeByteLike(signatureBuffer),
        userHandle: serializeByteLike(userHandleBuffer),
      });
    }

    if (!navigator.credentials) {
      return;
    }

    Object.defineProperty(navigator.credentials, 'create', {
      configurable: true,
      value: buildCreateResponse,
    });
    Object.defineProperty(navigator.credentials, 'get', {
      configurable: true,
      value: buildGetResponse,
    });
  });

  return {
    teardown: async () => {
      // The in-page emulator has no external resources to release.
    },
  };
}
