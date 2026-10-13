export interface DiscoverPage {
  results: unknown[];
  page?: number;
  totalPages?: number;
  totalResults?: number;
}

interface PagingDecision {
  isEmpty: boolean;
  isReachingEnd: boolean;
}

// ponytail: 3 consecutive empty pages ends a filtered list; a pathological
// server that returns thousands of empty pages with page < totalPages would
// stop at this bound instead of the real end. Raise if that ever happens.
const MAX_EMPTY_PAGES = 3;

const hasNumericMeta = (page: DiscoverPage): boolean =>
  typeof page.page === 'number' && typeof page.totalPages === 'number';

export const decideDiscoverPaging = (
  pages: (DiscoverPage | undefined)[],
  size: number,
  titlesLength: number
): PagingDecision => {
  const last = pages[pages.length - 1];

  // Nothing loaded yet: let ListView show its placeholders.
  if (!last) {
    return { isEmpty: false, isReachingEnd: false };
  }

  if (!hasNumericMeta(last)) {
    // Old behavior: any short page (or missing metadata) ends the list.
    const isEmpty = titlesLength === 0;
    return {
      isEmpty,
      isReachingEnd:
        isEmpty ||
        last.results.length < 20 ||
        (last.totalResults ?? 0) <= size * 20 ||
        (last.totalResults ?? 0) < 41,
    };
  }

  const morePages = (last.page as number) < (last.totalPages as number);

  let emptyRun = 0;
  for (let i = pages.length - 1; i >= 0; i--) {
    const page = pages[i];
    if (!page || page.results.length > 0) {
      break;
    }
    emptyRun++;
  }

  const isEmpty =
    titlesLength === 0 && (!morePages || emptyRun >= MAX_EMPTY_PAGES);
  const isReachingEnd =
    isEmpty ||
    !morePages ||
    emptyRun >= MAX_EMPTY_PAGES ||
    (last.totalResults ?? 0) <= size * 20 ||
    (last.totalResults ?? 0) < 41;

  return { isEmpty, isReachingEnd };
};
