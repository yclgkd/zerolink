import {
  type AdminMode,
  CHANNEL_STATE,
  type ChannelState,
  ErrorResponseSchema,
  PublicStatusResponseSchema,
  ROUTE_PATTERN,
  SECURITY_PROFILE,
  type SecurityProfile,
  UUIDSchema,
} from '@zerolink/shared';
import { ClipboardCheck, Copy, PlusCircle, Send, Trash2 } from 'lucide-react';
import type { ReactElement, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChannelUnavailableState } from '../components/channel/channel-unavailable-state';
import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  RoleBadge,
  StateNotice,
  StatusBadge,
} from '../components/layout';
import { PassphraseInput } from '../components/lock/passphrase-input';
import { SafetyCode } from '../components/safety/safety-code';
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/spinner';
import { cryptoOrchestrator } from '../crypto/orchestrator';
import { deriveSafetyCodeDisplay } from '../crypto/safety-code-derive';
import { useDeliverStore } from '../stores/deliver-store';
import type { ChannelClosedReason, ChannelStateUpdate } from '../sync/channel-sync.ts';
import { useChannelSync } from '../sync/use-channel-sync.ts';

function mapActionError(code: string): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'This channel is no longer available.';
    case 'FALLBACK_REQUIRED':
      return 'Password-managed channels are unavailable for this action in the current build.';
    case 'PROFILE_BLOCKED':
      return 'Selected security profile requires WebAuthn support.';
    case 'MISSING_LOCK_CHALLENGE':
      return 'Unable to fetch challenge from server. Please retry.';
    case 'MISSING_RECEIVER_IDENTITY':
      return 'Receiver identity is unavailable. Ask receiver to lock again.';
    case 'PASSPHRASE_REQUIRED':
      return 'A channel password is required for this action.';
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
      return 'An unexpected error occurred. Please try again.';
  }
}

function isTerminalPublicState(state: ChannelState): boolean {
  return state === CHANNEL_STATE.DELETED || state === CHANNEL_STATE.EXPIRED;
}

function resolveManageProfile(adminMode: AdminMode | null): SecurityProfile | null {
  if (adminMode === 'webauthn') return SECURITY_PROFILE.SECURE;
  if (adminMode === 'password' || adminMode === 'softkey') return SECURITY_PROFILE.QUICK;
  return null;
}

function canComposeDelivery(status: ChannelState): boolean {
  return status === CHANNEL_STATE.LOCKED || status === CHANNEL_STATE.DELIVERED;
}

function isTerminalManageState(status: ChannelState, unavailable: boolean): boolean {
  return unavailable || status === CHANNEL_STATE.DELETED || status === CHANNEL_STATE.EXPIRED;
}

