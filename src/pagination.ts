import type { PaginatedEnvelope, Pagination } from './types';

/**
 * A page of results from a paginated endpoint.
 *
 * Exposes the raw `data` + `pagination`, page navigation, and async iteration
 * over EVERY item across ALL pages (fetching lazily):
 *
 * ```ts
 * const page = await owlic.trainingPrograms.list({ limit: 50 });
 * page.data;                 // this page's items
 * page.pagination.total;     // total item count
 * await page.nextPage();     // the next Page, or null on the last page
 *
 * for await (const program of page) {
 *   // iterates the current page, then transparently fetches the following ones
 * }
 * ```
 */
export class Page<T> implements AsyncIterable<T> {
  readonly data: T[];
  readonly pagination: Pagination;

  #fetchPage: (page: number) => Promise<PaginatedEnvelope<T>>;

  constructor(envelope: PaginatedEnvelope<T>, fetchPage: (page: number) => Promise<PaginatedEnvelope<T>>) {
    this.data = envelope.data;
    this.pagination = envelope.pagination;
    this.#fetchPage = fetchPage;
  }

  hasNextPage(): boolean {
    return this.pagination.page < this.pagination.totalPages;
  }

  /** Fetch the next page, or `null` when this is the last one. */
  async nextPage(): Promise<Page<T> | null> {
    if (!this.hasNextPage()) return null;
    const envelope = await this.#fetchPage(this.pagination.page + 1);
    return new Page(envelope, this.#fetchPage);
  }

  /** Iterate every item of this page and all following pages. */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Page<T> | null = this;
    while (current) {
      for (const item of current.data) {
        yield item;
      }
      current = await current.nextPage();
    }
  }
}
