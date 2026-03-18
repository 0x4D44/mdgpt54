import { describe, expect, it, vi } from "vitest";

import {
  buildLayerStatusHints,
  createTrafficUI,
  updateLayerAvailability,
  updateLayerStatusHints,
  updateTrafficCredit,
  updateTrafficStatus
} from "./trafficUI";
import type { SnapshotStatus } from "./trafficTypes";

function makeStatus(
  aircraftCode: SnapshotStatus["aircraft"]["code"] = "ok",
  shipsCode: SnapshotStatus["ships"]["code"] = "ok",
  aircraftMsg: string | null = null,
  shipsMsg: string | null = null
): SnapshotStatus {
  return {
    aircraft: { code: aircraftCode, message: aircraftMsg },
    ships: { code: shipsCode, message: shipsMsg }
  };
}

describe("buildLayerStatusHints", () => {
  it("returns empty when both layers are ok", () => {
    expect(buildLayerStatusHints(makeStatus(), true, true)).toEqual([]);
  });

  it("returns empty when no layers are enabled", () => {
    expect(buildLayerStatusHints(makeStatus("zoom_in", "unavailable"), false, false)).toEqual([]);
  });

  it("returns zoom_in hint for aircraft when enabled", () => {
    const hints = buildLayerStatusHints(makeStatus("zoom_in"), true, false);
    expect(hints).toEqual(["Zoom in for aircraft"]);
  });

  it("returns zoom_in hint for ships when enabled", () => {
    const hints = buildLayerStatusHints(makeStatus("ok", "zoom_in"), false, true);
    expect(hints).toEqual(["Zoom in for ships"]);
  });

  it("returns unavailable hint for aircraft when enabled", () => {
    const hints = buildLayerStatusHints(makeStatus("unavailable"), true, false);
    expect(hints).toEqual(["Aircraft unavailable"]);
  });

  it("returns unavailable hint for ships when enabled", () => {
    const hints = buildLayerStatusHints(makeStatus("ok", "unavailable"), false, true);
    expect(hints).toEqual(["Ships unavailable"]);
  });

  it("returns error hints for retrying layers when enabled", () => {
    const hints = buildLayerStatusHints(
      makeStatus("error", "error", "Aircraft retrying", "Ship relay retrying"),
      true,
      true
    );
    expect(hints).toEqual(["Aircraft retrying", "Ship relay retrying"]);
  });

  it("uses server message when provided", () => {
    const status = makeStatus("zoom_in", "unavailable", "Zoom to z8+ for aircraft", "AIS offline");
    const hints = buildLayerStatusHints(status, true, true);
    expect(hints).toEqual(["Zoom to z8+ for aircraft", "AIS offline"]);
  });

  it("returns hints for both layers when both are degraded", () => {
    const hints = buildLayerStatusHints(makeStatus("zoom_in", "zoom_in"), true, true);
    expect(hints).toEqual(["Zoom in for aircraft", "Zoom in for ships"]);
  });

  it("ignores disabled layers even when degraded", () => {
    const hints = buildLayerStatusHints(makeStatus("zoom_in", "unavailable"), true, false);
    expect(hints).toEqual(["Zoom in for aircraft"]);
  });

  it("prefers a local zoom hint over server zoom_in hints", () => {
    const hints = buildLayerStatusHints(
      makeStatus("zoom_in", "zoom_in"),
      true,
      true,
      "Zoom in past 5 to activate live traffic."
    );
    expect(hints).toEqual(["Zoom in past 5 to activate live traffic."]);
  });

  it("keeps unavailable hints alongside a local zoom hint", () => {
    const hints = buildLayerStatusHints(
      makeStatus("zoom_in", "unavailable"),
      true,
      true,
      "Zoom in past 5 to activate live traffic."
    );
    expect(hints).toEqual(["Zoom in past 5 to activate live traffic.", "Ships unavailable"]);
  });
});

function createClassList(initialClasses: string[] = []) {
  const classes = new Set(initialClasses);

  return {
    add: (...tokens: string[]) => {
      for (const token of tokens) {
        classes.add(token);
      }
    },
    remove: (...tokens: string[]) => {
      for (const token of tokens) {
        classes.delete(token);
      }
    },
    contains: (token: string) => classes.has(token)
  };
}

function createButton(initialClasses: string[] = []): HTMLButtonElement {
  return {
    classList: createClassList(initialClasses),
    disabled: false,
    title: ""
  } as HTMLButtonElement;
}

function createHiddenElement(): HTMLElement {
  return {
    className: "",
    textContent: "",
    hidden: true
  } as HTMLElement;
}

function createStatusElement(): HTMLElement {
  return {
    className: "",
    textContent: ""
  } as HTMLElement;
}

