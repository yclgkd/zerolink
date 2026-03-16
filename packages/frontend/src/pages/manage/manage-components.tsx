import { CHANNEL_STATE, type ChannelState } from '@zerolink/shared';
import { PlusCircle, Send, Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  RoleBadge,
  StateNotice,
  StatusBadge,
} from '../../components/layout';
import { SafetyCode } from '../../components/safety/safety-code';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import type { deriveSafetyCodeDisplay } from '../../crypto/safety-code-derive';
import { isTerminalManageState } from './manage-utils';

export function ManagePageHeader({
  status,
  unavailable,
}: {
  status: ChannelState;
  unavailable: boolean;
}) {
  return (
    <PageCardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <PageCardTitle asChild className="text-primary">
            <h2>Manage / Deliver</h2>
          </PageCardTitle>
          {unavailable ? null : <StatusBadge status={status} />}
        </div>
        <RoleBadge party="sender" />
      </div>
      <PageCardDescription>
        Sender-side verification and delivery controls (integrated flow).
      </PageCardDescription>
    </PageCardHeader>
  );
}

export function UuidDisplay({ uuid }: { uuid?: string | undefined }) {
  return (
    <p className="text-xs text-muted-foreground">
      Channel ID:{' '}
      <code
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground"
        data-testid="manage-uuid"
      >
        {uuid ?? '(missing)'}
      </code>
    </p>
  );
}

export function StatusContent({
  status,
  safetyCode,
}: {
  status: ChannelState;
  safetyCode: ReturnType<typeof deriveSafetyCodeDisplay> | null;
}) {
  if (status === CHANNEL_STATE.WAITING) {
    return (
      <section className="space-y-2" data-testid="manage-state-waiting">
        <h3 className="text-base font-semibold text-foreground">Waiting for Receiver Lock</h3>
        <p className="text-xs text-muted-foreground">
          Receiver has not locked the channel yet. Share the link and this page will update
          automatically once they do.
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

        {safetyCode ? (
          <SafetyCode display={safetyCode} />
        ) : (
          <StateNotice
            data-testid="manage-safety-unavailable"
            title="Safety Code unavailable right now."
            tone="warning"
          >
            <p className="mt-1 text-xs text-neon-orange">
              Receiver fingerprint is missing from the current channel state, so the Safety Code
              cannot be shown.
            </p>
          </StateNotice>
        )}
      </section>
    );
  }

  if (status === CHANNEL_STATE.DELIVERED) {
    return (
      <section className="space-y-4" data-testid="manage-state-delivered">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">Delivery Completed</h3>
          <p className="text-xs text-muted-foreground">
            Ciphertext has been delivered to the receiver flow. Receiver-side decrypt happens
            locally and does not send confirmation back here.
          </p>
        </div>

        {safetyCode ? (
          <SafetyCode display={safetyCode} />
        ) : (
          <StateNotice
            data-testid="manage-safety-unavailable"
            title="Safety Code unavailable right now."
            tone="warning"
          >
            <p className="mt-1 text-xs text-neon-orange">
              Receiver fingerprint is missing from the current channel state, so the Safety Code
              cannot be shown.
            </p>
          </StateNotice>
        )}
      </section>
    );
  }

  if (status === CHANNEL_STATE.DELETED) {
    return (
      <section className="space-y-2" data-testid="manage-state-deleted">
        <h3 className="text-base font-semibold text-foreground">Channel Deleted</h3>
        <p className="text-xs text-muted-foreground">
          You deleted this channel. It can no longer deliver or decrypt content.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2" data-testid="manage-state-expired">
      <h3 className="text-base font-semibold text-foreground">Channel Expired</h3>
      <p className="text-xs text-muted-foreground">
        This channel expired. It can no longer be used for delivery or decryption.
      </p>
    </section>
  );
}

export function SecretInput({
  value,
  onChange,
  disabled,
  ariaInvalid,
  ariaDescribedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  ariaInvalid?: boolean | undefined;
  ariaDescribedBy?: string | undefined;
}) {
  return (
    <section className="space-y-2">
      <label
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        htmlFor="manage-secret-input"
      >
        Secret Payload
      </label>
      <textarea
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        className="min-h-24 w-full rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="manage-secret-input"
        disabled={disabled}
        id="manage-secret-input"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Enter plaintext secret to encrypt and deliver"
        value={value}
      />
    </section>
  );
}

export function DestroyConfirmPanel({
  pending,
  onCancelDestroy,
  onConfirmDestroy,
}: {
  pending: boolean;
  onCancelDestroy: () => void;
  onConfirmDestroy: () => void;
}) {
  return (
    <div
      className="space-y-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm ring-1 ring-destructive/20"
      data-testid="manage-destroy-confirm"
    >
      <div className="space-y-1">
        <p className="font-semibold text-destructive">Permanently delete this channel?</p>
        <p className="text-xs text-muted-foreground">
          This cannot be undone. All channel data will be removed from the server.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="manage-destroy-cancel"
          disabled={pending}
          onClick={onCancelDestroy}
          size="sm"
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          data-testid="manage-destroy-confirm-apply"
          disabled={pending}
          onClick={onConfirmDestroy}
          size="sm"
          type="button"
          variant="danger"
        >
          {pending ? (
            <>
              <Spinner aria-hidden="true" className="size-3.5" />
              Deleting…
            </>
          ) : (
            <>
              <Trash2 aria-hidden="true" className="size-3.5" />
              Confirm Delete
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export function TerminalActions(): ReactElement {
  const navigate = useNavigate();

  return (
    <section data-testid="manage-terminal-actions">
      <Button
        data-testid="manage-create-new-button"
        onClick={() => void navigate('/')}
        type="button"
        variant="secondary"
      >
        <PlusCircle aria-hidden="true" className="size-4" />
        Create New Channel
      </Button>
    </section>
  );
}

export function ActionPanel({
  status,
  unavailable,
  showDestroyConfirm,
  pending,
  showDeliverAction,
  canManageActions,
  canDeliver,
  onDeliver,
  onOpenDestroyConfirm,
  onCancelDestroy,
  onConfirmDestroy,
}: {
  status: ChannelState;
  unavailable: boolean;
  showDestroyConfirm: boolean;
  pending: boolean;
  showDeliverAction: boolean;
  canManageActions: boolean;
  canDeliver: boolean;
  onDeliver: () => void;
  onOpenDestroyConfirm: () => void;
  onCancelDestroy: () => void;
  onConfirmDestroy: () => void;
}) {
  if (isTerminalManageState(status, unavailable)) {
    return <TerminalActions />;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {showDeliverAction ? (
          <Button
            data-testid="manage-deliver-button"
            disabled={pending || !canDeliver}
            onClick={onDeliver}
            type="button"
          >
            {pending ? (
              <>
                <Spinner aria-hidden="true" className="size-4" />
                Delivering…
              </>
            ) : (
              <>
                <Send aria-hidden="true" className="size-4" />
                Deliver
              </>
            )}
          </Button>
        ) : null}
        <Button
          data-testid="manage-destroy-button"
          disabled={pending || !canManageActions}
          onClick={onOpenDestroyConfirm}
          type="button"
          variant="danger"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Delete Channel
        </Button>
      </div>

      {showDestroyConfirm ? (
        <DestroyConfirmPanel
          onCancelDestroy={onCancelDestroy}
          onConfirmDestroy={onConfirmDestroy}
          pending={pending}
        />
      ) : null}
    </section>
  );
}
