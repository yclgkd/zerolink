import { MANIFEST_SIGNING_PUBLIC_KEY_PEM } from './release/public-key';
import { setVerifiedReleaseSnapshot } from './release/runtime';
import {
  type ReleaseVerificationFailure,
  type ReleaseVerificationResult,
  type ReleaseVerificationUnavailable,
  verifyRelease,
} from './release/verification';

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
  initializeMockingFn?: (search: string) => Promise<void>;
  isReleaseVerificationRequired?: boolean;
  renderVerificationGate?: (state: ReleaseVerificationGateState) => void;
  setVerifiedReleaseSnapshot?: typeof setVerifiedReleaseSnapshot;
  verifyReleaseFn?: () => Promise<ReleaseVerificationResult>;
}

export type ReleaseVerificationGateState =
  | { status: 'verifying' }
  | ReleaseVerificationFailure
  | ReleaseVerificationUnavailable;

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

  const renderVerificationGate = options.renderVerificationGate ?? defaultRenderVerificationGate;
  const applyVerifiedReleaseSnapshot =
    options.setVerifiedReleaseSnapshot ?? setVerifiedReleaseSnapshot;
  const verifyReleaseImpl =
    options.verifyReleaseFn ??
    (() =>
      verifyRelease({
        baseUrl: window.location.href,
        publicKeyPem: MANIFEST_SIGNING_PUBLIC_KEY_PEM,
      }));

  renderVerificationGate({ status: 'verifying' });
  const verificationResult = await verifyReleaseImpl();
  if (verificationResult.status === 'verified') {
    applyVerifiedReleaseSnapshot(verificationResult);
    await options.loadApp();
    return;
  }

  applyVerifiedReleaseSnapshot(null);
  renderVerificationGate(verificationResult);
}

function defaultRenderVerificationGate(state: ReleaseVerificationGateState): void {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Root element not found');
  }

  const title =
    state.status === 'verifying'
      ? 'Verifying ZeroLink release'
      : state.status === 'failed'
        ? 'Release Verification Failed'
        : 'Verification Unavailable';
  const body =
    state.status === 'verifying'
      ? 'Checking the signed release manifest and build assets before loading ZeroLink.'
      : state.detail;
  const dangerNote =
    state.status === 'verifying'
      ? 'Please wait before entering any sensitive content.'
      : 'Do not enter passwords, API keys, or private messages on this page.';

  root.innerHTML = `
    <section
      data-testid="release-verification-gate"
      style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;background:#07070c;color:#f8fafc;font-family:Segoe UI,sans-serif;"
    >
      <div style="max-width:640px;width:100%;border:1px solid rgba(6,182,212,0.25);background:rgba(20,20,30,0.72);backdrop-filter:blur(18px);border-radius:20px;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.45);">
        <p style="margin:0 0 12px 0;color:${state.status === 'failed' ? '#f97316' : '#06b6d4'};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">${
          state.status === 'verifying' ? 'Verified Release' : 'Release Guard'
        }</p>
        <h1 style="margin:0 0 12px 0;font-size:32px;line-height:1.2;">${title}</h1>
        <p style="margin:0 0 14px 0;color:#cbd5e1;font-size:15px;line-height:1.6;">${body}</p>
        <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.6;">${dangerNote}</p>
      </div>
    </section>
  `;
}
