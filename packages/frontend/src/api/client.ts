import {
  API_BASE_PATH,
  CompoundBeginRequestSchema,
  CompoundBeginResponseSchema,
  CompoundCommitRequestSchema,
  CompoundCommitResponseSchema,
  CreateBeginRequestSchema,
  CreateBeginResponseSchema,
  CreateFinishRequestSchema,
  CreateFinishResponseSchema,
  DecryptFetchResponseSchema,
  DeleteIntentSchema,
  ErrorResponseSchema,
  FilePolicyResponseSchema,
  LockBeginRequestSchema,
  LockBeginResponseSchema,
  LockCommitRequestSchema,
  LockCommitResponseSchema,
  PublicStatusResponseSchema,
  SoftkeyCompoundCommitRequestSchema,
  UUIDSchema,
} from '@zerolink/shared';
import { z } from 'zod';

/**
 * Standardized error codes returned by the API client.
 */
export type ApiClientErrorCode =
  | 'NETWORK_ERROR'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'HTTP_ERROR'
  | (string & {});

/**
 * Represents an error state from an API client request.
 */
export interface ApiClientError {
  ok: false;
  code: ApiClientErrorCode;
  status: number | null;
  message?: string;
}

/**
 * Result of an API client operation, wrapping both success and error states.
 */
export type ApiResult<T> =
  | {
      ok: true;
      data: T;
      status: number;
    }
  | {
      ok: false;
      error: ApiClientError;
    };

/**
 * Configuration options for creating an API client.
 */
export interface ApiClientOptions {
  basePath?: string;
  fetchImpl?: typeof fetch;
}

const ManageCommitUnionSchema = z.union([
  CompoundCommitRequestSchema,
  SoftkeyCompoundCommitRequestSchema,
]);

const DeleteCommitRequestSchema = CompoundCommitRequestSchema.extend({
  intent: DeleteIntentSchema,
}).refine((value) => value.intent.uuid === value.uuid, {
  path: ['intent', 'uuid'],
  message: 'intent.uuid must match uuid',
});

const SoftkeyDeleteCommitRequestSchema = SoftkeyCompoundCommitRequestSchema.extend({
  intent: DeleteIntentSchema,
}).refine((value) => value.intent.uuid === value.uuid, {
  path: ['intent', 'uuid'],
  message: 'intent.uuid must match uuid',
});

const DeleteCommitUnionSchema = z.union([
  DeleteCommitRequestSchema,
  SoftkeyDeleteCommitRequestSchema,
]);

const DeleteCommitResponseSchema = z.object({
  ok: z.literal(true),
});

/**
 * Type alias for a delete commit request.
 */
export type DeleteCommitRequest = z.input<typeof DeleteCommitUnionSchema>;

/**
 * Type alias for a delete commit response.
 */
export type DeleteCommitResponse = z.output<typeof DeleteCommitResponseSchema>;

/**
 * The complete ZeroLink API client interface.
 */
export interface ApiClient {
  createBegin: (
    input: z.input<typeof CreateBeginRequestSchema>
  ) => Promise<ApiResult<z.output<typeof CreateBeginResponseSchema>>>;
  createFinish: (
    input: z.input<typeof CreateFinishRequestSchema>
  ) => Promise<ApiResult<z.output<typeof CreateFinishResponseSchema>>>;
  lockBegin: (
    input: z.input<typeof LockBeginRequestSchema>
  ) => Promise<ApiResult<z.output<typeof LockBeginResponseSchema>>>;
  lockCommit: (
    input: z.input<typeof LockCommitRequestSchema>
  ) => Promise<ApiResult<z.output<typeof LockCommitResponseSchema>>>;
  compoundBegin: (
    input: z.input<typeof CompoundBeginRequestSchema>
  ) => Promise<ApiResult<z.output<typeof CompoundBeginResponseSchema>>>;
  compoundCommit: (
    input: z.input<typeof ManageCommitUnionSchema>
  ) => Promise<ApiResult<z.output<typeof CompoundCommitResponseSchema>>>;
  deleteCommit: (input: DeleteCommitRequest) => Promise<ApiResult<DeleteCommitResponse>>;
  publicStatus: (
    uuid: z.input<typeof UUIDSchema>
  ) => Promise<ApiResult<z.output<typeof PublicStatusResponseSchema>>>;
  decryptFetch: (
    uuid: z.input<typeof UUIDSchema>
  ) => Promise<ApiResult<z.output<typeof DecryptFetchResponseSchema>>>;
  filePolicy: () => Promise<ApiResult<z.output<typeof FilePolicyResponseSchema>>>;
}

