# @owlic/sdk

Official TypeScript SDK for the [Owlic public API](https://api.owlic.fr/docs).

- **Fully typed** — every request/response type is inferred from `@owlic/api-contract`, the same Zod schemas that generate the OpenAPI document served at `/v1/openapi.json`. The SDK cannot drift from the API.
- **No runtime imports** — a thin layer over `fetch` (zod appears only as a type-level dependency). Works on Node.js ≥ 18, Vercel/edge runtimes, Bun and Deno.
- **Batteries included** — automatic retries with exponential backoff (`Retry-After` aware), per-request timeout & abort, typed errors, auto-pagination.

## Installation

```bash
npm install @owlic/sdk
```

Inside the Owlic monorepo the package is consumed directly from source (root tsconfig paths) — no install needed.

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

`new Owlic()` with no arguments reads `OWLIC_API_KEY` (and optionally `OWLIC_BASE_URL`) from the environment. A keyless client is allowed and can call the open endpoints (`health()`); authenticated methods then throw a helpful error at call time.

> ⚠️ **Server-side only.** API keys are secrets — never ship them to a browser. The constructor throws if it detects a browser environment while an API key is configured (override with `dangerouslyAllowBrowser: true` at your own risk).

## Configuration

```ts
const owlic = new Owlic({
  apiKey: 'owlic_sk_…',            // default: process.env.OWLIC_API_KEY
  baseUrl: 'https://api.owlic.fr', // default: process.env.OWLIC_BASE_URL ?? https://api.owlic.fr
  timeout: 30_000,                 // ms per attempt, covers the body read (default 30s)
  maxRetries: 2,                   // see "Retries" below (default 2)
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
| `owlic.health()` | `GET /health` (no auth — works on a keyless client; returns the payload even on 503) |
| `owlic.trainers.list()` | `GET /v1/trainers` |
| `owlic.trainers.get(id)` | `GET /v1/trainers/{trainerId}` |
| `owlic.trainingPrograms.list({ page, limit })` | `GET /v1/training-programs` |
| `owlic.trainingPrograms.get(id)` | `GET /v1/training-programs/{programId}` |
| `owlic.trainingPrograms.create(body)` | `POST /v1/training-programs` |
| `owlic.trainingPrograms.update(id, body)` | `PATCH /v1/training-programs/{programId}` (core fields) |
| `owlic.trainingPrograms.delete(id)` | `DELETE /v1/training-programs/{programId}` (soft delete) |
| `owlic.trainingPrograms.replaceModules(id, body)` | `PUT /v1/training-programs/{programId}/modules` |
| `owlic.trainingPrograms.addTrainers(id, body)` | `POST /v1/training-programs/{programId}/trainers` |
| `owlic.trainingPrograms.removeTrainer(id, trainerId)` | `DELETE /v1/training-programs/{programId}/trainers/{trainerId}` |
| `owlic.trainingPrograms.updatePositioning(id, body)` | `PATCH /v1/training-programs/{programId}/positioning` |
| `owlic.trainingPrograms.updateEvaluation(id, body)` | `PATCH /v1/training-programs/{programId}/evaluation` |
| `owlic.trainingActions.list()` | `GET /v1/training-actions` |
| `owlic.trainingActions.get(id)` | `GET /v1/training-actions/{actionId}` |
| `owlic.trainingActions.create(body)` | `POST /v1/training-actions` |
| `owlic.trainingActions.saveNeedsAnalysis(id, body)` | `POST /v1/training-actions/{actionId}/needs-analysis` |
| `owlic.trainingActions.saveBeneficiaries(id, body)` | `POST /v1/training-actions/{actionId}/beneficiaries` |
| `owlic.trainingActions.assignProgram(id, body)` | `POST /v1/training-actions/{actionId}/program` |
| `owlic.trainingActions.planSessions(id, body)` | `POST /v1/training-actions/{actionId}/sessions` |
| `owlic.trainingActions.setPeriod(id, body)` | `POST /v1/training-actions/{actionId}/period` |
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
| `PermissionDeniedError` | 403 | Key disabled/expired |
| `NotFoundError` | 404 | Resource not found in your organization |
| `UnprocessableEntityError` | 422 | Rejected by a domain rule |
| `RateLimitError` | 429 | Rate limit / quota exceeded (`retryAfter` in ms) |
| `InternalServerError` | 5xx | API-side failure |
| `OwlicConnectionError` | — | Network failure (no HTTP response) |
| `OwlicTimeoutError` | — | Request exceeded `timeout` |

### Retries

Retries (`maxRetries`, exponential backoff, honors `Retry-After`) are **method-aware**:

- **429** is retried for every method — the API's rate limiters reject requests *before* processing them, so a retry can never duplicate work. Exceptions: quota exhaustion (`USAGE_EXCEEDED`) is never retried, and a `Retry-After` beyond 60s fails fast instead of blocking.
- **Timeouts, connection errors and 5xx** are retried for idempotent methods only (GET/HEAD/PUT/DELETE). **POSTs are never replayed** after a timeout or 5xx: the API has no idempotency keys, and the server may have committed the write before the failure — a replay could silently duplicate the resource (e.g. a training action and its Qualiopi folder).
- Other 4xx client errors are never retried.

Aborting via `RequestOptions.signal` takes effect immediately, including during a retry backoff.

## Types

All request/response types are exported:

```ts
import type { Trainer, TrainingProgramDetail, CreateTrainingActionRequest } from '@owlic/sdk';
```

They are `z.infer<…>` of the `@owlic/api-contract` schemas — the single source of truth shared with the OpenAPI document, so a contract change immediately surfaces as a compile error here.

## Public mirror

This package is mirrored to [`Owlic-App/Typescript-SDK`](https://github.com/Owlic-App/Typescript-SDK) by the `Sync SDK Mirror` GitHub Action (`.github/workflows/sync-sdk-mirror.yml`): every merge to `main` touching `packages/sdk/**` force-pushes a fresh `git subtree split` of this directory over the mirror's `main`. The monorepo is the single source of truth — **never commit to the mirror directly**, changes there are overwritten on the next sync.

## Changelog

### 0.3.0

- **Training-action period** — added `trainingActions.setPeriod(id, { startDate, endDate })` (`POST /v1/training-actions/{actionId}/period`, dates `YYYY-MM-DD`) and the `SetPeriodRequest` / `TrainingActionPeriod` types: records the period of a training action whose session dates are not known yet. Planned sessions take precedence over the period in the convention.
- **Company address** — `CompanyInput` (in `saveBeneficiaries`) accepts an optional `rue` (street line, max 255 chars), needed to create a quote in the invoicing tool.
- **`generateConvention` template** — `GenerateConventionRequest.templateId` is now typed `'qualiopi-standard'` instead of a UUID string. The API never accepted any other value, so no working call changes; TypeScript code passing a plain `string` must now pass the literal.

### 0.2.0

- **Training-program writes** — the `trainingPrograms` resource is no longer read-only. Added `create`, `update` (core fields: title, description, pricing, distribution, prerequisites, objectives), `delete` (soft), `replaceModules`, `addTrainers` / `removeTrainer`, and `updatePositioning` / `updateEvaluation`, covering the per-section write endpoints of `/v1/training-programs*`. Backward compatible — no existing method changed.

### 0.1.0

- Initial release: `whoami`, `health`, `trainers` (list/get), `trainingPrograms` (list/get, auto-paginated), and `trainingActions` (list/get + the Qualiopi workflow writes). Typed errors, retries, timeouts and auto-pagination.

## Release process (npm)

The package is published to npm as [`@owlic/sdk`](https://www.npmjs.com/package/@owlic/sdk) by the `Publish SDK to npm` GitHub Action (`.github/workflows/publish-sdk.yml`, manual trigger). The build (`tsup`) emits ESM + CJS + `.d.ts` with the private `@owlic/api-contract` types **inlined**, so the published package is self-contained (zod is its only — type-level — dependency).

To release:

1. Bump `version` in `packages/sdk/package.json` (semver) and merge to `main`.
2. Run the **Publish SDK to npm** workflow from the Actions tab. It tests, builds, verifies the `.d.ts` is self-contained, refuses to overwrite an existing version, then publishes.
3. Requires the `NPM_TOKEN` repo secret (npm Automation token with publish rights on the `@owlic` scope).

Local dry run: `npm run build --workspace @owlic/sdk && npm pack --workspace @owlic/sdk`.

## Development

```bash
npm run type:check --workspace @owlic/sdk   # type-check
npx vitest run packages/sdk/src              # tests
```
