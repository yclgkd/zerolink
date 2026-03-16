import { CHANNEL_STATE, type ChannelState } from '@zerolink/shared';
import { PlusCircle, Send, Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <PageCardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <PageCardTitle asChild className="text-primary">
            <h2>{t('manage.headerTitle')}</h2>
          </PageCardTitle>
          {unavailable ? null : <StatusBadge status={status} />}
        </div>
        <RoleBadge party="sender" />
      </div>
      <PageCardDescription>{t('manage.headerDescription')}</PageCardDescription>
    </PageCardHeader>
  );
}

export function UuidDisplay({ uuid }: { uuid?: string | undefined }) {
  const { t } = useTranslation();
  return (
    <p className="text-xs text-muted-foreground">
      {t('manage.channelIdLabel')}{' '}
      <code
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground"
        data-testid="manage-uuid"
      >
        {uuid ?? t('manage.channelIdMissing')}
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
  const { t } = useTranslation();

  if (status === CHANNEL_STATE.WAITING) {
    return (
      <section className="space-y-2" data-testid="manage-state-waiting">
        <h3 className="text-base font-semibold text-foreground">{t('manage.waitingTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('manage.waitingBody')}</p>
      </section>
    );
  }

  if (status === CHANNEL_STATE.LOCKED) {
    return (
      <section className="space-y-4" data-testid="manage-state-locked">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">{t('manage.lockedTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('manage.lockedBody')}</p>
        </div>

        {safetyCode ? (
          <SafetyCode display={safetyCode} />
        ) : (
          <StateNotice
            data-testid="manage-safety-unavailable"
            title={t('manage.safetyUnavailableTitle')}
            tone="warning"
          >
            <p className="mt-1 text-xs text-neon-orange">{t('manage.safetyUnavailableBody')}</p>
          </StateNotice>
        )}
      </section>
    );
  }

  if (status === CHANNEL_STATE.DELIVERED) {
    return (
      <section className="space-y-4" data-testid="manage-state-delivered">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">{t('manage.deliveredTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('manage.deliveredBody')}</p>
        </div>

        {safetyCode ? (
          <SafetyCode display={safetyCode} />
        ) : (
          <StateNotice
            data-testid="manage-safety-unavailable"
            title={t('manage.safetyUnavailableTitle')}
            tone="warning"
          >
            <p className="mt-1 text-xs text-neon-orange">{t('manage.safetyUnavailableBody')}</p>
          </StateNotice>
        )}
      </section>
    );
  }

  if (status === CHANNEL_STATE.DELETED) {
    return (
      <section className="space-y-2" data-testid="manage-state-deleted">
        <h3 className="text-base font-semibold text-foreground">{t('manage.deletedTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('manage.deletedBody')}</p>
      </section>
    );
  }

  return (
    <section className="space-y-2" data-testid="manage-state-expired">
      <h3 className="text-base font-semibold text-foreground">{t('manage.expiredTitle')}</h3>
      <p className="text-xs text-muted-foreground">{t('manage.expiredBody')}</p>
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
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <label
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        htmlFor="manage-secret-input"
      >
        {t('manage.secretLabel')}
      </label>
      <textarea
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        className="min-h-24 w-full rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="manage-secret-input"
        disabled={disabled}
        id="manage-secret-input"
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('manage.secretPlaceholder')}
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
  const { t } = useTranslation();
  return (
    <div
      className="space-y-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm ring-1 ring-destructive/20"
      data-testid="manage-destroy-confirm"
    >
      <div className="space-y-1">
        <p className="font-semibold text-destructive">{t('manage.destroyConfirmTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('manage.destroyConfirmBody')}</p>
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
          {t('manage.destroyCancelButton')}
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
              {t('manage.destroyDeletingButton')}
            </>
          ) : (
            <>
              <Trash2 aria-hidden="true" className="size-3.5" />
              {t('manage.destroyConfirmButton')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export function TerminalActions(): ReactElement {
  const { t } = useTranslation();
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
        {t('manage.createNewButton')}
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
  const { t } = useTranslation();

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
                {t('manage.deliveringButton')}
              </>
            ) : (
              <>
                <Send aria-hidden="true" className="size-4" />
                {t('manage.deliverButton')}
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
          {t('manage.deleteChannelButton')}
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
