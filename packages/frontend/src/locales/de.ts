import type { Translation } from './en';

const de: Translation = {
  shell: {
    tagline: 'Zero-Knowledge-sichere Zustellung',
    trustModelLink: 'Vertrauensmodell',
    backToCreate: 'Zur Erstellung zurück',
    sourceCode: 'GitHub',
    inAppBrowserWarning:
      'Für die beste Sicherheit öffne ZeroLink in einem eigenständigen Browser (Safari, Chrome, Firefox) und nicht in Telegram, Instagram oder anderen In-App-Browsern.',
  },

  create: {
    title: 'Sicheren Kanal erstellen',
    description:
      'Zero-Knowledge-verschlüsselte Zustellung. Wähle Quick Share (Passwort) oder Secure Share (Passkey).',
    chooseModeTitle: 'Freigabemodus wählen',
    quickShareTitle: 'Quick Share',
    quickShareDescription: 'Passwortgeschützt — kein Passkey nötig. Funktioniert in jedem Browser.',
    secureShareTitle: 'Secure Share',
    secureShareDescriptionAvailable:
      'Passkey-geschützt — stärkste Sicherheit mit Benutzerverifizierung.',
    secureShareDescriptionUnavailable:
      'Erfordert WebAuthn-Unterstützung (in dieser Umgebung nicht verfügbar).',
    secureShareHint:
      'Dieser Passkey wird nur für diesen Kanal verwendet. Falls er in deinem Passkey-Manager erscheint, kannst du ihn nach Ablauf des Kanals sicher löschen.',
    webauthnBlockedTitle: 'WebAuthn ist in dieser Umgebung nicht verfügbar.',
    webauthnBlockedBody: 'Secure Share ist deaktiviert. Verwende stattdessen Quick Share.',
    howItWorksLabel: 'So funktioniert es',
    step1Title: 'Erstellen',
    step1Desc: 'Wähle einen Modus und erstelle den verschlüsselten Kanal.',
    step2Title: 'Teilen',
    step2Desc: 'Sende den Freigabelink an den Empfänger.',
    step3Title: 'Sperren',
    step3Desc: 'Der Empfänger legt auf seinem Gerät eine Passphrase fest und sperrt den Kanal.',
    step4Title: 'Prüfen',
    step4Desc:
      'Vergleiche den Sicherheitscode über einen separaten Kanal, um die Identität des Empfängers zu bestätigen.',
    step5Title: 'Zustellen',
    step5Desc: 'Stelle das verschlüsselte Geheimnis an den gesperrten Empfänger zu.',
    step6Title: 'Entschlüsseln',
    step6Desc:
      'Der Empfänger entschlüsselt das Geheimnis lokal auf dem Gerät, das die Sperre erstellt hat.',
    trustHintBody:
      'Brauchst du eine verständliche Zusammenfassung dazu, was lokal bleibt, was der Sender tun kann und wann Kanaldaten verschwinden?',
    trustHintLink: 'Vertrauensmodell lesen',
    passwordPanelTitle: 'Quick-Share-Passwort festlegen',
    passwordPanelBody:
      'Dieses Passwort schützt deinen Kanalverwaltungsschlüssel. Verwende mindestens 4 zufällige Wörter oder mindestens 12 Zeichen. Es kann bei Verlust nicht wiederhergestellt werden.',
    expiryTitle: 'Kanalablauf',
    expiryDescription: 'Wähle, wie lange dieser Kanal nach der Erstellung verfügbar bleibt.',
    ttlOneHour: '1 Stunde',
    ttlOneDay: '24 Stunden',
    ttlSevenDays: '7 Tage',
    passwordLabel: 'Kanalpasswort',
    passwordPlaceholder: 'Starkes Passwort eingeben',
    footerHintPasswordRequired: 'Gib ein Kanalpasswort mit mindestens 12 Zeichen ein.',
    footerHintPasswordInvalid:
      'Verwende für das Kanalpasswort mindestens 4 zufällige Wörter oder mindestens 12 Zeichen.',
    footerHintReady: 'Bereit, einen {{mode}}-Kanal zu erstellen, der in {{ttl}} abläuft.',
    submitButton: 'Kanal erstellen',
    submittingButton: 'Wird erstellt\u2026',
    successTitle: 'Kanal erfolgreich erstellt',
    successModeLabel: 'Modus:',
    passwordProtectedBadge: 'Passwortgeschützt',
    createAnother: 'Weiteren erstellen',
    createAnotherConfirmBody:
      'Hast du sowohl den Freigabelink als auch den privaten Verwaltungslink gespeichert? Wenn du diesen Bildschirm jetzt verlässt, kannst du sie hier möglicherweise nicht erneut anzeigen.',
    createAnotherConfirmCancel: 'Abbrechen',
    createAnotherConfirmContinue: 'Gespeichert, fortfahren',
    shareLinkLabel: 'Freigabelink — an Empfänger senden',
    shareLinkWarningTitle: 'Dieser Freigabelink wird nur einmal angezeigt.',
    shareLinkWarningBody:
      'Speichere ihn jetzt. In dieser Browsersitzung kann die Sender-Verwaltungsseite ihn erneut kopieren, solange der Kanal noch wartet. Außerhalb dieses Fensters musst du bei Verlust einen neuen Kanal erstellen.',
    manageLinkLabel: 'Verwaltungslink — privat aufbewahren',
    expiryHint:
      'Der Kanal läuft in {{duration}} ab. Stimme dich mit dem Empfänger ab, bevor er verschwindet.',
    copyButton: 'Kopieren',
    copiedButton: 'Kopiert',
    errorProfileBlocked: 'Secure Share erfordert WebAuthn-Unterstützung in deiner Umgebung.',
    errorNotAllowed:
      'Die Passkey-Abfrage wurde abgebrochen oder verweigert. Bitte erneut versuchen.',
    errorNetwork: 'Netzwerkfehler beim Erstellen des Kanals. Bitte erneut versuchen.',
    errorBadRequest: 'Die Erstellungsanfrage wurde abgelehnt. Bitte erneut versuchen.',
    errorDefault: 'Ein unerwarteter Fehler ist aufgetreten. Bitte erneut versuchen.',
  },

  profile: {
    quick: 'Quick Share',
    secure: 'Secure Share',
  },

  manage: {
    headerTitle: 'Verwalten / Zustellen',
    headerDescription: 'Senderseitige Verifizierung und Zustellsteuerung (integrierter Ablauf).',
    channelIdLabel: 'Kanal-ID:',
    channelIdMissing: '(fehlt)',
    waitingTitle: 'Warten auf Empfängersperre',
    waitingBody:
      'Der Empfänger hat den Kanal noch nicht gesperrt. Teile den Link; diese Seite aktualisiert sich automatisch, sobald die Sperre gesetzt wurde.',
    lockedTitle: 'Empfänger hat den Kanal gesperrt',
    lockedBody:
      'Prüfe den Sicherheitscode außerhalb dieses Kanals, bevor du das Geheimnis zustellst.',
    deliveredTitle: 'Zustellung abgeschlossen',
    deliveredBody:
      'Der Geheimtext wurde an den Empfängerablauf zugestellt. Die Entschlüsselung auf Empfängerseite erfolgt lokal und sendet hierher keine Bestätigung.',
    deletedTitle: 'Kanal gelöscht',
    deletedBody: 'Du hast diesen Kanal gelöscht. Er kann nicht mehr zustellen oder entschlüsseln.',
    expiredTitle: 'Kanal abgelaufen',
    expiredBody:
      'Dieser Kanal ist abgelaufen. Er kann nicht mehr für Zustellung oder Entschlüsselung verwendet werden.',
    unavailableBody: 'Dieser Kanal wurde zerstört, ist abgelaufen oder existiert nicht.',
    safetyUnavailableTitle: 'Sicherheitscode derzeit nicht verfügbar.',
    safetyUnavailableBody:
      'Im aktuellen Kanalzustand fehlt der Empfänger-Fingerprint, daher kann der Sicherheitscode nicht angezeigt werden.',
    deliveryModeText: 'Text',
    deliveryModeFile: 'Datei',
    secretLabel: 'Zuzustellendes Geheimnis',
    secretPlaceholder: 'Geheimnis hier eingeben oder einfügen',
    fileLabel: 'Zuzustellende Datei',
    fileClearButton: 'Datei entfernen',
    fileSizeLimit: 'Maximale Dateigröße: {{size}}',
    fileSizeLimitLoading: 'Dateigrößenlimit wird geprüft\u2026',
    softkeyPassphraseHint:
      'Dieser Kanal verwendet einen passwortgeschützten Verwaltungsschlüssel. Gib das Passwort ein, das du beim Erstellen dieses Kanals festgelegt hast.',
    softkeyLabel: 'Kanalpasswort',
    softkeyPlaceholder: 'Kanalpasswort eingeben',
    softkeyMinLengthHint: 'Gib ein Kanalpasswort mit mindestens {{min}} Zeichen ein',
    deliverButton: 'Zustellen',
    deliveringButton: 'Wird zugestellt\u2026',
    deleteChannelButton: 'Kanal löschen',
    destroyConfirmTitle: 'Diesen Kanal dauerhaft löschen?',
    destroyConfirmBody:
      'Dies kann nicht rückgängig gemacht werden. Alle Kanaldaten werden vom Server entfernt.',
    destroyCancelButton: 'Abbrechen',
    destroyConfirmButton: 'Löschen bestätigen',
    destroyDeletingButton: 'Wird gelöscht\u2026',
    createNewButton: 'Neuen Kanal erstellen',
    deliveredToast: 'Geheimnis erfolgreich zugestellt.',
    shareLinkRecoveryTitle: 'Empfängerlink erneut senden?',
    shareLinkRecoveryBody:
      'Diese Browsersitzung enthält noch den einmaligen Empfängerlink. Du kannst ihn erneut kopieren, bis der Empfänger den Kanal sperrt.',
    shareLinkRecoveryButton: 'Empfängerlink kopieren',
    shareLinkRecoveryCopied: 'Empfängerlink kopiert',
  },

  share: {
    channelIdLabel: 'Kanal-ID:',
    channelIdMissing: '(fehlt)',
    headerDefaultTitle: 'Empfängerkanal',
    headerDefaultDescription:
      'Öffne diesen Empfängerlink auf dem Gerät, das den Kanal sperren und später das zugestellte Geheimnis lokal entschlüsseln soll.',
    headerWaitingTitle: 'Empfänger-Einrichtung',
    headerWaitingDescription:
      'Der Sender hat diesen Kanal bereits erstellt. Lege hier deine eigene Passphrase fest, um deinen Empfängerschlüssel zu erzeugen und den Kanal auf diesem Gerät zu sperren.',
    headerLockedTitle: 'Empfängerkanal',
    headerLockedDescription:
      'Dieser Empfängerkanal ist gesperrt. Diese Seite aktualisiert sich automatisch, aber nur das Gerät, das die Sperre erstellt hat, kann den unten angezeigten Sicherheitscode prüfen.',
    headerDeliveredTitle: 'Zugestelltes Geheimnis entschlüsseln',
    headerDeliveredDescription:
      'Wenn dieses Gerät die Empfängersperre erstellt hat, gib diese Passphrase ein, um das Geheimnis lokal zu entschlüsseln.',
    headerUnavailableTitle: 'Empfängerkanal',
    headerUnavailableDescription: 'Dieser Empfängerlink ist nicht verfügbar oder nicht mehr aktiv.',
    loadingTitle: 'Kanalzustand wird geladen',
    loadingBody: 'Sicherer Kanalstatus für diesen Link wird abgerufen.',
    unavailableBody: 'Dieser Kanal wurde zerstört, ist abgelaufen oder existiert nicht.',
    stepIntro: 'Empfänger-Einführung',
    stepPassphrase: 'Deine Passphrase',
    stepReady: 'Bereit für Zustellung',
    stepIndicator: 'Schritt {{current}} von {{total}} — {{label}}',
    onboardingTitle: 'Empfängersperre einrichten',
    onboarding1Title: 'Diese Seite ist nur für den Empfänger mit dem geteilten Link bestimmt.',
    onboarding1Desc: 'Der Sender hat den Kanal bereits erstellt und dir diesen Link gesendet.',
    onboarding2Title: 'Deine Passphrase bleibt auf diesem Gerät',
    onboarding2Desc: 'Sie wird nie an den Server gesendet oder mit dem Sender geteilt.',
    onboarding3Title: 'Beim Sperren wird dein Empfängerschlüssel lokal erstellt',
    onboarding3Desc: 'Nach dem Sperren kann der Sender nur an deine Empfängeridentität zustellen.',
    continueButton: 'Als Empfänger fortfahren',
    lockTitle: 'Wähle deine Passphrase',
    lockLabel: 'Deine Passphrase',
    lockPlaceholder: 'Passphrase eingeben',
    privateModeNoticeBody:
      'Wenn du den privaten oder Inkognito-Modus verwendest, existiert dein Entschlüsselungsschlüssel nur in diesem Fenster. Wenn du es schließt, verlierst du den Zugriff dauerhaft. Kopiere zuerst diesen Link, wenn du zu einem normalen Browser wechseln möchtest.',
    privateModeNoticeCopy: 'Link kopieren',
    privateModeNoticeCopied: 'Kopiert!',
    backButton: 'Zurück',
    generateButton: 'Meinen Schlüssel erzeugen & sperren',
    lockingButton: 'Wird gesperrt\u2026',
    lockedTitle: 'Empfängerkanal ist gesperrt',
    lockedBody:
      'Prüfe den Sicherheitscode mit dem Sender nur dann, wenn dieses Gerät ihn unten anzeigt.',
    nextStepsLabel: 'Nächste Schritte',
    nextStep1:
      'Der Sicherheitscode kann nur auf dem Gerät geprüft werden, das diesen Kanal gesperrt hat.',
    nextStep2: 'Bestätige und prüfe den Sicherheitscode mit dem Sender über einen anderen Kanal.',
    nextStepNote:
      'Diese Seite wird automatisch aktualisiert, wenn der Sender den Geheimtext zustellt.',
    deliveredTitle: 'Kanal zugestellt',
    deliveredBody:
      'Das verschlüsselte Geheimnis wurde zugestellt. Für die Entschlüsselung ist weiterhin das Gerät erforderlich, das die Empfängersperre erstellt hat.',
    deliveredAtLabel: 'Zugestellt:',
    updatedBadge:
      'Aktualisiert (v{{version}}) \u00b7 Der Sender hat diesen Inhalt möglicherweise geändert. Die neueste Version wird angezeigt.',
    decryptLabel: 'Passphrase zum Entschlüsseln',
    decryptPlaceholder: 'Passphrase zum Entschlüsseln eingeben',
    decryptMinLengthHint: 'Gib eine Passphrase mit mindestens {{min}} Zeichen ein',
    decryptButton: 'Entschlüsseln',
    decryptingButton: 'Wird entschlüsselt\u2026',
    burnButton: 'Lokale Kopie löschen',
    plaintextLabel: 'Klartext',
    fileLabel: 'Entschlüsselte Datei',
    fileNameLabel: 'Name',
    fileSizeLabel: 'Größe',
    fileTypeLabel: 'Typ',
    fileDownloadButton: 'Datei herunterladen',
    fileDownloadHint:
      'ZeroLink zeigt keine Dateivorschau an. Der Download erfolgt erst nach deinem Klick.',
    cipherVersionNotice:
      'Der Inhalt wurde aktualisiert. Du bist dabei, die neueste Version zu entschlüsseln.',
    burnedTitle: 'Lokale entschlüsselte Kopie von diesem Gerät entfernt.',
    burnedBody:
      'Dies löscht den Kanal nicht und markiert ihn nicht als abgelaufen. Gib deine Passphrase erneut ein, um wieder zu entschlüsseln.',
    burnedToast: 'Lokale entschlüsselte Kopie entfernt.',
    safetyCheckingTitle: 'Dieses Gerät wird auf den Empfängerschlüssel geprüft\u2026',
    safetyCheckingBody:
      'ZeroLink zeigt den Sicherheitscode erst an, nachdem bestätigt wurde, dass dieses Gerät die aktuelle Sperre erstellt hat.',
    safetyMissingTitle: 'Dieses Gerät kann den Sicherheitscode nicht prüfen.',
    safetyMissingBody:
      'Auf diesem Gerät wurde kein passender Empfängerschlüssel gefunden. Bestätige den Sicherheitscode nicht von hier aus. Wenn du der erwartete Empfänger bist, bitte den Sender, den Kanal neu zu erstellen.',
    safetyMismatchedTitle: 'Abweichende Empfängeridentität erkannt.',
    safetyMismatchedBody:
      'Dieses Gerät hat anderes lokales Empfängerschlüsselmaterial als der aktuell auf dem Kanal gesperrte Schlüssel. Behandle diesen Link als unsicher und bitte den Sender, den Kanal neu zu erstellen.',
    safetyStorageErrorTitle: 'Lokaler Empfängerschlüssel kann nicht geprüft werden.',
    safetyStorageErrorBody:
      'ZeroLink konnte das auf diesem Gerät gespeicherte Empfängerschlüsselmaterial nicht lesen, daher kann der Sicherheitscode hier nicht geprüft werden.',
    safetyUnavailableTitle: 'Sicherheitscode derzeit nicht verfügbar.',
    safetyUnavailableBody:
      'Im aktuellen Kanalzustand fehlt der Empfänger-Fingerprint, daher kann der Sicherheitscode hier nicht geprüft werden.',
    decryptCheckingTitle: 'Dieses Gerät wird vor dem Aktivieren der Entschlüsselung geprüft\u2026',
    decryptCheckingBody:
      'ZeroLink prüft, ob dieses Gerät den für die lokale Entschlüsselung nötigen Empfängerschlüssel besitzt.',
    decryptMismatchedTitle: 'Entschlüsselung auf diesem Gerät blockiert.',
    decryptMismatchedBody:
      'Der auf diesem Gerät gespeicherte Empfängerschlüssel stimmt nicht mit dem aktuell auf dem Kanal gesperrten Schlüssel überein. Behandle diesen Link als unsicher und bitte den Sender, den Kanal neu zu erstellen.',
    decryptStorageErrorTitle: 'Lokaler Empfängerschlüssel kann nicht geladen werden.',
    decryptStorageErrorBody:
      'ZeroLink konnte den auf diesem Gerät gespeicherten Empfängerschlüssel nicht lesen, daher ist die lokale Entschlüsselung hier nicht verfügbar.',
    decryptUnavailableTitle: 'Entschlüsselung auf diesem Gerät nicht verfügbar.',
    decryptUnavailableBody:
      'Dieses Gerät hat nicht den Empfängerschlüssel, der den Kanal gesperrt hat, daher ist die lokale Entschlüsselung hier blockiert.',
  },

  trust: {
    badge: 'Vertrauensmodell',
    title: 'Was ZeroLink wissen kann und was nicht',
    description:
      'Eine kompakte Zusammenfassung dazu, was auf deinem Gerät bleibt, was der Sender steuern kann und wann ein Kanal verschwindet.',
    section1Title: 'Was der Server nie erhält',
    section1Body:
      'Der Server erhält nie das URL-Fragment (#k=...), die Empfänger-Passphrase, den privaten Empfängerschlüssel oder entschlüsselten Klartext. Diese bleiben außerhalb des serverseitigen Anfragepfads.',
    section2Title: 'Was der Server in jeder Phase speichert',
    section2Body:
      'Bei der Erstellung: Kanalmetadaten, Ablaufzeit und Admin-Authentifizierungsmaterial. Nach der Sperre: öffentlichen Empfängerschlüssel und Fingerprint. Nach der Zustellung: Geheimtext, den der Empfänger abrufen kann.',
    section3Title: 'Was der Sender steuern kann',
    section3Body:
      'Der Sender kann einen Kanal erstellen, den Empfängerlink teilen, Geheimtext zustellen und den Kanal löschen. Der Sender kann die Empfänger-Passphrase nicht lesen, den privaten Empfängerschlüssel nicht einsehen und den entschlüsselten Klartext auf dem Empfängergerät nicht sehen.',
    section4Title: 'Was der Verwaltungslink enthält',
    section4Body:
      'Quick Share bettet einen verpackten Admin-Schlüssel in den Verwaltungslink selbst ein (das URL-Fragment). Jeder, der diesen Link und das Kanalpasswort besitzt, kann den Kanal von jedem Gerät aus zustellen oder löschen. Wenn du den Verwaltungslink verlierst, gibt es keine Möglichkeit, ihn wiederherzustellen.',
    section5Title: 'Was auf dem Empfängergerät bleibt',
    section5Body:
      'Das Empfängergerät speichert für diesen Kanal einen verpackten privaten Empfängerschlüssel in IndexedDB. Klartext erscheint nur nach der Entschlüsselung auf dem lokalen Gerät. Der Kanalstatus kann dem Sender den Empfänger-Fingerprint anzeigen, aber die Empfängerseite sollte einen Sicherheitscode erst anzeigen, nachdem dieses Gerät nachgewiesen hat, dass es den passenden lokalen Empfängerschlüssel besitzt.',
    section6Title: 'Löschen, Ablauf, lokales Löschen und Verified Release',
    section6Body:
      'Kanäle laufen nach der gewählten TTL ab, maximal nach 7 Tagen. Eine Sender-Löschung entfernt Geheimtext und hinterlässt einen Tombstone, um Wiederbelebung zu verhindern. Lokales Löschen entfernt nur den Klartext von diesem Gerät — der Kanal bleibt aktiv. Verified Release bedeutet, dass der Build die signierte Release-Verifizierung bestanden hat; fehlt dieser Hinweis, hat er sie nicht bestanden.',
    backButton: 'Zurück',
    createButton: 'Sicheren Kanal erstellen',
  },

  notFound: {
    title: 'Seite nicht gefunden',
    description: 'Diese Route existiert in der aktuellen App-Shell nicht.',
    hint: 'Prüfe die URL und versuche es erneut.',
    backButton: 'Zur Erstellung zurück',
  },

  channel: {
    unavailableTitle: 'Kanal nicht verfügbar',
  },

  role: {
    sender: 'Sender',
    receiver: 'Empfänger',
  },

  status: {
    waiting: 'Warten auf Sperre',
    locked: 'Vom Empfänger gesperrt',
    delivered: 'Zugestellt',
    deleted: 'Gelöscht',
    expired: 'Abgelaufen',
  },

  passphrase: {
    defaultLabel: 'Passphrase',
    defaultPlaceholder: 'Passphrase eingeben',
    showButton: 'Passphrase anzeigen',
    hideButton: 'Passphrase ausblenden',
    policyHint: 'Verwende mindestens 4 zufällige Wörter oder mindestens 12 Zeichen',
    errorRequired: '{{label}} ist erforderlich',
    errorTooShort: '{{label}} muss mindestens {{min}} Zeichen lang sein',
    errorTooLong: '{{label}} darf höchstens {{max}} Zeichen lang sein',
    errorInvalidWhitespace:
      '{{label}} darf normale Leerzeichen zwischen Wörtern verwenden, aber keine Tabs, Zeilenumbrüche oder Sonderleerzeichen',
    strengthLabel: 'Passphrase-Stärke',
    weak: 'Schwach',
    medium: 'Mittel',
    strong: 'Stark',
  },

  safetyCode: {
    title: 'Sicherheitscode',
    verifyHint: 'Prüfe diesen Code über einen anderen Kanal (Telefon, Videoanruf)',
    emojiTab: 'Emoji',
    colorTab: 'Farben',
    advancedToggle: 'Erweiterter Fingerprint',
    shortFprLabel: 'Kurzer Fingerprint',
    fullFprLabel: 'Vollständiger Hex-Fingerprint',
  },

  lang: {
    switcherLabel: 'Sprache auswählen',
    menuLabel: 'Sprache',
  },

  manageError: {
    notFound: 'Dieser Kanal ist nicht mehr verfügbar.',
    fallbackRequired:
      'Passwortverwaltete Kanäle sind für diese Aktion im aktuellen Build nicht verfügbar.',
    profileBlocked: 'Das ausgewählte Sicherheitsprofil erfordert WebAuthn-Unterstützung.',
    missingLockChallenge:
      'Challenge konnte nicht vom Server abgerufen werden. Bitte erneut versuchen.',
    missingReceiverIdentity:
      'Empfängeridentität ist nicht verfügbar. Bitte den Empfänger, erneut zu sperren.',
    networkError: 'Netzwerkfehler beim Ausführen der Verwaltungsaktion. Bitte erneut versuchen.',
    badRequest: 'Die Verwaltungsanfrage wurde abgelehnt. Bitte erneut versuchen.',
    fileTooLarge: 'Die ausgewählte Datei überschreitet das Limit von 5 MiB.',
    fileStorageUnavailable: 'Diese Bereitstellung unterstützt keine Datei-Uploads.',
    multipartRequired: 'Die ausgewählte Datei ist größer als das Limit für Inline-Zustellung.',
    webauthnError: 'WebAuthn-Verifizierung wurde nicht abgeschlossen.',
    cryptoError: 'Falsches Kanalpasswort. Bitte erneut versuchen.',
    internalError: 'Unerwarteter interner Fehler. Bitte erneut versuchen.',
    default: 'Ein unerwarteter Fehler ist aufgetreten. Bitte erneut versuchen.',
  },

  manifest: {
    title: 'Verified Release',
    verifiedBadge: 'Verifiziert',
    body: 'Diese Seite entspricht einem offiziellen ZeroLink-Release, das von unserem Team signiert wurde.',
    fingerprintLabel: 'Release-Fingerprint:',
    showDetails: 'Verifizierungsdetails anzeigen',
    hideDetails: 'Verifizierungsdetails ausblenden',
    statusLabel: 'Status',
    versionLabel: 'App-Version',
    buildDateLabel: 'Build-Datum',
    commitLabel: 'Commit',
    manifestHashLabel: 'Manifest-Hash',
    filesLabel: 'Verifizierte Dateien',
    publisherKeyLabel: 'Publisher-Key-Fingerprint',
    signatureLabel: 'Signatur',
    externalLinkLabel: 'wird in einem neuen Tab geöffnet',
  },
};

export default de;
