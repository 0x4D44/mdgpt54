import { describe, expect, it } from "vitest";

import { createSearchRequestController } from "./searchRequestController";

describe("createSearchRequestController", () => {
  it("aborts the previous request and keeps only the latest request current", () => {
    const controller = createSearchRequestController();
    const first = controller.begin();

    expect(controller.isCurrent(first.requestId)).toBe(true);
    expect(first.signal.aborted).toBe(false);

    const second = controller.begin();

    expect(first.signal.aborted).toBe(true);
    expect(controller.isCurrent(first.requestId)).toBe(false);
    expect(controller.isCurrent(second.requestId)).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it("ignores finish calls from stale requests", () => {
    const controller = createSearchRequestController();
    const first = controller.begin();
    const second = controller.begin();

    controller.finish(first.requestId);

    expect(controller.isCurrent(second.requestId)).toBe(true);

    const third = controller.begin();

    expect(second.signal.aborted).toBe(true);
    expect(controller.isCurrent(third.requestId)).toBe(true);
  });

  it("clears the abort controller when finishing the current request", () => {
    const controller = createSearchRequestController();
    const first = controller.begin();

    controller.finish(first.requestId);

    const second = controller.begin();

    expect(first.signal.aborted).toBe(false);
    expect(controller.isCurrent(second.requestId)).toBe(true);
  });
});