function createEls() {
  return {
    section: {} as HTMLElement,
    aircraftToggle: createButton(),
    shipsToggle: createButton(),
    statusText: createStatusElement(),
    creditNote: createHiddenElement(),
    hintsContainer: createHiddenElement()
  };
}

describe("updateLayerAvailability", () => {
  it("keeps an unavailable layer active so the UX does not silently clear itself", () => {
    const shipsToggle = createButton(["is-active"]);
    const aircraftToggle = createButton();

    updateLayerAvailability(
      {
        section: {} as HTMLElement,
        aircraftToggle,
        shipsToggle,
        statusText: createStatusElement(),
        creditNote: createStatusElement(),
        hintsContainer: createStatusElement()
      },
      makeStatus("ok", "unavailable", null, "Ships need a live relay.")
    );

    expect(shipsToggle.disabled).toBe(false);
    expect(shipsToggle.classList.contains("is-active")).toBe(true);
    expect(shipsToggle.classList.contains("is-unavailable")).toBe(true);
    expect(shipsToggle.title).toBe("Ships need a live relay.");
  });

  it("marks retrying layer errors without disabling the toggle", () => {
    const shipsToggle = createButton(["is-active"]);
    const aircraftToggle = createButton();

    updateLayerAvailability(
      {
        section: {} as HTMLElement,
        aircraftToggle,
        shipsToggle,
        statusText: createStatusElement(),
        creditNote: createStatusElement(),
        hintsContainer: createStatusElement()
      },
      makeStatus("ok", "error", null, "Ship relay disconnected. Reconnecting.")
    );

    expect(shipsToggle.disabled).toBe(false);
    expect(shipsToggle.classList.contains("is-active")).toBe(true);
    expect(shipsToggle.classList.contains("is-error")).toBe(true);
    expect(shipsToggle.classList.contains("is-unavailable")).toBe(false);
    expect(shipsToggle.title).toBe("Ship relay disconnected. Reconnecting.");
  });
});

describe("updateTrafficStatus", () => {
  it("shows an aircraft-specific error instead of generic reconnecting text", () => {
    const els = createEls();

    updateTrafficStatus(els, "aircraft_error", true, false);

    expect(els.statusText.textContent).toBe("Aircraft feed error");
    expect(els.statusText.className).toBe("traffic-status traffic-status--disconnected");
  });

  it("shows Off when neither layer is enabled", () => {
    const els = createEls();

    updateTrafficStatus(els, "connected", false, false);

    expect(els.statusText.textContent).toBe("Off");
    expect(els.statusText.className).toBe("traffic-status");
  });

  it("shows Standby when status is standby", () => {
    const els = createEls();

    updateTrafficStatus(els, "standby", true, false);

    expect(els.statusText.textContent).toBe("Standby");
    expect(els.statusText.className).toBe("traffic-status");
  });

  it("shows Connecting... when connecting", () => {
    const els = createEls();

    updateTrafficStatus(els, "connecting", false, true);

    expect(els.statusText.textContent).toBe("Connecting...");
    expect(els.statusText.className).toBe("traffic-status traffic-status--connecting");
  });

  it("shows Live when connected", () => {
    const els = createEls();

    updateTrafficStatus(els, "connected", true, true);

    expect(els.statusText.textContent).toBe("Live");
    expect(els.statusText.className).toBe("traffic-status traffic-status--live");
  });

  it("shows Reconnecting... when disconnected", () => {
    const els = createEls();

    updateTrafficStatus(els, "disconnected", true, false);

    expect(els.statusText.textContent).toBe("Reconnecting...");
    expect(els.statusText.className).toBe("traffic-status traffic-status--disconnected");
  });

  it("shows Static Only when unavailable", () => {
    const els = createEls();

    updateTrafficStatus(els, "unavailable", true, false);

    expect(els.statusText.textContent).toBe("Static Only");
    expect(els.statusText.className).toBe("traffic-status traffic-status--unavailable");
  });
});

describe("updateLayerAvailability zoom_in", () => {
  it("marks a zoom_in aircraft toggle with the hint class", () => {
    const els = createEls();

    updateLayerAvailability(els, makeStatus("zoom_in", "ok", "Zoom in for aircraft"));

    expect(els.aircraftToggle.classList.contains("is-zoom-hint")).toBe(true);
    expect(els.aircraftToggle.disabled).toBe(false);
    expect(els.aircraftToggle.title).toBe("Zoom in for aircraft");
  });

  it("clears previous error class when status goes to ok", () => {
    const els = createEls();
    els.shipsToggle.classList.add("is-error");

    updateLayerAvailability(els, makeStatus("ok", "ok"));

    expect(els.shipsToggle.classList.contains("is-error")).toBe(false);
    expect(els.shipsToggle.disabled).toBe(false);
    expect(els.shipsToggle.title).toBe("");
  });
});

