import type { Map } from "maplibre-gl";

import { isAbortError } from "../guards";

/**
 * Shared lifecycle for fetch-driven, polling map overlays.
 *
 * Several overlays (earthquakes, ISS, weather radar) share a byte-identical
 * state machine: wait for the map style to load, fetch a remote resource on a
 * timer, gate completions behind a double revision-token scheme, and publish a
 * deduplicated presentation. This factory owns that machinery; each overlay
 * supplies the parts that actually differ (URL, parsing, source/layer wiring,
 * presentation shape) plus a few optional hooks for the small divergences.
 *
 * Revision tokens:
 * - `revision` bumps on every enable/disable and tags a "session" on a map.
 * - `refreshRevision` bumps on every refresh() call and guards out-of-order
 *   completions within a single session.
 *
 * Behaviour-preserving: this mirrors the previously-duplicated code exactly.
 */
export type PollingOverlayConfig<TParsed, TPresentation> = {
  url: string;
  fetchImpl: (input: string, init?: RequestInit) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
  refreshIntervalMs: number;
  requestErrorMessage: (status: number) => string;

  /** Parse the raw JSON. Return null to treat the response as UNAVAILABLE. */
  parse: (raw: unknown) => TParsed | null;

  /** Add/update sources and layers for a successful, current parse. */
  syncSourceAndLayer: (ctx: { map: Map; parsed: TParsed }) => void;

  /** Remove all sources/layers (and any side state) this overlay added. */
  removeOverlay: (map: Map) => void;

  presentation: {
    inactive: TPresentation;
    unavailable: TPresentation;
    active: (parsed: TParsed) => TPresentation;
    equals: (a: TPresentation, b: TPresentation) => boolean;
    onStateChange: (presentation: TPresentation) => void;
  };

  /** Called inside enable() right after the session is reset (before publish). */
  onBeforeEnable?: () => void;
  /** Called inside disable() right after the session is torn down (before publish). */
  onDisable?: () => void;
  /**
   * Whether a same-map re-enable should reassert the overlay instead of being a
   * no-op. Combined with the factory's own `enabled && currentMap === map`.
   * Undefined is treated as always-false.
   *
   * Note: reassert only fires on the SAME-map re-enable path. The original
   * weather overlay also reasserted on a cross-map enable, but no overlay is
   * ever enabled on a second map (all are constructed once for the single map),
   * so that path had no callers and is intentionally not carried over.
   */
  shouldReassertOnEnable?: (map: Map) => boolean;
  /** Reassert sources/layers during apply() when reasserting on enable. */
  reassert?: (map: Map) => void;
};

export type PollingOverlay = {
  enable(map: Map): void;
  disable(map: Map): void;
};

export function createPollingOverlay<TParsed, TPresentation>(
  config: PollingOverlayConfig<TParsed, TPresentation>
): PollingOverlay {
  let currentMap: Map | null = null;
  let loadHandler: (() => void) | null = null;
  let loadHandlerMap: Map | null = null;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let activeRequest: AbortController | null = null;
  let enabled = false;
  let revision = 0;
  let refreshRevision = 0;
  let presentation: TPresentation = config.presentation.inactive;

  const publish = (nextPresentation: TPresentation) => {
    if (config.presentation.equals(presentation, nextPresentation)) {
      return;
    }

    presentation = nextPresentation;
    config.presentation.onStateChange(nextPresentation);
  };

  const clearLoadHandler = () => {
    if (loadHandler && loadHandlerMap) {
      loadHandlerMap.off("load", loadHandler);
    }

    loadHandler = null;
    loadHandlerMap = null;
  };

  const clearTimer = () => {
    if (timer !== null) {
      globalThis.clearInterval(timer);
      timer = null;
    }
  };

  const abortFetch = () => {
    activeRequest?.abort();
    activeRequest = null;
  };

  const isCurrent = (map: Map, token: number) =>
    enabled && currentMap === map && revision === token;

  const isCurrentRefresh = (map: Map, token: number, refreshToken: number) =>
    isCurrent(map, token) && refreshRevision === refreshToken;

  const refresh = async (map: Map, token: number) => {
    const refreshToken = ++refreshRevision;
    abortFetch();
    const controller = new AbortController();
    activeRequest = controller;

    try {
      const response = await config.fetchImpl(config.url, {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(config.requestErrorMessage(response.status));
      }

      const raw = await response.json();
      if (!isCurrentRefresh(map, token, refreshToken)) {
        return;
      }

      const parsed = config.parse(raw);
      if (parsed === null) {
        config.removeOverlay(map);
        publish(config.presentation.unavailable);
        return;
      }

      config.syncSourceAndLayer({ map, parsed });
      publish(config.presentation.active(parsed));
    } catch (error) {
      if (isAbortError(error) || !isCurrentRefresh(map, token, refreshToken)) {
        return;
      }

      config.removeOverlay(map);
      publish(config.presentation.unavailable);
    } finally {
      if (activeRequest === controller) {
        activeRequest = null;
      }
    }
  };

  const startTimer = (map: Map, token: number) => {
    clearTimer();
    timer = globalThis.setInterval(() => {
      if (!isCurrent(map, token)) {
        return;
      }

      void refresh(map, token);
    }, config.refreshIntervalMs);
  };

  const enable = (map: Map) => {
    const reassertCurrentMap =
      enabled &&
      currentMap === map &&
      config.shouldReassertOnEnable !== undefined &&
      config.shouldReassertOnEnable(map);

    if (enabled && currentMap === map && !reassertCurrentMap) {
      return;
    }

    if (enabled && currentMap && currentMap !== map) {
      config.removeOverlay(currentMap);
    }

    enabled = true;
    currentMap = map;
    revision += 1;
    const token = revision;
    clearLoadHandler();
    clearTimer();
    abortFetch();
    config.onBeforeEnable?.();
    if (!reassertCurrentMap) {
      publish(config.presentation.inactive);
    }

    const apply = () => {
      if (!isCurrent(map, token)) {
        return;
      }

      clearLoadHandler();
      if (reassertCurrentMap) {
        config.reassert?.(map);
      }
      startTimer(map, token);
      void refresh(map, token);
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    loadHandler = () => {
      apply();
    };
    loadHandlerMap = map;
    map.on("load", loadHandler);
  };

  const disable = (map: Map) => {
    revision += 1;
    enabled = false;
    clearTimer();
    clearLoadHandler();
    abortFetch();
    config.onDisable?.();
    publish(config.presentation.inactive);

    const mapToClear = currentMap ?? map;
    config.removeOverlay(mapToClear);
    currentMap = null;
  };

  return {
    enable,
    disable
  };
}
