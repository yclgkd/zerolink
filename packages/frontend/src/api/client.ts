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
  LockBeginRequestSchema,
  LockBeginResponseSchema,
  LockCommitRequestSchema,
  LockCommitResponseSchema,
  PublicStatusResponseSchema,
  UUIDSchema,
} from '@zerolink/shared';
import { z } from 'zod';

export type ApiClientErrorCode =
  | 'NETWORK_ERROR'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'HTTP_ERROR'
  | (string & {});

export interface ApiClientError {
  ok: false;
  code: ApiClientErrorCode;
  status: number | null;
  message?: string;
}

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

export interface ApiClientOptions {
  basePath?: string;
  fetchImpl?: typeof fetch;
}

const DeleteCommitRequestSchema = z
  .object({
    uuid: UUIDSchema,
    intent: DeleteIntentSchema,
  })
  .refine((value) => value.intent.uuid === value.uuid, {
    path: ['intent', 'uuid'],
    message: 'intent.uuid must match uuid',
  });

const DeleteCommitResponseSchema = z.object({
  ok: z.literal(true),
});

export type DeleteCommitRequest = z.input<typeof DeleteCommitRequestSchema>;
export type DeleteCommitResponse = z.output<typeof DeleteCommitResponseSchema>;

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
    input: z.input<typeof CompoundCommitRequestSchema>
  ) => Promise<ApiResult<z.output<typeof CompoundCommitResponseSchema>>>;
  deleteCommit: (input: DeleteCommitRequest) => Promise<ApiResult<DeleteCommitResponse>>;
  publicStatus: (
    uuid: z.input<typeof UUIDSchema>
  ) => Promise<ApiResult<z.output<typeof PublicStatusResponseSchema>>>;
  decryptFetch: (
    uuid: z.input<typeof UUIDSchema>
  ) => Promise<ApiResult<z.output<typeof DecryptFetchResponseSchema>>>;
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

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const basePath = options.basePath ?? API_BASE_PATH;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function requestJson<TInput, TRequest, TResponse>(
    options: RequestJsonOptions<TInput, TRequest, TResponse>
  ): Promise<ApiResult<TResponse>> {
    const parsedRequest = options.requestSchema.safeParse(options.input);
    if (!parsedRequest.success) {
      return {
        ok: false,
        error: createError('INVALID_REQUEST', null),
      };
    }

    const requestData = parsedRequest.data;
    const url = joinPath(basePath, options.buildPath(requestData));
    const requestInit: RequestInit =
      options.method === 'POST'
        ? {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
          }
        : {
            method: 'GET',
          };

    let response: Response;
    try {
      response = await fetchImpl(url, requestInit);
    } catch (error) {
      return {
        ok: false,
        error: createError(
          'NETWORK_ERROR',
          null,
          error instanceof Error ? error.message : 'Network request failed'
        ),
      };
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

      return {
        ok: false,
        error: createError('HTTP_ERROR', response.status),
      };
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

    return {
      ok: true,
      data: parsedResponse.data,
      status: response.status,
    };
  }

  return {
    createBegin: (input) =>
      requestJson({
        method: 'POST',
        input,
        requestSchema: CreateBeginRequestSchema,
        buildPath: (request) => `create_begin/${request.uuid}`,
        responseSchema: CreateBeginResponseSchema,
      }),

    createFinish: (input) =>
      requestJson({
        method: 'POST',
        input,
        requestSchema: CreateFinishRequestSchema,
        buildPath: (request) => `create_finish/${request.uuid}`,
        responseSchema: CreateFinishResponseSchema,
      }),

    lockBegin: (input) =>
      requestJson({
        method: 'POST',
        input,
        requestSchema: LockBeginRequestSchema,
        buildPath: (request) => `lock_begin/${request.uuid}`,
        responseSchema: LockBeginResponseSchema,
      }),

    lockCommit: (input) =>
      requestJson({
        method: 'POST',
        input,
        requestSchema: LockCommitRequestSchema,
        buildPath: (request) => `lock_commit/${request.uuid}`,
        responseSchema: LockCommitResponseSchema,
      }),

    compoundBegin: (input) =>
      requestJson({
        method: 'POST',
        input,
        requestSchema: CompoundBeginRequestSchema,
        buildPath: (request) => `manage/compound_begin/${request.uuid}`,
        responseSchema: CompoundBeginResponseSchema,
      }),

    compoundCommit: (input) =>
      requestJson({
        method: 'POST',
        input,
        requestSchema: CompoundCommitRequestSchema,
        buildPath: (request) => `manage/compound_commit/${request.uuid}`,
        responseSchema: CompoundCommitResponseSchema,
      }),

    deleteCommit: (input) =>
      requestJson({
        method: 'POST',
        input,
        requestSchema: DeleteCommitRequestSchema,
        buildPath: (request) => `delete_commit/${request.uuid}`,
        responseSchema: DeleteCommitResponseSchema,
      }),

    publicStatus: (uuid) =>
      requestJson({
        method: 'GET',
        input: uuid,
        requestSchema: UUIDSchema,
        buildPath: (request) => `public/${request}`,
        responseSchema: PublicStatusResponseSchema,
      }),

    decryptFetch: (uuid) =>
      requestJson({
        method: 'GET',
        input: uuid,
        requestSchema: UUIDSchema,
        buildPath: (request) => `decrypt_fetch/${request}`,
        responseSchema: DecryptFetchResponseSchema,
      }),
  };
}

export const apiClient = createApiClient();
