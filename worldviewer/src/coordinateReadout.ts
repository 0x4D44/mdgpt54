export type CursorPosition = {
  lat: number;
  lng: number;
  elevation: number | null;
};

const THROTTLE_MS = 100;

/** Format a CursorPosition into the display string. */
export function formatReadout(pos: CursorPosition): string {
  const lat = pos.lat.toFixed(4);
  const lng = pos.lng.toFixed(4);
  if (pos.elevation !== null) {
    return `${lat}, ${lng} · ${Math.round(pos.elevation)} m`;
  }
  return `${lat}, ${lng}`;
}

/** Format coordinates for clipboard (no elevation). */
export function formatForClipboard(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/** Simple leading-edge throttle. Fires immediately, then suppresses for `ms`. */
export function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let lastCall = 0;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= ms) {
      lastCall = now;
      fn(...args);
    }
  }) as T;
}

/** Create a throttled mousemove handler. Returns the handler and a cleanup function. */
export function createReadoutController(options: {
  getElevation: (lngLat: { lng: number; lat: number }) => number | null;
  onUpdate: (text: string) => void;
}): {
  handleMouseMove: (event: { lngLat: { lng: number; lat: number } }) => void;
  dispose: () => void;
} {
  let disposed = false;

  const update = throttle((event: { lngLat: { lng: number; lat: number } }) => {
    if (disposed) return;
    const elevation = options.getElevation(event.lngLat);
    const text = formatReadout({
      lat: event.lngLat.lat,
      lng: event.lngLat.lng,
      elevation
    });
    options.onUpdate(text);
  }, THROTTLE_MS);

  return {
    handleMouseMove: (event) => {
      if (disposed) return;
      update(event);
    },
    dispose: () => {
      disposed = true;
    }
  };
}
