export interface MockWorker {
  start: (options?: Record<string, unknown>) => Promise<unknown>;
}

export interface MockWorkerModule {
  worker: MockWorker;
}

export type MockWorkerLoader = () => Promise<MockWorkerModule>;

export interface BootstrapAppOptions {
  search: string;
  render: () => void;
  initializeMockingFn?: (search: string) => Promise<void>;
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

export async function bootstrapApp(options: BootstrapAppOptions): Promise<void> {
  const initialize = options.initializeMockingFn ?? initializeMocking;
  await initialize(options.search);
  options.render();
}
