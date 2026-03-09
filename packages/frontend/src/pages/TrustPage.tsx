import type { ReactElement } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardFooter,
  PageCardHeader,
  PageCardTitle,
} from '../components/layout';
import { Button } from '../components/ui/button';

const TRUST_SECTIONS = [
  {
    title: 'What the server never gets',
    body: 'The server never receives the URL fragment (#k=...), the receiver passphrase, the receiver private key, or decrypted plaintext. Those stay outside the server-side request path.',
    accentClass: 'text-neon-cyan',
  },
  {
    title: 'What the server stores while a channel is active',
    body: 'While the channel is active, the server stores ciphertext plus protocol metadata such as lifecycle state, expiry, admin authentication material, lock verification material, receiver public key and fingerprint, and the version counter needed for safe updates.',
    accentClass: 'text-neon-magenta',
  },
  {
    title: 'What the sender can control',
    body: 'The sender can create a channel, share the receiver link, deliver ciphertext, and delete the channel. The sender cannot read the receiver passphrase, inspect the receiver private key, or see decrypted plaintext on the receiver device.',
    accentClass: 'text-neon-green',
  },
  {
    title: 'What stays on the sender device',
    body: 'Quick Share keeps a wrapped admin key on the sender device so the same device can later deliver or delete the channel. If you switch devices without that local material, you cannot keep managing the existing channel from the new device.',
    accentClass: 'text-neon-orange',
  },
  {
    title: 'What stays on the receiver device',
    body: 'The receiver device keeps a wrapped receiver private key and receiver fingerprint in IndexedDB for that channel. Plaintext appears only on the local device after decrypt, and the Safety Code is generated locally from receiver key material.',
    accentClass: 'text-neon-cyan',
  },
  {
    title: 'What delete, expiry, local burn, and Verified Release mean',
    body: 'ZeroLink channels expire 1 hour after creation. Sender delete removes server-side ciphertext and active channel records, then keeps only a minimal tombstone so the channel cannot be revived. TTL expiry makes the channel unavailable through the same purge path. Local burn removes plaintext only on the current device. Verified Release means this frontend build passed signed release verification, not that the browser becomes an absolute trust anchor.',
    accentClass: 'text-neon-orange',
  },
] as const;

function canNavigateBack(locationKey: string): boolean {
  if (locationKey !== 'default') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  const state = window.history.state as { idx?: number } | null;
  if (typeof state?.idx === 'number') {
    return state.idx > 0;
  }

  return window.history.length > 1;
}

export function TrustPage(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();

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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
      <PageCardFooter className="flex flex-wrap gap-3">
        <Button
          data-testid="trust-back-button"
          onClick={() => {
            if (canNavigateBack(location.key)) {
              navigate(-1);
              return;
            }

            navigate('/');
          }}
          type="button"
          variant="secondary"
        >
          Back
        </Button>
        <Button asChild data-testid="trust-create-button">
          <Link to="/">Create Secure Channel</Link>
        </Button>
      </PageCardFooter>
    </PageCard>
  );
}
