/**
 * Unit tests for @owlic/sdk. Each test builds its own client + mocked fetch
 * (no shared state, no beforeEach) per the repo testing guidelines.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  Owlic,
  OwlicError,
  OwlicTimeoutError,
  RateLimitError,
  UnprocessableEntityError,
} from '../index';

type FetchMock = ReturnType<typeof vi.fn> & typeof globalThis.fetch;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

function createClient(responses: Response[], options: Partial<ConstructorParameters<typeof Owlic>[0]> = {}) {
  const queue = [...responses];
  const fetchMock = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('fetch mock called more times than responses were queued');
    return next;
  }) as FetchMock;
  const client = new Owlic({
    apiKey: 'owlic_sk_test',
    fetch: fetchMock,
    dangerouslyAllowBrowser: true, // vitest runs under jsdom
    maxRetries: 0,
    ...options,
  });
  return { client, fetchMock };
}

describe('Owlic client — construction', () => {
  it('should throw a helpful OwlicError when no API key is provided', () => {
    vi.stubEnv('OWLIC_API_KEY', '');
    try {
      expect(() => new Owlic({ dangerouslyAllowBrowser: true })).toThrow(OwlicError);
      expect(() => new Owlic({ dangerouslyAllowBrowser: true })).toThrow(/OWLIC_API_KEY/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('should read the API key from the OWLIC_API_KEY environment variable', async () => {
    vi.stubEnv('OWLIC_API_KEY', 'owlic_sk_from_env');
    try {
      const fetchMock = vi.fn(async () => jsonResponse(200, { data: [] })) as FetchMock;
      const client = new Owlic({ fetch: fetchMock, dangerouslyAllowBrowser: true });
      await client.trainers.list();
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer owlic_sk_from_env');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('should refuse to run in a browser-like environment without the explicit opt-in', () => {
    // vitest uses jsdom, so window/document/navigator exist — exactly the case we guard.
    expect(() => new Owlic({ apiKey: 'owlic_sk_test' })).toThrow(/browser/i);
  });
});

describe('Owlic client — requests', () => {
  it('should send the Bearer auth header and hit the default base URL', async () => {
    const { client, fetchMock } = createClient([jsonResponse(200, { data: [] })]);

    await client.trainers.list();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.owlic.fr/v1/trainers');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer owlic_sk_test');
  });

  it('should respect a custom baseUrl (trailing slash tolerated)', async () => {
    const { client, fetchMock } = createClient([jsonResponse(200, { data: [] })], {
      baseUrl: 'http://localhost:3000/api/',
    });

    await client.trainingActions.list();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:3000/api/v1/training-actions');
  });

  it('should unwrap the { data } envelope', async () => {
    const trainer = { id: 't_1', firstName: 'Ada', lastName: 'Lovelace' };
    const { client } = createClient([jsonResponse(200, { data: [trainer] })]);

    const trainers = await client.trainers.list();

    expect(trainers).toEqual([trainer]);
  });

  it('should URL-encode path parameters', async () => {
    const { client, fetchMock } = createClient([jsonResponse(200, { data: { id: 'a/b' } })]);

    await client.trainers.get('a/b');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.owlic.fr/v1/trainers/a%2Fb');
  });

  it('should POST a JSON body with the content-type header', async () => {
    const record = { id: 'ta_1', title: 'Formation Excel avancé' };
    const { client, fetchMock } = createClient([jsonResponse(201, { data: record })]);

    const created = await client.trainingActions.create({
      title: 'Formation Excel avancé',
      requiresQualiopiCompliance: true,
    });

    expect(created).toEqual(record);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.owlic.fr/v1/training-actions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Formation Excel avancé',
      requiresQualiopiCompliance: true,
    });
  });

  it('should return whoami payload directly (no envelope)', async () => {
    const me = { authenticated: true, organizationId: 'org_1', userId: 'u_1', apiKeyId: 'k_1' };
    const { client } = createClient([jsonResponse(200, me)]);

    expect(await client.whoami()).toEqual(me);
  });

  it('should return the health payload on 503 instead of throwing', async () => {
    const unhealthy = { status: 'unhealthy', database: 'disconnected' };
    const { client } = createClient([jsonResponse(503, unhealthy)]);

    expect(await client.health()).toEqual(unhealthy);
  });
});

describe('Owlic client — pagination', () => {
  const program = (id: string) => ({ id, title: `Program ${id}` });
  const pageEnvelope = (page: number, totalPages: number, ids: string[]) => ({
    data: ids.map(program),
    pagination: { page, limit: 2, total: 3, totalPages },
  });

  it('should pass page/limit as query parameters', async () => {
    const { client, fetchMock } = createClient([jsonResponse(200, pageEnvelope(2, 5, ['p3', 'p4']))]);

    await client.trainingPrograms.list({ page: 2, limit: 2 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.owlic.fr/v1/training-programs?page=2&limit=2');
  });

  it('should expose pagination metadata and fetch the next page on demand', async () => {
    const { client } = createClient([
      jsonResponse(200, pageEnvelope(1, 2, ['p1', 'p2'])),
      jsonResponse(200, pageEnvelope(2, 2, ['p3'])),
    ]);

    const page1 = await client.trainingPrograms.list({ limit: 2 });
    expect(page1.pagination.total).toBe(3);
    expect(page1.hasNextPage()).toBe(true);

    const page2 = await page1.nextPage();
    expect(page2?.data.map((p) => p.id)).toEqual(['p3']);
    expect(page2?.hasNextPage()).toBe(false);
    expect(await page2?.nextPage()).toBeNull();
  });

  it('should auto-iterate across all pages with for await', async () => {
    const { client, fetchMock } = createClient([
      jsonResponse(200, pageEnvelope(1, 2, ['p1', 'p2'])),
      jsonResponse(200, pageEnvelope(2, 2, ['p3'])),
    ]);

    const seen: string[] = [];
    for await (const p of await client.trainingPrograms.list({ limit: 2 })) {
      seen.push(p.id);
    }

    expect(seen).toEqual(['p1', 'p2', 'p3']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondUrl] = fetchMock.mock.calls[1] as [string];
    expect(secondUrl).toContain('page=2');
  });
});

describe('Owlic client — errors', () => {
  const apiError = (code: string, message = 'boom') => ({ error: { code, message } });

  it('should map statuses to typed error classes with the envelope code', async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, BadRequestError, 'VALIDATION_ERROR'],
      [401, AuthenticationError, 'INVALID_API_KEY'],
      [404, NotFoundError, 'NOT_FOUND'],
      [422, UnprocessableEntityError, 'DOMAIN_RULE'],
    ];

    for (const [status, errorClass, code] of cases) {
      const { client } = createClient([jsonResponse(status, apiError(code))]);
      const error = await client.trainers.list().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(errorClass);
      expect((error as InstanceType<typeof BadRequestError>).status).toBe(status);
      expect((error as InstanceType<typeof BadRequestError>).code).toBe(code);
      expect((error as Error).message).toBe('boom');
    }
  });

  it('should expose retryAfter on rate-limit errors', async () => {
    const { client } = createClient([jsonResponse(429, apiError('RATE_LIMITED'), { 'retry-after': '3' })]);

    const error = await client.trainers.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(3000);
  });

  it('should time out with OwlicTimeoutError', async () => {
    const hangingFetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    ) as unknown as FetchMock;
    const client = new Owlic({
      apiKey: 'owlic_sk_test',
      fetch: hangingFetch,
      dangerouslyAllowBrowser: true,
      timeout: 10,
      maxRetries: 0,
    });

    await expect(client.trainers.list()).rejects.toBeInstanceOf(OwlicTimeoutError);
  });
});

describe('Owlic client — retries', () => {
  it('should retry a 429 (honoring Retry-After) and succeed', async () => {
    const { client, fetchMock } = createClient(
      [
        jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'slow down' } }, { 'retry-after': '0' }),
        jsonResponse(200, { data: [] }),
      ],
      { maxRetries: 2 }
    );

    expect(await client.trainers.list()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should retry a 500 and surface it once retries are exhausted', async () => {
    const failure = () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'oops' } });
    const { client, fetchMock } = createClient([failure(), failure()], { maxRetries: 1 });

    const error = await client.trainers.list().catch((e: unknown) => e);

    expect((error as InstanceType<typeof BadRequestError>).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry a 400', async () => {
    const { client, fetchMock } = createClient(
      [jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'bad' } })],
      { maxRetries: 3 }
    );

    await expect(client.trainers.list()).rejects.toBeInstanceOf(BadRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
