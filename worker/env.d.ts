declare type Fetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

declare interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

declare interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

declare interface R2HttpMetadata {
  contentType?: string;
}

declare interface R2GetOptions {}

declare interface R2ObjectBody {
  body: ReadableStream | null;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

declare interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream,
    options?: { httpMetadata?: R2HttpMetadata },
  ): Promise<void>;
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
}
