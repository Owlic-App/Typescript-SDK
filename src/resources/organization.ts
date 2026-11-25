import type {
  ApiCaller,
  DataEnvelope,
  OrganizationLogo,
  OrganizationProfile,
  RequestOptions,
  UpdateOrganizationProfileRequest,
  UploadOrganizationLogoRequest,
} from '../types';

/**
 * `/v1/organization*` — the profile of the API key's organization, printed on
 * its conventions: identity, activity declaration, default representative and
 * logo. The organization is always the key's: no method takes an id.
 */
export class Organization {
  #client: ApiCaller;

  constructor(client: ApiCaller) {
    this.#client = client;
  }

  /**
   * Get the profile. Until it is saved once (`isSaved: false`), its values come
   * from the attached company and the owner. `declarationSuggestion` is a
   * proposal from the public registry, never saved by itself.
   */
  async get(options?: RequestOptions): Promise<OrganizationProfile> {
    const res = await this.#client.request<DataEnvelope<OrganizationProfile>>('GET', '/v1/organization', {
      options,
    });
    return res.data;
  }

  /**
   * Update the profile: only the given fields change, `null` or `""` clears one.
   * Throws `BadRequestError` on an invalid value or an unknown field.
   */
  async update(body: UpdateOrganizationProfileRequest, options?: RequestOptions): Promise<OrganizationProfile> {
    const res = await this.#client.request<DataEnvelope<OrganizationProfile>>('PATCH', '/v1/organization', {
      body,
      options,
    });
    return res.data;
  }

  /**
   * Upload the logo, encoded in base64: PNG, JPEG or SVG, 300 KB at most. An SVG
   * is checked then converted to PNG. Replaces the previous logo.
   */
  async uploadLogo(body: UploadOrganizationLogoRequest, options?: RequestOptions): Promise<OrganizationLogo> {
    const res = await this.#client.request<DataEnvelope<OrganizationLogo>>('PUT', '/v1/organization/logo', {
      body,
      options,
    });
    return res.data;
  }

  /** Remove the logo (204: resolves to nothing). */
  async removeLogo(options?: RequestOptions): Promise<void> {
    await this.#client.request<undefined>('DELETE', '/v1/organization/logo', { options });
  }
}
