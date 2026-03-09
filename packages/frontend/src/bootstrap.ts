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
  const accentColor = state.status === 'failed' ? '#f97316' : '#06b6d4';
  const badgeText = state.status === 'verifying' ? 'Verified Release' : 'Release Guard';

  // Reset body defaults and apply site background before CSS loads (bootstrap runs before main.ts)
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.backgroundColor = '#06060b';
  document.body.style.backgroundImage = [
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E\")",
    'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(139,92,246,0.22) 0%, transparent 60%)',
    'linear-gradient(rgba(139,92,246,0.055) 1px, transparent 1px)',
    'linear-gradient(90deg, rgba(139,92,246,0.055) 1px, transparent 1px)',
  ].join(',');
  document.body.style.backgroundSize = '200px 200px, auto, 40px 40px, 40px 40px';
  document.body.style.backgroundAttachment = 'fixed';
  document.body.style.fontFamily =
    '"Sora", "Space Grotesk", "IBM Plex Sans", "Segoe UI", sans-serif';

  const section = document.createElement('section');
  section.setAttribute('data-testid', 'release-verification-gate');
  section.setAttribute(
    'style',
    'position:fixed;inset:0;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:32px;color:#f8fafc;'
  );

  const card = document.createElement('div');
  card.setAttribute(
    'style',
    'max-width:640px;width:100%;border:1px solid rgba(6,182,212,0.25);background:rgba(20,20,30,0.72);backdrop-filter:blur(18px);border-radius:1rem;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.45);'
  );

  const badge = document.createElement('p');
  badge.setAttribute(
    'style',
    `margin:0 0 8px 0;color:${accentColor};font-size:12px;font-weight:700;letter-spacing:0.35em;text-transform:uppercase;`
  );
  badge.textContent = badgeText;

  const heading = document.createElement('h1');
  heading.setAttribute(
    'style',
    'margin:0 0 12px 0;font-size:28px;font-weight:500;line-height:1.5;'
  );
  heading.textContent = title;

  const bodyEl = document.createElement('p');
  bodyEl.setAttribute('style', 'margin:0 0 14px 0;color:#94a3b8;font-size:14px;line-height:1.6;');
  bodyEl.textContent = body;

  const noteEl = document.createElement('p');
  noteEl.setAttribute(
    'style',
    `margin:0;padding:12px 14px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:0.75rem;color:#94a3b8;font-size:13px;line-height:1.6;`
  );
  noteEl.textContent = dangerNote;

  card.append(badge, heading, bodyEl, noteEl);
  section.append(card);
  root.replaceChildren(section);
}
