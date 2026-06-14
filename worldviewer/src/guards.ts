/** Shared runtime type guards (previously duplicated across overlays). */

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * True for an AbortController/fetch abort. Uses duck typing (not instanceof) so
 * it matches DOMException AbortError, which is not an Error instance.
 */
export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
