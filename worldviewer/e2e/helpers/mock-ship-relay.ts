import { Page, WebSocketRoute } from "@playwright/test";

export interface MockShipRelay {
  sendShipData(data: unknown): void;
  close(): void;
}

export async function mockShipRelay(page: Page): Promise<MockShipRelay> {
  let route: WebSocketRoute | null = null;

  await page.routeWebSocket("**/traffic", (ws) => {
    route = ws;
    // Don't connect to real server - mock it entirely
    // Listen for client messages (e.g., subscribe)
    ws.onMessage(() => {
      // No-op: acknowledge subscribe silently
    });
  });

  return {
    sendShipData(data: unknown) {
      route?.send(JSON.stringify(data));
    },
    close() {
      route?.close();
    },
  };
}
