# @owlic/sdk

Official TypeScript SDK for the [Owlic public API](https://api.owlic.fr/docs).

- **Fully typed** — every request/response type is inferred from `@owlic/api-contract`, the same Zod schemas that generate the OpenAPI document served at `/v1/openapi.json`. The SDK cannot drift from the API.
- **Zero runtime dependencies** — a thin layer over `fetch`. Works on Node.js ≥ 18, Vercel/edge runtimes, Bun and Deno.
- **Batteries included** — automatic retries with exponential backoff (`Retry-After` aware), per-request timeout & abort, typed errors, auto-pagination.

## Installation

Inside the monorepo the package is available directly:

```ts
import { Owlic } from '@owlic/sdk';
```

For external consumers, publishing to npm requires adding a build step (e.g. `tsup`) since workspace packages ship raw TypeScript — see “Publishing” below.

## Quickstart

```ts
import { Owlic } from '@owlic/sdk';

const owlic = new Owlic({
  apiKey: process.env.OWLIC_API_KEY, // 'owlic_sk_…' — created from the Owlic dashboard
});

// Check your credentials
const me = await owlic.whoami();
console.log(me.organizationId);

// Read resources
const trainers = await owlic.trainers.list();
const action = await owlic.trainingActions.get('action-id');

// Drive the Qualiopi workflow end-to-end
const created = await owlic.trainingActions.create({
  title: 'Formation Excel avancé',
  requiresQualiopiCompliance: true,
});

await owlic.trainingActions.saveBeneficiaries(created.id, {
  beneficiaries: [
    { firstName: 'Florian', lastName: 'Truchot', email: 'support@owlic.fr', companySiret: '99499860700018' },
  ],
  companies: [
    { siret: '99499860700018', denominationSociale: 'OWLIC', ville: 'Lyon', codePostal: '69001' },
  ],
  replaceExisting: true,
});
```

`new Owlic()` with no arguments reads `OWLIC_API_KEY` (and optionally `OWLIC_BASE_URL`) from the environment.

> ⚠️ **Server-side only.** API keys are secrets — never ship them to a browser. The constructor throws if it detects a browser environment (override with `dangerouslyAllowBrowser: true` at your own risk).

## Configuration

```ts
const owlic = new Owlic({
  apiKey: 'owlic_sk_…',            // default: process.env.OWLIC_API_KEY
  baseUrl: 'https://api.owlic.fr', // default: process.env.OWLIC_BASE_URL ?? https://api.owlic.fr
  timeout: 30_000,                 // ms per attempt (default 30s)
  maxRetries: 2,                   // retries for 429/5xx/network failures (default 2)
  fetch: customFetch,              // bring your own fetch (proxy, instrumentation…)
  defaultHeaders: { 'x-request-source': 'my-integration' },
});
```

Every method also accepts per-request options as its last argument:

```ts
await owlic.trainers.list({ timeout: 5_000, maxRetries: 0, signal: abortController.signal });
```

## API surface

| SDK method | Endpoint |
|---|---|
| `owlic.whoami()` | `GET /v1/whoami` |
| `owlic.health()` | `GET /health` (no auth; returns the payload even on 503) |
| `owlic.trainers.list()` | `GET /v1/trainers` |
| `owlic.trainers.get(id)` | `GET /v1/trainers/{trainerId}` |
| `owlic.trainingPrograms.list({ page, limit })` | `GET /v1/training-programs` |
| `owlic.trainingPrograms.get(id)` | `GET /v1/training-programs/{programId}` |
| `owlic.trainingActions.list()` | `GET /v1/training-actions` |
| `owlic.trainingActions.get(id)` | `GET /v1/training-actions/{actionId}` |
| `owlic.trainingActions.create(body)` | `POST /v1/training-actions` |
| `owlic.trainingActions.saveNeedsAnalysis(id, body)` | `POST /v1/training-actions/{actionId}/needs-analysis` |
| `owlic.trainingActions.saveBeneficiaries(id, body)` | `POST /v1/training-actions/{actionId}/beneficiaries` |
| `owlic.trainingActions.assignProgram(id, body)` | `POST /v1/training-actions/{actionId}/program` |
| `owlic.trainingActions.planSessions(id, body)` | `POST /v1/training-actions/{actionId}/sessions` |
| `owlic.trainingActions.assignTrainers(id, body)` | `POST /v1/training-actions/{actionId}/trainers` |
| `owlic.trainingActions.setPricing(id, body)` | `POST /v1/training-actions/{actionId}/pricing` |
| `owlic.trainingActions.generateConvention(id, body)` | `POST /v1/training-actions/{actionId}/convention` |

Responses are unwrapped: methods return the resource itself (the API's `{ data }` envelope is handled for you).

For an endpoint the SDK doesn't wrap yet, use the escape hatch — it reuses auth, retries, timeout and error mapping:

```ts
const raw = await owlic.request<{ data: unknown }>('GET', '/v1/new-endpoint', { query: { page: 1 } });
```

## Pagination

Paginated endpoints return a `Page<T>`:

```ts
const page = await owlic.trainingPrograms.list({ limit: 50 });

page.data;               // TrainingProgram[] — this page
page.pagination;         // { page, limit, total, totalPages }
await page.nextPage();   // Page<TrainingProgram> | null

// Or let the SDK walk all pages for you:
for await (const program of page) {
  console.log(program.title);
}
```

## Error handling

All failures extend `OwlicError`. HTTP errors are `OwlicAPIError` subclasses carrying `status` + the API's machine-readable `code`:

```ts
import { NotFoundError, RateLimitError, OwlicAPIError } from '@owlic/sdk';

try {
  await owlic.trainers.get('unknown-id');
} catch (error) {
  if (error instanceof NotFoundError) {
    // 404 — not in your organization
  } else if (error instanceof RateLimitError) {
    console.log(`Retry in ${error.retryAfter}ms`); // already retried `maxRetries` times
  } else if (error instanceof OwlicAPIError) {
    console.log(error.status, error.code, error.message);
  }
}
```

| Class | Status | Meaning |
|---|---|---|
| `BadRequestError` | 400 | Invalid request body/parameters |
| `AuthenticationError` | 401 | Missing or invalid API key |
| `PermissionDeniedError` | 403 | Key disabled/expired, or `apiKeys` feature off |
| `NotFoundError` | 404 | Resource not found in your organization |
| `UnprocessableEntityError` | 422 | Rejected by a domain rule |
| `RateLimitError` | 429 | Rate limit / quota exceeded (`retryAfter` in ms) |
| `InternalServerError` | 5xx | API-side failure |
| `OwlicConnectionError` | — | Network failure (no HTTP response) |
| `OwlicTimeoutError` | — | Request exceeded `timeout` |

429, 5xx, timeouts and connection errors are retried automatically (`maxRetries`, exponential backoff, honors `Retry-After`). 4xx client errors are never retried.

## Types

All request/response types are exported:

```ts
import type { Trainer, TrainingProgramDetail, CreateTrainingActionRequest } from '@owlic/sdk';
```

They are `z.infer<…>` of the `@owlic/api-contract` schemas — the single source of truth shared with the OpenAPI document, so a contract change immediately surfaces as a compile error here.

## Publishing (later)

The package follows the repo's source-only convention (`main` → `src/index.ts`, ADR-31). To publish it on npm for external consumers:

1. Add a bundler (`tsup src/index.ts --format esm,cjs --dts`) and point `exports` at `dist/`.
2. Inline `@owlic/api-contract` types at build time (`tsup --dts-resolve`) or publish the contract package alongside.
3. Drop `"private": true`, version with changesets/semver.

## Development

```bash
npm run type:check --workspace @owlic/sdk   # type-check
npx vitest run packages/sdk/src              # tests
```
