import type { CDPSession, Page } from '@playwright/test';

export interface VirtualAuthenticatorHandle {
  teardown: () => Promise<void>;
}

/**
 * Enables a Chromium virtual authenticator for deterministic WebAuthn E2E.
 */
export async function installVirtualAuthenticator(page: Page): Promise<VirtualAuthenticatorHandle> {
  await page.addInitScript(() => {
    const encode = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;

    const mockedCreate = async (): Promise<PublicKeyCredential> => {
      const response = {
        clientDataJSON: encode('e2e-client-data'),
        attestationObject: encode('e2e-attestation-object'),
        getTransports: () => ['internal'],
      };
      return {
        id: 'e2e-credential-id',
        rawId: encode('e2e-raw-id'),
        type: 'public-key',
        response,
        getClientExtensionResults: () => ({}),
      } as PublicKeyCredential;
    };

    const mockedGet = async (): Promise<PublicKeyCredential> => {
      const response = {
        clientDataJSON: encode('e2e-assert-client-data'),
        authenticatorData: encode('e2e-authenticator-data'),
        signature: encode('e2e-signature'),
        userHandle: null,
      };
      return {
        id: 'e2e-credential-id',
        rawId: encode('e2e-raw-id'),
        type: 'public-key',
        response,
        getClientExtensionResults: () => ({}),
      } as PublicKeyCredential;
    };

    if (!navigator.credentials) {
      return;
    }

    try {
      Object.defineProperty(navigator.credentials, 'create', {
        configurable: true,
        value: mockedCreate,
      });
    } catch {
      // no-op when create is immutable in the runtime.
    }

    try {
      Object.defineProperty(navigator.credentials, 'get', {
        configurable: true,
        value: mockedGet,
      });
    } catch {
      // no-op when get is immutable in the runtime.
    }
  });

  try {
    await page.context().grantPermissions(['publickey-credentials-get'], {
      origin: 'http://127.0.0.1:4173',
    });
  } catch {
    // Some Chromium builds do not require or expose this permission.
  }

  const session = await page.context().newCDPSession(page);
  await session.send('WebAuthn.enable');
  const result = (await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      isUserConsenting: true,
      automaticPresenceSimulation: true,
    },
  })) as { authenticatorId?: string };

  const authenticatorId = result.authenticatorId;

  return {
    teardown: async () => {
      await teardownAuthenticator(session, authenticatorId);
    },
  };
}

async function teardownAuthenticator(session: CDPSession, authenticatorId?: string): Promise<void> {
  try {
    if (authenticatorId) {
      await session.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    }
  } catch {
    // no-op on teardown
  }

  try {
    await session.send('WebAuthn.disable');
  } catch {
    // no-op on teardown
  }

  try {
    await session.detach();
  } catch {
    // no-op on teardown
  }
}
