import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <div>ZeroLink</div>
  </StrictMode>
);
