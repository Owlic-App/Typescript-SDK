import type { ApiCaller, CompanyRepresentative, DataEnvelope, RequestOptions } from '../types';

/**
 * `/v1/companies/{companyId}/*` — the client companies of the API key's
 * organization (those whose learners it enrolled, or that it linked). Any other
 * company, whether unknown or another organization's, throws `NotFoundError`.
 */
export class Companies {
  #client: ApiCaller;

  constructor(client: ApiCaller) {
    this.#client = client;
  }

  /** The person who signs the company's conventions, or `null` when none is recorded yet. */
  async getRepresentative(companyId: string, options?: RequestOptions): Promise<CompanyRepresentative | null> {
    const res = await this.#client.request<DataEnvelope<CompanyRepresentative | null>>(
      'GET',
      `/v1/companies/${encodeURIComponent(companyId)}/representative`,
      { options },
    );
    return res.data;
  }

  /**
   * Record the person who signs the company's conventions, replacing the previous
   * one; the next conventions are prefilled with them. Throws `BadRequestError`
   * on a missing or refused field.
   */
  async saveRepresentative(companyId: string, body: CompanyRepresentative, options?: RequestOptions): Promise<CompanyRepresentative> {
    const res = await this.#client.request<DataEnvelope<CompanyRepresentative>>(
      'PUT',
      `/v1/companies/${encodeURIComponent(companyId)}/representative`,
      { body, options },
    );
    return res.data;
  }
}
