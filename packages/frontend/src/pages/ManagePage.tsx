import { CHANNEL_STATE, type ChannelState, type HexString, ROUTE_PATTERN } from '@zerolink/shared';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  RoleBadge,
  StatusBadge,
} from '../components/layout';
import { SafetyCode } from '../components/safety/safety-code';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

const statusOrder: ChannelState[] = [
  CHANNEL_STATE.WAITING,
  CHANNEL_STATE.LOCKED,
  CHANNEL_STATE.DELIVERED,
  CHANNEL_STATE.DELETED,
  CHANNEL_STATE.EXPIRED,
];

const statusSwitcherLabelMap: Record<ChannelState, string> = {
  [CHANNEL_STATE.WAITING]: 'Waiting',
  [CHANNEL_STATE.LOCKED]: 'Locked',
  [CHANNEL_STATE.DELIVERED]: 'Delivered',
  [CHANNEL_STATE.DELETED]: 'Deleted',
  [CHANNEL_STATE.EXPIRED]: 'Expired',
};

const mockSafetyCodeDisplay = {
  emoji: {
    type: 'emoji',
    emojis: ['🔥', '🌲', '🚀', '🔮', '💎', '🎯', '⚡', '🌙'],
  },
  color: {
    type: 'color',
    cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
  shortFpr: 'a1b2c3d4e5f6...f1e2d3c4b5a6',
  fullFpr: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00' as HexString,
} as const;

function ManagePageHeader({ status }: { status: ChannelState }) {
  return (
    <PageCardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <PageCardTitle asChild className="text-primary">
            <h2>Manage / Deliver</h2>
          </PageCardTitle>
          <StatusBadge status={status} />
        </div>
        <RoleBadge party="sender" />
      </div>
      <PageCardDescription>
        Sender-side verification and delivery controls (UI-only flow).
      </PageCardDescription>
    </PageCardHeader>
  );
}

function UuidDisplay({ uuid }: { uuid?: string | undefined }) {
  return (
    <p>
      UUID:{' '}
      <code
        className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono text-foreground"
        data-testid="manage-uuid"
      >
        {uuid ?? '(missing uuid)'}
      </code>
    </p>
  );
}

function ShareLinkCard({
  shareLink,
  copied,
  onCopy,
}: {
  shareLink: string;
  copied: boolean;
  onCopy: () => Promise<void>;
}) {
  return (
    <section
      className="space-y-3 rounded-xl border border-border/60 bg-card/50 p-4"
      data-testid="manage-share-link-card"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Share Link</h3>
        <p className="text-xs text-muted-foreground">
          Send this receiver link through a trusted channel.
        </p>
      </div>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <code
          className="block flex-1 break-all rounded bg-muted px-2 py-2 text-xs text-neon-cyan"
          data-testid="manage-share-link-value"
        >
          {shareLink}
        </code>
        <Button
          data-testid="manage-copy-button"
          onClick={() => void onCopy()}
          size="sm"
          type="button"
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </section>
  );
}

function StatePreviewSwitcher({
  currentStatus,
  onSelectStatus,
}: {
  currentStatus: ChannelState;
  onSelectStatus: (status: ChannelState) => void;
}) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        State Preview
      </p>
      <div className="flex flex-wrap gap-2">
        {statusOrder.map((status) => (
          <button
            aria-pressed={currentStatus === status}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs transition-colors',
              currentStatus === status
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'border-border/70 bg-card/60 text-muted-foreground hover:text-foreground'
            )}
            data-testid={`manage-status-switch-${status}`}
            key={status}
            onClick={() => onSelectStatus(status)}
            type="button"
          >
            {statusSwitcherLabelMap[status]}
          </button>
        ))}
      </div>
    </section>
  );
}

