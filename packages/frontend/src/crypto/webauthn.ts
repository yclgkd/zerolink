import {
  type CredentialCreationOptionsJSON,
  type CredentialRequestOptionsJSON,
  supported as isWebAuthnJsonSupported,
  create as webAuthnCreate,
  get as webAuthnGet,
} from '@github/webauthn-json';
import {
  type AssertionJSON,
  AssertionJSONSchema,
  type AttestationJSON,
  AttestationJSONSchema,
  SECURITY_PROFILE,
  type SecurityProfile,
} from '@zerolink/shared';

/**
 * Canonical WebAuthn adapter error codes.
 */
export type WebAuthnAdapterErrorCode =
  | 'UNSUPPORTED_ENV'
  | 'PROFILE_BLOCKED'
  | 'FALLBACK_REQUIRED'
  | 'INVALID_OPTIONS'
  | 'NOT_ALLOWED'
  | 'ABORTED'
  | 'WEBAUTHN_ERROR';

/**
 * Structured error returned by WebAuthn adapter methods.
 */
export interface WebAuthnAdapterError {
  ok: false;
  code: WebAuthnAdapterErrorCode;
  message?: string;
  causeName?: string;
}

/**
 * Result union used by all adapter methods.
 */
export type WebAuthnAdapterResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: WebAuthnAdapterError;
    };

/**
 * Environment support detail for WebAuthn capability decisions.
 */
export interface WebAuthnSupportInfo {
  supported: boolean;
  secureContext: boolean;
  hasPublicKeyCredential: boolean;
  hasCredentialsCreate: boolean;
  hasCredentialsGet: boolean;
}

/**
 * Resolved mode decision for profile and environment.
 */
export type WebAuthnModeDecision =
  | { mode: 'webauthn'; allowed: true }
  | { mode: 'fallback'; allowed: false; reason: 'WEBAUTHN_UNAVAILABLE' }
  | { mode: 'blocked'; allowed: false; reason: 'PROFILE_REQUIRES_WEBAUTHN' };

/**
 * Policy overlays applied to WebAuthn creation/assertion options.
 */
export interface WebAuthnProfilePolicy {
  userVerification: UserVerificationRequirement;
  residentKey: ResidentKeyRequirement;
  attestation: AttestationConveyancePreference;
  authenticatorAttachment?: AuthenticatorAttachment;
  hints?: readonly string[];
}

/**
 * Input for registerWithWebAuthn.
 */
export interface RegisterWithWebAuthnInput {
  profile: SecurityProfile;
  creationOptions: CreationPublicKeyOptions | CredentialCreationOptionsJSON;
}

/**
 * Input for assertWithWebAuthn.
 */
export interface AssertWithWebAuthnInput {
  profile: SecurityProfile;
  requestOptions: RequestPublicKeyOptions | CredentialRequestOptionsJSON;
}

type CreationPublicKeyOptions = CredentialCreationOptionsJSON['publicKey'];
type RequestPublicKeyOptions = NonNullable<CredentialRequestOptionsJSON['publicKey']>;
type NormalizedCredentialRequestOptions = Omit<CredentialRequestOptionsJSON, 'publicKey'> & {
  publicKey: RequestPublicKeyOptions;
};

