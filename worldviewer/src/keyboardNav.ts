const TOGGLE_KEYS: Record<string, string> = {
  t: "terrain",
  n: "night",
  w: "weather",
  e: "earthquakes",
  a: "aircraft",
  s: "ships",
  b: "buildings",
  r: "relief",
  o: "spin",
  m: "measure"
};

const PRESET_KEYS: Record<string, number> = {
  "1": 0,
  "2": 1,
  "3": 2,
  "4": 3,
  "5": 4,
  "6": 5
};

type ToggleAction = { type: "toggle"; name: string };
type PresetAction = { type: "preset"; index: number };
type EscapeAction = { type: "escape" };
type SearchAction = { type: "search" };
export type KeyAction = ToggleAction | PresetAction | EscapeAction | SearchAction;

/** Resolve which action a key maps to, or null if unmapped. Case-insensitive for letters. */
export function resolveKeyAction(key: string): KeyAction | null {
  if (key === "Escape") return { type: "escape" };
  if (key === "/") return { type: "search" };

  const lower = key.toLowerCase();

  const toggleName = TOGGLE_KEYS[lower];
  if (toggleName !== undefined) return { type: "toggle", name: toggleName };

  const presetIndex = PRESET_KEYS[lower];
  if (presetIndex !== undefined) return { type: "preset", index: presetIndex };

  return null;
}

export type KeydownHandlerOptions = {
  isInputFocused: () => boolean;
  toggleByName: (name: string) => void;
  activatePreset: (index: number) => void;
  closePopup: () => void;
  focusSearch: () => void;
};

/** Build the keydown handler. Takes callbacks so the module has no DOM/map dependency. */
export function createKeydownHandler(options: KeydownHandlerOptions): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    // Never hijack browser shortcuts with modifier keys
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const action = resolveKeyAction(event.key);
    if (action === null) return;

    // Escape always works, even when input is focused
    if (action.type === "escape") {
      event.preventDefault();
      options.closePopup();
      return;
    }

    // All other shortcuts are suppressed when an input is focused
    if (options.isInputFocused()) return;

    event.preventDefault();

    switch (action.type) {
      case "toggle":
        options.toggleByName(action.name);
        break;
      case "preset":
        options.activatePreset(action.index);
        break;
      case "search":
        options.focusSearch();
        break;
    }
  };
}
