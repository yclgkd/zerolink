import type { Translation } from './en';

const fr: Translation = {
  shell: {
    tagline: 'Transmission sécurisée à connaissance zéro',
    trustModelLink: 'Modèle de confiance',
    backToCreate: 'Retour à la création',
    sourceCode: 'GitHub',
    inAppBrowserWarning:
      'Pour une sécurité optimale, ouvrez ZeroLink dans un navigateur autonome (Safari, Chrome, Firefox), et non dans Telegram, Instagram ou un autre navigateur intégré.',
  },

  create: {
    title: 'Créer un canal sécurisé',
    description:
      'Transmission chiffrée à connaissance zéro. Choisissez Partage rapide (mot de passe) ou Partage sécurisé (clé d’accès).',
    chooseModeTitle: 'Choisir le mode de partage',
    quickShareTitle: 'Partage rapide',
    quickShareDescription:
      'Protégé par mot de passe — aucune clé d’accès requise. Fonctionne dans tous les navigateurs.',
    secureShareTitle: 'Partage sécurisé',
    secureShareDescriptionAvailable:
      'Protégé par clé d’accès — sécurité maximale avec vérification de l’utilisateur.',
    secureShareDescriptionUnavailable:
      'Nécessite la prise en charge de WebAuthn (indisponible dans cet environnement).',
    secureShareHint:
      'Cette clé d’accès est utilisée uniquement pour ce canal. Si elle apparaît dans votre gestionnaire de clés d’accès, vous pouvez la supprimer en toute sécurité après l’expiration du canal.',
    webauthnBlockedTitle: 'WebAuthn n’est pas disponible dans cet environnement.',
    webauthnBlockedBody: 'Le partage sécurisé est désactivé. Utilisez plutôt le partage rapide.',
    howItWorksLabel: 'Fonctionnement',
    step1Title: 'Créer',
    step1Desc: 'Choisissez un mode et créez le canal chiffré.',
    step2Title: 'Partager',
    step2Desc: 'Envoyez le lien de partage au destinataire.',
    step3Title: 'Verrouiller',
    step3Desc:
      'Le destinataire définit une phrase secrète sur son appareil et verrouille le canal.',
    step4Title: 'Vérifier',
    step4Desc:
      'Comparez le code de sécurité via un canal séparé pour confirmer l’identité du destinataire.',
    step5Title: 'Transmettre',
    step5Desc: 'Transmettez le secret chiffré au destinataire verrouillé.',
    step6Title: 'Déchiffrer',
    step6Desc:
      'Le destinataire déchiffre le secret localement sur l’appareil qui a créé le verrouillage.',
    trustHintBody:
      'Besoin d’un résumé clair de ce qui reste local, de ce que l’expéditeur peut faire et du moment où les données du canal disparaissent ?',
    trustHintLink: 'Lire le modèle de confiance',
    passwordPanelTitle: 'Définir un mot de passe de partage rapide',
    passwordPanelBody:
      'Ce mot de passe protège votre clé de gestion du canal. Utilisez au moins 4 mots aléatoires ou au moins 12 caractères. Il ne peut pas être récupéré en cas de perte.',
    expiryTitle: 'Expiration du canal',
    expiryDescription: 'Choisissez combien de temps ce canal reste disponible après sa création.',
    ttlOneHour: '1 heure',
    ttlOneDay: '24 heures',
    ttlSevenDays: '7 jours',
    passwordLabel: 'Mot de passe du canal',
    passwordPlaceholder: 'Saisir un mot de passe robuste',
    footerHintPasswordRequired: 'Saisissez un mot de passe de canal d’au moins 12 caractères.',
    footerHintPasswordInvalid:
      'Utilisez au moins 4 mots aléatoires ou au moins 12 caractères pour le mot de passe du canal.',
    footerHintReady: 'Prêt à créer un canal {{mode}} qui expire dans {{ttl}}.',
    submitButton: 'Créer le canal',
    submittingButton: 'Création\u2026',
    successTitle: 'Canal créé avec succès',
    successModeLabel: 'Mode :',
    passwordProtectedBadge: 'Protégé par mot de passe',
    createAnother: 'En créer un autre',
    createAnotherConfirmBody:
      'Avez-vous enregistré à la fois le lien de partage et le lien privé de gestion ? Si vous quittez cet écran maintenant, vous ne pourrez peut-être plus les revoir ici.',
    createAnotherConfirmCancel: 'Annuler',
    createAnotherConfirmContinue: 'Je les ai enregistrés, continuer',
    shareLinkLabel: 'Lien de partage — à envoyer au destinataire',
    shareLinkWarningTitle: 'Ce lien de partage n’est affiché qu’une seule fois.',
    shareLinkWarningBody:
      'Enregistrez-le maintenant. Dans cette session de navigateur, la page de gestion de l’expéditeur peut le recopier tant que le canal est encore en attente. En dehors de cette fenêtre, si vous le perdez, créez un nouveau canal.',
    manageLinkLabel: 'Lien de gestion — à garder privé',
    expiryHint:
      'Le canal expire dans {{duration}}. Coordonnez-vous avec le destinataire avant sa disparition.',
    copyButton: 'Copier',
    copiedButton: 'Copié',
    errorProfileBlocked:
      'Le partage sécurisé nécessite la prise en charge de WebAuthn dans votre environnement.',
    errorNotAllowed: 'La demande de clé d’accès a été annulée ou refusée. Veuillez réessayer.',
    errorNetwork: 'Erreur réseau lors de la création du canal. Veuillez réessayer.',
    errorBadRequest: 'La demande de création a été rejetée. Veuillez réessayer.',
    errorDefault: 'Une erreur inattendue est survenue. Veuillez réessayer.',
  },

  profile: {
    quick: 'Partage rapide',
    secure: 'Partage sécurisé',
  },

  manage: {
    headerTitle: 'Gérer / Transmettre',
    headerDescription:
      'Contrôles de vérification et de transmission côté expéditeur (flux intégré).',
    channelIdLabel: 'ID du canal :',
    channelIdMissing: '(manquant)',
    waitingTitle: 'En attente du verrouillage par le destinataire',
    waitingBody:
      'Le destinataire n’a pas encore verrouillé le canal. Partagez le lien ; cette page se mettra automatiquement à jour dès qu’il l’aura fait.',
    lockedTitle: 'Le destinataire a verrouillé le canal',
    lockedBody: 'Vérifiez le code de sécurité hors bande avant de transmettre le secret.',
    deliveredTitle: 'Transmission terminée',
    deliveredBody:
      'Le texte chiffré a été transmis au flux du destinataire. Le déchiffrement côté destinataire se fait localement et n’envoie aucune confirmation ici.',
    deletedTitle: 'Canal supprimé',
    deletedBody:
      'Vous avez supprimé ce canal. Il ne peut plus transmettre ni déchiffrer de contenu.',
    expiredTitle: 'Canal expiré',
    expiredBody:
      'Ce canal a expiré. Il ne peut plus être utilisé pour la transmission ou le déchiffrement.',
    unavailableBody: 'Ce canal a été détruit, a expiré ou n’existe pas.',
    safetyUnavailableTitle: 'Code de sécurité indisponible pour le moment.',
    safetyUnavailableBody:
      'L’empreinte du destinataire manque dans l’état actuel du canal ; le code de sécurité ne peut donc pas être affiché.',
    deliveryModeText: 'Texte',
    deliveryModeFile: 'Fichier',
    secretLabel: 'Secret à transmettre',
    secretPlaceholder: 'Saisissez ou collez votre secret ici',
    fileLabel: 'Fichier à transmettre',
    fileClearButton: 'Retirer le fichier',
    fileSizeLimit: 'Taille maximale du fichier : {{size}}',
    fileSizeLimitLoading: 'Vérification de la limite de taille du fichier\u2026',
    softkeyPassphraseHint:
      'Ce canal utilise une clé de gestion protégée par mot de passe. Saisissez le mot de passe défini lors de la création de ce canal.',
    softkeyLabel: 'Mot de passe du canal',
    softkeyPlaceholder: 'Saisir le mot de passe du canal',
    softkeyMinLengthHint: 'Saisissez un mot de passe de canal d’au moins {{min}} caractères',
    deliverButton: 'Transmettre',
    deliveringButton: 'Transmission\u2026',
    deleteChannelButton: 'Supprimer le canal',
    destroyConfirmTitle: 'Supprimer définitivement ce canal ?',
    destroyConfirmBody:
      'Cette action est irréversible. Toutes les données du canal seront supprimées du serveur.',
    destroyCancelButton: 'Annuler',
    destroyConfirmButton: 'Confirmer la suppression',
    destroyDeletingButton: 'Suppression\u2026',
    createNewButton: 'Créer un nouveau canal',
    deliveredToast: 'Secret transmis avec succès.',
    shareLinkRecoveryTitle: 'Besoin de renvoyer le lien du destinataire ?',
    shareLinkRecoveryBody:
      'Cette session de navigateur contient encore le lien destinataire à usage unique. Vous pouvez le copier à nouveau jusqu’à ce que le destinataire verrouille le canal.',
    shareLinkRecoveryButton: 'Copier le lien destinataire',
    shareLinkRecoveryCopied: 'Lien destinataire copié',
  },

  share: {
    channelIdLabel: 'ID du canal :',
    channelIdMissing: '(manquant)',
    headerDefaultTitle: 'Canal destinataire',
    headerDefaultDescription:
      'Ouvrez ce lien destinataire sur l’appareil qui verrouillera le canal et déchiffrera ensuite localement le secret transmis.',
    headerWaitingTitle: 'Configuration du destinataire',
    headerWaitingDescription:
      'L’expéditeur a déjà créé ce canal. Définissez ici votre propre phrase secrète pour générer votre clé de destinataire et verrouiller le canal sur cet appareil.',
    headerLockedTitle: 'Canal destinataire',
    headerLockedDescription:
      'Ce canal destinataire est verrouillé. Cette page se met à jour automatiquement, mais seul l’appareil qui a créé le verrouillage peut vérifier le code de sécurité ci-dessous.',
    headerDeliveredTitle: 'Déchiffrer le secret transmis',
    headerDeliveredDescription:
      'Si cet appareil a créé le verrouillage du destinataire, saisissez cette phrase secrète pour déchiffrer le secret localement.',
    headerUnavailableTitle: 'Canal destinataire',
    headerUnavailableDescription: 'Ce lien destinataire est indisponible ou n’est plus actif.',
    loadingTitle: 'Chargement de l’état du canal',
    loadingBody: 'Récupération de l’état du canal sécurisé pour ce lien.',
    unavailableBody: 'Ce canal a été détruit, a expiré ou n’existe pas.',
    stepIntro: 'Introduction destinataire',
    stepPassphrase: 'Votre phrase secrète',
    stepReady: 'Prêt pour la transmission',
    stepIndicator: 'Étape {{current}} sur {{total}} — {{label}}',
    onboardingTitle: 'Configuration du verrouillage destinataire',
    onboarding1Title: 'Cette page est réservée au destinataire qui utilise le lien partagé.',
    onboarding1Desc: 'L’expéditeur a déjà créé le canal et vous a envoyé ce lien.',
    onboarding2Title: 'Votre phrase secrète reste sur cet appareil',
    onboarding2Desc: 'Elle n’est jamais envoyée au serveur ni partagée avec l’expéditeur.',
    onboarding3Title: 'Le verrouillage crée localement votre clé de destinataire',
    onboarding3Desc:
      'Après le verrouillage, l’expéditeur ne peut transmettre qu’à votre identité de destinataire.',
    continueButton: 'Continuer comme destinataire',
    lockTitle: 'Choisissez votre phrase secrète',
    lockLabel: 'Votre phrase secrète',
    lockPlaceholder: 'Saisir votre phrase secrète',
    privateModeNoticeBody:
      'Si vous êtes en navigation privée ou incognito, votre clé de déchiffrement n’existera que dans cette fenêtre. La fermer vous fera perdre définitivement l’accès. Pour passer à un navigateur normal, copiez d’abord ce lien.',
    privateModeNoticeCopy: 'Copier le lien',
    privateModeNoticeCopied: 'Copié !',
    backButton: 'Retour',
    generateButton: 'Générer ma clé et verrouiller',
    lockingButton: 'Verrouillage\u2026',
    lockedTitle: 'Le canal destinataire est verrouillé',
    lockedBody:
      'Vérifiez le code de sécurité avec l’expéditeur uniquement si cet appareil l’affiche ci-dessous.',
    nextStepsLabel: 'Étapes suivantes',
    nextStep1:
      'Le code de sécurité ne peut être vérifié que sur l’appareil qui a verrouillé ce canal.',
    nextStep2: 'Confirmez et vérifiez le code de sécurité avec l’expéditeur via un autre canal.',
    nextStepNote:
      'Cette page s’actualisera automatiquement lorsque l’expéditeur transmettra le texte chiffré.',
    deliveredTitle: 'Canal transmis',
    deliveredBody:
      'Le secret chiffré a été transmis. Le déchiffrement exige toujours l’appareil qui a créé le verrouillage destinataire.',
    deliveredAtLabel: 'Transmis :',
    updatedBadge:
      'Mis à jour (v{{version}}) \u00b7 L’expéditeur a peut-être modifié ce contenu. La dernière version est affichée.',
    decryptLabel: 'Phrase secrète de déchiffrement',
    decryptPlaceholder: 'Saisir la phrase secrète pour déchiffrer',
    decryptMinLengthHint: 'Saisissez une phrase secrète d’au moins {{min}} caractères',
    decryptButton: 'Déchiffrer',
    decryptingButton: 'Déchiffrement\u2026',
    burnButton: 'Effacer la copie locale',
    plaintextLabel: 'Texte en clair',
    fileLabel: 'Fichier déchiffré',
    fileNameLabel: 'Nom',
    fileSizeLabel: 'Taille',
    fileTypeLabel: 'Type',
    fileDownloadButton: 'Télécharger le fichier',
    fileDownloadHint:
      'ZeroLink ne prévisualise pas les fichiers. Le téléchargement ne se lance qu’après votre clic.',
    cipherVersionNotice:
      'Le contenu a été mis à jour. Vous êtes sur le point de déchiffrer la dernière version.',
    burnedTitle: 'Copie locale déchiffrée supprimée de cet appareil.',
    burnedBody:
      'Cela ne supprime pas le canal et ne le marque pas comme expiré. Saisissez de nouveau votre phrase secrète pour déchiffrer à nouveau.',
    burnedToast: 'Copie locale déchiffrée supprimée.',
    safetyCheckingTitle: 'Vérification de la clé destinataire sur cet appareil\u2026',
    safetyCheckingBody:
      'ZeroLink n’affiche le code de sécurité qu’après avoir confirmé que cet appareil a créé le verrouillage actuel.',
    safetyMissingTitle: 'Cet appareil ne peut pas vérifier le code de sécurité.',
    safetyMissingBody:
      'Aucune clé destinataire correspondante n’a été trouvée sur cet appareil. Ne confirmez pas le code de sécurité depuis ici. Si vous deviez être le destinataire, demandez à l’expéditeur de recréer le canal.',
    safetyMismatchedTitle: 'Incompatibilité d’identité destinataire détectée.',
    safetyMismatchedBody:
      'Cet appareil possède un matériel de clé destinataire local différent de la clé actuellement verrouillée sur le canal. Considérez ce lien comme non sûr et demandez à l’expéditeur de recréer le canal.',
    safetyStorageErrorTitle: 'Impossible de vérifier la clé destinataire locale.',
    safetyStorageErrorBody:
      'ZeroLink n’a pas pu lire le matériel de clé destinataire stocké sur cet appareil ; le code de sécurité ne peut donc pas être vérifié ici.',
    safetyUnavailableTitle: 'Code de sécurité indisponible pour le moment.',
    safetyUnavailableBody:
      'L’empreinte du destinataire manque dans l’état actuel du canal ; le code de sécurité ne peut donc pas être vérifié ici.',
    decryptCheckingTitle: 'Vérification de cet appareil avant d’activer le déchiffrement\u2026',
    decryptCheckingBody:
      'ZeroLink vérifie si cet appareil détient la clé destinataire nécessaire au déchiffrement local.',
    decryptMismatchedTitle: 'Déchiffrement bloqué sur cet appareil.',
    decryptMismatchedBody:
      'La clé destinataire stockée sur cet appareil ne correspond pas à la clé actuellement verrouillée sur le canal. Considérez ce lien comme non sûr et demandez à l’expéditeur de recréer le canal.',
    decryptStorageErrorTitle: 'Impossible de charger la clé destinataire locale.',
    decryptStorageErrorBody:
      'ZeroLink n’a pas pu lire la clé destinataire stockée sur cet appareil ; le déchiffrement local n’est donc pas disponible ici.',
    decryptUnavailableTitle: 'Déchiffrement indisponible sur cet appareil.',
    decryptUnavailableBody:
      'Cet appareil ne possède pas la clé destinataire qui a verrouillé le canal ; le déchiffrement local est donc bloqué ici.',
  },

  trust: {
    badge: 'Modèle de confiance',
    title: 'Ce que ZeroLink peut et ne peut pas savoir',
    description:
      'Un résumé compact de ce qui reste sur votre appareil, de ce que l’expéditeur peut contrôler et du moment où un canal disparaît.',
    section1Title: 'Ce que le serveur ne reçoit jamais',
    section1Body:
      'Le serveur ne reçoit jamais le fragment d’URL (#k=...), la phrase secrète du destinataire, la clé privée du destinataire ni le texte clair déchiffré. Ces éléments restent hors du chemin de requête côté serveur.',
    section2Title: 'Ce que le serveur stocke à chaque étape',
    section2Body:
      'À la création : métadonnées du canal, expiration et matériel d’authentification administrateur. Après verrouillage : clé publique et empreinte du destinataire. Après transmission : texte chiffré à récupérer par le destinataire.',
    section3Title: 'Ce que l’expéditeur peut contrôler',
    section3Body:
      'L’expéditeur peut créer un canal, partager le lien destinataire, transmettre le texte chiffré et supprimer le canal. Il ne peut pas lire la phrase secrète du destinataire, inspecter sa clé privée ni voir le texte clair déchiffré sur l’appareil du destinataire.',
    section4Title: 'Ce que contient le lien de gestion',
    section4Body:
      'Le partage rapide intègre une clé administrateur enveloppée dans le lien de gestion lui-même (le fragment d’URL). Toute personne qui possède ce lien et le mot de passe du canal peut transmettre ou supprimer le canal depuis n’importe quel appareil. Si vous perdez le lien de gestion, il n’existe aucun moyen de le récupérer.',
    section5Title: 'Ce qui reste sur l’appareil du destinataire',
    section5Body:
      'L’appareil du destinataire conserve dans IndexedDB une clé privée destinataire enveloppée pour ce canal. Le texte clair n’apparaît sur l’appareil local qu’après déchiffrement. L’état du canal peut exposer l’empreinte du destinataire à l’expéditeur, mais la page destinataire ne doit afficher un code de sécurité qu’après que cet appareil a prouvé qu’il détient la clé destinataire locale correspondante.',
    section6Title: 'Suppression, expiration, effacement local et version vérifiée',
    section6Body:
      'Les canaux expirent selon la durée choisie, jusqu’à 7 jours. La suppression par l’expéditeur purge le texte chiffré et laisse une marque pour empêcher toute réactivation. L’effacement local supprime uniquement le texte clair de cet appareil — le canal reste actif. Une version vérifiée signifie que le build a réussi la vérification de version signée ; son absence signifie que ce n’est pas le cas.',
    backButton: 'Retour',
    createButton: 'Créer un canal sécurisé',
  },

  notFound: {
    title: 'Page introuvable',
    description: 'Cette route n’existe pas dans l’enveloppe actuelle de l’application.',
    hint: 'Vérifiez l’URL et réessayez.',
    backButton: 'Retour à la création',
  },

  channel: {
    unavailableTitle: 'Canal indisponible',
  },

  role: {
    sender: 'Expéditeur',
    receiver: 'Destinataire',
  },

  status: {
    waiting: 'En attente du verrouillage',
    locked: 'Verrouillé par le destinataire',
    delivered: 'Transmis',
    deleted: 'Supprimé',
    expired: 'Expiré',
  },

  passphrase: {
    defaultLabel: 'Phrase secrète',
    defaultPlaceholder: 'Saisir la phrase secrète',
    showButton: 'Afficher la phrase secrète',
    hideButton: 'Masquer la phrase secrète',
    policyHint: 'Utilisez au moins 4 mots aléatoires ou au moins 12 caractères',
    errorRequired: '{{label}} est requis',
    errorTooShort: '{{label}} doit contenir au moins {{min}} caractères',
    errorTooLong: '{{label}} doit contenir au maximum {{max}} caractères',
    errorInvalidWhitespace:
      '{{label}} peut utiliser des espaces ordinaires entre les mots, mais pas de tabulations, de sauts de ligne ni d’espaces spéciaux',
    strengthLabel: 'Robustesse de la phrase secrète',
    weak: 'Faible',
    medium: 'Moyenne',
    strong: 'Forte',
  },

  safetyCode: {
    title: 'Code de sécurité',
    verifyHint: 'Vérifiez ce code via un autre canal (téléphone, appel vidéo)',
    emojiTab: 'Emoji',
    colorTab: 'Couleurs',
    advancedToggle: 'Empreinte avancée',
    shortFprLabel: 'Empreinte courte',
    fullFprLabel: 'Empreinte hexadécimale complète',
  },

  lang: {
    switcherLabel: 'Sélectionner la langue',
    menuLabel: 'Langue',
  },

  manageError: {
    notFound: 'Ce canal n’est plus disponible.',
    fallbackRequired:
      'Les canaux gérés par mot de passe ne sont pas disponibles pour cette action dans le build actuel.',
    profileBlocked: 'Le profil de sécurité sélectionné nécessite la prise en charge de WebAuthn.',
    missingLockChallenge:
      'Impossible de récupérer le challenge auprès du serveur. Veuillez réessayer.',
    missingReceiverIdentity:
      'L’identité du destinataire est indisponible. Demandez-lui de verrouiller à nouveau.',
    networkError: 'Erreur réseau pendant l’action de gestion. Veuillez réessayer.',
    badRequest: 'La demande de gestion a été rejetée. Veuillez réessayer.',
    fileTooLarge: 'Le fichier sélectionné dépasse la limite de 5 MiB.',
    fileStorageUnavailable: 'Ce déploiement ne prend pas en charge les téléversements de fichiers.',
    multipartRequired: 'Le fichier sélectionné dépasse la limite de transmission intégrée.',
    webauthnError: 'La vérification WebAuthn n’a pas été terminée.',
    cryptoError: 'Mot de passe du canal incorrect. Veuillez réessayer.',
    internalError: 'Erreur interne inattendue. Veuillez réessayer.',
    default: 'Une erreur inattendue est survenue. Veuillez réessayer.',
  },

  manifest: {
    title: 'Version vérifiée',
    verifiedBadge: 'Vérifiée',
    body: 'Cette page correspond à une version officielle de ZeroLink signée par notre équipe.',
    fingerprintLabel: 'Empreinte de version :',
    showDetails: 'Afficher les détails de vérification',
    hideDetails: 'Masquer les détails de vérification',
    statusLabel: 'État',
    versionLabel: 'Version de l’application',
    buildDateLabel: 'Date du build',
    commitLabel: 'Commit',
    manifestHashLabel: 'Hash du manifeste',
    filesLabel: 'Fichiers vérifiés',
    publisherKeyLabel: 'Empreinte de la clé de publication',
    signatureLabel: 'Signature',
    externalLinkLabel: 's’ouvre dans un nouvel onglet',
  },
};

export default fr;
