// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { bootstrapAppMock } = vi.hoisted(() => ({
  bootstrapAppMock: vi.fn(),
}));

vi.mock('../bootstrap', () => ({
  bootstrapApp: bootstrapAppMock,
}));

function resetRootElement(): void {
  const existing = document.getElementById('root');
  if (existing) {
    existing.remove();
  }
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
}

function clearBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

describe('bootstrap-entry', () => {
  beforeEach(() => {
    vi.resetModules();
    bootstrapAppMock.mockReset();
    resetRootElement();
    document.body.style.cssText = '';
  });

  afterEach(() => {
    clearBody();
    document.body.style.cssText = '';
  });

  it('renders the blocking release guard when bootstrap startup fails', async () => {
    bootstrapAppMock.mockRejectedValue(new Error('startup failed'));

    await import('../bootstrap-entry');

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="release-verification-gate"]')).toBeTruthy();
    });

    expect(document.body.textContent).toContain('Release Guard');
    expect(document.body.textContent).toContain('Verification Unavailable');
    expect(document.body.textContent).toContain(
      'ZeroLink could not complete release verification before startup.'
    );
    expect(document.body.textContent).toContain(
      'Do not enter passwords, API keys, or private messages on this page.'
    );
  });
});
