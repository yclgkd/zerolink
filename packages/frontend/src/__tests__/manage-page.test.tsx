// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagePage } from '../pages/ManagePage';

const originalFetch = globalThis.fetch;

function renderManagePage(routePath = '/m/:uuid', initialPath = '/m/demo-channel-shell') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ManagePage />} path={routePath} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();

  if (originalFetch) {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  } else {
    Reflect.deleteProperty(globalThis, 'fetch');
  }
});

describe('ManagePage', () => {
  it('renders waiting state by default', () => {
    renderManagePage();

    expect(screen.getByTestId('page-manage')).toBeTruthy();
    expect(screen.getByTestId('manage-state-waiting')).toBeTruthy();
    expect(screen.getByText('Waiting for Receiver Lock')).toBeTruthy();
  });

  it('shows sender role badge and uuid value', () => {
    renderManagePage();

    expect(screen.getByText('Sender')).toBeTruthy();
    expect(screen.getByTestId('manage-uuid').textContent).toContain('demo-channel-shell');
  });

  it('falls back to missing uuid label when uuid param is absent', () => {
    renderManagePage('/m', '/m');

    expect(screen.getByTestId('manage-uuid').textContent).toContain('(missing uuid)');
  });

  it('switches between all status previews and updates aria-pressed', () => {
    renderManagePage();

    const waiting = screen.getByTestId('manage-status-switch-waiting');
    const locked = screen.getByTestId('manage-status-switch-locked');
    const delivered = screen.getByTestId('manage-status-switch-delivered');
    const deleted = screen.getByTestId('manage-status-switch-deleted');
    const expired = screen.getByTestId('manage-status-switch-expired');

    expect(waiting.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(locked);
    expect(locked.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('manage-state-locked')).toBeTruthy();

    fireEvent.click(delivered);
    expect(delivered.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('manage-state-delivered')).toBeTruthy();

    fireEvent.click(deleted);
    expect(deleted.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('manage-state-deleted')).toBeTruthy();

    fireEvent.click(expired);
    expect(expired.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('manage-state-expired')).toBeTruthy();
  });

  it('renders safety code in locked state', () => {
    renderManagePage();

    fireEvent.click(screen.getByTestId('manage-status-switch-locked'));

    expect(screen.getByTestId('manage-state-locked')).toBeTruthy();
    expect(screen.getByText('Safety Code')).toBeTruthy();
    expect(
      screen.getByText('Verify this code via another channel (phone, video call)')
    ).toBeTruthy();
  });

  it('transitions to delivered state when clicking deliver', () => {
    renderManagePage();

    fireEvent.click(screen.getByTestId('manage-deliver-button'));

    expect(screen.getByTestId('manage-state-delivered')).toBeTruthy();
    expect(screen.getByText('Delivery Completed')).toBeTruthy();
  });

  it('uses inline destroy confirm panel and respects cancel/confirm actions', () => {
    renderManagePage();

    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    expect(screen.getByTestId('manage-destroy-confirm')).toBeTruthy();

    fireEvent.click(screen.getByTestId('manage-destroy-cancel'));
    expect(screen.queryByTestId('manage-destroy-confirm')).toBeNull();
    expect(screen.getByTestId('manage-state-waiting')).toBeTruthy();

    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-confirm-apply'));

    expect(screen.getByTestId('manage-state-deleted')).toBeTruthy();
    expect(screen.queryByTestId('manage-destroy-confirm')).toBeNull();
  });

  it('does not trigger network requests during ui-only interactions', () => {
    renderManagePage();
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    fireEvent.click(screen.getByTestId('manage-status-switch-locked'));
    fireEvent.click(screen.getByTestId('manage-deliver-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-button'));
    fireEvent.click(screen.getByTestId('manage-destroy-cancel'));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
