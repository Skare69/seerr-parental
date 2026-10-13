import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideDiscoverPaging } from './discoverPagingHelper';

const page = (
  resultCount: number,
  pageNum: number,
  totalPages: number,
  totalResults = 100
) => ({
  results: Array.from({ length: resultCount }, (_, i) => ({ id: i })),
  page: pageNum,
  totalPages,
  totalResults,
});

describe('decideDiscoverPaging', () => {
  it('returns neither empty nor end when no pages have loaded', () => {
    const result = decideDiscoverPaging([], 1, 0);

    assert.equal(result.isEmpty, false);
    assert.equal(result.isReachingEnd, false);
  });

  it('continues on full pages', () => {
    const result = decideDiscoverPaging(
      [page(20, 1, 5), page(20, 2, 5)],
      2,
      40
    );

    assert.equal(result.isEmpty, false);
    assert.equal(result.isReachingEnd, false);
  });

  it('continues on a short page when more pages exist', () => {
    const result = decideDiscoverPaging([page(20, 1, 5), page(5, 2, 5)], 2, 25);

    assert.equal(result.isEmpty, false);
    assert.equal(result.isReachingEnd, false);
  });

  it('ends on a short last page', () => {
    const result = decideDiscoverPaging([page(20, 1, 2), page(5, 2, 2)], 2, 25);

    assert.equal(result.isEmpty, false);
    assert.equal(result.isReachingEnd, true);
  });

  it('is not empty and does not end when the first page has zero results but more pages exist', () => {
    const result = decideDiscoverPaging([page(0, 1, 5)], 1, 0);

    assert.equal(result.isEmpty, false);
    assert.equal(result.isReachingEnd, false);
  });

  it('ends after three consecutive zero-result pages', () => {
    const result = decideDiscoverPaging(
      [page(0, 1, 5), page(0, 2, 5), page(0, 3, 5)],
      3,
      0
    );

    assert.equal(result.isEmpty, true);
    assert.equal(result.isReachingEnd, true);
  });

  it('resets the empty-page run when a page has results', () => {
    const result = decideDiscoverPaging(
      [
        page(0, 1, 6, 300),
        page(0, 2, 6, 300),
        page(3, 3, 6, 300),
        page(0, 4, 6, 300),
        page(0, 5, 6, 300),
      ],
      5,
      3
    );

    assert.equal(result.isReachingEnd, false);
  });

  it('falls back to the old rule when totalPages is missing', () => {
    const result = decideDiscoverPaging(
      [{ results: Array.from({ length: 5 }, (_, i) => ({ id: i })), page: 1 }],
      1,
      5
    );

    assert.equal(result.isEmpty, false);
    assert.equal(result.isReachingEnd, true);
  });

  it('falls back to the old rule when page is missing', () => {
    const result = decideDiscoverPaging(
      [{ results: page(20, 0, 0).results, totalPages: 5, totalResults: 200 }],
      1,
      20
    );

    assert.equal(result.isReachingEnd, false);
  });

  it('still ends when totalResults is within fetched pages', () => {
    const result = decideDiscoverPaging([page(20, 1, 5, 15)], 1, 15);

    assert.equal(result.isReachingEnd, true);
  });

  it('still ends when totalResults is below 41', () => {
    const result = decideDiscoverPaging([page(20, 1, 5, 30)], 1, 30);

    assert.equal(result.isReachingEnd, true);
  });

  it('does not end while the last page is still loading', () => {
    const result = decideDiscoverPaging([page(20, 1, 5), undefined], 2, 20);

    assert.equal(result.isReachingEnd, false);
  });
});
