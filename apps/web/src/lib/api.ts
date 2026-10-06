/** An error from the API, in the vocabulary of its problem documents. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | null;
  constructor(status: number, code: string, title: string, detail: string | null) {
    super(title);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
  /** Something a person can read: the detail if there is one, else the title. */
  get readable(): string {
    return this.detail ?? this.message;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => {
    throw new ApiError(
      0,
      'NETWORK',
      'The server could not be reached.',
      'Is the demo API running? Try `pnpm dev:demo`.',
    );
  });
  const text = await response.text();
  const json: unknown = text === '' ? null : safeJson(text);
  if (!response.ok) {
    const problem = (json ?? {}) as {
      code?: string;
      title?: string;
      detail?: string;
    };
    throw new ApiError(
      response.status,
      problem.code ?? 'ERROR',
      problem.title ?? response.statusText,
      problem.detail ?? null,
    );
  }
  return json as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};
