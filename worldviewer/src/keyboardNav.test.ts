import { describe, expect, it, vi } from "vitest";

import { resolveKeyAction, createKeydownHandler } from "./keyboardNav";

describe("keyboardNav", () => {
  describe("resolveKeyAction", () => {
    it("maps 't' to terrain toggle", () => {
      expect(resolveKeyAction("t")).toEqual({ type: "toggle", name: "terrain" });
    });

    it("maps 'n' to night toggle", () => {
      expect(resolveKeyAction("n")).toEqual({ type: "toggle", name: "night" });
    });

    it("maps 'w' to weather toggle", () => {
      expect(resolveKeyAction("w")).toEqual({ type: "toggle", name: "weather" });
    });

    it("maps 'a' to aircraft toggle", () => {
      expect(resolveKeyAction("a")).toEqual({ type: "toggle", name: "aircraft" });
    });

    it("maps 's' to ships toggle", () => {
      expect(resolveKeyAction("s")).toEqual({ type: "toggle", name: "ships" });
    });

    it("maps 'b' to buildings toggle", () => {
      expect(resolveKeyAction("b")).toEqual({ type: "toggle", name: "buildings" });
    });

    it("maps 'r' to relief toggle", () => {
      expect(resolveKeyAction("r")).toEqual({ type: "toggle", name: "relief" });
    });

    it("maps 'o' to spin toggle", () => {
      expect(resolveKeyAction("o")).toEqual({ type: "toggle", name: "spin" });
    });

    it("maps '3' to preset index 2", () => {
      expect(resolveKeyAction("3")).toEqual({ type: "preset", index: 2 });
    });

    it("maps '1' to preset index 0", () => {
      expect(resolveKeyAction("1")).toEqual({ type: "preset", index: 0 });
    });

    it("maps '6' to preset index 5", () => {
      expect(resolveKeyAction("6")).toEqual({ type: "preset", index: 5 });
    });

    it("maps 'Escape' to escape action", () => {
      expect(resolveKeyAction("Escape")).toEqual({ type: "escape" });
    });

    it("maps '/' to search action", () => {
      expect(resolveKeyAction("/")).toEqual({ type: "search" });
    });

    it("returns null for unmapped key 'x'", () => {
      expect(resolveKeyAction("x")).toBeNull();
    });

    it("returns null for unmapped key '0'", () => {
      expect(resolveKeyAction("0")).toBeNull();
    });

    it("returns null for unmapped key '7'", () => {
      expect(resolveKeyAction("7")).toBeNull();
    });

    it("treats uppercase 'T' the same as lowercase 't'", () => {
      expect(resolveKeyAction("T")).toEqual({ type: "toggle", name: "terrain" });
    });

    it("treats uppercase 'W' the same as lowercase 'w'", () => {
      expect(resolveKeyAction("W")).toEqual({ type: "toggle", name: "weather" });
    });
  });

  describe("createKeydownHandler", () => {
    function makeOptions() {
      return {
        isInputFocused: vi.fn(() => false),
        toggleByName: vi.fn(),
        activatePreset: vi.fn(),
        closePopup: vi.fn(),
        focusSearch: vi.fn()
      };
    }

    function makeEvent(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
      return {
        key,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
        ...overrides
      } as unknown as KeyboardEvent;
    }

    it("calls toggleByName when a toggle key is pressed and input is not focused", () => {
      const opts = makeOptions();
      const handler = createKeydownHandler(opts);
      const event = makeEvent("t");

      handler(event);

      expect(opts.toggleByName).toHaveBeenCalledWith("terrain");
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("calls activatePreset when a preset key is pressed", () => {
      const opts = makeOptions();
      const handler = createKeydownHandler(opts);
      const event = makeEvent("3");

      handler(event);

      expect(opts.activatePreset).toHaveBeenCalledWith(2);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("calls closePopup when Escape is pressed and input is not focused", () => {
      const opts = makeOptions();
      const handler = createKeydownHandler(opts);
      const event = makeEvent("Escape");

      handler(event);

      expect(opts.closePopup).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("calls focusSearch when '/' is pressed and input is not focused", () => {
      const opts = makeOptions();
      const handler = createKeydownHandler(opts);
      const event = makeEvent("/");

      handler(event);

      expect(opts.focusSearch).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("does not call toggle callbacks when input is focused", () => {
      const opts = makeOptions();
      opts.isInputFocused.mockReturnValue(true);
      const handler = createKeydownHandler(opts);
      const event = makeEvent("t");

      handler(event);

      expect(opts.toggleByName).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("does not call preset callbacks when input is focused", () => {
      const opts = makeOptions();
      opts.isInputFocused.mockReturnValue(true);
      const handler = createKeydownHandler(opts);
      const event = makeEvent("3");

      handler(event);

      expect(opts.activatePreset).not.toHaveBeenCalled();
    });

    it("does not call focusSearch when input is focused", () => {
      const opts = makeOptions();
      opts.isInputFocused.mockReturnValue(true);
      const handler = createKeydownHandler(opts);
      const event = makeEvent("/");

      handler(event);

      expect(opts.focusSearch).not.toHaveBeenCalled();
    });

    it("still calls closePopup when Escape is pressed and input IS focused", () => {
      const opts = makeOptions();
      opts.isInputFocused.mockReturnValue(true);
      const handler = createKeydownHandler(opts);
      const event = makeEvent("Escape");

      handler(event);

      expect(opts.closePopup).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("does not fire when Ctrl modifier is held", () => {
      const opts = makeOptions();
      const handler = createKeydownHandler(opts);
      const event = makeEvent("t", { ctrlKey: true });

      handler(event);

      expect(opts.toggleByName).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("does not fire when Alt modifier is held", () => {
      const opts = makeOptions();
      const handler = createKeydownHandler(opts);
      const event = makeEvent("t", { altKey: true });

      handler(event);

      expect(opts.toggleByName).not.toHaveBeenCalled();
    });

    it("does not fire when Meta modifier is held", () => {
      const opts = makeOptions();
      const handler = createKeydownHandler(opts);
      const event = makeEvent("t", { metaKey: true });

      handler(event);

      expect(opts.toggleByName).not.toHaveBeenCalled();
    });

    it("does not call preventDefault for unmapped keys", () => {
      const opts = makeOptions();
      const handler = createKeydownHandler(opts);
      const event = makeEvent("x");

      handler(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("handles uppercase key from CapsLock via case-insensitive resolution", () => {
      const opts = makeOptions();
      const handler = createKeydownHandler(opts);
      const event = makeEvent("N");

      handler(event);

      expect(opts.toggleByName).toHaveBeenCalledWith("night");
    });
  });
});