function ManagePageHeader({ status, unavailable }: { status: ChannelState; unavailable: boolean }) {
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

function UuidDisplay({ uuid }: { uuid?: string | undefined }) {
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
          {copied ? (
            <>
              <ClipboardCheck aria-hidden="true" className="size-3.5 text-neon-green" />
              Copied
            </>
          ) : (
            <>
              <Copy aria-hidden="true" className="size-3.5" />
              Copy
            </>
          )}
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
          <StateNotice
            data-testid="manage-safety-unavailable"
            title="Safety Code unavailable on this device."
            tone="warning"
          >
            <p className="mt-1 text-xs text-neon-orange">
              Safety Code is generated locally and can only be shown when receiver fingerprint is
              available on this device.
            </p>
          </StateNotice>
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

function SecretInput({
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

function TerminalActions(): ReactElement {
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

function ActionPanel({
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

function useShareLinkGenerator(uuid?: string) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const shareLink = useMemo(() => {
    if (!uuid) return '(missing uuid)';
    const sharePath = ROUTE_PATTERN.SHARE.replace(':uuid', uuid);
    return typeof window === 'undefined' ? sharePath : `${window.location.origin}${sharePath}`;
  }, [uuid]);

  const handleCopyShareLink = useCallback(async () => {
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
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [uuid, shareLink]);

  return { copied, shareLink, handleCopyShareLink };
}

function usePublicStatusFetcher(uuid: string | undefined, mountedRef: RefObject<boolean>) {
  const store = useDeliverStore();
  const [publicStatusError, setPublicStatusError] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);

  useEffect(() => {
    let canceled = false;
    if (!uuid) {
      store.setChannelState(CHANNEL_STATE.WAITING);
      setPublicStatusError(null);
      setIsUnavailable(false);
      return;
    }

    setIsUnavailable(false);
    const loadPublicStatus = async () => {
      try {
        const response = await fetch(`/api/public/${uuid}`);
        const payload = (await response.json()) as unknown;
        const parsedError = ErrorResponseSchema.safeParse(payload);
        if (
          response.status === 404 ||
          (parsedError.success && parsedError.data.code === 'NOT_FOUND')
        ) {
          if (canceled || !mountedRef.current) return;
          store.setShowDestroyConfirm(false);
          store.setAdminMode(null);
          store.setReceiverPubFpr(null);
          store.setChannelState(CHANNEL_STATE.WAITING);
          setPublicStatusError(null);
          setIsUnavailable(true);
          return;
        }

        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const parsedPayload = PublicStatusResponseSchema.safeParse(payload);
        if (!parsedPayload.success) throw new Error('INVALID_RESPONSE');

        if (canceled || !mountedRef.current) return;
        if (isTerminalPublicState(parsedPayload.data.state)) {
          store.setShowDestroyConfirm(false);
          store.setAdminMode(null);
          store.setReceiverPubFpr(null);
          store.setChannelState(CHANNEL_STATE.WAITING);
          setPublicStatusError(null);
          setIsUnavailable(true);
          return;
        }

        setPublicStatusError(null);
        setIsUnavailable(false);
        store.setShowDestroyConfirm(false);
        store.setChannelState(parsedPayload.data.state);
        store.setAdminMode(parsedPayload.data.adminMode);
        store.setReceiverPubFpr(parsedPayload.data.receiverPubFpr ?? null);
      } catch {
        if (canceled || !mountedRef.current) return;
        store.setShowDestroyConfirm(false);
        store.setAdminMode(null);
        store.setReceiverPubFpr(null);
        store.setChannelState(CHANNEL_STATE.WAITING);
        setIsUnavailable(false);
        setPublicStatusError('Unable to load channel state right now. Showing safe default state.');
      }
    };

    void loadPublicStatus();
    return () => {
      canceled = true;
    };
  }, [
    uuid,
    store.setAdminMode,
    store.setChannelState,
    store.setReceiverPubFpr,
    store.setShowDestroyConfirm,
    mountedRef,
  ]);

  return { isUnavailable, publicStatusError, setPublicStatusError, setIsUnavailable };
}

function useManageDeliveryLogic(
  mountedRef: RefObject<boolean>,
  actionScopeRef: RefObject<number>,
  isActionPending: boolean,
  setIsActionPending: (pending: boolean) => void,
  setActionError: (error: string | null) => void,
  setIsSecretInputInvalid: (invalid: boolean) => void,
  secretInput: string,
  softkeyPassphrase: string,
  profile: SecurityProfile | null
) {
  const store = useDeliverStore();

  const isActiveActionContext = (scope: number, actionUuid: string): boolean => {
    if (!mountedRef.current) return false;
    if (actionScopeRef.current !== scope) return false;
    return useDeliverStore.getState().uuid === actionUuid;
  };

  const handleDeliver = async () => {
    if (isActionPending) return;
    if (!store.uuid) {
      setIsSecretInputInvalid(false);
      return setActionError('Channel UUID is missing and cannot be delivered.');
    }
    if (profile === null) {
      setIsSecretInputInvalid(false);
      return setActionError('Channel authentication mode is still loading. Please retry.');
    }
    if (secretInput.trim().length === 0) {
      setIsSecretInputInvalid(true);
      return setActionError('Secret payload is required before delivery.');
    }

    setIsSecretInputInvalid(false);
    setActionError(null);
    setIsActionPending(true);
    const actionScope = actionScopeRef.current ?? 0;
    const actionUuid = store.uuid;

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.deliverSecret>>;
    try {
      result = await cryptoOrchestrator.deliverSecret({
        uuid: actionUuid,
        profile,
        plaintext: secretInput,
        ...(softkeyPassphrase.trim().length > 0 ? { softkeyPassphrase } : {}),
      });
    } catch {
      if (!isActiveActionContext(actionScope, actionUuid)) return;
      setIsActionPending(false);
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError('INTERNAL_ERROR'));
    }

    if (!isActiveActionContext(actionScope, actionUuid)) return;
    setIsActionPending(false);
    if (!result.ok) {
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError(result.error.code));
    }

    store.setShowDestroyConfirm(false);
    setIsSecretInputInvalid(false);
    setActionError(null);
  };

  return { handleDeliver, isActiveActionContext };
}

function useManageDestructionLogic(
  _mountedRef: RefObject<boolean>,
  actionScopeRef: RefObject<number>,
  isActionPending: boolean,
  setIsActionPending: (pending: boolean) => void,
  setActionError: (error: string | null) => void,
  setIsSecretInputInvalid: (invalid: boolean) => void,
  setSecretInput: (value: string) => void,
  setSoftkeyPassphrase: (value: string) => void,
  softkeyPassphrase: string,
  profile: SecurityProfile | null,
  isActiveActionContext: (scope: number, actionUuid: string) => boolean
) {
  const store = useDeliverStore();

  const handleDestroyConfirm = () => {
    if (isActionPending) return;
    if (profile === null) return;
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
      setIsSecretInputInvalid(false);
      return setActionError('Channel UUID is missing and cannot be deleted.');
    }
    if (profile === null) {
      setIsSecretInputInvalid(false);
      return setActionError('Channel authentication mode is still loading. Please retry.');
    }

    setIsSecretInputInvalid(false);
    setActionError(null);
    setIsActionPending(true);
    const actionScope = actionScopeRef.current ?? 0;
    const actionUuid = store.uuid;

    let result: Awaited<ReturnType<typeof cryptoOrchestrator.deleteChannel>>;
    try {
      result = await cryptoOrchestrator.deleteChannel({
        uuid: actionUuid,
        profile,
        ...(softkeyPassphrase.trim().length > 0 ? { softkeyPassphrase } : {}),
      });
    } catch {
      if (!isActiveActionContext(actionScope, actionUuid)) return;
      setIsActionPending(false);
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError('INTERNAL_ERROR'));
    }

    if (!isActiveActionContext(actionScope, actionUuid)) return;
    setIsActionPending(false);
    if (!result.ok) {
      setIsSecretInputInvalid(false);
      return setActionError(mapActionError(result.error.code));
    }
    setIsSecretInputInvalid(false);
    setActionError(null);
    setSecretInput('');
    setSoftkeyPassphrase('');
  };

  return { handleDestroyConfirm, handleApplyDestroy };
}

function useManagePageState(uuid?: string) {
  const store = useDeliverStore();
  const mountedRef = useRef(true);
  const actionScopeRef = useRef(0);

  const [secretInput, setSecretInput] = useState('');
  const [softkeyPassphrase, setSoftkeyPassphrase] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSecretInputInvalid, setIsSecretInputInvalid] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { isUnavailable, publicStatusError, setPublicStatusError, setIsUnavailable } =
    usePublicStatusFetcher(uuid, mountedRef);

  // Real-time sync: auto-update when receiver locks or channel state changes
  useChannelSync(uuid, {
    onStateChange: useCallback(
      (update: ChannelStateUpdate) => {
        if (!mountedRef.current) return;
        setIsUnavailable(false);
        setPublicStatusError(null);
        store.setChannelState(update.state);
        store.setAdminMode(update.adminMode);
        store.setReceiverPubFpr(update.receiverPubFpr ?? null);
      },
      [
        setIsUnavailable,
        setPublicStatusError,
        store.setChannelState,
        store.setAdminMode,
        store.setReceiverPubFpr,
      ]
    ),
    onChannelClosed: useCallback(
      (_reason: ChannelClosedReason) => {
        if (!mountedRef.current) return;
        const latestState = useDeliverStore.getState().channelState;
        setPublicStatusError(null);
        store.setShowDestroyConfirm(false);
        if (latestState === CHANNEL_STATE.DELETED) {
          setIsUnavailable(false);
          return;
        }

        setIsUnavailable(true);
        store.setChannelState(CHANNEL_STATE.WAITING);
        store.setAdminMode(null);
        store.setReceiverPubFpr(null);
      },
      [
        setPublicStatusError,
        setIsUnavailable,
        store.setChannelState,
        store.setShowDestroyConfirm,
        store.setAdminMode,
        store.setReceiverPubFpr,
      ]
    ),
  });

  const { copied, shareLink, handleCopyShareLink } = useShareLinkGenerator(uuid);

  useEffect(() => {
    actionScopeRef.current += 1;
    setIsActionPending(false);
    setSecretInput('');
    setSoftkeyPassphrase('');
    setActionError(null);
    setIsSecretInputInvalid(false);
    setPublicStatusError(null);

    if (!uuid) {
      store.setDeliverUuid(null);
      return;
    }
    const parsedUuid = UUIDSchema.safeParse(uuid);
    store.setDeliverUuid(parsedUuid.success ? parsedUuid.data : null);
    store.setShowDestroyConfirm(false);
  }, [uuid, store.setDeliverUuid, store.setShowDestroyConfirm, setPublicStatusError]);

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

  const profile = resolveManageProfile(store.adminMode);
  const canManageActions =
    !isUnavailable &&
    store.channelState !== CHANNEL_STATE.DELETED &&
    store.channelState !== CHANNEL_STATE.EXPIRED &&
    profile !== null &&
    Boolean(store.uuid);
  const canDeliver = canManageActions && secretInput.trim().length > 0;

  const { handleDeliver, isActiveActionContext } = useManageDeliveryLogic(
    mountedRef,
    actionScopeRef,
    isActionPending,
    setIsActionPending,
    setActionError,
    setIsSecretInputInvalid,
    secretInput,
    softkeyPassphrase,
    profile
  );

  const { handleDestroyConfirm, handleApplyDestroy } = useManageDestructionLogic(
    mountedRef,
    actionScopeRef,
    isActionPending,
    setIsActionPending,
    setActionError,
    setIsSecretInputInvalid,
    setSecretInput,
    setSoftkeyPassphrase,
    softkeyPassphrase,
    profile,
    isActiveActionContext
  );

  return {
    status: store.channelState,
    adminMode: store.adminMode,
    showDestroyConfirm: store.showDestroyConfirm,
    copied,
    shareLink,
    secretInput,
    softkeyPassphrase,
    safetyCode,
    actionError,
    isSecretInputInvalid,
    isUnavailable,
    publicStatusError,
    isActionPending,
    canManageActions,
    canDeliver,
    handleSecretChange: (value: string) => {
      setSecretInput(value);
      if (actionError || isSecretInputInvalid) {
        setActionError(null);
        setIsSecretInputInvalid(false);
      }
    },
    handleSoftkeyPassphraseChange: (value: string) => {
      setSoftkeyPassphrase(value);
      if (actionError) {
        setActionError(null);
      }
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
  const usesPasswordManagedChannel =
    state.adminMode === 'password' || state.adminMode === 'softkey';
  const showUnavailableState = state.isUnavailable && state.status !== CHANNEL_STATE.DELETED;
  const isTerminalState = isTerminalManageState(state.status, showUnavailableState);
  const showShareLink = !isTerminalState;
  const showDeliveryComposer = !isTerminalState && canComposeDelivery(state.status);
  const showPasswordSection = !isTerminalState && usesPasswordManagedChannel;

  return (
    <PageCard data-testid="page-manage" tone="orange">
      <ManagePageHeader status={state.status} unavailable={showUnavailableState} />
      <PageCardContent aria-busy={state.isActionPending} className="space-y-6">
        <UuidDisplay uuid={uuid} />

        {state.publicStatusError ? (
          <StateNotice
            data-testid="manage-public-status-error"
            id="manage-public-status-error"
            tone="warning"
          >
            {state.publicStatusError}
          </StateNotice>
        ) : null}

        {showShareLink ? (
          <ShareLinkCard
            copied={state.copied}
            onCopy={state.handleCopyShareLink}
            shareLink={state.shareLink}
          />
        ) : null}

        {showUnavailableState ? (
          <ChannelUnavailableState
            body="This channel was destroyed, expired, or does not exist."
            testId="manage-state-unavailable"
          />
        ) : (
          <StatusContent safetyCode={state.safetyCode} status={state.status} />
        )}

        {showDeliveryComposer ? (
          <>
            <SecretInput
              ariaDescribedBy={
                state.actionError && state.isSecretInputInvalid ? 'manage-action-error' : undefined
              }
              ariaInvalid={state.isSecretInputInvalid ? true : undefined}
              disabled={state.isActionPending}
              onChange={state.handleSecretChange}
              value={state.secretInput}
            />
          </>
        ) : null}

        {showPasswordSection ? (
          <section className="space-y-2" data-testid="manage-softkey-passphrase-section">
            <p className="text-xs text-muted-foreground">
              This channel uses a password-protected management key. Enter the password you set when
              creating this channel.
            </p>
            <PassphraseInput
              inputId="manage-softkey-passphrase"
              label="Channel password"
              onChange={state.handleSoftkeyPassphraseChange}
              placeholder="Enter channel password"
              showStrength={false}
              value={state.softkeyPassphrase}
            />
          </section>
        ) : null}

        {state.actionError ? (
          <StateNotice
            autoFocusOnMount
            data-testid="manage-action-error"
            id="manage-action-error"
            tone="error"
          >
            {state.actionError}
          </StateNotice>
        ) : null}

        <ActionPanel
          canManageActions={state.canManageActions}
          canDeliver={state.canDeliver}
          onCancelDestroy={state.handleCancelDestroy}
          onConfirmDestroy={state.handleApplyDestroy}
          onDeliver={state.handleDeliver}
          onOpenDestroyConfirm={state.handleDestroyConfirm}
          pending={state.isActionPending}
          showDeliverAction={showDeliveryComposer}
          showDestroyConfirm={state.showDestroyConfirm}
          status={state.status}
          unavailable={showUnavailableState}
        />
      </PageCardContent>
    </PageCard>
  );
}
