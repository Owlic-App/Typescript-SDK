import { Page } from '../pagination';
import type {
  AddProgramTrainersRequest,
  ApiCaller,
  CreateTrainingProgramRequest,
  CreateTrainingProgramResult,
  DataEnvelope,
  DeletedTrainingProgramResult,
  PaginatedEnvelope,
  ProgramTrainersResult,
  RequestOptions,
  TrainingProgram,
  TrainingProgramCoreResult,
  TrainingProgramDetail,
  TrainingProgramEvaluationResult,
  TrainingProgramModulesResult,
  TrainingProgramPositioningResult,
  UpdateTrainingProgramCoreRequest,
  UpdateTrainingProgramEvaluationRequest,
  UpdateTrainingProgramModulesRequest,
  UpdateTrainingProgramPositioningRequest,
} from '../types';

export interface ListTrainingProgramsParams {
  /** Page number (default 1). */
  page?: number;
  /** Items per page (default 20, max 100). */
  limit?: number;
}

/**
 * `/v1/training-programs*` — the organization's training programs.
 *
 * Reads: `list` / `get`. Writes (org-scoped, per-section): `create`, `update`
 * (core fields), `delete` (soft), `replaceModules`, `addTrainers` /
 * `removeTrainer`, `updatePositioning` / `updateEvaluation`.
 */
export class TrainingPrograms {
  #client: ApiCaller;

  constructor(client: ApiCaller) {
    this.#client = client;
  }

  #programPath(programId: string, suffix = ''): string {
    return `/v1/training-programs/${encodeURIComponent(programId)}${suffix}`;
  }

  /**
   * List training programs (paginated). The returned `Page` is async-iterable
   * across ALL pages: `for await (const program of await owlic.trainingPrograms.list())`.
   */
  async list(params?: ListTrainingProgramsParams, options?: RequestOptions): Promise<Page<TrainingProgram>> {
    const fetchPage = (page: number) =>
      this.#client.request<PaginatedEnvelope<TrainingProgram>>('GET', '/v1/training-programs', {
        query: { page, limit: params?.limit },
        options,
      });
    const envelope = await fetchPage(params?.page ?? 1);
    return new Page(envelope, fetchPage);
  }

  /** Get a training program by id, with its modules. Throws `NotFoundError` if unknown. */
  async get(programId: string, options?: RequestOptions): Promise<TrainingProgramDetail> {
    const res = await this.#client.request<DataEnvelope<TrainingProgramDetail>>('GET', this.#programPath(programId), {
      options,
    });
    return res.data;
  }

  /** Create a training program for the calling key's organization. */
  async create(body: CreateTrainingProgramRequest, options?: RequestOptions): Promise<CreateTrainingProgramResult> {
    const res = await this.#client.request<DataEnvelope<CreateTrainingProgramResult>>('POST', '/v1/training-programs', {
      body,
      options,
    });
    return res.data;
  }

  /**
   * Partially update a program's core fields (title, description, pricing,
   * distribution channels/urls, prerequisites, objectives). Distribution is a
   * whole-value replace: omit both `distributionChannels` and `distributionUrls`
   * to leave them unchanged.
   */
  async update(
    programId: string,
    body: UpdateTrainingProgramCoreRequest,
    options?: RequestOptions
  ): Promise<TrainingProgramCoreResult> {
    const res = await this.#client.request<DataEnvelope<TrainingProgramCoreResult>>(
      'PATCH',
      this.#programPath(programId),
      { body, options }
    );
    return res.data;
  }

  /** Soft-delete a program. Subsequent reads return `NotFoundError`. */
  async delete(programId: string, options?: RequestOptions): Promise<DeletedTrainingProgramResult> {
    const res = await this.#client.request<DataEnvelope<DeletedTrainingProgramResult>>(
      'DELETE',
      this.#programPath(programId),
      { options }
    );
    return res.data;
  }

  /**
   * Replace the full module/activity tree of the program (PUT = full replace:
   * existing modules and activities are removed and recreated from `modules`).
   */
  async replaceModules(
    programId: string,
    body: UpdateTrainingProgramModulesRequest,
    options?: RequestOptions
  ): Promise<TrainingProgramModulesResult> {
    const res = await this.#client.request<DataEnvelope<TrainingProgramModulesResult>>(
      'PUT',
      this.#programPath(programId, '/modules'),
      { body, options }
    );
    return res.data;
  }

  /**
   * Assign trainers to the program's pedagogical team by id (idempotent —
   * re-assigning is a no-op). Returns the full current trainer-id set.
   */
  async addTrainers(
    programId: string,
    body: AddProgramTrainersRequest,
    options?: RequestOptions
  ): Promise<ProgramTrainersResult> {
    const res = await this.#client.request<DataEnvelope<ProgramTrainersResult>>(
      'POST',
      this.#programPath(programId, '/trainers'),
      { body, options }
    );
    return res.data;
  }

  /** Remove a trainer from the program's pedagogical team. Returns the remaining trainer-id set. */
  async removeTrainer(programId: string, trainerId: string, options?: RequestOptions): Promise<ProgramTrainersResult> {
    const res = await this.#client.request<DataEnvelope<ProgramTrainersResult>>(
      'DELETE',
      this.#programPath(programId, `/trainers/${encodeURIComponent(trainerId)}`),
      { options }
    );
    return res.data;
  }

  /**
   * Set the positioning-questionnaire URL reference (Questionnaire de
   * positionnement). Send `""` to clear it.
   */
  async updatePositioning(
    programId: string,
    body: UpdateTrainingProgramPositioningRequest,
    options?: RequestOptions
  ): Promise<TrainingProgramPositioningResult> {
    const res = await this.#client.request<DataEnvelope<TrainingProgramPositioningResult>>(
      'PATCH',
      this.#programPath(programId, '/positioning'),
      { body, options }
    );
    return res.data;
  }

  /**
   * Set the skills-evaluation external link (Évaluation des acquis). Send `""`
   * to clear it.
   */
  async updateEvaluation(
    programId: string,
    body: UpdateTrainingProgramEvaluationRequest,
    options?: RequestOptions
  ): Promise<TrainingProgramEvaluationResult> {
    const res = await this.#client.request<DataEnvelope<TrainingProgramEvaluationResult>>(
      'PATCH',
      this.#programPath(programId, '/evaluation'),
      { body, options }
    );
    return res.data;
  }
}
