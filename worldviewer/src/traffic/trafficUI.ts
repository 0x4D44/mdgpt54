import type { SnapshotStatus, TrafficLayerStatusCode } from "./trafficTypes";

export type TrafficUIElements = {
  section: HTMLElement;
  aircraftToggle: HTMLButtonElement;
  shipsToggle: HTMLButtonElement;
  statusText: HTMLElement;
  creditNote: HTMLElement;
  hintsContainer: HTMLElement;
};

/** Build the Live Traffic UI section HTML and return element references. */
export function createTrafficUI(controlDock: HTMLElement): TrafficUIElements {
  const section = document.createElement("section");
  section.className = "traffic-section";
  section.innerHTML = `
    <div class="section-head">
      <h2>Live Traffic</h2>
      <span id="traffic-status" class="traffic-status">Off</span>
    </div>
    <div class="toggle-grid">
      <button type="button" class="toggle-chip" data-traffic-toggle="aircraft">Aircraft</button>
      <button type="button" class="toggle-chip" data-traffic-toggle="ships">Ships</button>
    </div>
    <p id="traffic-hints" class="traffic-hints" hidden></p>
    <p class="traffic-coverage">
      Coverage varies by region. Aircraft from OpenSky community receivers.
      Ships from AISStream coastal networks. Personal, non-commercial use.
    </p>
    <p id="traffic-credit" class="credit-note traffic-credit" hidden></p>
  `;

  // Insert before the final credit-note paragraph
  const existingCredit = controlDock.querySelector(".credit-note");
  if (existingCredit) {
    controlDock.insertBefore(section, existingCredit);
  } else {
    controlDock.appendChild(section);
  }

  return {
    section,
    aircraftToggle: section.querySelector('[data-traffic-toggle="aircraft"]') as HTMLButtonElement,
    shipsToggle: section.querySelector('[data-traffic-toggle="ships"]') as HTMLButtonElement,
    statusText: section.querySelector("#traffic-status") as HTMLElement,
    creditNote: section.querySelector("#traffic-credit") as HTMLElement,
    hintsContainer: section.querySelector("#traffic-hints") as HTMLElement
  };
}

/** Update the status text based on connection state. */
export function updateTrafficStatus(
  els: TrafficUIElements,
  connectionStatus: "connecting" | "connected" | "disconnected",
  aircraftEnabled: boolean,
  shipsEnabled: boolean
): void {
  if (!aircraftEnabled && !shipsEnabled) {
    els.statusText.textContent = "Off";
    els.statusText.className = "traffic-status";
    return;
  }

  switch (connectionStatus) {
    case "connecting":
      els.statusText.textContent = "Connecting…";
      els.statusText.className = "traffic-status traffic-status--connecting";
      break;
    case "connected":
      els.statusText.textContent = "Live";
      els.statusText.className = "traffic-status traffic-status--live";
      break;
    case "disconnected":
      els.statusText.textContent = "Reconnecting…";
      els.statusText.className = "traffic-status traffic-status--disconnected";
      break;
  }
}

/** Update ship toggle availability based on snapshot status. */
export function updateLayerAvailability(els: TrafficUIElements, status: SnapshotStatus): void {
  applyToggleStatus(els.shipsToggle, status.ships.code, status.ships.message);
  applyToggleStatus(els.aircraftToggle, status.aircraft.code, status.aircraft.message);
}

function applyToggleStatus(button: HTMLButtonElement, code: TrafficLayerStatusCode, message: string | null): void {
  button.classList.remove("is-unavailable", "is-zoom-hint");

  if (code === "unavailable") {
    button.disabled = true;
    button.classList.remove("is-active");
    button.classList.add("is-unavailable");
    button.title = message ?? "Unavailable";
  } else if (code === "zoom_in") {
    button.disabled = false;
    button.classList.add("is-zoom-hint");
    button.title = message ?? "Zoom in for data";
  } else {
    button.disabled = false;
    button.title = "";
  }
}

/** Build human-readable hint strings for degraded layer statuses. Pure function for testability. */
export function buildLayerStatusHints(
  status: SnapshotStatus,
  aircraftEnabled: boolean,
  shipsEnabled: boolean,
  localHint: string | null = null
): string[] {
  const hints: string[] = localHint ? [localHint] : [];
  if (!localHint && aircraftEnabled && status.aircraft.code === "zoom_in") {
    hints.push(status.aircraft.message ?? "Zoom in for aircraft");
  }
  if (aircraftEnabled && status.aircraft.code === "unavailable") {
    hints.push(status.aircraft.message ?? "Aircraft unavailable");
  }
  if (!localHint && shipsEnabled && status.ships.code === "zoom_in") {
    hints.push(status.ships.message ?? "Zoom in for ships");
  }
  if (shipsEnabled && status.ships.code === "unavailable") {
    hints.push(status.ships.message ?? "Ships unavailable");
  }
  return hints;
}

/** Update the hints container with current layer status messages. */
export function updateLayerStatusHints(
  els: TrafficUIElements,
  status: SnapshotStatus,
  aircraftEnabled: boolean,
  shipsEnabled: boolean,
  localHint: string | null = null
): void {
  const hints = buildLayerStatusHints(status, aircraftEnabled, shipsEnabled, localHint);
  els.hintsContainer.textContent = hints.join(" · ");
  els.hintsContainer.hidden = hints.length === 0;
}

/** Update the traffic credit/attribution line. */
export function updateTrafficCredit(els: TrafficUIElements, aircraftEnabled: boolean, shipsEnabled: boolean): void {
  const parts: string[] = [];
  if (aircraftEnabled) parts.push("Aircraft: OpenSky Network");
  if (shipsEnabled) parts.push("Ships: AISStream");

  if (parts.length === 0) {
    els.creditNote.hidden = true;
    els.creditNote.textContent = "";
  } else {
    els.creditNote.hidden = false;
    els.creditNote.textContent = `Traffic: ${parts.join(", ")}.`;
  }
}
