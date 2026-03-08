import { bootstrapApp } from './bootstrap';

void bootstrapApp({
  loadApp: async () => {
    const { renderApp } = await import('./main');
    renderApp();
  },
  search: window.location.search,
}).catch(() => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <section
        data-testid="release-verification-gate"
        style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;background:#07070c;color:#f8fafc;font-family:Segoe UI,sans-serif;"
      >
        <div style="max-width:640px;width:100%;border:1px solid rgba(249,115,22,0.35);background:rgba(20,20,30,0.72);backdrop-filter:blur(18px);border-radius:20px;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.45);">
          <p style="margin:0 0 12px 0;color:#f97316;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Release Guard</p>
          <h1 style="margin:0 0 12px 0;font-size:32px;line-height:1.2;">Verification Unavailable</h1>
          <p style="margin:0 0 14px 0;color:#cbd5e1;font-size:15px;line-height:1.6;">ZeroLink could not complete release verification before startup.</p>
          <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.6;">Do not enter passwords, API keys, or private messages on this page.</p>
        </div>
      </section>
    `;
  }
});
