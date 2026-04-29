import type { Translation } from './en';

const es: Translation = {
  shell: {
    tagline: 'Entrega segura de conocimiento cero',
    trustModelLink: 'Modelo de confianza',
    backToCreate: 'Volver a crear',
    sourceCode: 'GitHub',
    inAppBrowserWarning:
      'Para mayor seguridad, abre ZeroLink en un navegador independiente (Safari, Chrome, Firefox), no dentro de Telegram, Instagram u otros navegadores integrados.',
  },

  create: {
    title: 'Crear canal seguro',
    description:
      'Entrega cifrada de conocimiento cero. Elige Compartir rápido (contraseña) o Compartir seguro (clave de acceso).',
    chooseModeTitle: 'Elegir modo de uso compartido',
    quickShareTitle: 'Compartir rápido',
    quickShareDescription:
      'Protegido con contraseña — no necesita clave de acceso. Funciona en cualquier navegador.',
    secureShareTitle: 'Compartir seguro',
    secureShareDescriptionAvailable:
      'Protegido con clave de acceso — máxima seguridad con verificación del usuario.',
    secureShareDescriptionUnavailable:
      'Requiere compatibilidad con WebAuthn (no disponible en este entorno).',
    secureShareHint:
      'Esta clave de acceso se usa solo para este canal. Si aparece en tu gestor de claves de acceso, puedes eliminarla con seguridad cuando el canal expire.',
    webauthnBlockedTitle: 'WebAuthn no está disponible en este entorno.',
    webauthnBlockedBody: 'Compartir seguro está desactivado. Usa Compartir rápido.',
    howItWorksLabel: 'Cómo funciona',
    step1Title: 'Crear',
    step1Desc: 'Elige un modo y crea el canal cifrado.',
    step2Title: 'Compartir',
    step2Desc: 'Envía el enlace de uso compartido al destinatario.',
    step3Title: 'Bloquear',
    step3Desc:
      'El destinatario define una frase de contraseña en su dispositivo y bloquea el canal.',
    step4Title: 'Verificar',
    step4Desc:
      'Compara el código de seguridad por un canal separado para confirmar la identidad del destinatario.',
    step5Title: 'Entregar',
    step5Desc: 'Entrega el secreto cifrado al destinatario bloqueado.',
    step6Title: 'Descifrar',
    step6Desc:
      'El destinatario descifra el secreto localmente en el dispositivo que creó el bloqueo.',
    trustHintBody:
      '¿Necesitas un resumen claro de qué permanece local, qué puede hacer el remitente y cuándo desaparecen los datos del canal?',
    trustHintLink: 'Leer el modelo de confianza',
    passwordPanelTitle: 'Definir una contraseña de Compartir rápido',
    passwordPanelBody:
      'Esta contraseña protege tu clave de gestión del canal. Usa 4 o más palabras aleatorias, o 12 o más caracteres. No se puede recuperar si se pierde.',
    expiryTitle: 'Caducidad del canal',
    expiryDescription: 'Elige cuánto tiempo seguirá disponible este canal después de crearlo.',
    ttlOneHour: '1 hora',
    ttlOneDay: '24 horas',
    ttlSevenDays: '7 días',
    passwordLabel: 'Contraseña del canal',
    passwordPlaceholder: 'Introduce una contraseña segura',
    footerHintPasswordRequired: 'Introduce una contraseña del canal de al menos 12 caracteres.',
    footerHintPasswordInvalid:
      'Usa 4 o más palabras aleatorias, o al menos 12 caracteres, para la contraseña del canal.',
    footerHintReady: 'Listo para crear un canal {{mode}} que caduca en {{ttl}}.',
    submitButton: 'Crear canal',
    submittingButton: 'Creando\u2026',
    successTitle: 'Canal creado correctamente',
    successModeLabel: 'Modo:',
    passwordProtectedBadge: 'Protegido con contraseña',
    createAnother: 'Crear otro',
    createAnotherConfirmBody:
      '¿Guardaste tanto el enlace de uso compartido como el enlace privado de gestión? Si sales de esta pantalla ahora, quizá no puedas volver a verlos aquí.',
    createAnotherConfirmCancel: 'Cancelar',
    createAnotherConfirmContinue: 'Los guardé, continuar',
    shareLinkLabel: 'Enlace de uso compartido — enviar al destinatario',
    shareLinkWarningTitle: 'Este enlace de uso compartido se muestra solo una vez.',
    shareLinkWarningBody:
      'Guárdalo ahora. En esta sesión del navegador, la página de gestión del remitente puede volver a copiarlo mientras el canal siga en espera. Fuera de esa ventana, si lo pierdes, crea un canal nuevo.',
    manageLinkLabel: 'Enlace de gestión — mantenlo privado',
    expiryHint:
      'El canal caduca en {{duration}}. Coordínate con el destinatario antes de que desaparezca.',
    copyButton: 'Copiar',
    copiedButton: 'Copiado',
    errorProfileBlocked: 'Compartir seguro requiere compatibilidad con WebAuthn en tu entorno.',
    errorNotAllowed: 'La solicitud de clave de acceso se canceló o se denegó. Inténtalo de nuevo.',
    errorNetwork: 'Error de red al crear el canal. Inténtalo de nuevo.',
    errorBadRequest: 'Se rechazó la solicitud de creación. Inténtalo de nuevo.',
    errorDefault: 'Se produjo un error inesperado. Inténtalo de nuevo.',
  },

  profile: {
    quick: 'Compartir rápido',
    secure: 'Compartir seguro',
  },

  manage: {
    headerTitle: 'Gestionar / Entregar',
    headerDescription: 'Controles de verificación y entrega del remitente (flujo integrado).',
    channelIdLabel: 'ID del canal:',
    channelIdMissing: '(falta)',
    waitingTitle: 'Esperando el bloqueo del destinatario',
    waitingBody:
      'El destinatario aún no ha bloqueado el canal. Comparte el enlace; esta página se actualizará automáticamente cuando lo haga.',
    lockedTitle: 'El destinatario bloqueó el canal',
    lockedBody: 'Verifica el código de seguridad fuera de banda antes de entregar el secreto.',
    deliveredTitle: 'Entrega completada',
    deliveredBody:
      'El texto cifrado se entregó al flujo del destinatario. El descifrado del lado del destinatario ocurre localmente y no envía confirmación aquí.',
    deletedTitle: 'Canal eliminado',
    deletedBody: 'Eliminaste este canal. Ya no puede entregar ni descifrar contenido.',
    expiredTitle: 'Canal caducado',
    expiredBody: 'Este canal caducó. Ya no se puede usar para entrega ni descifrado.',
    unavailableBody: 'Este canal fue destruido, caducó o no existe.',
    safetyUnavailableTitle: 'El código de seguridad no está disponible ahora.',
    safetyUnavailableBody:
      'Falta la huella del destinatario en el estado actual del canal, por lo que no se puede mostrar el código de seguridad.',
    deliveryModeText: 'Texto',
    deliveryModeFile: 'Archivo',
    secretLabel: 'Secreto para entregar',
    secretPlaceholder: 'Escribe o pega tu secreto aquí',
    fileLabel: 'Archivo para entregar',
    fileClearButton: 'Quitar archivo',
    fileSizeLimit: 'Tamaño máximo del archivo: {{size}}',
    fileSizeLimitLoading: 'Comprobando límite de tamaño del archivo\u2026',
    softkeyPassphraseHint:
      'Este canal usa una clave de gestión protegida por contraseña. Introduce la contraseña que definiste al crear este canal.',
    softkeyLabel: 'Contraseña del canal',
    softkeyPlaceholder: 'Introduce la contraseña del canal',
    softkeyMinLengthHint: 'Introduce una contraseña del canal de al menos {{min}} caracteres',
    deliverButton: 'Entregar',
    deliveringButton: 'Entregando\u2026',
    deleteChannelButton: 'Eliminar canal',
    destroyConfirmTitle: '¿Eliminar este canal permanentemente?',
    destroyConfirmBody:
      'Esto no se puede deshacer. Todos los datos del canal se eliminarán del servidor.',
    destroyCancelButton: 'Cancelar',
    destroyConfirmButton: 'Confirmar eliminación',
    destroyDeletingButton: 'Eliminando\u2026',
    createNewButton: 'Crear canal nuevo',
    deliveredToast: 'Secreto entregado correctamente.',
    shareLinkRecoveryTitle: '¿Necesitas reenviar el enlace del destinatario?',
    shareLinkRecoveryBody:
      'Esta sesión del navegador aún conserva el enlace de destinatario de un solo uso. Puedes copiarlo de nuevo hasta que el destinatario bloquee el canal.',
    shareLinkRecoveryButton: 'Copiar enlace del destinatario',
    shareLinkRecoveryCopied: 'Enlace del destinatario copiado',
  },

  share: {
    channelIdLabel: 'ID del canal:',
    channelIdMissing: '(falta)',
    headerDefaultTitle: 'Canal del destinatario',
    headerDefaultDescription:
      'Abre este enlace de destinatario en el dispositivo que bloqueará el canal y luego descifrará localmente el secreto entregado.',
    headerWaitingTitle: 'Configuración del destinatario',
    headerWaitingDescription:
      'El remitente ya creó este canal. Define aquí tu propia frase de contraseña para generar tu clave de destinatario y bloquear el canal en este dispositivo.',
    headerLockedTitle: 'Canal del destinatario',
    headerLockedDescription:
      'Este canal del destinatario está bloqueado. Esta página se actualiza automáticamente, pero solo el dispositivo que creó el bloqueo puede verificar el código de seguridad que se muestra abajo.',
    headerDeliveredTitle: 'Descifrar secreto entregado',
    headerDeliveredDescription:
      'Si este dispositivo creó el bloqueo del destinatario, introduce esa frase de contraseña para descifrar el secreto localmente.',
    headerUnavailableTitle: 'Canal del destinatario',
    headerUnavailableDescription:
      'Este enlace de destinatario no está disponible o ya no está activo.',
    loadingTitle: 'Cargando estado del canal',
    loadingBody: 'Obteniendo el estado del canal seguro para este enlace.',
    unavailableBody: 'Este canal fue destruido, caducó o no existe.',
    stepIntro: 'Introducción del destinatario',
    stepPassphrase: 'Tu frase de contraseña',
    stepReady: 'Listo para la entrega',
    stepIndicator: 'Paso {{current}} de {{total}} — {{label}}',
    onboardingTitle: 'Configuración del bloqueo del destinatario',
    onboarding1Title: 'Esta página es solo para el destinatario que usa el enlace compartido.',
    onboarding1Desc: 'El remitente ya creó el canal y te envió este enlace.',
    onboarding2Title: 'Tu frase de contraseña permanece en este dispositivo',
    onboarding2Desc: 'Nunca se envía al servidor ni se comparte con el remitente.',
    onboarding3Title: 'El bloqueo crea tu clave de destinatario localmente',
    onboarding3Desc:
      'Después de bloquear, el remitente solo puede entregar a tu identidad de destinatario.',
    continueButton: 'Continuar como destinatario',
    lockTitle: 'Elige tu frase de contraseña',
    lockLabel: 'Tu frase de contraseña',
    lockPlaceholder: 'Introduce tu frase de contraseña',
    privateModeNoticeBody:
      'Si estás en modo privado o incógnito, tu clave de descifrado solo existirá en esta ventana. Al cerrarla perderás el acceso permanentemente. Para cambiar a un navegador normal, copia este enlace primero.',
    privateModeNoticeCopy: 'Copiar enlace',
    privateModeNoticeCopied: '¡Copiado!',
    backButton: 'Atrás',
    generateButton: 'Generar mi clave y bloquear',
    lockingButton: 'Bloqueando\u2026',
    lockedTitle: 'El canal del destinatario está bloqueado',
    lockedBody:
      'Verifica el código de seguridad con el remitente solo si este dispositivo lo muestra abajo.',
    nextStepsLabel: 'Siguientes pasos',
    nextStep1:
      'El código de seguridad solo se puede verificar en el dispositivo que bloqueó este canal.',
    nextStep2: 'Confirma y verifica el código de seguridad con el remitente por otro canal.',
    nextStepNote:
      'Esta página se actualizará automáticamente cuando el remitente entregue el texto cifrado.',
    deliveredTitle: 'Canal entregado',
    deliveredBody:
      'El secreto cifrado fue entregado. El descifrado aún requiere el dispositivo que creó el bloqueo del destinatario.',
    deliveredAtLabel: 'Entregado:',
    updatedBadge:
      'Actualizado (v{{version}}) \u00b7 El remitente puede haber revisado este contenido. Se muestra la versión más reciente.',
    decryptLabel: 'Frase de contraseña de descifrado',
    decryptPlaceholder: 'Introduce la frase de contraseña para descifrar',
    decryptMinLengthHint: 'Introduce una frase de contraseña de al menos {{min}} caracteres',
    decryptButton: 'Descifrar',
    decryptingButton: 'Descifrando\u2026',
    burnButton: 'Borrar copia local',
    plaintextLabel: 'Texto claro',
    fileLabel: 'Archivo descifrado',
    fileNameLabel: 'Nombre',
    fileSizeLabel: 'Tamaño',
    fileTypeLabel: 'Tipo',
    fileDownloadButton: 'Descargar archivo',
    fileDownloadHint:
      'ZeroLink no previsualiza archivos. La descarga ocurre solo después de hacer clic.',
    cipherVersionNotice:
      'El contenido se actualizó. Estás a punto de descifrar la versión más reciente.',
    burnedTitle: 'Copia local descifrada eliminada de este dispositivo.',
    burnedBody:
      'Esto no elimina el canal ni lo marca como caducado. Vuelve a introducir tu frase de contraseña para descifrar de nuevo.',
    burnedToast: 'Copia local descifrada eliminada.',
    safetyCheckingTitle: 'Comprobando este dispositivo para la clave del destinatario\u2026',
    safetyCheckingBody:
      'ZeroLink solo muestra el código de seguridad después de confirmar que este dispositivo creó el bloqueo actual.',
    safetyMissingTitle: 'Este dispositivo no puede verificar el código de seguridad.',
    safetyMissingBody:
      'No se encontró una clave de destinatario correspondiente en este dispositivo. No confirmes el código de seguridad desde aquí. Si esperabas ser el destinatario, pide al remitente que vuelva a crear el canal.',
    safetyMismatchedTitle: 'Se detectó una discrepancia de identidad del destinatario.',
    safetyMismatchedBody:
      'Este dispositivo tiene material de clave de destinatario local diferente de la clave actualmente bloqueada en el canal. Trata este enlace como inseguro y pide al remitente que vuelva a crear el canal.',
    safetyStorageErrorTitle: 'No se pudo comprobar la clave de destinatario local.',
    safetyStorageErrorBody:
      'ZeroLink no pudo leer el material de clave de destinatario almacenado en este dispositivo, por lo que el código de seguridad no se puede verificar aquí.',
    safetyUnavailableTitle: 'El código de seguridad no está disponible ahora.',
    safetyUnavailableBody:
      'Falta la huella del destinatario en el estado actual del canal, por lo que el código de seguridad no se puede verificar aquí.',
    decryptCheckingTitle: 'Comprobando este dispositivo antes de habilitar el descifrado\u2026',
    decryptCheckingBody:
      'ZeroLink está verificando si este dispositivo conserva la clave de destinatario necesaria para el descifrado local.',
    decryptMismatchedTitle: 'Descifrado bloqueado en este dispositivo.',
    decryptMismatchedBody:
      'La clave de destinatario almacenada en este dispositivo no coincide con la clave actualmente bloqueada en el canal. Trata este enlace como inseguro y pide al remitente que vuelva a crear el canal.',
    decryptStorageErrorTitle: 'No se pudo cargar la clave de destinatario local.',
    decryptStorageErrorBody:
      'ZeroLink no pudo leer la clave de destinatario almacenada en este dispositivo, por lo que el descifrado local no está disponible aquí.',
    decryptUnavailableTitle: 'Descifrado no disponible en este dispositivo.',
    decryptUnavailableBody:
      'Este dispositivo no tiene la clave de destinatario que bloqueó el canal, por lo que el descifrado local está bloqueado aquí.',
  },

  trust: {
    badge: 'Modelo de confianza',
    title: 'Qué puede y no puede saber ZeroLink',
    description:
      'Un resumen compacto de qué permanece en tu dispositivo, qué puede controlar el remitente y cuándo desaparece un canal.',
    section1Title: 'Lo que el servidor nunca recibe',
    section1Body:
      'El servidor nunca recibe el fragmento de URL (#k=...), la frase de contraseña del destinatario, la clave privada del destinatario ni el texto claro descifrado. Eso permanece fuera de la ruta de solicitudes del servidor.',
    section2Title: 'Lo que el servidor almacena en cada etapa',
    section2Body:
      'Al crear: metadatos del canal, caducidad y material de autenticación de administrador. Después del bloqueo: clave pública y huella del destinatario. Después de la entrega: texto cifrado para que lo obtenga el destinatario.',
    section3Title: 'Lo que el remitente puede controlar',
    section3Body:
      'El remitente puede crear un canal, compartir el enlace del destinatario, entregar texto cifrado y eliminar el canal. El remitente no puede leer la frase de contraseña del destinatario, inspeccionar la clave privada del destinatario ni ver el texto claro descifrado en el dispositivo del destinatario.',
    section4Title: 'Qué contiene el enlace de gestión',
    section4Body:
      'Compartir rápido inserta una clave de administrador envuelta en el propio enlace de gestión (el fragmento de URL). Cualquiera que tenga ese enlace y la contraseña del canal puede entregar o eliminar el canal desde cualquier dispositivo. Si pierdes el enlace de gestión, no hay forma de recuperarlo.',
    section5Title: 'Qué permanece en el dispositivo del destinatario',
    section5Body:
      'El dispositivo del destinatario conserva en IndexedDB una clave privada de destinatario envuelta para ese canal. El texto claro aparece solo en el dispositivo local después de descifrar. El estado del canal puede mostrar la huella del destinatario al remitente, pero la página del destinatario solo debería mostrar un código de seguridad después de que este dispositivo demuestre que conserva la clave de destinatario local correspondiente.',
    section6Title: 'Eliminación, caducidad, borrado local y versión verificada',
    section6Body:
      'Los canales caducan según el TTL seleccionado, hasta 7 días. La eliminación por parte del remitente purga el texto cifrado y deja una marca para evitar reactivaciones. El borrado local elimina el texto claro solo de este dispositivo; el canal sigue activo. Versión verificada significa que la compilación superó la verificación de lanzamiento firmado; si falta, no la superó.',
    backButton: 'Atrás',
    createButton: 'Crear canal seguro',
  },

  notFound: {
    title: 'Página no encontrada',
    description: 'Esta ruta no existe en el shell actual de la aplicación.',
    hint: 'Comprueba la URL e inténtalo de nuevo.',
    backButton: 'Volver a crear',
  },

  channel: {
    unavailableTitle: 'Canal no disponible',
  },

  role: {
    sender: 'Remitente',
    receiver: 'Destinatario',
  },

  status: {
    waiting: 'Esperando bloqueo',
    locked: 'Bloqueado por el destinatario',
    delivered: 'Entregado',
    deleted: 'Eliminado',
    expired: 'Caducado',
  },

  passphrase: {
    defaultLabel: 'Frase de contraseña',
    defaultPlaceholder: 'Introduce la frase de contraseña',
    showButton: 'Mostrar frase de contraseña',
    hideButton: 'Ocultar frase de contraseña',
    policyHint: 'Usa 4 o más palabras aleatorias, o 12 o más caracteres',
    errorRequired: '{{label}} es obligatorio',
    errorTooShort: '{{label}} debe tener al menos {{min}} caracteres',
    errorTooLong: '{{label}} debe tener {{max}} caracteres o menos',
    errorInvalidWhitespace:
      '{{label}} puede usar espacios normales entre palabras, pero no tabulaciones, saltos de línea ni espacios especiales',
    strengthLabel: 'Fortaleza de la frase de contraseña',
    weak: 'Débil',
    medium: 'Media',
    strong: 'Fuerte',
  },

  safetyCode: {
    title: 'Código de seguridad',
    verifyHint: 'Verifica este código por otro canal (teléfono, videollamada)',
    emojiTab: 'Emoji',
    colorTab: 'Colores',
    advancedToggle: 'Huella avanzada',
    shortFprLabel: 'Huella corta',
    fullFprLabel: 'Huella hexadecimal completa',
  },

  lang: {
    switcherLabel: 'Seleccionar idioma',
    menuLabel: 'Idioma',
  },

  manageError: {
    notFound: 'Este canal ya no está disponible.',
    fallbackRequired:
      'Los canales gestionados por contraseña no están disponibles para esta acción en la compilación actual.',
    profileBlocked: 'El perfil de seguridad seleccionado requiere compatibilidad con WebAuthn.',
    missingLockChallenge: 'No se pudo obtener el desafío del servidor. Inténtalo de nuevo.',
    missingReceiverIdentity:
      'La identidad del destinatario no está disponible. Pide al destinatario que vuelva a bloquear.',
    networkError: 'Error de red al realizar la acción de gestión. Inténtalo de nuevo.',
    badRequest: 'Se rechazó la solicitud de gestión. Inténtalo de nuevo.',
    fileTooLarge: 'El archivo seleccionado supera el límite de 5 MiB.',
    fileStorageUnavailable: 'Este despliegue no admite cargas de archivos.',
    multipartRequired: 'El archivo seleccionado supera el límite de entrega en línea.',
    webauthnError: 'La verificación WebAuthn no se completó.',
    cryptoError: 'Contraseña del canal incorrecta. Inténtalo de nuevo.',
    internalError: 'Error interno inesperado. Inténtalo de nuevo.',
    default: 'Se produjo un error inesperado. Inténtalo de nuevo.',
  },

  manifest: {
    title: 'Versión verificada',
    verifiedBadge: 'Verificada',
    body: 'Esta página coincide con una versión oficial de ZeroLink firmada por nuestro equipo.',
    fingerprintLabel: 'Huella de la versión:',
    showDetails: 'Ver detalles de verificación',
    hideDetails: 'Ocultar detalles de verificación',
    statusLabel: 'Estado',
    versionLabel: 'Versión de la aplicación',
    buildDateLabel: 'Fecha de compilación',
    commitLabel: 'Commit',
    manifestHashLabel: 'Hash del manifiesto',
    filesLabel: 'Archivos verificados',
    publisherKeyLabel: 'Huella de la clave del publicador',
    signatureLabel: 'Firma',
  },
};

export default es;