function StatusContent({ status }: { status: ChannelState }) {
  if (status === CHANNEL_STATE.WAITING) {
    return (
      <section className="space-y-2" data-testid="manage-state-waiting">
        <h3 className="text-base font-semibold text-foreground">Waiting for Receiver Lock</h3>
        <p className="text-xs text-muted-foreground">
          Receiver has not locked the channel yet. Share the link and wait for confirmation.
        </p>
      </section>
    );
  }

  if (status === CHANNEL_STATE.LOCKED) {
    return (
      <section className="space-y-4" data-testid="manage-state-locked">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">Receiver Locked the Channel</h3>
          <p className="text-xs text-muted-foreground">
            Verify the Safety Code out-of-band before delivering the secret.
          </p>
        </div>
        <SafetyCode display={mockSafetyCodeDisplay} />
      </section>
    );
  }

  if (status === CHANNEL_STATE.DELIVERED) {
    return (
      <section className="space-y-2" data-testid="manage-state-delivered">
        <h3 className="text-base font-semibold text-foreground">Delivery Completed</h3>
        <p className="text-xs text-muted-foreground">
          Ciphertext has been delivered to the receiver flow. Await receiver-side decrypt.
        </p>
      </section>
    );
  }

  if (status === CHANNEL_STATE.DELETED) {
    return (
      <section className="space-y-2" data-testid="manage-state-deleted">
        <h3 className="text-base font-semibold text-foreground">Channel Deleted</h3>
        <p className="text-xs text-muted-foreground">
          This channel has been destroyed and cannot be recovered.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2" data-testid="manage-state-expired">
      <h3 className="text-base font-semibold text-foreground">Channel Expired</h3>
      <p className="text-xs text-muted-foreground">
        The channel exceeded its lifetime and is no longer valid for delivery.
      </p>
    </section>
  );
}

function DestroyConfirmPanel({
  onCancelDestroy,
  onConfirmDestroy,
}: {
  onCancelDestroy: () => void;
  onConfirmDestroy: () => void;
}) {
  return (
    <div
      className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
      data-testid="manage-destroy-confirm"
    >
      <p className="text-foreground">Destroy this channel permanently?</p>
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="manage-destroy-cancel"
          onClick={onCancelDestroy}
          size="sm"
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          data-testid="manage-destroy-confirm-apply"
          onClick={onConfirmDestroy}
          size="sm"
          type="button"
          variant="danger"
        >
          Confirm Destroy
        </Button>
      </div>
    </div>
  );
}

function ActionPanel({
  status,
  showDestroyConfirm,
  onDeliver,
  onOpenDestroyConfirm,
  onCancelDestroy,
  onConfirmDestroy,
}: {
  status: ChannelState;
  showDestroyConfirm: boolean;
  onDeliver: () => void;
  onOpenDestroyConfirm: () => void;
  onCancelDestroy: () => void;
  onConfirmDestroy: () => void;
}) {
  const deliverDisabled = status === CHANNEL_STATE.DELETED || status === CHANNEL_STATE.EXPIRED;
  const destroyDisabled = status === CHANNEL_STATE.DELETED || status === CHANNEL_STATE.EXPIRED;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="manage-deliver-button"
          disabled={deliverDisabled}
          onClick={onDeliver}
          type="button"
        >
          Deliver
        </Button>
        <Button
          data-testid="manage-destroy-button"
          disabled={destroyDisabled}
          onClick={onOpenDestroyConfirm}
          type="button"
          variant="danger"
        >
          Destroy
        </Button>
      </div>

      {showDestroyConfirm ? (
        <DestroyConfirmPanel
          onCancelDestroy={onCancelDestroy}
          onConfirmDestroy={onConfirmDestroy}
        />
      ) : null}
    </section>
  );
}

function useManagePageState(uuid?: string) {
  const [status, setStatus] = useState<ChannelState>(CHANNEL_STATE.WAITING);
  const [showDestroyConfirm, setShowDestroyConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareLink = useMemo(() => {
    if (!uuid) return '(missing uuid)';
    const sharePath = ROUTE_PATTERN.SHARE.replace(':uuid', uuid);
    return typeof window === 'undefined' ? sharePath : `${window.location.origin}${sharePath}`;
  }, [uuid]);

  const handleStatusSwitch = (nextStatus: ChannelState) => {
    setStatus(nextStatus);
    setShowDestroyConfirm(false);
  };

  const handleDeliver = () => {
    setStatus(CHANNEL_STATE.DELIVERED);
    setShowDestroyConfirm(false);
  };

  const handleApplyDestroy = () => {
    if (status === CHANNEL_STATE.DELETED || status === CHANNEL_STATE.EXPIRED) {
      setShowDestroyConfirm(false);
      return;
    }

    setStatus(CHANNEL_STATE.DELETED);
    setShowDestroyConfirm(false);
  };

  const handleDestroyConfirm = () => {
    if (status === CHANNEL_STATE.DELETED || status === CHANNEL_STATE.EXPIRED) {
      setShowDestroyConfirm(false);
      return;
    }

    setShowDestroyConfirm(true);
  };

  const handleCopyShareLink = async () => {
    if (!uuid) {
      setCopied(false);
      return;
    }

    try {
      const writeText =
        typeof navigator !== 'undefined'
          ? navigator.clipboard?.writeText?.bind(navigator.clipboard)
          : undefined;
      if (!writeText) {
        setCopied(false);
        return;
      }

      await writeText(shareLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return {
    status,
    showDestroyConfirm,
    copied,
    shareLink,
    handleStatusSwitch,
    handleDeliver,
    handleDestroyConfirm,
    handleCancelDestroy: () => setShowDestroyConfirm(false),
    handleApplyDestroy,
    handleCopyShareLink,
  };
}

/**
 * Sender-side manage page with local-only state flow for waiting/locked/delivered/deleted/expired.
 */
export function ManagePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();
  const state = useManagePageState(uuid);

  return (
    <PageCard data-testid="page-manage" tone="orange">
      <ManagePageHeader status={state.status} />
      <PageCardContent className="space-y-6">
        <UuidDisplay uuid={uuid} />
        <ShareLinkCard
          copied={state.copied}
          onCopy={state.handleCopyShareLink}
          shareLink={state.shareLink}
        />
        <StatePreviewSwitcher
          currentStatus={state.status}
          onSelectStatus={state.handleStatusSwitch}
        />
        <StatusContent status={state.status} />
        <ActionPanel
          onCancelDestroy={state.handleCancelDestroy}
          onConfirmDestroy={state.handleApplyDestroy}
          onDeliver={state.handleDeliver}
          onOpenDestroyConfirm={state.handleDestroyConfirm}
          showDestroyConfirm={state.showDestroyConfirm}
          status={state.status}
        />
      </PageCardContent>
    </PageCard>
  );
}