interface RequestJsonOptions<TInput, TRequest, TResponse> {
  method: 'GET' | 'POST';
  input: TInput;
  requestSchema: z.ZodType<TRequest>;
  buildPath: (input: TRequest) => string;
  responseSchema: z.ZodType<TResponse>;
}

function normalizeBasePath(basePath: string): string {
  if (basePath.endsWith('/')) {
    return basePath.slice(0, -1);
  }
  return basePath;
}

function joinPath(basePath: string, path: string): string {
  const normalizedBase = normalizeBasePath(basePath);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function createError(
  code: ApiClientErrorCode,
  status: number | null,
  message?: string
): ApiClientError {
  return {
    ok: false,
    code,
    status,
    ...(message ? { message } : {}),
  };
}

async function readJson(response: Response): Promise<unknown | null> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Generic JSON request executor handling schema validation and standardized error parsing.
 */
async function executeRequest<TInput, TRequest, TResponse>(
  options: RequestJsonOptions<TInput, TRequest, TResponse>,
  basePath: string,
  fetchImpl: typeof fetch
): Promise<ApiResult<TResponse>> {
  const parsedRequest = options.requestSchema.safeParse(options.input);
  if (!parsedRequest.success) {
    return { ok: false, error: createError('INVALID_REQUEST', null) };
  }

  const requestData = parsedRequest.data;
  const url = joinPath(basePath, options.buildPath(requestData));
  const requestInit: RequestInit =
    options.method === 'POST'
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestData),
        }
      : { method: 'GET' };

  let response: Response;
  try {
    response = await fetchImpl(url, requestInit);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    return { ok: false, error: createError('NETWORK_ERROR', null, message) };
  }

  if (!response.ok) {
    const errorPayload = await readJson(response);
    const parsedError = ErrorResponseSchema.safeParse(errorPayload);
    if (parsedError.success) {
      return {
        ok: false,
        error: createError(parsedError.data.code, response.status),
      };
    }
    return { ok: false, error: createError('HTTP_ERROR', response.status) };
  }

  const payload = await readJson(response);
  if (payload === null) {
    return {
      ok: false,
      error: createError('INVALID_RESPONSE', response.status),
    };
  }

  const parsedResponse = options.responseSchema.safeParse(payload);
  if (!parsedResponse.success) {
    return {
      ok: false,
      error: createError('INVALID_RESPONSE', response.status),
    };
  }

  return { ok: true, data: parsedResponse.data, status: response.status };
}

function buildCreateApi(basePath: string, fetchImpl: typeof fetch) {
  return {
    createBegin: (input: z.input<typeof CreateBeginRequestSchema>) =>
      executeRequest(
        {
          method: 'POST',
          input,
          requestSchema: CreateBeginRequestSchema,
          buildPath: (request) => `create_begin/${request.uuid}`,
          responseSchema: CreateBeginResponseSchema,
        },
        basePath,
        fetchImpl
      ),
    createFinish: (input: z.input<typeof CreateFinishRequestSchema>) =>
      executeRequest(
        {
          method: 'POST',
          input,
          requestSchema: CreateFinishRequestSchema,
          buildPath: (request) => `create_finish/${request.uuid}`,
          responseSchema: CreateFinishResponseSchema,
        },
        basePath,
        fetchImpl
      ),
  };
}

