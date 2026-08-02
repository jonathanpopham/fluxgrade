import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createCheckoutServer } from "../candidate/src/server.js";

const servers: Array<ReturnType<typeof createCheckoutServer>> = [];

async function startServer(): Promise<string> {
  const server = createCheckoutServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
});

describe("candidate checkout server", () => {
  it("serves health and deterministic checkout responses", async () => {
    const origin = await startServer();

    const health = await fetch(`${origin}/health`);
    const checkout = await fetch(`${origin}/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: "order-smoke",
        customerId: "customer-smoke",
        amountCents: 2500,
        paymentMethod: { kind: "saved", token: "saved-smoke" }
      })
    });

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ready" });
    expect(checkout.status).toBe(200);
    await expect(checkout.json()).resolves.toMatchObject({
      orderId: "order-smoke",
      status: "succeeded",
      durationMs: 385,
      fraudDecision: "allow"
    });
  });

  it("rejects malformed checkout input without invoking the service", async () => {
    const origin = await startServer();

    const response = await fetch(`${origin}/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: "missing-fields" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid-checkout-request" });
  });
});
