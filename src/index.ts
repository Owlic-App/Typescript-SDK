/**
 * @owlic/sdk — official TypeScript SDK for the Owlic public API.
 *
 * ```ts
 * import { Owlic } from '@owlic/sdk';
 *
 * const owlic = new Owlic({ apiKey: process.env.OWLIC_API_KEY });
 * const trainers = await owlic.trainers.list();
 * ```
 *
 * Types are inferred from `@owlic/api-contract` (the same Zod schemas that
 * generate the OpenAPI document served at `/v1/openapi.json`), so the SDK can
 * not drift from the API. Zero runtime dependencies — works on Node.js >= 18,
 * edge runtimes and serverless.
 */
export { Owlic } from './client';
export type { OwlicOptions } from './client';

export { Page } from './pagination';

export {
  OwlicError,
  OwlicAPIError,
  OwlicConnectionError,
  OwlicTimeoutError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  UnprocessableEntityError,
  RateLimitError,
  InternalServerError,
} from './errors';

export { Trainers } from './resources/trainers';
export { TrainingPrograms } from './resources/trainingPrograms';
export type { ListTrainingProgramsParams } from './resources/trainingPrograms';
export { TrainingActions } from './resources/trainingActions';

export type {
  // Envelopes & plumbing
  Pagination,
  DataEnvelope,
  PaginatedEnvelope,
  ErrorResponse,
  RequestOptions,
  HttpMethod,
  QueryParams,
  ApiCaller,
  // Identity & system
  WhoAmI,
  Health,
  // Trainers
  Trainer,
  TrainerDetail,
  // Training programs
  TrainingProgram,
  TrainingProgramModule,
  TrainingProgramDetail,
  // Training actions
  TrainingAction,
  TrainingActionDetail,
  TrainingActionRecord,
  AssignedTrainer,
  TrainingActionBeneficiary,
  BeneficiaryCompany,
  PlannedSession,
  SavedNeedsAnalysis,
  ConventionsStatus,
  CreateTrainingActionRequest,
  NeedsAnalysisRequest,
  NeedsAnalysisSaved,
  BeneficiaryInput,
  CompanyInput,
  SaveBeneficiariesRequest,
  SaveBeneficiariesResult,
  AssignProgramRequest,
  TimeSlot,
  SessionInput,
  PlanSessionsRequest,
  PlanSessionsResult,
  TrainerInput,
  InviteTrainersRequest,
  InviteTrainersResult,
  Expense,
  PricingData,
  SetPricingRequest,
  CustomClause,
  GenerateConventionRequest,
  ConventionResult,
} from './types';

export { Owlic as default } from './client';
