import type {
  ApiCaller,
  AssignProgramRequest,
  ConventionResult,
  CreateTrainingActionRequest,
  DataEnvelope,
  GenerateConventionRequest,
  InviteTrainersRequest,
  InviteTrainersResult,
  NeedsAnalysisRequest,
  NeedsAnalysisSaved,
  PlanSessionsRequest,
  PlanSessionsResult,
  PricingData,
  RequestOptions,
  SaveBeneficiariesRequest,
  SaveBeneficiariesResult,
  SetPeriodRequest,
  SetPricingRequest,
  TrainingAction,
  TrainingActionDetail,
  TrainingActionPeriod,
  TrainingActionRecord,
} from '../types';

/**
 * `/v1/training-actions*` — training actions and their Qualiopi workflow.
 *
 * The write methods mirror the workflow steps: `create` → `saveNeedsAnalysis` →
 * `saveBeneficiaries` → `assignProgram` → `planSessions` (or `setPeriod` while the
 * session dates are not known yet) → `assignTrainers` → `setPricing` → `generateConvention`.
 */
export class TrainingActions {
  #client: ApiCaller;

  constructor(client: ApiCaller) {
    this.#client = client;
  }

  #actionPath(actionId: string, suffix = ''): string {
    return `/v1/training-actions/${encodeURIComponent(actionId)}${suffix}`;
  }

  /** List all training actions of the organization. */
  async list(options?: RequestOptions): Promise<TrainingAction[]> {
    const res = await this.#client.request<DataEnvelope<TrainingAction[]>>('GET', '/v1/training-actions', { options });
    return res.data;
  }

  /** Get a training action by id, with trainers and beneficiary count. */
  async get(actionId: string, options?: RequestOptions): Promise<TrainingActionDetail> {
    const res = await this.#client.request<DataEnvelope<TrainingActionDetail>>('GET', this.#actionPath(actionId), {
      options,
    });
    return res.data;
  }

  /**
   * Create a training action for the calling key's organization. When
   * `requiresQualiopiCompliance` is true, an associated Qualiopi folder is created.
   */
  async create(body: CreateTrainingActionRequest, options?: RequestOptions): Promise<TrainingActionRecord> {
    const res = await this.#client.request<DataEnvelope<TrainingActionRecord>>('POST', '/v1/training-actions', {
      body,
      options,
    });
    return res.data;
  }

  /** Upsert the needs analysis ("analyse des besoins") of the action. */
  async saveNeedsAnalysis(
    actionId: string,
    body: NeedsAnalysisRequest,
    options?: RequestOptions
  ): Promise<NeedsAnalysisSaved> {
    const res = await this.#client.request<DataEnvelope<NeedsAnalysisSaved>>(
      'POST',
      this.#actionPath(actionId, '/needs-analysis'),
      { body, options }
    );
    return res.data;
  }

  /**
   * Save the beneficiaries of the action. To link a beneficiary to a company,
   * set their `companySiret` AND include that company (same SIRET) in `companies[]`.
   * Pass `replaceExisting: true` to make re-runs idempotent.
   */
  async saveBeneficiaries(
    actionId: string,
    body: SaveBeneficiariesRequest,
    options?: RequestOptions
  ): Promise<SaveBeneficiariesResult> {
    const res = await this.#client.request<DataEnvelope<SaveBeneficiariesResult>>(
      'POST',
      this.#actionPath(actionId, '/beneficiaries'),
      { body, options }
    );
    return res.data;
  }

  /** Link an existing training program (same organization) to the action. */
  async assignProgram(
    actionId: string,
    body: AssignProgramRequest,
    options?: RequestOptions
  ): Promise<TrainingAction> {
    const res = await this.#client.request<DataEnvelope<TrainingAction>>(
      'POST',
      this.#actionPath(actionId, '/program'),
      { body, options }
    );
    return res.data;
  }

  /** Plan the training sessions of the action. */
  async planSessions(
    actionId: string,
    body: PlanSessionsRequest,
    options?: RequestOptions
  ): Promise<PlanSessionsResult> {
    const res = await this.#client.request<DataEnvelope<PlanSessionsResult>>(
      'POST',
      this.#actionPath(actionId, '/sessions'),
      { body, options }
    );
    return res.data;
  }

  /**
   * Record the period of the action (`YYYY-MM-DD` start and end) while the session
   * dates are not known yet. Planned sessions take precedence in the convention.
   */
  async setPeriod(
    actionId: string,
    body: SetPeriodRequest,
    options?: RequestOptions
  ): Promise<TrainingActionPeriod> {
    const res = await this.#client.request<DataEnvelope<TrainingActionPeriod>>(
      'POST',
      this.#actionPath(actionId, '/period'),
      { body, options }
    );
    return res.data;
  }

  /**
   * Atomically replace the action's trainers; when `sendInvitationEmails` is
   * true, invitation emails are sent (best-effort — partial email failures do
   * not fail the operation, see `emailFailures` in the result).
   */
  async assignTrainers(
    actionId: string,
    body: InviteTrainersRequest,
    options?: RequestOptions
  ): Promise<InviteTrainersResult> {
    const res = await this.#client.request<DataEnvelope<InviteTrainersResult>>(
      'POST',
      this.#actionPath(actionId, '/trainers'),
      { body, options }
    );
    return res.data;
  }

  /** Set the pricing. At least one expense of type `training` is required. */
  async setPricing(actionId: string, body: SetPricingRequest, options?: RequestOptions): Promise<PricingData> {
    const res = await this.#client.request<DataEnvelope<PricingData>>(
      'POST',
      this.#actionPath(actionId, '/pricing'),
      { body, options }
    );
    return res.data;
  }

  /** Generate a "convention de formation" for the action. */
  async generateConvention(
    actionId: string,
    body: GenerateConventionRequest,
    options?: RequestOptions
  ): Promise<ConventionResult> {
    const res = await this.#client.request<DataEnvelope<ConventionResult>>(
      'POST',
      this.#actionPath(actionId, '/convention'),
      { body, options }
    );
    return res.data;
  }
}
