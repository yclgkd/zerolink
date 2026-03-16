// @vitest-environment jsdom

import './helpers/i18n-test-setup';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ManifestInfo } from '../components/manifest-info';
import type { VerifiedReleaseSnapshot } from '../release/verification';

function setVerifiedReleaseSnapshot(value: VerifiedReleaseSnapshot | null): void {
  if (value === null) {
    delete (window as Window & { __ZEROLINK_RELEASE_VERIFICATION__?: unknown })
      .__ZEROLINK_RELEASE_VERIFICATION__;
    return;
  }

  (
    window as Window & { __ZEROLINK_RELEASE_VERIFICATION__?: unknown }
  ).__ZEROLINK_RELEASE_VERIFICATION__ = value;
}

beforeEach(() => {
  cleanup();
  setVerifiedReleaseSnapshot(null);
});

afterEach(() => {
  cleanup();
  setVerifiedReleaseSnapshot(null);
});

describe('ManifestInfo', () => {
  it('renders nothing when no verified release snapshot is present', () => {
    render(<ManifestInfo />);

    expect(screen.queryByTestId('manifest-info-card')).toBeNull();
    expect(screen.queryByText('Verified Release')).toBeNull();
  });

  it('renders the verified release card from the bootstrap snapshot', () => {
    setVerifiedReleaseSnapshot({
      buildTime: '2026-03-08T12:34:56.000Z',
      commitHash: 'abc1234',
      manifestHash: 'f'.repeat(64),
      publicKeyFingerprint: 'a'.repeat(64),
      signature: 'signed-release',
      status: 'verified',
      verifiedFileCount: 4,
      version: '1.2.3',
    });

    render(<ManifestInfo />);

    expect(screen.getByTestId('manifest-info-card')).toBeTruthy();
    expect(screen.getByText('Verified Release')).toBeTruthy();
    expect(
      screen.getByText('This page matches an official ZeroLink release signed by our team.')
    ).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
  });

  it('toggles verification details and shows release metadata', () => {
    setVerifiedReleaseSnapshot({
      buildTime: '2026-03-08T12:34:56.000Z',
      commitHash: 'abc1234',
      manifestHash: 'f'.repeat(64),
      publicKeyFingerprint: 'a'.repeat(64),
      signature: 'signed-release',
      status: 'verified',
      verifiedFileCount: 4,
      version: '1.2.3',
    });

    render(<ManifestInfo />);

    expect(screen.queryByText('App version')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View verification details' }));

    expect(screen.getByText('App version')).toBeTruthy();
    expect(screen.getByText('1.2.3')).toBeTruthy();
    expect(screen.getByText('Commit')).toBeTruthy();
    expect(screen.getByText('abc1234')).toBeTruthy();
    expect(screen.getByText('Manifest hash')).toBeTruthy();
    expect(screen.getByText('Publisher key fingerprint')).toBeTruthy();
    expect(screen.getByText('Verified files')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('Signature')).toBeTruthy();
    expect(screen.getByText('signed-release')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide verification details' }));
    expect(screen.queryByText('App version')).toBeNull();
  });
});
