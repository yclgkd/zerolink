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
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.backgroundColor = '#06060b';
    document.body.style.backgroundImage = [
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E\")",
      'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(139,92,246,0.22) 0%, transparent 60%)',
      'linear-gradient(rgba(139,92,246,0.055) 1px, transparent 1px)',
      'linear-gradient(90deg, rgba(139,92,246,0.055) 1px, transparent 1px)',
    ].join(',');
    document.body.style.backgroundSize = '200px 200px, auto, 40px 40px, 40px 40px';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    root.innerHTML = `
      <section
        data-testid="release-verification-gate"
        style="position:fixed;inset:0;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:32px;color:#f8fafc;"
      >
        <div style="max-width:640px;width:100%;border:1px solid rgba(249,115,22,0.35);background:rgba(20,20,30,0.72);backdrop-filter:blur(18px);border-radius:1rem;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.45);">
          <p style="margin:0 0 8px 0;color:#f97316;font-size:12px;font-weight:700;letter-spacing:0.35em;text-transform:uppercase;">Release Guard</p>
          <h1 style="margin:0 0 12px 0;font-size:28px;font-weight:500;line-height:1.5;">Verification Unavailable</h1>
          <p style="margin:0 0 14px 0;color:#94a3b8;font-size:14px;line-height:1.6;">ZeroLink could not complete release verification before startup.</p>
          <p style="margin:0;padding:12px 14px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:0.75rem;color:#94a3b8;font-size:13px;line-height:1.6;">Do not enter passwords, API keys, or private messages on this page.</p>
        </div>
      </section>
    `;
  }
});