function adapterError(
  code: WebAuthnAdapterErrorCode,
  message?: string,
  causeName?: string
): WebAuthnAdapterError {
  return {
    ok: false,
    code,
    ...(message ? { message } : {}),
    ...(causeName ? { causeName } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidCreationPublicKeyOptions(value: unknown): value is CreationPublicKeyOptions {
  if (!isRecord(value)) return false;

  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
  const challenge = value['challenge'];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
  const rp = value['rp'];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
  const user = value['user'];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
  const pubKeyCredParams = value['pubKeyCredParams'];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
  const userId = isRecord(user) ? user['id'] : undefined;

  return (
    typeof challenge === 'string' &&
    isRecord(rp) &&
    isRecord(user) &&
    typeof userId === 'string' &&
    Array.isArray(pubKeyCredParams)
  );
}

function isValidRequestPublicKeyOptions(value: unknown): value is RequestPublicKeyOptions {
  if (!isRecord(value)) return false;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
  return typeof value['challenge'] === 'string';
}

function normalizeCreationOptions(
  input: RegisterWithWebAuthnInput['creationOptions']
): CredentialCreationOptionsJSON | null {
  if (!isRecord(input)) {
    return null;
  }

  if ('publicKey' in input) {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
    const publicKey = input['publicKey'];
    if (!isValidCreationPublicKeyOptions(publicKey)) {
      return null;
    }

    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
    const signal = input['signal'];
    return {
      ...(signal !== undefined ? { signal: signal as AbortSignal } : {}),
      publicKey,
    };
  }

  if (!isValidCreationPublicKeyOptions(input)) {
    return null;
  }

  return { publicKey: input as CreationPublicKeyOptions };
}

function normalizeRequestOptions(
  input: AssertWithWebAuthnInput['requestOptions']
): NormalizedCredentialRequestOptions | null {
  if (!isRecord(input)) {
    return null;
  }

  if ('publicKey' in input) {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
    const publicKey = input['publicKey'];
    if (!isValidRequestPublicKeyOptions(publicKey)) {
      return null;
    }

    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
    const mediation = input['mediation'];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
    const signal = input['signal'];
    return {
      ...(mediation !== undefined
        ? { mediation: mediation as CredentialMediationRequirement }
        : {}),
      ...(signal !== undefined ? { signal: signal as AbortSignal } : {}),
      publicKey,
    };
  }

  if (!isValidRequestPublicKeyOptions(input)) {
    return null;
  }

  return { publicKey: input as RequestPublicKeyOptions };
}

function normalizeWebAuthnFailure(error: unknown): WebAuthnAdapterError {
  const causeNameFromPayload =
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
    isRecord(error) && typeof error['name'] === 'string' ? error['name'] : undefined;
  const causeName = causeNameFromPayload ?? (error instanceof Error ? error.name : undefined);
  const message = error instanceof Error ? error.message : undefined;

  if (causeName === 'NotAllowedError') {
    return adapterError('NOT_ALLOWED', message, causeName);
  }

  if (causeName === 'AbortError') {
    return adapterError('ABORTED', message, causeName);
  }

  return adapterError(
    'WEBAUTHN_ERROR',
    message,
    typeof causeName === 'string' ? causeName : undefined
  );
}

/**
 * Detects browser WebAuthn runtime support and secure-context readiness.
 */
export function detectWebAuthnSupport(): WebAuthnSupportInfo {
  const secureContext = typeof window !== 'undefined' && window.isSecureContext === true;
  const hasPublicKeyCredential =
    typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
  const hasCredentialsCreate =
    typeof navigator !== 'undefined' && typeof navigator.credentials?.create === 'function';
  const hasCredentialsGet =
    typeof navigator !== 'undefined' && typeof navigator.credentials?.get === 'function';

  let webAuthnJsonSupport = false;
  try {
    webAuthnJsonSupport = isWebAuthnJsonSupported();
  } catch {
    webAuthnJsonSupport = false;
  }

  return {
    supported:
      secureContext &&
      hasPublicKeyCredential &&
      hasCredentialsCreate &&
      hasCredentialsGet &&
      webAuthnJsonSupport,
    secureContext,
    hasPublicKeyCredential,
    hasCredentialsCreate,
    hasCredentialsGet,
  };
}

/**
 * Resolves profile-specific WebAuthn policy settings.
 * New profiles: 'secure' (strict), 'quick' (no WebAuthn).
 * Legacy profiles: 'standard'/'strict'/'hardware_only' are handled for backward compatibility.
 */
export function resolveWebAuthnPolicy(profile: SecurityProfile): WebAuthnProfilePolicy {
  switch (profile) {
    case SECURITY_PROFILE.SECURE:
    case SECURITY_PROFILE.STRICT:
    case SECURITY_PROFILE.HARDWARE_ONLY:
      return {
        userVerification: 'required',
        residentKey: 'required',
        attestation: 'none',
      };
    default:
      // 'quick' profile never reaches here (password mode, no WebAuthn)
      // 'standard' falls through to preferred UV
      return {
        userVerification: 'preferred',
        residentKey: 'preferred',
        attestation: 'none',
      };
  }
}

/**
 * Decides whether profile execution should use WebAuthn, fallback, or block.
 * 'secure' profile requires WebAuthn; 'quick' is never routed through WebAuthn.
 * Legacy 'standard' profile allows fallback; 'strict'/'hardware_only' require WebAuthn.
 */
export function evaluateWebAuthnMode(
  profile: SecurityProfile,
  support: WebAuthnSupportInfo = detectWebAuthnSupport()
): WebAuthnModeDecision {
  if (support.supported) {
    return { mode: 'webauthn', allowed: true };
  }

  // Profiles that allow password/softkey fallback
  if (profile === SECURITY_PROFILE.STANDARD || profile === SECURITY_PROFILE.QUICK) {
    return {
      mode: 'fallback',
      allowed: false,
      reason: 'WEBAUTHN_UNAVAILABLE',
    };
  }

  return {
    mode: 'blocked',
    allowed: false,
    reason: 'PROFILE_REQUIRES_WEBAUTHN',
  };
}

function applyCreationPolicy(
  options: CredentialCreationOptionsJSON,
  policy: WebAuthnProfilePolicy
): CredentialCreationOptionsJSON {
  const existingSelection = options.publicKey.authenticatorSelection ?? {};
  const nextSelection: AuthenticatorSelectionCriteria = {
    ...existingSelection,
    userVerification: policy.userVerification,
    residentKey: policy.residentKey,
    ...(policy.authenticatorAttachment
      ? { authenticatorAttachment: policy.authenticatorAttachment }
      : {}),
  };

  return {
    ...options,
    publicKey: {
      ...options.publicKey,
      attestation: policy.attestation,
      authenticatorSelection: nextSelection,
      // hints is a WebAuthn Level 3 field not yet typed by @github/webauthn-json
      ...(policy.hints ? { hints: policy.hints } : {}),
    } as CredentialCreationOptionsJSON['publicKey'],
  };
}

function applyRequestPolicy(
  options: NormalizedCredentialRequestOptions,
  policy: WebAuthnProfilePolicy
): NormalizedCredentialRequestOptions {
  return {
    ...options,
    publicKey: {
      ...options.publicKey,
      userVerification: policy.userVerification,
    },
  };
}

/**
 * Executes a WebAuthn registration ceremony using profile-based policy.
 */
export async function registerWithWebAuthn(
  input: RegisterWithWebAuthnInput
): Promise<WebAuthnAdapterResult<AttestationJSON>> {
  const mode = evaluateWebAuthnMode(input.profile);
  if (mode.mode === 'fallback') {
    return { ok: false, error: adapterError('FALLBACK_REQUIRED') };
  }
  if (mode.mode === 'blocked') {
    return { ok: false, error: adapterError('PROFILE_BLOCKED') };
  }

  const normalizedOptions = normalizeCreationOptions(input.creationOptions);
  if (!normalizedOptions) {
    return { ok: false, error: adapterError('INVALID_OPTIONS') };
  }

  const policy = resolveWebAuthnPolicy(input.profile);
  const requestOptions = applyCreationPolicy(normalizedOptions, policy);

  try {
    const result = await webAuthnCreate(requestOptions);
    const parsed = AttestationJSONSchema.safeParse(result);
    if (!parsed.success) {
      return {
        ok: false,
        error: adapterError('WEBAUTHN_ERROR', 'Invalid attestation payload'),
      };
    }

    return {
      ok: true,
      data: parsed.data as AttestationJSON,
    };
  } catch (error) {
    return { ok: false, error: normalizeWebAuthnFailure(error) };
  }
}

/**
 * Executes a WebAuthn assertion ceremony using profile-based policy.
 */
export async function assertWithWebAuthn(
  input: AssertWithWebAuthnInput
): Promise<WebAuthnAdapterResult<AssertionJSON>> {
  const mode = evaluateWebAuthnMode(input.profile);
  if (mode.mode === 'fallback') {
    return { ok: false, error: adapterError('FALLBACK_REQUIRED') };
  }
  if (mode.mode === 'blocked') {
    return { ok: false, error: adapterError('PROFILE_BLOCKED') };
  }

  const normalizedOptions = normalizeRequestOptions(input.requestOptions);
  if (!normalizedOptions) {
    return { ok: false, error: adapterError('INVALID_OPTIONS') };
  }

  const policy = resolveWebAuthnPolicy(input.profile);
  const requestOptions = applyRequestPolicy(normalizedOptions, policy);

  try {
    const result = await webAuthnGet(requestOptions);
    const parsed = AssertionJSONSchema.safeParse(result);
    if (!parsed.success) {
      return {
        ok: false,
        error: adapterError('WEBAUTHN_ERROR', 'Invalid assertion payload'),
      };
    }

    return {
      ok: true,
      data: parsed.data as AssertionJSON,
    };
  } catch (error) {
    return { ok: false, error: normalizeWebAuthnFailure(error) };
  }
}
