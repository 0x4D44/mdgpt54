export type TimeScrubberState = {
  overrideDate: Date | null;
};

type TimeScrubberOptions = {
  onDateChange: (date: Date | null) => void;
};

type TimeScrubberController = {
  setOverride(date: Date): void;
  resetToLive(): void;
  getDate(): Date;
  getState(): TimeScrubberState;
};

/**
 * Format a Date for the scrubber label: "2026-03-16 14:30 UTC".
 */
export function formatScrubberLabel(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d} ${h}:${mi} UTC`;
}

/**
 * Convert a slider value (0-1440, minutes in the current UTC day) to a Date.
 * 0 = midnight, 720 = noon, 1440 = next midnight (wraps to 00:00 next day).
 */
export function dateFromSliderValue(value: number): Date {
  const now = new Date();
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + (hours >= 24 ? 1 : 0),
      hours % 24,
      minutes
    )
  );
}

/**
 * Convert a Date to a slider value (0-1439), representing minutes since
 * midnight UTC on that date.
 */
export function sliderValueFromDate(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/**
 * Create a time scrubber controller.
 *
 * In live mode (overrideDate === null), getDate() returns the real current time.
 * When an override is set, getDate() returns the frozen date.
 */
export function createTimeScrubber(options: TimeScrubberOptions): TimeScrubberController {
  const state: TimeScrubberState = {
    overrideDate: null
  };

  const setOverride = (date: Date): void => {
    state.overrideDate = date;
    options.onDateChange(date);
  };

  const resetToLive = (): void => {
    state.overrideDate = null;
    options.onDateChange(null);
  };

  const getDate = (): Date => {
    return state.overrideDate ?? new Date();
  };

  const getState = (): TimeScrubberState => {
    return { ...state };
  };

  return { setOverride, resetToLive, getDate, getState };
}