function buildLockApi(basePath: string, fetchImpl: typeof fetch) {
  return {
    lockBegin: (input: z.input<typeof LockBeginRequestSchema>) =>
      executeRequest(
        {
          method: 'POST',
          input,
          requestSchema: LockBeginRequestSchema,
          buildPath: (request) => `lock_begin/${request.uuid}`,
          responseSchema: LockBeginResponseSchema,
        },
        basePath,
        fetchImpl
      ),
    lockCommit: (input: z.input<typeof LockCommitRequestSchema>) =>
      executeRequest(
        {
          method: 'POST',
          input,
          requestSchema: LockCommitRequestSchema,
          buildPath: (request) => `lock_commit/${request.uuid}`,
          responseSchema: LockCommitResponseSchema,
        },
        basePath,
        fetchImpl
      ),
  };
}

function buildManageApi(basePath: string, fetchImpl: typeof fetch) {
  return {
    compoundBegin: (input: z.input<typeof CompoundBeginRequestSchema>) =>
      executeRequest(
        {
          method: 'POST',
          input,
          requestSchema: CompoundBeginRequestSchema,
          buildPath: (request) => `manage/compound_begin/${request.uuid}`,
          responseSchema: CompoundBeginResponseSchema,
        },
        basePath,
        fetchImpl
      ),
    compoundCommit: (input: z.input<typeof ManageCommitUnionSchema>) =>
      executeRequest(
        {
          method: 'POST',
          input,
          requestSchema: ManageCommitUnionSchema,
          buildPath: (request) => `manage/compound_commit/${request.uuid}`,
          responseSchema: CompoundCommitResponseSchema,
        },
        basePath,
        fetchImpl
      ),
    deleteCommit: (input: DeleteCommitRequest) =>
      executeRequest(
        {
          method: 'POST',
          input,
          requestSchema: DeleteCommitUnionSchema,
          buildPath: (request) => `delete_commit/${request.uuid}`,
          responseSchema: DeleteCommitResponseSchema,
        },
        basePath,
        fetchImpl
      ),
  };
}

function buildPublicApi(basePath: string, fetchImpl: typeof fetch) {
  return {
    publicStatus: (uuid: z.input<typeof UUIDSchema>) =>
      executeRequest(
        {
          method: 'GET',
          input: uuid,
          requestSchema: UUIDSchema,
          buildPath: (request) => `public/${request}`,
          responseSchema: PublicStatusResponseSchema,
        },
        basePath,
        fetchImpl
      ),
    decryptFetch: (uuid: z.input<typeof UUIDSchema>) =>
      executeRequest(
        {
          method: 'GET',
          input: uuid,
          requestSchema: UUIDSchema,
          buildPath: (request) => `decrypt_fetch/${request}`,
          responseSchema: DecryptFetchResponseSchema,
        },
        basePath,
        fetchImpl
      ),
    filePolicy: () =>
      executeRequest(
        {
          method: 'GET',
          input: 'file-policy',
          requestSchema: z.string(),
          buildPath: () => 'file_policy',
          responseSchema: FilePolicyResponseSchema,
        },
        basePath,
        fetchImpl
      ),
  };
}

/**
 * Creates and configures a new ZeroLink API client instance.
 * @param options Configuration options for the API client (e.g. basePath, custom fetch implementation).
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const basePath = options.basePath ?? API_BASE_PATH;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    ...buildCreateApi(basePath, fetchImpl),
    ...buildLockApi(basePath, fetchImpl),
    ...buildManageApi(basePath, fetchImpl),
    ...buildPublicApi(basePath, fetchImpl),
  };
}

/**
 * Default singleton instance of the API client pointing to the standard base path.
 */
export const apiClient = createApiClient();
