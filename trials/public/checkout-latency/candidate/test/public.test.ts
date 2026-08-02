import { describe, expect, it } from "vitest";

import { CheckoutService } from "../src/checkout.js";
import { DeterministicFraudProvider } from "../src/fraud.js";
import { runDeterministicLoad } from "../src/load.js";
import { InMemoryPaymentProvider } from "../src/payments.js";

const PUBLIC_SLO_P95_MS = 250;
const missionDescribe = process.env.FLUXGRADE_PUBLIC_TESTS === "1" ? describe : describe.skip;

missionDescribe("checkout latency", () => {
  it("keeps successful checkout p95 within the published SLO", async () => {
    const checkout = new CheckoutService(
      new InMemoryPaymentProvider(),
      new DeterministicFraudProvider()
    );

    const report = await runDeterministicLoad(checkout, 100);

    expect(report.successful).toBe(report.total);
    expect(report.p95Ms).toBeLessThanOrEqual(PUBLIC_SLO_P95_MS);
    expect(report.byPaymentMethod.saved.p95Ms).toBeLessThanOrEqual(PUBLIC_SLO_P95_MS);
  });
});
