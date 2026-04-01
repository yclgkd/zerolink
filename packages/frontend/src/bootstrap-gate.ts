import type {
  ReleaseVerificationFailure,
  ReleaseVerificationUnavailable,
} from './release/verification';

export type ReleaseVerificationGateState =
  | { status: 'verifying' }
  | ReleaseVerificationFailure
  | ReleaseVerificationUnavailable;

export function clearBootstrapBodyStyles(): void {
  const props = [
    'margin',
    'padding',
    'backgroundColor',
    'backgroundImage',
    'backgroundSize',
    'backgroundAttachment',
    'fontFamily',
  ] as const;

  for (const prop of props) {
    document.body.style[prop] = '';
  }
}

export function defaultRenderVerificationGate(state: ReleaseVerificationGateState): void {
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
  const accentColor = state.status === 'failed' ? '#f97316' : '#7dd3fc';
  const badgeText = state.status === 'verifying' ? 'Verified Release' : 'Release Guard';

  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.backgroundColor = '#08111f';
  document.body.style.backgroundImage = [
    'radial-gradient(circle at top, rgba(125,211,252,0.13) 0%, transparent 40%)',
    'radial-gradient(circle at 78% 18%, rgba(148,163,184,0.08) 0%, transparent 28%)',
    'linear-gradient(180deg, rgba(8,17,31,0.96) 0%, rgba(7,13,24,1) 100%)',
  ].join(',');
  document.body.style.backgroundSize = 'auto';
  document.body.style.backgroundAttachment = 'fixed';
  document.body.style.fontFamily = 'system-ui, -apple-system, sans-serif';

  const section = document.createElement('section');
  section.setAttribute('data-testid', 'release-verification-gate');
  section.setAttribute(
    'style',
    'position:fixed;inset:0;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:32px;color:#e8eef8;'
  );

  const card = document.createElement('div');
  card.setAttribute(
    'style',
    'max-width:640px;width:100%;border:1px solid rgba(125,211,252,0.16);background:rgba(8,18,32,0.72);backdrop-filter:blur(18px);border-radius:1rem;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.45);'
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
  bodyEl.setAttribute('style', 'margin:0 0 14px 0;color:#99a9bf;font-size:14px;line-height:1.6;');
  bodyEl.textContent = body;

  const noteEl = document.createElement('p');
  noteEl.setAttribute(
    'style',
    'margin:0;padding:12px 14px;background:rgba(56,189,248,0.08);border:1px solid rgba(125,211,252,0.16);border-radius:0.75rem;color:#99a9bf;font-size:13px;line-height:1.6;'
  );
  noteEl.textContent = dangerNote;

  card.append(badge, heading, bodyEl, noteEl);
  section.append(card);
  root.replaceChildren(section);
}
