import { Page } from '../pagination';
import type {
  ApiCaller,
  DataEnvelope,
  PaginatedEnvelope,
  RequestOptions,
  TrainingProgram,
  TrainingProgramDetail,
} from '../types';

export interface ListTrainingProgramsParams {
  /** Page number (default 1). */
  page?: number;
  /** Items per page (default 20, max 100). */
  limit?: number;
}

/** `GET /v1/training-programs*` — the organization's training programs. */
export class TrainingPrograms {
  #client: ApiCaller;

  constructor(client: ApiCaller) {
    this.#client = client;
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
    const envelope = await this.#client.request<PaginatedEnvelope<TrainingProgram>>('GET', '/v1/training-programs', {
      query: { page: params?.page, limit: params?.limit },
      options,
    });
    return new Page(envelope, fetchPage);
  }

  /** Get a training program by id, with its modules. Throws `NotFoundError` if unknown. */
  async get(programId: string, options?: RequestOptions): Promise<TrainingProgramDetail> {
    const res = await this.#client.request<DataEnvelope<TrainingProgramDetail>>(
      'GET',
      `/v1/training-programs/${encodeURIComponent(programId)}`,
      { options }
    );
    return res.data;
  }
}