describe("updateLayerStatusHints", () => {
  it("sets hint text and unhides the container when hints exist", () => {
    const els = createEls();

    updateLayerStatusHints(els, makeStatus("zoom_in", "ok"), true, false);

    expect(els.hintsContainer.textContent).toBe("Zoom in for aircraft");
    expect(els.hintsContainer.hidden).toBe(false);
  });

  it("hides the container when no hints exist", () => {
    const els = createEls();
    els.hintsContainer.hidden = false;

    updateLayerStatusHints(els, makeStatus("ok", "ok"), true, true);

    expect(els.hintsContainer.textContent).toBe("");
    expect(els.hintsContainer.hidden).toBe(true);
  });

  it("joins multiple hints with pipe separator", () => {
    const els = createEls();

    updateLayerStatusHints(els, makeStatus("zoom_in", "unavailable"), true, true);

    expect(els.hintsContainer.textContent).toBe("Zoom in for aircraft | Ships unavailable");
    expect(els.hintsContainer.hidden).toBe(false);
  });

  it("passes localHint through to buildLayerStatusHints", () => {
    const els = createEls();

    updateLayerStatusHints(els, makeStatus("zoom_in", "ok"), true, false, "Custom hint");

    expect(els.hintsContainer.textContent).toBe("Custom hint");
  });
});

describe("updateTrafficCredit", () => {
  it("shows aircraft credit when only aircraft enabled", () => {
    const els = createEls();

    updateTrafficCredit(els, true, false);

    expect(els.creditNote.hidden).toBe(false);
    expect(els.creditNote.textContent).toBe(
      "Traffic: Aircraft: OpenSky Network live traffic + aircraft metadata."
    );
  });

  it("shows ships credit when only ships enabled", () => {
    const els = createEls();

    updateTrafficCredit(els, false, true);

    expect(els.creditNote.hidden).toBe(false);
    expect(els.creditNote.textContent).toBe("Traffic: Ships: AISStream.");
  });

  it("shows combined credit when both enabled", () => {
    const els = createEls();

    updateTrafficCredit(els, true, true);

    expect(els.creditNote.hidden).toBe(false);
    expect(els.creditNote.textContent).toBe(
      "Traffic: Aircraft: OpenSky Network live traffic + aircraft metadata, Ships: AISStream."
    );
  });

  it("hides credit and clears text when neither enabled", () => {
    const els = createEls();
    els.creditNote.hidden = false;
    els.creditNote.textContent = "old";

    updateTrafficCredit(els, false, false);

    expect(els.creditNote.hidden).toBe(true);
    expect(els.creditNote.textContent).toBe("");
  });
});

describe("createTrafficUI", () => {
  it("builds the traffic section and appends to the dock", () => {
    const childElements: HTMLElement[] = [];
    const section = {
      className: "",
      innerHTML: "",
      querySelector: (selector: string) => {
        if (selector === '[data-traffic-toggle="aircraft"]')
          return { dataset: { trafficToggle: "aircraft" } };
        if (selector === '[data-traffic-toggle="ships"]')
          return { dataset: { trafficToggle: "ships" } };
        if (selector === "#traffic-status") return { id: "traffic-status" };
        if (selector === "#traffic-credit") return { id: "traffic-credit" };
        if (selector === "#traffic-hints") return { id: "traffic-hints" };
        return null;
      }
    } as unknown as HTMLElement;

    const dock = {
      querySelector: () => null,
      appendChild: (child: HTMLElement) => {
        childElements.push(child);
      },
      insertBefore: () => {}
    } as unknown as HTMLElement;

    vi.stubGlobal("document", {
      createElement: () => section
    });

    const els = createTrafficUI(dock);

    expect(els.section).toBe(section);
    expect(section.className).toBe("traffic-section");
    expect(childElements).toContain(section);
    expect(els.aircraftToggle).toBeTruthy();
    expect(els.shipsToggle).toBeTruthy();
    expect(els.statusText).toBeTruthy();
    expect(els.creditNote).toBeTruthy();
    expect(els.hintsContainer).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it("inserts section before an existing credit-note element", () => {
    let insertedBefore: unknown = null;
    const creditNote = { className: "credit-note" };
    const section = {
      className: "",
      innerHTML: "",
      querySelector: () => ({})
    } as unknown as HTMLElement;

    const dock = {
      querySelector: (sel: string) => (sel === ".credit-note" ? creditNote : null),
      insertBefore: (_node: unknown, ref: unknown) => {
        insertedBefore = ref;
      },
      appendChild: () => {}
    } as unknown as HTMLElement;

    vi.stubGlobal("document", {
      createElement: () => section
    });

    createTrafficUI(dock);

    expect(insertedBefore).toBe(creditNote);

    vi.unstubAllGlobals();
  });
});
