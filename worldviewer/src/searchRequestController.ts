export type SearchRequest = {
  requestId: number;
  signal: AbortSignal;
};

export type SearchRequestController = {
  begin: () => SearchRequest;
  isCurrent: (requestId: number) => boolean;
  finish: (requestId: number) => void;
};

export function createSearchRequestController(): SearchRequestController {
  let currentRequestId = 0;
  let currentAbortController: AbortController | null = null;

  return {
    begin() {
      currentRequestId += 1;
      currentAbortController?.abort();
      currentAbortController = new AbortController();
      return {
        requestId: currentRequestId,
        signal: currentAbortController.signal
      };
    },
    isCurrent(requestId) {
      return requestId === currentRequestId;
    },
    finish(requestId) {
      if (requestId !== currentRequestId) {
        return;
      }

      currentAbortController = null;
    }
  };
}
