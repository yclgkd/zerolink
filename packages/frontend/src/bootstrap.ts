import {
  clearBootstrapBodyStyles,
  defaultRenderVerificationGate,
  type ReleaseVerificationGateState,
} from './bootstrap-gate';
import { clearEntryRecoveryAttempt, recoverEntryMismatchOnce } from './bootstrap-recovery';
import { MANIFEST_SIGNING_PUBLIC_KEY_PEM } from './release/public-key';
import { setVerifiedReleaseSnapshot } from './release/runtime';
import { tieredVerifyRelease } from './release/tiered-verification';
import type { ReleaseVerificationResult } from './release/verification';

export interface MockWorker {
  start: (options?: Record<string, unknown>) => Promise<unknown>;
}

export interface MockWorkerModule {
  worker: MockWorker;
}

export type MockWorkerLoader = () => Promise<MockWorkerModule>;

export interface BootstrapAppOptions {
  search: string;
  loadApp: () => Promise<void> | void;
  currentEntryUrl?: string;
  initializeMockingFn?: (search: string) => Promise<void>;
  isReleaseVerificationRequired?: boolean;
  renderVerificationGate?: (state: ReleaseVerificationGateState) => void;
  recoverEntryMismatchFn?: () => boolean;
  setVerifiedReleaseSnapshot?: typeof setVerifiedReleaseSnapshot;
  verifyReleaseFn?: () => Promise<ReleaseVerificationResult>;
}

const defaultWorkerLoader: MockWorkerLoader = async () => import('./mocks/browser');

export function isMockEnabled(search: string): boolean {
  const normalizedSearch = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  return params.get('mock') === 'true';
}

export async function initializeMocking(
  search: string,
  loadWorker: MockWorkerLoader = defaultWorkerLoader,
  isDevMode: boolean = import.meta.env.DEV
): Promise<void> {
  if (!isDevMode || !isMockEnabled(search)) {
    return;
  }

  const { worker } = await loadWorker();
  await worker.start({
    onUnhandledRequest: 'bypass',
  });
}

export function isReleaseVerificationRequiredByDefault(
  isProd: boolean = import.meta.env.PROD,
  releaseVerificationFlag: string | undefined = import.meta.env.VITE_RELEASE_VERIFICATION_REQUIRED
): boolean {
  return isProd && releaseVerificationFlag === 'true';
}

export async function bootstrapApp(options: BootstrapAppOptions): Promise<void> {
  const initialize = options.initializeMockingFn ?? initializeMocking;
  await initialize(options.search);

  const shouldVerify =
    options.isReleaseVerificationRequired ?? isReleaseVerificationRequiredByDefault();
  if (!shouldVerify) {
    await options.loadApp();
    return;
  }

  const usingDefaultGate = options.renderVerificationGate === undefined;
  const renderVerificationGate = options.renderVerificationGate ?? defaultRenderVerificationGate;
  const applyVerifiedReleaseSnapshot =
    options.setVerifiedReleaseSnapshot ?? setVerifiedReleaseSnapshot;
  const recoverEntryMismatch = options.recoverEntryMismatchFn ?? recoverEntryMismatchOnce;
  const verifyReleaseImpl =
    options.verifyReleaseFn ??
    (async () => {
      const { result } = await tieredVerifyRelease({
        baseUrl: window.location.href,
        currentEntryUrl: options.currentEntryUrl ?? import.meta.url,
        publicKeyPem: MANIFEST_SIGNING_PUBLIC_KEY_PEM,
      });
      return result;
    });

  renderVerificationGate({ status: 'verifying' });
  const verificationResult = await verifyReleaseImpl();
  if (verificationResult.status === 'verified') {
    clearEntryRecoveryAttempt();
    applyVerifiedReleaseSnapshot(verificationResult);
    if (usingDefaultGate) {
      clearBootstrapBodyStyles();
    }
    await options.loadApp();
    return;
  }

  applyVerifiedReleaseSnapshot(null);
  if (verificationResult.reason === 'entry_asset_mismatch' && recoverEntryMismatch()) {
    return;
  }
  renderVerificationGate(verificationResult);
}
