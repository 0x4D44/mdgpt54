import { describe, expect, it } from "vitest";

import { isAbortError, isObject } from "./guards";

describe("isObject", () => {
  it("accepts plain objects", () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });

  it("rejects null and primitives", () => {
    expect(isObject(null)).toBe(false);
    expect(isObject("x")).toBe(false);
    expect(isObject(42)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });
});

describe("isAbortError", () => {
  it("matches an Error named AbortError", () => {
    expect(isAbortError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
  });

  it("matches a DOMException-like object that is not an Error instance", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("rejects other errors and non-objects", () => {
    expect(isAbortError(new Error("fail"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
