// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { clearBootstrapBodyStyles, defaultRenderVerificationGate } from '../bootstrap-gate';

describe('clearBootstrapBodyStyles', () => {
  it('resets the temporary bootstrap body styles', () => {
    document.body.style.margin = '1px';
    document.body.style.padding = '2px';
    document.body.style.backgroundColor = 'red';
    document.body.style.backgroundImage = 'linear-gradient(red, blue)';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.fontFamily = 'serif';

    clearBootstrapBodyStyles();

    expect(document.body.style.margin).toBe('');
    expect(document.body.style.padding).toBe('');
    expect(document.body.style.backgroundColor).toBe('');
    expect(document.body.style.backgroundImage).toBe('');
    expect(document.body.style.backgroundSize).toBe('');
    expect(document.body.style.backgroundAttachment).toBe('');
    expect(document.body.style.fontFamily).toBe('');
  });
});

describe('defaultRenderVerificationGate', () => {
  it('renders the verifying gate', () => {
    document.body.innerHTML = '<div id="root"></div>';

    defaultRenderVerificationGate({ status: 'verifying' });

    expect(document.querySelector('[data-testid="release-verification-gate"]')).toBeTruthy();
    expect(document.body.textContent).toContain('Verifying ZeroLink release');
    expect(document.body.textContent).toContain(
      'Checking the signed release manifest and build assets before loading ZeroLink.'
    );
    expect(document.body.textContent).toContain(
      'Please wait before entering any sensitive content.'
    );
    expect(document.body.textContent).toContain('Verified Release');
  });

  it('renders the failed gate with the failure detail', () => {
    document.body.innerHTML = '<div id="root"></div>';

    defaultRenderVerificationGate({
      status: 'failed',
      reason: 'asset_hash_mismatch',
      detail: 'Main asset hash mismatch.',
    });

    expect(document.body.textContent).toContain('Release Verification Failed');
    expect(document.body.textContent).toContain('Main asset hash mismatch.');
    expect(document.body.textContent).toContain(
      'Do not enter passwords, API keys, or private messages on this page.'
    );
    expect(document.body.textContent).toContain('Release Guard');
  });

  it('renders the unavailable gate', () => {
    document.body.innerHTML = '<div id="root"></div>';

    defaultRenderVerificationGate({
      status: 'unavailable',
      reason: 'manifest_unavailable',
      detail: 'Signed release metadata is unavailable.',
    });

    expect(document.body.textContent).toContain('Verification Unavailable');
    expect(document.body.textContent).toContain('Signed release metadata is unavailable.');
  });

  it('throws when the root container is missing', () => {
    document.body.innerHTML = '';

    expect(() => defaultRenderVerificationGate({ status: 'verifying' })).toThrow(
      'Root element not found'
    );
  });
});
