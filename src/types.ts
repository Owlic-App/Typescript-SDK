/**
 * Public types of the Owlic SDK, inferred from the Zod schemas of
 * `@owlic/api-contract` — the single source of truth also used to generate the
 * OpenAPI document. Type-only imports: nothing from zod or the contract package
 * ends up in the SDK's runtime, so the SDK stays dependency-free at runtime
 * while being impossible to drift from the API contract.
 */
import type { z } from 'zod';
// Import the schemas module directly (not the barrel): the barrel also exports
// the OpenAPI document builder, which drags `@owlic/auth` into type resolution.
import type * as contract from '@owlic/api-contract/schemas';

// ── Envelopes ────────────────────────────────────────────────────────────────

export type Pagination = z.infer<typeof contract.PaginationSchema>;

/** `{ data }` envelope returned by every non-paginated endpoint. */
export interface DataEnvelope<T> {
  data: T;
}

/** `{ data, pagination }` envelope returned by paginated endpoints. */
export interface PaginatedEnvelope<T> {
  data: T[];
  pagination: Pagination;
}

export type ErrorResponse = z.infer<typeof contract.ErrorResponseSchema>;

// ── Identity & system ────────────────────────────────────────────────────────

export type WhoAmI = z.infer<typeof contract.WhoAmISchema>;
export type Health = z.infer<typeof contract.HealthSchema>;

// ── Trainers ─────────────────────────────────────────────────────────────────

export type Trainer = z.infer<typeof contract.TrainerSchema>;
export type TrainerDetail = z.infer<typeof contract.TrainerDetailSchema>;

// ── Training programs ────────────────────────────────────────────────────────

export type TrainingProgram = z.infer<typeof contract.TrainingProgramSchema>;
export type TrainingProgramModule = z.infer<typeof contract.TrainingProgramModuleSchema>;
export type TrainingProgramDetail = z.infer<typeof contract.TrainingProgramDetailSchema>;

// ── Training actions (reads) ─────────────────────────────────────────────────

export type TrainingAction = z.infer<typeof contract.TrainingActionSchema>;
export type TrainingActionDetail = z.infer<typeof contract.TrainingActionDetailSchema>;
export type TrainingActionRecord = z.infer<typeof contract.TrainingActionRecordSchema>;

// ── Training actions (Qualiopi workflow writes) ──────────────────────────────

export type CreateTrainingActionRequest = z.infer<typeof contract.CreateTrainingActionRequestSchema>;

export type NeedsAnalysisRequest = z.infer<typeof contract.NeedsAnalysisRequestSchema>;
export type NeedsAnalysisSaved = z.infer<typeof contract.NeedsAnalysisSavedSchema>;

export type BeneficiaryInput = z.infer<typeof contract.BeneficiaryInputSchema>;
export type CompanyInput = z.infer<typeof contract.CompanyInputSchema>;
export type SaveBeneficiariesRequest = z.infer<typeof contract.SaveBeneficiariesRequestSchema>;
export type SaveBeneficiariesResult = z.infer<typeof contract.SaveBeneficiariesResultSchema>;

export type AssignProgramRequest = z.infer<typeof contract.AssignProgramRequestSchema>;

export type TimeSlot = z.infer<typeof contract.TimeSlotSchema>;
export type SessionInput = z.infer<typeof contract.SessionInputSchema>;
export type PlanSessionsRequest = z.infer<typeof contract.PlanSessionsRequestSchema>;
export type PlanSessionsResult = z.infer<typeof contract.PlanSessionsResultSchema>;

export type TrainerInput = z.infer<typeof contract.TrainerInputSchema>;
export type InviteTrainersRequest = z.infer<typeof contract.InviteTrainersRequestSchema>;
export type InviteTrainersResult = z.infer<typeof contract.InviteTrainersResultSchema>;

export type Expense = z.infer<typeof contract.ExpenseSchema>;
export type PricingData = z.infer<typeof contract.PricingDataSchema>;
export type SetPricingRequest = z.infer<typeof contract.SetPricingRequestSchema>;

export type CustomClause = z.infer<typeof contract.CustomClauseSchema>;
export type GenerateConventionRequest = z.infer<typeof contract.GenerateConventionRequestSchema>;
export type ConventionResult = z.infer<typeof contract.ConventionResultSchema>;

// ── Client plumbing ──────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryParams = Record<string, string | number | boolean | undefined>;

/** Per-request overrides accepted by every SDK method as its last argument. */
export interface RequestOptions {
  /** Abort the request from the outside (combined with the SDK timeout). */
  signal?: AbortSignal;
  /** Per-request timeout in milliseconds (overrides the client default). */
  timeout?: number;
  /** Per-request retry budget (overrides the client default). */
  maxRetries?: number;
  /** Extra headers merged into the request (override client defaults). */
  headers?: Record<string, string>;
}

/** The minimal transport surface resources need — implemented by `Owlic`. */
export interface ApiCaller {
  request<T>(
    method: HttpMethod,
    path: string,
    init?: {
      query?: QueryParams;
      body?: unknown;
      options?: RequestOptions;
      /** Non-2xx statuses whose JSON body is returned instead of thrown (e.g. 503 for /health). */
      acceptStatuses?: readonly number[];
    }
  ): Promise<T>;
}
