import type { Page } from '@playwright/test';

export async function disableWebSocket(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class DisabledWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      constructor() {
        throw new Error('WebSocket disabled for mocked E2E transport');
      }
    }

    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: DisabledWebSocket,
      writable: true,
    });
  });
}
