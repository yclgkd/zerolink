import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PageCard,
  PageCardContent,
  PageCardDescription,
  PageCardHeader,
  PageCardTitle,
  RoleBadge,
  StateNotice,
} from '../components/layout';
import {
  ActionFooter,
  ExpirySelector,
  HowItWorks,
  ModeSelectorGrid,
  QuickSharePasswordPanel,
  TrustModelHint,
} from './create/create-form-sections';
import { SuccessSummary } from './create/create-success-summary';
import { useCreatePageLogic } from './create/use-create-page-logic';

/**
 * Create page with Quick Share (password) and Secure Share (passkey) modes.
 */
export function CreatePage(): ReactElement {
  const { t } = useTranslation();
  const logic = useCreatePageLogic();

  return (
    <PageCard data-testid="page-create" tone="purple">
      <PageCardHeader>
        <div className="flex items-center justify-between gap-3">
          <PageCardTitle asChild className="text-primary">
            <h2>{t('create.title')}</h2>
          </PageCardTitle>
          <RoleBadge party="sender" />
        </div>
        <PageCardDescription>{t('create.description')}</PageCardDescription>
      </PageCardHeader>
      <PageCardContent aria-busy={logic.isSubmitting} className="space-y-6">
        {logic.createdLinks ? (
          <SuccessSummary
            createdProfile={logic.state.createdProfile}
            links={logic.createdLinks}
            onCreateAnother={logic.handleCreateAnother}
          />
        ) : (
          <>
            <HowItWorks />
            <ModeSelectorGrid
              onSelect={logic.handleSelectProfile}
              selected={logic.state.selectedProfile}
              webAuthnSupported={logic.state.webAuthnSupported}
            />
            <ExpirySelector onSelect={logic.handleSelectTtl} selected={logic.selectedTtl} />
            <TrustModelHint />
            {logic.isQuickMode ? (
              <QuickSharePasswordPanel
                onPasswordChange={logic.handleQuickPasswordChange}
                password={logic.quickPassword}
              />
            ) : null}
            <ActionFooter
              disabled={logic.isSubmitting || !logic.canSubmit}
              isLoading={logic.isSubmitting}
              onCreate={logic.handleCreate}
            />
            {logic.submitError ? (
              <StateNotice
                autoFocusOnMount
                data-testid="create-submit-error"
                id="create-submit-error"
                tone="error"
              >
                {logic.submitError}
              </StateNotice>
            ) : null}
          </>
        )}
      </PageCardContent>
    </PageCard>
  );
}
