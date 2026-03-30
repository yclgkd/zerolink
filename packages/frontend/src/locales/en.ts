const en = {
  shell: {
    tagline: 'Zero-Knowledge Secure Delivery',
    trustModelLink: 'Trust Model',
    backToCreate: 'Back to Create',
    inAppBrowserWarning:
      'For best security, open ZeroLink in a standalone browser (Safari, Chrome, Firefox) — not inside Telegram, Instagram, or other in-app browsers.',
  },

  create: {
    title: 'Create Secure Channel',
    description:
      'Zero-knowledge encrypted delivery. Choose Quick Share (password) or Secure Share (passkey).',
    chooseModeTitle: 'Choose Share Mode',
    quickShareTitle: 'Quick Share',
    quickShareDescription: 'Password-protected — no passkey needed. Works in any browser.',
    secureShareTitle: 'Secure Share',
    secureShareDescriptionAvailable:
      'Passkey-protected — strongest security with user verification.',
    secureShareDescriptionUnavailable:
      'Requires WebAuthn support (not available in this environment).',
    secureShareHint:
      'This passkey is used only for this channel. If it appears in your passkey manager, it can be safely deleted after the channel expires.',
    webauthnBlockedTitle: 'WebAuthn is not available in this environment.',
    webauthnBlockedBody: 'Secure Share is disabled. Use Quick Share instead.',
    howItWorksLabel: 'How it works',
    step1Title: 'Create',
    step1Desc: 'Choose a mode and create the encrypted channel.',
    step2Title: 'Share',
    step2Desc: 'Send the share link to your receiver.',
    step3Title: 'Lock',
    step3Desc: 'Receiver sets a passphrase on their device and locks the channel.',
    step4Title: 'Verify',
    step4Desc: 'Compare the Safety Code over a separate channel to confirm the receiver identity.',
    step5Title: 'Deliver',
    step5Desc: 'Deliver the encrypted secret to the locked receiver.',
    step6Title: 'Decrypt',
    step6Desc: 'The receiver decrypts the secret locally on the device that created the lock.',
    trustHintBody:
      'Need a plain-language summary of what stays local, what the sender can do, and when channel data disappears?',
    trustHintLink: 'Read the trust model',
    passwordPanelTitle: 'Set a Quick Share Password',
    passwordPanelBody:
      'This password protects your channel management key. Use 4+ random words or 12+ characters. It cannot be recovered if lost.',
    expiryTitle: 'Channel expiry',
    expiryDescription: 'Choose how long this channel stays available after creation.',
    ttlOneHour: '1 hour',
    ttlOneDay: '24 hours',
    ttlSevenDays: '7 days',
    passwordLabel: 'Channel password',
    passwordPlaceholder: 'Enter a strong password',
    footerHintPasswordRequired: 'Enter a channel password with at least 12 characters.',
    footerHintPasswordInvalid:
      'Use 4+ random words or at least 12 characters for the channel password.',
    footerHintReady: 'Ready to create a {{mode}} channel that expires in {{ttl}}.',
    submitButton: 'Create Channel',
    submittingButton: 'Creating\u2026',
    successTitle: 'Channel created successfully',
    successModeLabel: 'Mode:',
    passwordProtectedBadge: 'Password-protected',
    createAnother: 'Create another',
    shareLinkLabel: 'Share link — send to receiver',
    shareLinkWarningTitle: 'This share link is shown only once.',
    shareLinkWarningBody:
      'Save it now. In this browser session, the sender Manage page can re-copy it while the channel is still waiting. Outside that window, if you lose it, create a new channel.',
    manageLinkLabel: 'Manage link — keep this private',
    expiryHint:
      'Channel expires in {{duration}}. Coordinate with the receiver before it disappears.',
    copyButton: 'Copy',
    copiedButton: 'Copied',
    errorProfileBlocked: 'Secure Share requires WebAuthn support in your environment.',
    errorNotAllowed: 'Passkey prompt was cancelled or denied. Please try again.',
    errorNetwork: 'Network error while creating channel. Please retry.',
    errorBadRequest: 'Create request was rejected. Please retry.',
    errorDefault: 'An unexpected error occurred. Please try again.',
  },

  profile: {
    quick: 'Quick Share',
    secure: 'Secure Share',
  },

  manage: {
    headerTitle: 'Manage / Deliver',
    headerDescription: 'Sender-side verification and delivery controls (integrated flow).',
    channelIdLabel: 'Channel ID:',
    channelIdMissing: '(missing)',
    waitingTitle: 'Waiting for Receiver Lock',
    waitingBody:
      'Receiver has not locked the channel yet. Share the link and this page will update automatically once they do.',
    lockedTitle: 'Receiver Locked the Channel',
    lockedBody: 'Verify the Safety Code out-of-band before delivering the secret.',
    deliveredTitle: 'Delivery Completed',
    deliveredBody:
      'Ciphertext has been delivered to the receiver flow. Receiver-side decrypt happens locally and does not send confirmation back here.',
    deletedTitle: 'Channel Deleted',
    deletedBody: 'You deleted this channel. It can no longer deliver or decrypt content.',
    expiredTitle: 'Channel Expired',
    expiredBody: 'This channel expired. It can no longer be used for delivery or decryption.',
    unavailableBody: 'This channel was destroyed, expired, or does not exist.',
    safetyUnavailableTitle: 'Safety Code unavailable right now.',
    safetyUnavailableBody:
      'Receiver fingerprint is missing from the current channel state, so the Safety Code cannot be shown.',
    secretLabel: 'Secret Payload',
    secretPlaceholder: 'Enter plaintext secret to encrypt and deliver',
    softkeyPassphraseHint:
      'This channel uses a password-protected management key. Enter the password you set when creating this channel.',
    softkeyLabel: 'Channel password',
    softkeyPlaceholder: 'Enter channel password',
    deliverButton: 'Deliver',
    deliveringButton: 'Delivering\u2026',
    deleteChannelButton: 'Delete Channel',
    destroyConfirmTitle: 'Permanently delete this channel?',
    destroyConfirmBody: 'This cannot be undone. All channel data will be removed from the server.',
    destroyCancelButton: 'Cancel',
    destroyConfirmButton: 'Confirm Delete',
    destroyDeletingButton: 'Deleting\u2026',
    createNewButton: 'Create New Channel',
    deliveredToast: 'Secret delivered successfully.',
    shareLinkRecoveryTitle: 'Need to resend the receiver link?',
    shareLinkRecoveryBody:
      'This browser session still has the one-time receiver link. You can copy it again until the receiver locks the channel.',
    shareLinkRecoveryButton: 'Copy receiver link',
    shareLinkRecoveryCopied: 'Receiver link copied',
  },

  share: {
    channelIdLabel: 'Channel ID:',
    channelIdMissing: '(missing)',
    headerDefaultTitle: 'Receiver Channel',
    headerDefaultDescription:
      'Open this receiver link on the device that will lock the channel and later decrypt the delivered secret locally.',
    headerWaitingTitle: 'Receiver Setup',
    headerWaitingDescription:
      'The sender already created this channel. Set your own passphrase here to generate your receiver key and lock the channel on this device.',
    headerLockedTitle: 'Receiver Channel',
    headerLockedDescription:
      'This receiver channel is locked. This page updates automatically, but only the device that created the lock can verify the Safety Code shown below.',
    headerDeliveredTitle: 'Decrypt Delivered Secret',
    headerDeliveredDescription:
      'If this device created the receiver lock, enter that passphrase to decrypt the secret locally.',
    headerUnavailableTitle: 'Receiver Channel',
    headerUnavailableDescription: 'This receiver link is unavailable or no longer active.',
    loadingTitle: 'Loading Channel State',
    loadingBody: 'Fetching secure channel status for this link.',
    unavailableBody: 'This channel was destroyed, expired, or does not exist.',
    stepIntro: 'Receiver intro',
    stepPassphrase: 'Your passphrase',
    stepReady: 'Ready for delivery',
    stepIndicator: 'Step {{current}} of {{total}} — {{label}}',
    onboardingTitle: 'Receiver Lock Setup',
    onboarding1Title: 'This page is only for the receiver using the shared link.',
    onboarding1Desc: 'The sender already created the channel and sent you this link.',
    onboarding2Title: 'Your passphrase stays on this device',
    onboarding2Desc: 'It never gets sent to the server or shared with the sender.',
    onboarding3Title: 'Locking creates your receiver key locally',
    onboarding3Desc: 'After you lock, the sender can deliver only to your receiver identity.',
    continueButton: 'Continue as receiver',
    lockTitle: 'Choose your passphrase',
    lockLabel: 'Your passphrase',
    lockPlaceholder: 'Enter your passphrase',
    privateModeNoticeBody:
      'If you are in private or incognito mode, your decryption key will only exist in this window. Closing it will permanently lose access. To switch to a regular browser, copy this link first.',
    privateModeNoticeCopy: 'Copy link',
    privateModeNoticeCopied: 'Copied!',
    backButton: 'Back',
    generateButton: 'Generate My Key & Lock',
    lockingButton: 'Locking\u2026',
    lockedTitle: 'Receiver channel is locked',
    lockedBody: 'Verify the Safety Code with the sender only if this device shows it below.',
    nextStepsLabel: 'Next Steps',
    nextStep1: 'Coordinate with the sender over another channel.',
    nextStep2: 'Only confirm the Safety Code if this device shows it below.',
    nextStep3: 'This page updates automatically when the sender delivers the encrypted secret.',
    deliveredTitle: 'Channel Delivered',
    deliveredBody:
      'The encrypted secret has been delivered. Decryption still requires the device that created the receiver lock.',
    deliveredAtLabel: 'Delivered:',
    updatedBadge:
      'Updated (v{{version}}) \u00b7 The sender may have revised this content. The latest version is shown.',
    decryptLabel: 'Decrypt passphrase',
    decryptPlaceholder: 'Enter passphrase to decrypt',
    decryptButton: 'Decrypt',
    decryptingButton: 'Decrypting\u2026',
    burnButton: 'Burn Local Plaintext',
    plaintextLabel: 'Plaintext',
    cipherVersionNotice:
      'The content has been updated. You are about to decrypt the latest version.',
    burnedTitle: 'Local plaintext removed from this device.',
    burnedBody:
      'This does not delete the channel or mark it expired. Re-enter your passphrase to decrypt again.',
    burnedToast: 'Local plaintext removed.',
    safetyCheckingTitle: 'Checking this device for the receiver key\u2026',
    safetyCheckingBody:
      'ZeroLink only shows the Safety Code after confirming that this device created the current lock.',
    safetyMissingTitle: 'This device cannot verify the Safety Code.',
    safetyMissingBody:
      'No matching receiver key was found on this device. Do not confirm the Safety Code from here. If you expected to be the receiver, ask the sender to recreate the channel.',
    safetyMismatchedTitle: 'Receiver identity mismatch detected.',
    safetyMismatchedBody:
      'This device has different local receiver key material than the key currently locked on the channel. Treat this link as unsafe and ask the sender to recreate the channel.',
    safetyStorageErrorTitle: 'Unable to check the local receiver key.',
    safetyStorageErrorBody:
      'ZeroLink could not read the receiver key material stored on this device, so the Safety Code cannot be verified here.',
    safetyUnavailableTitle: 'Safety Code unavailable right now.',
    safetyUnavailableBody:
      'Receiver fingerprint is missing from the current channel state, so the Safety Code cannot be verified here.',
    decryptCheckingTitle: 'Checking this device before enabling decrypt\u2026',
    decryptCheckingBody:
      'ZeroLink is verifying whether this device holds the receiver key needed for local decryption.',
    decryptMismatchedTitle: 'Decrypt blocked on this device.',
    decryptMismatchedBody:
      'The receiver key stored on this device does not match the key currently locked on the channel. Treat this link as unsafe and ask the sender to recreate the channel.',
    decryptStorageErrorTitle: 'Unable to load the local receiver key.',
    decryptStorageErrorBody:
      'ZeroLink could not read the receiver key stored on this device, so local decrypt is unavailable here.',
    decryptUnavailableTitle: 'Decrypt unavailable on this device.',
    decryptUnavailableBody:
      'This device does not have the receiver key that locked the channel, so local decrypt is blocked here.',
  },

  trust: {
    badge: 'Trust Model',
    title: 'What ZeroLink Can and Cannot Know',
    description:
      'A compact summary of what stays on your device, what the sender can control, and when a channel disappears.',
    section1Title: 'What the server never gets',
    section1Body:
      'The server never receives the URL fragment (#k=...), the receiver passphrase, the receiver private key, or decrypted plaintext. Those stay outside the server-side request path.',
    section2Title: 'What the server stores at each stage',
    section2Body:
      'At create time: channel metadata, expiry, and admin auth material. After lock: receiver public key and fingerprint. After delivery: ciphertext for the receiver to fetch.',
    section3Title: 'What the sender can control',
    section3Body:
      'The sender can create a channel, share the receiver link, deliver ciphertext, and delete the channel. The sender cannot read the receiver passphrase, inspect the receiver private key, or see decrypted plaintext on the receiver device.',
    section4Title: 'What the manage link carries',
    section4Body:
      'Quick Share embeds a wrapped admin key in the manage link itself (the URL fragment). Anyone who has that link — and the channel password — can deliver or delete the channel from any device. If you lose the manage link, there is no way to recover it.',
    section5Title: 'What stays on the receiver device',
    section5Body:
      'The receiver device keeps a wrapped receiver private key in IndexedDB for that channel. Plaintext appears only on the local device after decrypt. Channel status may surface the receiver fingerprint to the sender, but the receiver page should show a Safety Code only after this device proves it holds the matching local receiver key.',
    section6Title: 'Delete, expiry, local burn, and Verified Release',
    section6Body:
      'Channels expire after the selected TTL, up to 7 days. Sender delete purges ciphertext and leaves a tombstone to prevent revival. Local burn removes plaintext from this device only — the channel stays active. Verified Release means the build passed signed release verification; absence means it did not.',
    backButton: 'Back',
    createButton: 'Create Secure Channel',
  },

  notFound: {
    title: 'Page Not Found',
    description: 'This route does not exist in the current app shell.',
    hint: 'Check the URL and try again.',
    backButton: 'Back to Create',
  },

  channel: {
    unavailableTitle: 'Channel Unavailable',
  },

  role: {
    sender: 'Sender',
    receiver: 'Receiver',
  },

  status: {
    waiting: 'Waiting for Lock',
    locked: 'Locked by Receiver',
    delivered: 'Delivered',
    deleted: 'Deleted',
    expired: 'Expired',
  },

  passphrase: {
    defaultLabel: 'Passphrase',
    defaultPlaceholder: 'Enter passphrase',
    showButton: 'Show passphrase',
    hideButton: 'Hide passphrase',
    policyHint: 'Use 4+ random words or 12+ characters',
    errorRequired: '{{label}} is required',
    errorTooShort: '{{label}} must be at least {{min}} characters',
    errorTooLong: '{{label}} must be {{max}} characters or fewer',
    errorInvalidWhitespace:
      '{{label}} can use ordinary spaces between words, but not tabs, line breaks, or special spaces',
    strengthLabel: 'Passphrase strength',
    weak: 'Weak',
    medium: 'Medium',
    strong: 'Strong',
  },

  safetyCode: {
    title: 'Safety Code',
    verifyHint: 'Verify this code via another channel (phone, video call)',
    emojiTab: 'Emoji',
    colorTab: 'Colors',
    advancedToggle: 'Advanced fingerprint',
    shortFprLabel: 'Short fingerprint',
    fullFprLabel: 'Full hex fingerprint',
  },

  lang: {
    switcherLabel: 'Select language',
    menuLabel: 'Language',
  },

  manageError: {
    notFound: 'This channel is no longer available.',
    fallbackRequired:
      'Password-managed channels are unavailable for this action in the current build.',
    profileBlocked: 'Selected security profile requires WebAuthn support.',
    missingLockChallenge: 'Unable to fetch challenge from server. Please retry.',
    missingReceiverIdentity: 'Receiver identity is unavailable. Ask receiver to lock again.',
    networkError: 'Network error while performing manage action. Please retry.',
    badRequest: 'Manage request was rejected. Please retry.',
    webauthnError: 'WebAuthn verification was not completed.',
    cryptoError: 'Incorrect channel password. Please try again.',
    internalError: 'Unexpected internal error. Please retry.',
    default: 'An unexpected error occurred. Please try again.',
  },

  manifest: {
    title: 'Verified Release',
    verifiedBadge: 'Verified',
    body: 'This page matches an official ZeroLink release signed by our team.',
    fingerprintLabel: 'Release fingerprint:',
    showDetails: 'View verification details',
    hideDetails: 'Hide verification details',
    statusLabel: 'Status',
    versionLabel: 'App version',
    buildDateLabel: 'Build date',
    commitLabel: 'Commit',
    manifestHashLabel: 'Manifest hash',
    filesLabel: 'Verified files',
    publisherKeyLabel: 'Publisher key fingerprint',
    signatureLabel: 'Signature',
  },
};

export default en;
export type Translation = typeof en;
