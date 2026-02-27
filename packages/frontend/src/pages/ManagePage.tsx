import {
  CHANNEL_STATE,
  type ChannelState,
  PublicStatusResponseSchema,
  ROUTE_PATTERN,
  SECURITY_PROFILE,
  type SecurityProfile,
  UUIDSchema,
} from '@zerolink/shared';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { cryptoOrchestrator } from '../crypto/orchestrator';
import { deriveSafetyCodeDisplay } from '../crypto/safety-code-derive';
import { useCreateStore } from '../stores/create-store';
import { useDeliverStore } from '../stores/deliver-store';

function mapActionError(code: string): string {
  switch (code) {
    case 'FALLBACK_REQUIRED':
      return 'Compatibility fallback is unavailable for this action in the current build.';
    case 'PROFILE_BLOCKED':
      return 'Selected security profile requires WebAuthn support.';
    case 'MISSING_LOCK_CHALLENGE':
      return 'Unable to fetch challenge from server. Please retry.';
    case 'MISSING_RECEIVER_IDENTITY':
      return 'Receiver identity is unavailable. Ask receiver to lock again.';
    case 'NETWORK_ERROR':
      return 'Network error while performing manage action. Please retry.';
    case 'BAD_REQUEST':
    case 'INVALID_REQUEST':
      return 'Manage request was rejected. Please retry.';
    case 'WEBAUTHN_ERROR':
    case 'NOT_ALLOWED':
    case 'ABORTED':
      return 'WebAuthn verification was not completed.';
    case 'INTERNAL_ERROR':
      return 'Unexpected internal error. Please retry.';
    default:
      return `Manage action failed: ${code}`;
  }
}

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
        Sender-side verification and delivery controls (integrated flow).
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

function StatusContent({
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

        {safetyCode ? (
          <SafetyCode display={safetyCode} />
        ) : (
          <div
            className="rounded-xl border border-neon-orange/40 bg-neon-orange/10 p-4 text-sm"
            data-testid="manage-safety-unavailable"
          >
            <p className="font-medium text-foreground">Safety Code unavailable on this device.</p>
            <p className="mt-1 text-xs text-neon-orange">
              Safety Code is generated locally and can only be shown when receiver fingerprint is
              available on this device.
            </p>
          </div>
        )}
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

function SecretInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
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

function DestroyConfirmPanel({
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
      className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
      data-testid="manage-destroy-confirm"
    >
      <p className="text-foreground">Destroy this channel permanently?</p>
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
          {pending ? 'Destroying...' : 'Confirm Destroy'}
        </Button>
      </div>
    </div>
  );
}

function ActionPanel({
  status,
  showDestroyConfirm,
  pending,
  canDeliver,
  onDeliver,
  onOpenDestroyConfirm,
  onCancelDestroy,
  onConfirmDestroy,
}: {
  status: ChannelState;
  showDestroyConfirm: boolean;
  pending: boolean;
  canDeliver: boolean;
  onDeliver: () => void;
  onOpenDestroyConfirm: () => void;
  onCancelDestroy: () => void;
  onConfirmDestroy: () => void;
}) {
  const terminal = status === CHANNEL_STATE.DELETED || status === CHANNEL_STATE.EXPIRED;
  const deliverDisabled = terminal || pending || !canDeliver;
  const destroyDisabled = terminal || pending;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="manage-deliver-button"
          disabled={deliverDisabled}
          onClick={onDeliver}
          type="button"
        >
          {pending ? 'Delivering...' : 'Deliver'}
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
          pending={pending}
        />
      ) : null}
    </section>
  );
}

function useResolvedProfile(): SecurityProfile {
  const createdProfile = useCreateStore((state) => state.createdProfile);
  const selectedProfile = useCreateStore((state) => state.selectedProfile);

  return createdProfile ?? selectedProfile ?? SECURITY_PROFILE.STANDARD;
}

