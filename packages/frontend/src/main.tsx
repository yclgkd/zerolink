import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { bootstrapApp } from './bootstrap';
import './styles/theme.css';
import './styles/base.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element not found');
}

const root = createRoot(rootEl);

function renderApp(): void {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrapApp({
  search: window.location.search,
  render: renderApp,
}).catch(() => {
  renderApp();
});
