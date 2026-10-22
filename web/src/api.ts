export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body?: unknown) => call<T>(path, 'POST', body),
  put: <T>(path: string, body?: unknown) => call<T>(path, 'PUT', body),
  patch: <T>(path: string, body?: unknown) => call<T>(path, 'PATCH', body),
  del: <T>(path: string) => call<T>(path, 'DELETE'),
};

export async function apiText(path: string): Promise<string> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
  return res.text();
}

export function download(path: string): void {
  const a = document.createElement('a');
  a.href = `/api${path}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
