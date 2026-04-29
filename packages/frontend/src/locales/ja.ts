import type { Translation } from './en';

const ja: Translation = {
  shell: {
    tagline: 'ゼロ知識セキュア配信',
    trustModelLink: '信頼モデル',
    backToCreate: '作成に戻る',
    sourceCode: 'GitHub',
    inAppBrowserWarning:
      '最高のセキュリティを確保するため、Telegram、Instagram などのアプリ内ブラウザではなく、Safari、Chrome、Firefox などの独立したブラウザで ZeroLink を開いてください。',
  },

  create: {
    title: 'セキュアチャネルを作成',
    description:
      'ゼロ知識暗号化配信。クイック共有（パスワード）またはセキュア共有（パスキー）を選択します。',
    chooseModeTitle: '共有モードを選択',
    quickShareTitle: 'クイック共有',
    quickShareDescription: 'パスワード保護 — パスキー不要。どのブラウザでも使えます。',
    secureShareTitle: 'セキュア共有',
    secureShareDescriptionAvailable: 'パスキー保護 — ユーザー確認付きの最強のセキュリティ。',
    secureShareDescriptionUnavailable:
      'WebAuthn のサポートが必要です（この環境では利用できません）。',
    secureShareHint:
      'このパスキーはこのチャネル専用です。パスキーマネージャーに表示された場合、チャネルの期限切れ後に安全に削除できます。',
    webauthnBlockedTitle: 'この環境では WebAuthn を利用できません。',
    webauthnBlockedBody: 'セキュア共有は無効です。クイック共有を使用してください。',
    howItWorksLabel: '仕組み',
    step1Title: '作成',
    step1Desc: 'モードを選択し、暗号化チャネルを作成します。',
    step2Title: '共有',
    step2Desc: '共有リンクを受信者に送ります。',
    step3Title: 'ロック',
    step3Desc: '受信者が自分の端末でパスフレーズを設定し、チャネルをロックします。',
    step4Title: '確認',
    step4Desc: '別の経路で安全コードを照合し、受信者の本人性を確認します。',
    step5Title: '配信',
    step5Desc: 'ロック済みの受信者に暗号化されたシークレットを配信します。',
    step6Title: '復号',
    step6Desc: '受信者はロックを作成した端末上でシークレットをローカルに復号します。',
    trustHintBody:
      '何がローカルに残るのか、送信者に何ができるのか、チャネルデータがいつ消えるのかを平易に確認しますか？',
    trustHintLink: '信頼モデルを読む',
    passwordPanelTitle: 'クイック共有パスワードを設定',
    passwordPanelBody:
      'このパスワードはチャネル管理キーを保護します。4 語以上のランダムな単語、または 12 文字以上を使用してください。失うと復旧できません。',
    expiryTitle: 'チャネルの有効期限',
    expiryDescription: '作成後、このチャネルを利用可能にしておく期間を選択します。',
    ttlOneHour: '1 時間',
    ttlOneDay: '24 時間',
    ttlSevenDays: '7 日',
    passwordLabel: 'チャネルパスワード',
    passwordPlaceholder: '強力なパスワードを入力',
    footerHintPasswordRequired: '12 文字以上のチャネルパスワードを入力してください。',
    footerHintPasswordInvalid:
      'チャネルパスワードには、4 語以上のランダムな単語、または 12 文字以上を使用してください。',
    footerHintReady: '{{ttl}} で期限切れになる {{mode}} チャネルを作成できます。',
    submitButton: 'チャネルを作成',
    submittingButton: '作成中\u2026',
    successTitle: 'チャネルを作成しました',
    successModeLabel: 'モード:',
    passwordProtectedBadge: 'パスワード保護',
    createAnother: 'もう一つ作成',
    createAnotherConfirmBody:
      '共有リンクと非公開の管理リンクの両方を保存しましたか？この画面を離れると、ここで再表示できない場合があります。',
    createAnotherConfirmCancel: 'キャンセル',
    createAnotherConfirmContinue: '保存しました。続行',
    shareLinkLabel: '共有リンク — 受信者に送信',
    shareLinkWarningTitle: 'この共有リンクは一度だけ表示されます。',
    shareLinkWarningBody:
      '今すぐ保存してください。このブラウザセッションでは、チャネルが待機中であれば送信者の管理ページから再コピーできます。それ以外で失った場合は、新しいチャネルを作成してください。',
    manageLinkLabel: '管理リンク — 非公開で保管',
    expiryHint:
      'チャネルは {{duration}} 後に期限切れになります。消える前に受信者と調整してください。',
    copyButton: 'コピー',
    copiedButton: 'コピー済み',
    errorProfileBlocked: 'セキュア共有には、この環境での WebAuthn サポートが必要です。',
    errorNotAllowed: 'パスキーの確認がキャンセルまたは拒否されました。もう一度お試しください。',
    errorNetwork: 'チャネル作成中にネットワークエラーが発生しました。再試行してください。',
    errorBadRequest: '作成リクエストが拒否されました。再試行してください。',
    errorDefault: '予期しないエラーが発生しました。もう一度お試しください。',
  },

  profile: {
    quick: 'クイック共有',
    secure: 'セキュア共有',
  },

  manage: {
    headerTitle: '管理 / 配信',
    headerDescription: '送信者側の確認と配信コントロール（統合フロー）。',
    channelIdLabel: 'チャネル ID:',
    channelIdMissing: '（未指定）',
    waitingTitle: '受信者のロック待ち',
    waitingBody:
      '受信者はまだチャネルをロックしていません。リンクを共有すると、ロック後にこのページが自動更新されます。',
    lockedTitle: '受信者がチャネルをロックしました',
    lockedBody: 'シークレットを配信する前に、別経路で安全コードを確認してください。',
    deliveredTitle: '配信が完了しました',
    deliveredBody:
      '暗号文は受信者フローへ配信されました。受信者側の復号はローカルで行われ、ここへ確認は送信されません。',
    deletedTitle: 'チャネルを削除しました',
    deletedBody: 'このチャネルは削除されました。今後、配信や復号はできません。',
    expiredTitle: 'チャネルの期限が切れました',
    expiredBody: 'このチャネルは期限切れです。配信や復号には使用できません。',
    unavailableBody: 'このチャネルは破棄済み、期限切れ、または存在しません。',
    safetyUnavailableTitle: '現在、安全コードを利用できません。',
    safetyUnavailableBody:
      '現在のチャネル状態に受信者フィンガープリントがないため、安全コードを表示できません。',
    deliveryModeText: 'テキスト',
    deliveryModeFile: 'ファイル',
    secretLabel: '配信するシークレット',
    secretPlaceholder: 'ここにシークレットを入力または貼り付け',
    fileLabel: '配信するファイル',
    fileClearButton: 'ファイルを削除',
    fileSizeLimit: '最大ファイルサイズ: {{size}}',
    fileSizeLimitLoading: 'ファイルサイズ上限を確認中\u2026',
    softkeyPassphraseHint:
      'このチャネルはパスワード保護された管理キーを使用しています。チャネル作成時に設定したパスワードを入力してください。',
    softkeyLabel: 'チャネルパスワード',
    softkeyPlaceholder: 'チャネルパスワードを入力',
    softkeyMinLengthHint: '{{min}} 文字以上のチャネルパスワードを入力してください',
    deliverButton: '配信',
    deliveringButton: '配信中\u2026',
    deleteChannelButton: 'チャネルを削除',
    destroyConfirmTitle: 'このチャネルを完全に削除しますか？',
    destroyConfirmBody:
      'この操作は取り消せません。すべてのチャネルデータがサーバーから削除されます。',
    destroyCancelButton: 'キャンセル',
    destroyConfirmButton: '削除を確定',
    destroyDeletingButton: '削除中\u2026',
    createNewButton: '新しいチャネルを作成',
    deliveredToast: 'シークレットを配信しました。',
    shareLinkRecoveryTitle: '受信者リンクを再送しますか？',
    shareLinkRecoveryBody:
      'このブラウザセッションには、まだ一度限りの受信者リンクがあります。受信者がチャネルをロックするまで、もう一度コピーできます。',
    shareLinkRecoveryButton: '受信者リンクをコピー',
    shareLinkRecoveryCopied: '受信者リンクをコピーしました',
  },

  share: {
    channelIdLabel: 'チャネル ID:',
    channelIdMissing: '（未指定）',
    headerDefaultTitle: '受信者チャネル',
    headerDefaultDescription:
      'チャネルをロックし、後で配信されたシークレットをローカルに復号する端末で、この受信者リンクを開いてください。',
    headerWaitingTitle: '受信者セットアップ',
    headerWaitingDescription:
      '送信者はすでにこのチャネルを作成しています。ここで自分のパスフレーズを設定し、受信者キーを生成してこの端末でチャネルをロックします。',
    headerLockedTitle: '受信者チャネル',
    headerLockedDescription:
      'この受信者チャネルはロックされています。ページは自動更新されますが、下の安全コードを確認できるのはロックを作成した端末だけです。',
    headerDeliveredTitle: '配信済みシークレットを復号',
    headerDeliveredDescription:
      'この端末で受信者ロックを作成した場合、そのパスフレーズを入力してシークレットをローカルに復号します。',
    headerUnavailableTitle: '受信者チャネル',
    headerUnavailableDescription: 'この受信者リンクは利用できないか、すでに無効です。',
    loadingTitle: 'チャネル状態を読み込み中',
    loadingBody: 'このリンクのセキュアチャネル状態を取得しています。',
    unavailableBody: 'このチャネルは破棄済み、期限切れ、または存在しません。',
    stepIntro: '受信者向け説明',
    stepPassphrase: 'あなたのパスフレーズ',
    stepReady: '配信準備完了',
    stepIndicator: 'ステップ {{current}} / {{total}} — {{label}}',
    onboardingTitle: '受信者ロックのセットアップ',
    onboarding1Title: 'このページは共有リンクを使う受信者専用です。',
    onboarding1Desc: '送信者はすでにチャネルを作成し、このリンクをあなたに送っています。',
    onboarding2Title: 'パスフレーズはこの端末に残ります',
    onboarding2Desc: 'サーバーへ送信されたり、送信者と共有されたりすることはありません。',
    onboarding3Title: 'ロックにより受信者キーがローカルに作成されます',
    onboarding3Desc: 'ロック後、送信者はあなたの受信者 ID に対してのみ配信できます。',
    continueButton: '受信者として続行',
    lockTitle: 'パスフレーズを選択',
    lockLabel: 'あなたのパスフレーズ',
    lockPlaceholder: 'パスフレーズを入力',
    privateModeNoticeBody:
      'プライベートモードまたはシークレットモードを使用している場合、復号キーはこのウィンドウ内にしか存在しません。閉じるとアクセスを永久に失います。通常のブラウザへ切り替える場合は、先にこのリンクをコピーしてください。',
    privateModeNoticeCopy: 'リンクをコピー',
    privateModeNoticeCopied: 'コピーしました！',
    backButton: '戻る',
    generateButton: 'キーを生成してロック',
    lockingButton: 'ロック中\u2026',
    lockedTitle: '受信者チャネルはロックされています',
    lockedBody: 'この端末に下の安全コードが表示されている場合のみ、送信者と照合してください。',
    nextStepsLabel: '次の手順',
    nextStep1: '安全コードを確認できるのは、このチャネルをロックした端末だけです。',
    nextStep2: '別の経路で送信者と安全コードを確認・照合してください。',
    nextStepNote: '送信者が暗号文を配信すると、このページは自動で更新されます。',
    deliveredTitle: 'チャネルに配信されました',
    deliveredBody:
      '暗号化されたシークレットが配信されました。復号には、受信者ロックを作成した端末が引き続き必要です。',
    deliveredAtLabel: '配信日時:',
    updatedBadge:
      '更新済み（v{{version}}）\u00b7 送信者が内容を更新した可能性があります。最新バージョンを表示しています。',
    decryptLabel: '復号パスフレーズ',
    decryptPlaceholder: '復号するためのパスフレーズを入力',
    decryptMinLengthHint: '{{min}} 文字以上のパスフレーズを入力してください',
    decryptButton: '復号',
    decryptingButton: '復号中\u2026',
    burnButton: 'ローカルコピーを消去',
    plaintextLabel: '平文',
    fileLabel: '復号されたファイル',
    fileNameLabel: '名前',
    fileSizeLabel: 'サイズ',
    fileTypeLabel: '種類',
    fileDownloadButton: 'ファイルをダウンロード',
    fileDownloadHint:
      'ZeroLink はファイルをプレビューしません。ダウンロードはクリック後にのみ行われます。',
    cipherVersionNotice: '内容が更新されています。最新バージョンを復号しようとしています。',
    burnedTitle: 'ローカルの復号済みコピーをこの端末から削除しました。',
    burnedBody:
      'これはチャネルを削除したり、期限切れにしたりするものではありません。パスフレーズを再入力すると再び復号できます。',
    burnedToast: 'ローカルの復号済みコピーを削除しました。',
    safetyCheckingTitle: 'この端末の受信者キーを確認中\u2026',
    safetyCheckingBody:
      'ZeroLink は、この端末が現在のロックを作成したことを確認してから安全コードを表示します。',
    safetyMissingTitle: 'この端末では安全コードを確認できません。',
    safetyMissingBody:
      'この端末に一致する受信者キーが見つかりませんでした。ここから安全コードを確認しないでください。自分が受信者のはずであれば、送信者にチャネルの再作成を依頼してください。',
    safetyMismatchedTitle: '受信者 ID の不一致を検出しました。',
    safetyMismatchedBody:
      'この端末のローカル受信者キー素材は、チャネル上で現在ロックされているキーと異なります。このリンクは安全でないものとして扱い、送信者にチャネルの再作成を依頼してください。',
    safetyStorageErrorTitle: 'ローカル受信者キーを確認できません。',
    safetyStorageErrorBody:
      'ZeroLink はこの端末に保存された受信者キー素材を読み取れなかったため、ここでは安全コードを確認できません。',
    safetyUnavailableTitle: '現在、安全コードを利用できません。',
    safetyUnavailableBody:
      '現在のチャネル状態に受信者フィンガープリントがないため、ここでは安全コードを確認できません。',
    decryptCheckingTitle: '復号を有効にする前にこの端末を確認中\u2026',
    decryptCheckingBody:
      'ZeroLink は、この端末がローカル復号に必要な受信者キーを保持しているか確認しています。',
    decryptMismatchedTitle: 'この端末での復号はブロックされました。',
    decryptMismatchedBody:
      'この端末に保存された受信者キーは、チャネル上で現在ロックされているキーと一致しません。このリンクは安全でないものとして扱い、送信者にチャネルの再作成を依頼してください。',
    decryptStorageErrorTitle: 'ローカル受信者キーを読み込めません。',
    decryptStorageErrorBody:
      'ZeroLink はこの端末に保存された受信者キーを読み取れなかったため、ここではローカル復号を利用できません。',
    decryptUnavailableTitle: 'この端末では復号を利用できません。',
    decryptUnavailableBody:
      'この端末にはチャネルをロックした受信者キーがないため、ここでのローカル復号はブロックされています。',
  },

  trust: {
    badge: '信頼モデル',
    title: 'ZeroLink が知ることができるもの、できないもの',
    description:
      '何が端末に残るのか、送信者が何を制御できるのか、チャネルがいつ消えるのかを簡潔にまとめます。',
    section1Title: 'サーバーが決して受け取らないもの',
    section1Body:
      'サーバーは URL フラグメント（#k=...）、受信者のパスフレーズ、受信者の秘密キー、復号済み平文を受け取りません。これらはサーバー側のリクエスト経路の外に留まります。',
    section2Title: '各段階でサーバーが保存するもの',
    section2Body:
      '作成時: チャネルメタデータ、有効期限、管理者認証素材。ロック後: 受信者公開キーとフィンガープリント。配信後: 受信者が取得する暗号文。',
    section3Title: '送信者が制御できるもの',
    section3Body:
      '送信者はチャネルを作成し、受信者リンクを共有し、暗号文を配信し、チャネルを削除できます。送信者は受信者のパスフレーズを読んだり、受信者の秘密キーを調べたり、受信者端末上の復号済み平文を見たりすることはできません。',
    section4Title: '管理リンクが持つもの',
    section4Body:
      'クイック共有では、ラップされた管理キーが管理リンク自体（URL フラグメント）に埋め込まれます。そのリンクとチャネルパスワードを持つ人は、どの端末からでもチャネルへの配信や削除ができます。管理リンクを失うと復旧する方法はありません。',
    section5Title: '受信者端末に残るもの',
    section5Body:
      '受信者端末は、そのチャネル用のラップされた受信者秘密キーを IndexedDB に保持します。平文は復号後にのみローカル端末上に現れます。チャネル状態には受信者フィンガープリントが含まれ、送信者に見える場合がありますが、受信者ページで安全コードを表示するのは、この端末が一致するローカル受信者キーを保持していることを証明した後であるべきです。',
    section6Title: '削除、有効期限、ローカル消去、検証済みリリース',
    section6Body:
      'チャネルは選択された TTL に従って期限切れになり、最大 7 日です。送信者による削除は暗号文を消去し、復活を防ぐための墓標を残します。ローカル消去はこの端末から平文だけを削除し、チャネルは有効なままです。検証済みリリースは、ビルドが署名付きリリース検証に合格したことを意味します。表示がない場合は合格していません。',
    backButton: '戻る',
    createButton: 'セキュアチャネルを作成',
  },

  notFound: {
    title: 'ページが見つかりません',
    description: 'このルートは現在のアプリシェルに存在しません。',
    hint: 'URL を確認して、もう一度お試しください。',
    backButton: '作成に戻る',
  },

  channel: {
    unavailableTitle: 'チャネルを利用できません',
  },

  role: {
    sender: '送信者',
    receiver: '受信者',
  },

  status: {
    waiting: 'ロック待ち',
    locked: '受信者によりロック済み',
    delivered: '配信済み',
    deleted: '削除済み',
    expired: '期限切れ',
  },

  passphrase: {
    defaultLabel: 'パスフレーズ',
    defaultPlaceholder: 'パスフレーズを入力',
    showButton: 'パスフレーズを表示',
    hideButton: 'パスフレーズを隠す',
    policyHint: '4 語以上のランダムな単語、または 12 文字以上を使用',
    errorRequired: '{{label}} は必須です',
    errorTooShort: '{{label}} は {{min}} 文字以上である必要があります',
    errorTooLong: '{{label}} は {{max}} 文字以下である必要があります',
    errorInvalidWhitespace:
      '{{label}} では単語間に通常のスペースを使えますが、タブ、改行、特殊な空白は使えません',
    strengthLabel: 'パスフレーズ強度',
    weak: '弱い',
    medium: '中程度',
    strong: '強い',
  },

  safetyCode: {
    title: '安全コード',
    verifyHint: '別の経路（電話、ビデオ通話）でこのコードを確認してください',
    emojiTab: '絵文字',
    colorTab: '色',
    advancedToggle: '高度なフィンガープリント',
    shortFprLabel: '短いフィンガープリント',
    fullFprLabel: '完全な 16 進フィンガープリント',
  },

  lang: {
    switcherLabel: '言語を選択',
    menuLabel: '言語',
  },

  manageError: {
    notFound: 'このチャネルは利用できなくなりました。',
    fallbackRequired: '現在のビルドでは、この操作にパスワード管理チャネルを使用できません。',
    profileBlocked: '選択したセキュリティプロファイルには WebAuthn サポートが必要です。',
    missingLockChallenge: 'サーバーからチャレンジを取得できません。再試行してください。',
    missingReceiverIdentity: '受信者 ID を利用できません。受信者に再度ロックしてもらってください。',
    networkError: '管理操作中にネットワークエラーが発生しました。再試行してください。',
    badRequest: '管理リクエストが拒否されました。再試行してください。',
    fileTooLarge: '選択したファイルは 5 MiB の上限を超えています。',
    fileStorageUnavailable: 'このデプロイではファイルアップロードをサポートしていません。',
    multipartRequired: '選択したファイルはインライン配信の上限を超えています。',
    webauthnError: 'WebAuthn 検証が完了しませんでした。',
    cryptoError: 'チャネルパスワードが正しくありません。もう一度お試しください。',
    internalError: '予期しない内部エラーが発生しました。再試行してください。',
    default: '予期しないエラーが発生しました。もう一度お試しください。',
  },

  manifest: {
    title: '検証済みリリース',
    verifiedBadge: '検証済み',
    body: 'このページは、私たちのチームが署名した公式 ZeroLink リリースと一致しています。',
    fingerprintLabel: 'リリースフィンガープリント:',
    showDetails: '検証の詳細を表示',
    hideDetails: '検証の詳細を隠す',
    statusLabel: 'ステータス',
    versionLabel: 'アプリバージョン',
    buildDateLabel: 'ビルド日',
    commitLabel: 'コミット',
    manifestHashLabel: 'マニフェストハッシュ',
    filesLabel: '検証済みファイル',
    publisherKeyLabel: '発行者キーのフィンガープリント',
    signatureLabel: '署名',
  },
};

export default ja;
