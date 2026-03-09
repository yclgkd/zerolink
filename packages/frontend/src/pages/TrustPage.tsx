import type { ReactElement } from 'react';

import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
} from '../components/layout';

const TRUST_SECTIONS = [
  {
    title: 'What the server cannot see',
    body: 'The server never receives the URL fragment (#k=...), the receiver passphrase, the receiver private key, or decrypted plaintext. It only stores ciphertext and channel lifecycle state.',
    accentClass: 'text-neon-cyan',
  },
  {
    title: 'What the sender can and cannot do',
    body: 'The sender can create a channel, share the receiver link, deliver ciphertext, and delete the channel. The sender cannot read the receiver passphrase, inspect the receiver private key, or see decrypted plaintext on the receiver device.',
    accentClass: 'text-neon-magenta',
  },
  {
    title: 'What is stored on the receiver device',
    body: 'The receiver device keeps a wrapped receiver private key and receiver fingerprint in IndexedDB for that channel. Plaintext appears only on the local device after decrypt, and the Safety Code is generated and shown locally from receiver key material that cannot be recovered from server state.',
    accentClass: 'text-neon-green',
  },
  {
    title: 'When data becomes unavailable',
    body: 'Channel data becomes unavailable 1 hour after creation. Sender delete and TTL expiry both make later visits unavailable. Local burn removes plaintext only on this device and does not delete or expire the channel.',
    accentClass: 'text-neon-orange',
  },
] as const;

export function TrustPage(): ReactElement {
  return (
    <PageCard data-testid="page-trust" tone="cyan">
      <PageCardHeader className="gap-2">
        <p className="text-xs uppercase tracking-[0.35em] text-neon-cyan/80">Trust Model</p>
        <PageCardTitle asChild className="text-primary">
          <h2>What ZeroLink Can and Cannot Know</h2>
        </PageCardTitle>
        <PageCardDescription>
          A compact summary of what stays on your device, what the sender can control, and when a
          channel disappears.
        </PageCardDescription>
      </PageCardHeader>
      <PageCardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {TRUST_SECTIONS.map((section, index) => (
            <article
              className="rounded-2xl border border-border/60 bg-card/60 p-5 shadow-[0_18px_48px_rgb(0_0_0_/_0.2)]"
              key={section.title}
            >
              <p className={`text-xs uppercase tracking-[0.3em] ${section.accentClass}`}>
                {`0${index + 1}`}
              </p>
              <h3 className="mt-3 text-lg font-semibold text-foreground">{section.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{section.body}</p>
            </article>
          ))}
        </div>
      </PageCardContent>
    </PageCard>
  );
}
