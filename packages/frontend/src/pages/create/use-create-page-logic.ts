import {
  buildManageUrlWithFragment,
  CHANNEL_TTL_MS,
  type ChannelTtlMs,
  SECURITY_PROFILE,
  type SecurityProfile,
} from '@zerolink/shared';
import i18next from 'i18next';
import { useEffect, useState } from 'react';

import { cryptoOrchestrator } from '../../crypto/orchestrator';
import { getPassphraseValidationMessage, hasValidPassphrase } from '../../crypto/passphrase-policy';
import { detectWebAuthnSupport } from '../../crypto/webauthn';
import { serializeWrappedKeyCompact } from '../../crypto/wrapped-key-codec';
import { generateChannelUuid } from '../../lib/channel-uuid';
import type { CreateStore } from '../../stores/create-store';
import { useCreateStore } from '../../stores/create-store';
import type { CreatedLinks } from './helpers';

function mapCreateError(code: string, message?: string): string {
  switch (code) {
    case 'PROFILE_BLOCKED':
      return i18next.t('create.errorProfileBlocked');
    case 'PASSPHRASE_REQUIRED':
      return (
        message ?? getPassphraseValidationMessage('too_short', i18next.t('create.passwordLabel'))
      );
    case 'NOT_ALLOWED':
      return i18next.t('create.errorNotAllowed');
    case 'NETWORK_ERROR':
      return i18next.t('create.errorNetwork');
    case 'BAD_REQUEST':
    case 'INVALID_REQUEST':
      return i18next.t('create.errorBadRequest');
    default:
      return i18next.t('create.errorDefault');
  }
}

interface RunCreateOptions {
  quickPassword: string;
  ttl: ChannelTtlMs;
  store: CreateStore;
  onError: (message: string) => void;
  onSuccess: (links: CreatedLinks) => void;
  onQuickPasswordClear: () => void;
}

async function runCreate({
  quickPassword,
  ttl,
  store,
  onError,
  onSuccess,
  onQuickPasswordClear,
}: RunCreateOptions): Promise<void> {
  const { selectedProfile } = useCreateStore.getState();
  store.startCreateBegin();

  let result: Awaited<ReturnType<typeof cryptoOrchestrator.createChannel>>;
  try {
    result = await cryptoOrchestrator.createChannel({
      uuid: generateChannelUuid(),
      profile: selectedProfile,
      ttl,
      useCompatibilityMode: selectedProfile === SECURITY_PROFILE.QUICK,
      ...(selectedProfile === SECURITY_PROFILE.QUICK ? { softkeyPassphrase: quickPassword } : {}),
    });
  } catch {
    store.failCreateBegin('INTERNAL_ERROR');
    onError('Channel creation failed: INTERNAL_ERROR');
    return;
  }

  if (!result.ok) {
    store.failCreateBegin(result.error.code);
    onError(mapCreateError(result.error.code, result.error.message));
    return;
  }

  store.completeCreateBegin({ ok: true, creationOptions: {} });
  store.setCreatedProfile(selectedProfile);

  let manageUrl = result.data.manageUrl;
  if (selectedProfile === SECURITY_PROFILE.QUICK && result.data.wrappedPrivateKey) {
    const compact = serializeWrappedKeyCompact(result.data.wrappedPrivateKey);
    manageUrl = buildManageUrlWithFragment(manageUrl, compact);
  }

  onSuccess({
    shareUrlWithFragment: result.data.shareUrlWithFragment,
    manageUrl,
    isPasswordMode: selectedProfile === SECURITY_PROFILE.QUICK,
    ttl,
  });
  if (selectedProfile === SECURITY_PROFILE.QUICK) onQuickPasswordClear();
}

export function useCreatePageLogic() {
  const store = useCreateStore();
  const [createdLinks, setCreatedLinks] = useState<CreatedLinks | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [quickPassword, setQuickPassword] = useState('');
  const [selectedTtl, setSelectedTtl] = useState<ChannelTtlMs>(CHANNEL_TTL_MS.ONE_HOUR);

  useEffect(() => {
    const support = detectWebAuthnSupport();
    store.setWebAuthnSupported(support.supported);
    store.setSelectedProfile(SECURITY_PROFILE.QUICK);
  }, [store.setWebAuthnSupported, store.setSelectedProfile]);

  const isQuickMode = store.selectedProfile === SECURITY_PROFILE.QUICK;
  const isSubmitting =
    store.createBegin.status === 'loading' || store.createFinish.status === 'loading';
  const canSubmit = isQuickMode ? hasValidPassphrase(quickPassword) : store.webAuthnSupported;

  function clearLocalFeedback(): void {
    setSubmitError(null);
    setCreatedLinks(null);
    store.setCreatedProfile(null);
  }

  function handleSelectProfile(profile: SecurityProfile): void {
    store.setSelectedProfile(profile);
    clearLocalFeedback();
  }

  function handleCreate(): void {
    if (isSubmitting || !canSubmit) return;
    clearLocalFeedback();
    void runCreate({
      quickPassword,
      ttl: selectedTtl,
      store,
      onError: setSubmitError,
      onSuccess: setCreatedLinks,
      onQuickPasswordClear: () => setQuickPassword(''),
    });
  }

  function handleCreateAnother(): void {
    clearLocalFeedback();
  }

  return {
    state: store,
    createdLinks,
    submitError,
    quickPassword,
    selectedTtl,
    isQuickMode,
    isSubmitting,
    canSubmit,
    handleSelectProfile,
    handleSelectTtl: (ttl: ChannelTtlMs) => {
      setSelectedTtl(ttl);
      if (submitError) setSubmitError(null);
    },
    handleCreate,
    handleCreateAnother,
    handleQuickPasswordChange: (value: string) => {
      setQuickPassword(value);
      if (submitError) setSubmitError(null);
    },
  };
}
