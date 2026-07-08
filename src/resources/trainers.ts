import type { ApiCaller, DataEnvelope, RequestOptions, Trainer, TrainerDetail } from '../types';

/** `GET /v1/trainers*` — the organization's trainers. */
export class Trainers {
  #client: ApiCaller;

  constructor(client: ApiCaller) {
    this.#client = client;
  }

  /** List all trainers of the organization. */
  async list(options?: RequestOptions): Promise<Trainer[]> {
    const res = await this.#client.request<DataEnvelope<Trainer[]>>('GET', '/v1/trainers', { options });
    return res.data;
  }

  /** Get a trainer by id, with their profile. Throws `NotFoundError` if unknown. */
  async get(trainerId: string, options?: RequestOptions): Promise<TrainerDetail> {
    const res = await this.#client.request<DataEnvelope<TrainerDetail>>(
      'GET',
      `/v1/trainers/${encodeURIComponent(trainerId)}`,
      { options }
    );
    return res.data;
  }
}
