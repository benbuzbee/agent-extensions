// Minimal outbound-fetch mock for the worker integration suite.
//
// WHY THIS EXISTS: @cloudflare/vitest-pool-workers removed the built-in
// `fetchMock` (undici MockAgent) export in 0.13.0 (the Vitest 4 / 0.16 line).
// The upstream guidance is to "mock globalThis.fetch or use a library like MSW".
// This is a tiny, dependency-free shim that mocks `globalThis.fetch` while
// preserving the EXACT guarantees the proxy suite relies on:
//   * disableNetConnect(): any unmatched outbound call THROWS (no real network).
//   * single-use interceptors matched by origin + method + path(+query).
//   * assertNoPendingInterceptors(): unused mocks (or accidental real-GitHub
//     calls) fail the test loudly.
// The public surface intentionally mirrors the old API
// (`get(origin).intercept({method,path}).reply(status, body, {headers})`) so the
// security tests port over verbatim, with no assertions weakened.

interface Interceptor {
  origin: string;
  method: string;
  path: string; // pathname + search, matched exactly
  status: number;
  body: string;
  headers: Record<string, string>;
  consumed: boolean;
}

class MockScope {
  constructor(private readonly i: Interceptor) {}
  reply(
    status: number,
    body: string | unknown = "",
    opts: { headers?: Record<string, string> } = {},
  ): MockScope {
    this.i.status = status;
    this.i.body = typeof body === "string" ? body : JSON.stringify(body);
    this.i.headers = opts.headers ?? {};
    return this;
  }
}

class Interceptable {
  constructor(
    private readonly origin: string,
    private readonly add: (i: Interceptor) => void,
  ) {}
  intercept(opts: { method?: string; path: string }): MockScope {
    const i: Interceptor = {
      origin: this.origin,
      method: (opts.method ?? "GET").toUpperCase(),
      path: opts.path,
      status: 200,
      body: "",
      headers: {},
      consumed: false,
    };
    this.add(i);
    return new MockScope(i);
  }
}

class FetchMock {
  private interceptors: Interceptor[] = [];
  private netDisabled = false;
  private original: typeof globalThis.fetch | null = null;

  /** Install the mock over globalThis.fetch. */
  activate(): void {
    if (this.original) return;
    this.original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      this.handle(input, init)) as typeof globalThis.fetch;
  }

  /** Restore the real fetch and drop any interceptors. */
  deactivate(): void {
    if (this.original) globalThis.fetch = this.original;
    this.original = null;
    this.interceptors = [];
    this.netDisabled = false;
  }

  disableNetConnect(): void {
    this.netDisabled = true;
  }

  get(origin: string): Interceptable {
    return new Interceptable(origin, (i) => this.interceptors.push(i));
  }

  pendingInterceptors(): Interceptor[] {
    return this.interceptors.filter((i) => !i.consumed);
  }

  assertNoPendingInterceptors(): void {
    const pending = this.pendingInterceptors();
    if (pending.length > 0) {
      const lines = pending
        .map((i) => `  ${i.method} ${i.origin}${i.path}`)
        .join("\n");
      throw new Error(`Unused fetch interceptors:\n${lines}`);
    }
    // Reset for the next test so interceptors do not leak across cases.
    this.interceptors = [];
  }

  private async handle(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const method = (
      init?.method ??
      (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const origin = url.origin;
    const path = url.pathname + url.search;

    const match = this.interceptors.find(
      (i) =>
        !i.consumed &&
        i.origin === origin &&
        i.method === method &&
        i.path === path,
    );
    if (!match) {
      // No interceptor: this is exactly the disableNetConnect() guard -- any
      // unmocked outbound call (e.g. a real GitHub hit) blows up the test.
      if (this.netDisabled) {
        throw new Error(`Unmocked outbound fetch: ${method} ${origin}${path}`);
      }
      if (this.original) return this.original(input as RequestInfo, init);
      throw new Error(`No fetch interceptor for ${method} ${origin}${path}`);
    }
    match.consumed = true;
    return new Response(match.body, {
      status: match.status,
      headers: match.headers,
    });
  }
}

/** Drop-in replacement for the removed `cloudflare:test` fetchMock. */
export const fetchMock = new FetchMock();
