import { CHANNEL_STATE } from '@zerolink/shared';
import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { ChannelUnavailableState } from '../components/channel/channel-unavailable-state';
import { PageCard, PageCardContent, StateNotice } from '../components/layout';
import { PassphraseInput } from '../components/lock/passphrase-input';
import {
  ActionPanel,
  ManagePageHeader,
  SecretInput,
  StatusContent,
  UuidDisplay,
} from './manage/manage-components';
import { canComposeDelivery, isTerminalManageState } from './manage/manage-utils';
import { useManagePageState } from './manage/use-manage-page-state';

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
  const showDeliveryComposer = !isTerminalState && canComposeDelivery(state.status);
  const showPasswordSection =
    !isTerminalState &&
    usesPasswordManagedChannel &&
    (showDeliveryComposer || state.showDestroyConfirm);

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

        {showUnavailableState ? (
          <ChannelUnavailableState
            body="This channel was destroyed, expired, or does not exist."
            testId="manage-state-unavailable"
          />
        ) : (
          <StatusContent safetyCode={state.safetyCode} status={state.status} />
        )}

        {showDeliveryComposer ? (
          <SecretInput
            ariaDescribedBy={
              state.actionError && state.isSecretInputInvalid ? 'manage-action-error' : undefined
            }
            ariaInvalid={state.isSecretInputInvalid ? true : undefined}
            disabled={state.isActionPending}
            onChange={state.handleSecretChange}
            value={state.secretInput}
          />
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
