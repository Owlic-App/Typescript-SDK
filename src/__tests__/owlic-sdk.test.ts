/**
 * Unit tests for @owlic/sdk. Each test builds its own client + mocked fetch
 * (no shared state, no beforeEach) per the repo testing guidelines.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  AuthenticationError,
  BadRequestError,
  InternalServerError,
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

/** A response whose body is not JSON (e.g. an HTML load-balancer error page). */
function nonJsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
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

describe('Owlic client — construction & auth', () => {
  it('should reject authenticated calls with a helpful OwlicError when no API key is available', async () => {
    vi.stubEnv('OWLIC_API_KEY', '');
    try {
      const fetchMock = vi.fn() as FetchMock;
      const client = new Owlic({ fetch: fetchMock });
      await expect(client.whoami()).rejects.toThrow(/OWLIC_API_KEY/);
      await expect(client.trainers.list()).rejects.toBeInstanceOf(OwlicError);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('should allow a keyless client to call the open health endpoint, without an Authorization header', async () => {
    vi.stubEnv('OWLIC_API_KEY', '');
    try {
      const payload = { status: 'ok', database: 'connected' };
      const fetchMock = vi.fn(async () => jsonResponse(200, payload)) as FetchMock;
      const client = new Owlic({ fetch: fetchMock });

      expect(await client.health()).toEqual(payload);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.owlic.fr/health');
      expect((init.headers as Record<string, string>).authorization).toBeUndefined();
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

  it('should refuse an API key in a browser-like environment without the explicit opt-in', () => {
    // vitest uses jsdom, so window/document/navigator exist — exactly the case we guard.
    expect(() => new Owlic({ apiKey: 'owlic_sk_test' })).toThrow(/browser/i);
    // A keyless client has no secret to leak — allowed even in a browser.
    vi.stubEnv('OWLIC_API_KEY', '');
    try {
      expect(() => new Owlic({ fetch: vi.fn() as FetchMock })).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
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

  it('should merge headers case-insensitively, user headers overriding client defaults', async () => {
    const { client, fetchMock } = createClient([jsonResponse(200, {})], {
      defaultHeaders: { 'X-Request-Source': 'integration' },
    });

    await client.request('POST', '/v1/whatever', {
      body: { ok: true },
      options: { headers: { 'Content-Type': 'text/plain', AUTHORIZATION: 'Bearer overridden' } },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // Single lowercase key per header — no case-variant duplicates combined by fetch.
    expect(headers['content-type']).toBe('text/plain');
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers.authorization).toBe('Bearer overridden');
    expect(headers.AUTHORIZATION).toBeUndefined();
    expect(headers['x-request-source']).toBe('integration');
  });

  it('should return whoami payload directly (no envelope)', async () => {
    const me = { authenticated: true, organizationId: 'org_1', userId: 'u_1', apiKeyId: 'k_1' };
    const { client } = createClient([jsonResponse(200, me)]);

    expect(await client.whoami()).toEqual(me);
  });

  it('should return the health payload on a JSON 503 instead of throwing', async () => {
    const unhealthy = { status: 'unhealthy', database: 'disconnected' };
    const { client } = createClient([jsonResponse(503, unhealthy)]);

    expect(await client.health()).toEqual(unhealthy);
  });

  it('should throw (not resolve to undefined) when an accepted 503 has a non-JSON body', async () => {
    const { client } = createClient([nonJsonResponse(503)]);

    const error = await client.health().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InternalServerError);
    expect((error as InternalServerError).status).toBe(503);
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
      expect((error as BadRequestError).status).toBe(status);
      expect((error as BadRequestError).code).toBe(code);
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

  it('should time out even when the server stalls AFTER sending headers (slow body)', async () => {
    // fetch resolves immediately, but the body read hangs until the request signal aborts.
    const stalledBodyFetch = vi.fn(async (_url: string, init: RequestInit) => {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('body read aborted')));
          }),
      } as unknown as Response;
    }) as unknown as FetchMock;
    const client = new Owlic({
      apiKey: 'owlic_sk_test',
      fetch: stalledBodyFetch,
      dangerouslyAllowBrowser: true,
      timeout: 10,
      maxRetries: 0,
    });

    await expect(client.trainers.list()).rejects.toBeInstanceOf(OwlicTimeoutError);
  });
});

describe('Owlic client — retries', () => {
  it('should retry a 429 (honoring Retry-After) and succeed, on GET', async () => {
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

  it('should retry a 429 on POST too (rate-limited requests are rejected before processing)', async () => {
    const record = { id: 'ta_1' };
    const { client, fetchMock } = createClient(
      [
        jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'slow down' } }, { 'retry-after': '0' }),
        jsonResponse(201, { data: record }),
      ],
      { maxRetries: 2 }
    );

    expect(await client.trainingActions.create({ title: 'Test', requiresQualiopiCompliance: false })).toEqual(record);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry a quota-exhausted 429 (USAGE_EXCEEDED is not transient)', async () => {
    const { client, fetchMock } = createClient(
      [jsonResponse(429, { error: { code: 'USAGE_EXCEEDED', message: 'quota' } }, { 'retry-after': '0' })],
      { maxRetries: 3 }
    );

    await expect(client.trainers.list()).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should retry a 500 on GET and surface it once retries are exhausted', async () => {
    const failure = () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'oops' } });
    const { client, fetchMock } = createClient([failure(), failure()], { maxRetries: 1 });

    const error = await client.trainers.list().catch((e: unknown) => e);

    expect((error as InternalServerError).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry a 500 on POST (no idempotency keys — a replay could duplicate the resource)', async () => {
    const { client, fetchMock } = createClient(
      [jsonResponse(500, { error: { code: 'INTERNAL', message: 'oops' } })],
      { maxRetries: 3 }
    );

    await expect(
      client.trainingActions.create({ title: 'Test', requiresQualiopiCompliance: false })
    ).rejects.toBeInstanceOf(InternalServerError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry a 400', async () => {
    const { client, fetchMock } = createClient(
      [jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'bad' } })],
      { maxRetries: 3 }
    );

    await expect(client.trainers.list()).rejects.toBeInstanceOf(BadRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should abort the retry backoff immediately when the caller aborts', async () => {
    const { client, fetchMock } = createClient(
      [jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'slow down' } }, { 'retry-after': '30' })],
      { maxRetries: 2 }
    );
    const controller = new AbortController();
    const startedAt = Date.now();
    setTimeout(() => controller.abort(new Error('caller aborted')), 25);

    const error = await client.trainers.list({ signal: controller.signal }).catch((e: unknown) => e);

    expect((error as Error).message).toBe('caller aborted');
    expect(Date.now() - startedAt).toBeLessThan(5_000); // nowhere near the 30s Retry-After
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Owlic client — training program writes', () => {
  it('should create a program (POST + JSON body, unwrapped data)', async () => {
    const record = {
      id: 'tp_1',
      title: 'Formation',
      description: null,
      modulesCount: 0,
      totalDuration: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { client, fetchMock } = createClient([jsonResponse(201, { data: record })]);

    const created = await client.trainingPrograms.create({ title: 'Formation', priceExcludingTax: 900 });

    expect(created).toEqual(record);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.owlic.fr/v1/training-programs');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Formation', priceExcludingTax: 900 });
  });

  it('should PATCH core fields', async () => {
    const { client, fetchMock } = createClient([jsonResponse(200, { data: { id: 'tp_1', title: 'New' } })]);

    await client.trainingPrograms.update('tp_1', { title: 'New', priceExcludingTax: 1500 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.owlic.fr/v1/training-programs/tp_1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'New', priceExcludingTax: 1500 });
  });

  it('should DELETE a program without a body or content-type', async () => {
    const { client, fetchMock } = createClient([jsonResponse(200, { data: { id: 'tp_1', deleted: true } })]);

    const res = await client.trainingPrograms.delete('tp_1');

    expect(res).toEqual({ id: 'tp_1', deleted: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.owlic.fr/v1/training-programs/tp_1');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('should PUT the module/activity tree', async () => {
    const { client, fetchMock } = createClient([jsonResponse(200, { data: { id: 'tp_1', modules: [] } })]);

    await client.trainingPrograms.replaceModules('tp_1', {
      modules: [{ name: 'M1', activities: [{ name: 'A1', durationMinutes: 60 }] }],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.owlic.fr/v1/training-programs/tp_1/modules');
    expect(init.method).toBe('PUT');
  });

  it('should add and remove trainers (nested, URL-encoded path)', async () => {
    const { client, fetchMock } = createClient([
      jsonResponse(200, { data: { programId: 'tp_1', trainerIds: ['tr_1'] } }),
      jsonResponse(200, { data: { programId: 'tp_1', trainerIds: [] } }),
    ]);

    const added = await client.trainingPrograms.addTrainers('tp_1', { trainerIds: ['tr_1'] });
    expect(added.trainerIds).toEqual(['tr_1']);
    const [addUrl, addInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(addUrl).toBe('https://api.owlic.fr/v1/training-programs/tp_1/trainers');
    expect(addInit.method).toBe('POST');

    const removed = await client.trainingPrograms.removeTrainer('tp_1', 'tr/1');
    expect(removed.trainerIds).toEqual([]);
    const [rmUrl, rmInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(rmUrl).toBe('https://api.owlic.fr/v1/training-programs/tp_1/trainers/tr%2F1');
    expect(rmInit.method).toBe('DELETE');
  });

  it('should PATCH positioning and evaluation URL references', async () => {
    const { client, fetchMock } = createClient([
      jsonResponse(200, { data: { id: 'tp_1', positioningQuestionnaireUrl: 'https://x' } }),
      jsonResponse(200, { data: { id: 'tp_1', evaluationExternalLink: 'https://y' } }),
    ]);

    await client.trainingPrograms.updatePositioning('tp_1', { positioningQuestionnaireUrl: 'https://x' });
    await client.trainingPrograms.updateEvaluation('tp_1', { evaluationExternalLink: 'https://y' });

    const [posUrl, posInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(posUrl).toBe('https://api.owlic.fr/v1/training-programs/tp_1/positioning');
    expect(posInit.method).toBe('PATCH');
    const [evalUrl, evalInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(evalUrl).toBe('https://api.owlic.fr/v1/training-programs/tp_1/evaluation');
    expect(evalInit.method).toBe('PATCH');
  });
});

describe('Owlic client — contract conformance', () => {
  it('should cover every route declared in the business registry', async () => {
    const { buildBusinessRegistry } = await import('../../../api-contract/src/businessRegistry');
    const registry = buildBusinessRegistry();
    const declared = registry.definitions
      .filter((d): d is Extract<typeof d, { type: 'route' }> => d.type === 'route')
      .map((d) => `${d.route.method.toUpperCase()} ${d.route.path.replace(/\{[^}]+\}/g, 'SENTINEL-ID')}`);
    expect(declared.length).toBeGreaterThanOrEqual(16);

    const called = new Set<string>();
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      called.add(`${init.method} ${new URL(url).pathname}`);
      return jsonResponse(200, { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    }) as unknown as FetchMock;
    const client = new Owlic({ apiKey: 'owlic_sk_test', fetch: fetchMock, dangerouslyAllowBrowser: true });

    const ID = 'SENTINEL-ID';
    await client.whoami();
    await client.health();
    await client.trainers.list();
    await client.trainers.get(ID);
    await client.trainingPrograms.list();
    await client.trainingPrograms.get(ID);
    await client.trainingPrograms.create({ title: 'P' });
    await client.trainingPrograms.update(ID, { title: 'P2' });
    await client.trainingPrograms.delete(ID);
    await client.trainingPrograms.replaceModules(ID, { modules: [] });
    await client.trainingPrograms.addTrainers(ID, { trainerIds: ['00000000-0000-0000-0000-000000000001'] });
    await client.trainingPrograms.removeTrainer(ID, ID);
    await client.trainingPrograms.updatePositioning(ID, { positioningQuestionnaireUrl: 'https://forms.example/x' });
    await client.trainingPrograms.updateEvaluation(ID, { evaluationExternalLink: 'https://forms.example/y' });
    await client.trainingActions.list();
    await client.trainingActions.get(ID);
    await client.trainingActions.create({ title: 'T', requiresQualiopiCompliance: false });
    await client.trainingActions.saveNeedsAnalysis(ID, {
      interestedProgram: 'P',
      trainingObjectives: ['O'],
      concreteApplications: 'A',
      improvementPoints: 'I',
    });
    await client.trainingActions.saveBeneficiaries(ID, { beneficiaries: [] });
    await client.trainingActions.assignProgram(ID, { trainingProgramId: 'p_1' });
    await client.trainingActions.planSessions(ID, { sessions: [] });
    await client.trainingActions.assignTrainers(ID, { trainers: [] });
    await client.trainingActions.setPricing(ID, { pricingData: { expenses: [] } });
    await client.trainingActions.generateConvention(ID, {
      templateId: '00000000-0000-0000-0000-000000000000',
      beneficiaryIds: ['00000000-0000-0000-0000-000000000001'],
      conventionTitle: 'C',
      useCustomClauses: false,
      generatePdf: false,
      sendNotifications: false,
    });

    const missing = declared.filter((route) => !called.has(route));
    expect(missing).toEqual([]); // every contract route must have an SDK method hitting it
  });
});