function useManagePageState(uuid?: string) {
  const store = useDeliverStore();
  const profile = useResolvedProfile();
  const [secretInput, setSecretInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [publicStatusError, setPublicStatusError] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const mountedRef = useRef(true);
  const actionScopeRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    actionScopeRef.current += 1;
    setIsActionPending(false);

    if (!uuid) {
      store.setDeliverUuid(null);
      setSecretInput('');
      setActionError(null);
      setPublicStatusError(null);
      return;
    }

    const parsedUuid = UUIDSchema.safeParse(uuid);
    store.setDeliverUuid(parsedUuid.success ? parsedUuid.data : null);
    store.setShowDestroyConfirm(false);
    setSecretInput('');
    setActionError(null);
    setPublicStatusError(null);
  }, [uuid, store.setDeliverUuid, store.setShowDestroyConfirm]);

  const isActiveActionContext = (scope: number, actionUuid: string): boolean => {
    if (!mountedRef.current) return false;
    if (actionScopeRef.current !== scope) return false;
    return useDeliverStore.getState().uuid === actionUuid;
  };

  useEffect(() => {
    let canceled = false;

    if (!uuid) {
      store.setChannelState(CHANNEL_STATE.WAITING);
      return;
    }

    const loadPublicStatus = async () => {
      try {
        const response = await fetch(`/api/public/${uuid}`);
        if (!response.ok) throw new Error(`HTTP_${response.status}`);

        const payload = (await response.json()) as unknown;
        const parsedPayload = PublicStatusResponseSchema.safeParse(payload);
        if (!parsedPayload.success) throw new Error('INVALID_RESPONSE');

        if (canceled || !mountedRef.current) return;
        setPublicStatusError(null);
        setActionError(null);
        store.setShowDestroyConfirm(false);
        store.setChannelState(parsedPayload.data.state);
      } catch {
        if (canceled || !mountedRef.current) return;
        store.setShowDestroyConfirm(false);
        store.setChannelState(CHANNEL_STATE.WAITING);
        setPublicStatusError('Unable to load channel state right now. Showing safe default state.');
      }
    };

    void loadPublicStatus();

    return () => {
      canceled = true;
    };
  }, [uuid, store.setChannelState, store.setShowDestroyConfirm]);

  useEffect(() => {
    return () => store.resetDeliverStore();
  }, [store.resetDeliverStore]);

  const safetyCode = useMemo(() => {
    if (!store.receiverPubFpr) return null;

    try {
      return deriveSafetyCodeDisplay(store.receiverPubFpr);
    } catch {
      return null;
    }
  }, [store.receiverPubFpr]);

  const shareLink = useMemo(() => {
    if (!uuid) return '(missing uuid)';
    const sharePath = ROUTE_PATTERN.SHARE.replace(':uuid', uuid);
    return typeof window === 'undefined' ? sharePath : `${window.location.origin}${sharePath}`;
  }, [uuid]);

  const canDeliver =
    store.channelState !== CHANNEL_STATE.DELETED &&
    store.channelState !== CHANNEL_STATE.EXPIRED &&
    secretInput.trim().length > 0 &&
    Boolean(store.uuid);

  const handleDeliver = async () => {
    if (isActionPending) return;
    if (!store.uuid) {
      setActionError('Channel UUID is missing and cannot be delivered.');
      return;
    }
    if (secretInput.trim().length === 0) {
      setActionError('Secret payload is required before delivery.');
      return;
    }

    setActionError(null);
    setIsActionPending(true);
    const actionScope = actionScopeRef.current;
    const actionUuid = store.uuid;

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.deliverSecret>>;
    try {
      result = await cryptoOrchestrator.deliverSecret({
        uuid: actionUuid,
        profile,
        plaintext: secretInput,
      });
    } catch {
      if (!isActiveActionContext(actionScope, actionUuid)) return;
      setIsActionPending(false);
      setActionError(mapActionError('INTERNAL_ERROR'));
      return;
    }

    if (!isActiveActionContext(actionScope, actionUuid)) return;
    setIsActionPending(false);
    if (!result.ok) {
      setActionError(mapActionError(result.error.code));
      return;
    }

    store.setShowDestroyConfirm(false);
    setActionError(null);
  };

  const handleDestroyConfirm = () => {
    if (isActionPending) return;
    if (
      store.channelState === CHANNEL_STATE.DELETED ||
      store.channelState === CHANNEL_STATE.EXPIRED
    )
      return;
    store.setShowDestroyConfirm(true);
  };

  const handleApplyDestroy = async () => {
    if (isActionPending) return;
    if (!store.uuid) {
      setActionError('Channel UUID is missing and cannot be destroyed.');
      return;
    }

    setActionError(null);
    setIsActionPending(true);
    const actionScope = actionScopeRef.current;
    const actionUuid = store.uuid;

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.deleteChannel>>;
    try {
      result = await cryptoOrchestrator.deleteChannel({
        uuid: actionUuid,
        profile,
      });
    } catch {
      if (!isActiveActionContext(actionScope, actionUuid)) return;
      setIsActionPending(false);
      setActionError(mapActionError('INTERNAL_ERROR'));
      return;
    }

    if (!isActiveActionContext(actionScope, actionUuid)) return;
    setIsActionPending(false);
    if (!result.ok) {
      setActionError(mapActionError(result.error.code));
      return;
    }

    setActionError(null);
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
    status: store.channelState,
    showDestroyConfirm: store.showDestroyConfirm,
    copied,
    shareLink,
    secretInput,
    safetyCode,
    actionError,
    publicStatusError,
    isActionPending,
    canDeliver,
    handleSecretChange: (value: string) => {
      setSecretInput(value);
      if (actionError) setActionError(null);
    },
    handleDeliver,
    handleDestroyConfirm,
    handleCancelDestroy: () => store.setShowDestroyConfirm(false),
    handleApplyDestroy,
    handleCopyShareLink,
  };
}

/**
 * Sender-side manage page integrated with orchestrator deliver/delete flows.
 */
export function ManagePage(): ReactElement {
  const { uuid } = useParams<{ uuid: string }>();
  const state = useManagePageState(uuid);

  return (
    <PageCard data-testid="page-manage" tone="orange">
      <ManagePageHeader status={state.status} />
      <PageCardContent className="space-y-6">
        <UuidDisplay uuid={uuid} />

        {state.publicStatusError ? (
          <div
            className="rounded-xl border border-neon-orange/40 bg-neon-orange/10 p-3 text-xs text-neon-orange"
            data-testid="manage-public-status-error"
          >
            {state.publicStatusError}
          </div>
        ) : null}

        <ShareLinkCard
          copied={state.copied}
          onCopy={state.handleCopyShareLink}
          shareLink={state.shareLink}
        />

        <StatusContent safetyCode={state.safetyCode} status={state.status} />

        <SecretInput
          disabled={state.isActionPending}
          onChange={state.handleSecretChange}
          value={state.secretInput}
        />

        {state.actionError ? (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            data-testid="manage-action-error"
          >
            {state.actionError}
          </div>
        ) : null}

        <ActionPanel
          canDeliver={state.canDeliver}
          onCancelDestroy={state.handleCancelDestroy}
          onConfirmDestroy={state.handleApplyDestroy}
          onDeliver={state.handleDeliver}
          onOpenDestroyConfirm={state.handleDestroyConfirm}
          pending={state.isActionPending}
          showDestroyConfirm={state.showDestroyConfirm}
          status={state.status}
        />
      </PageCardContent>
    </PageCard>
  );
}
