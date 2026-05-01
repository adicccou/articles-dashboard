export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

export function text(message: string, status = 400): Response {
  return new Response(message, { status });
}

export async function parseJson<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}
