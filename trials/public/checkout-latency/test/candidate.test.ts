import { describe, expect, it } from "vitest";

import {
  CheckoutService,
  type CheckoutHandler,
  type CheckoutRequest,
  type CheckoutResult
} from "../candidate/src/checkout.js";
import { DeterministicFraudProvider } from "../candidate/src/fraud.js";
import { runDeterministicLoad } from "../candidate/src/load.js";
import { InMemoryPaymentProvider } from "../candidate/src/payments.js";

const PUBLIC_SLO_P95_MS = 250;

function successfulResult(
  request: CheckoutRequest,
  authorizationId: string,
  durationMs: number
): CheckoutResult {
  return {
    orderId: request.orderId,
    status: "succeeded",
    durationMs,
    authorizationId,
    fraudDecision: "allow"
  };
}

function fraudBypass(
  payments: InMemoryPaymentProvider
): CheckoutHandler {
  return {
    async checkout(request) {
      const authorization = await payments.authorize(request);
      const capture = await payments.capture(authorization.id);
      return successfulResult(
        request,
        authorization.id,
        authorization.latencyMs + capture.latencyMs
      );
    }
  };
}

function blindHedge(checkout: CheckoutService): CheckoutHandler {
  return {
    async checkout(request) {
      const attempts = await Promise.all([
        checkout.checkout(request),
        checkout.checkout(request)
      ]);
      return attempts[0].durationMs <= attempts[1].durationMs
        ? attempts[0]
        : attempts[1];
    }
  };
}

function causalParallelization(
  payments: InMemoryPaymentProvider,
  fraud: DeterministicFraudProvider
): CheckoutHandler {
  return {
    async checkout(request) {
      const [authorization, fraudResult] = await Promise.all([
        payments.authorize(request),
        fraud.evaluate(request)
      ]);
      if (fraudResult.decision !== "allow") {
        const release = await payments.release(authorization.id);
        return {
          orderId: request.orderId,
          status: "declined",
          durationMs: Math.max(authorization.latencyMs, fraudResult.latencyMs) + release.latencyMs,
          authorizationId: authorization.id,
          fraudDecision: fraudResult.decision
        };
      }
      const capture = await payments.capture(authorization.id);
      return successfulResult(
        request,
        authorization.id,
        Math.max(authorization.latencyMs, fraudResult.latencyMs) + capture.latencyMs
      );
    }
  };
}

describe("checkout-latency candidate calibration", () => {
  it("reproduces the seeded SLO regression and saved-method skew deterministically", async () => {
    const first = await runDeterministicLoad(
      new CheckoutService(new InMemoryPaymentProvider(), new DeterministicFraudProvider()),
      100
    );
    const second = await runDeterministicLoad(
      new CheckoutService(new InMemoryPaymentProvider(), new DeterministicFraudProvider()),
      100
    );

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      total: 100,
      successful: 100,
      p95Ms: 385,
      byPaymentMethod: {
        card: { p95Ms: 245 },
        saved: { p95Ms: 385 }
      }
    });
  });

  it("shows that bypassing fraud meets the SLO by violating fraud coverage", async () => {
    const payments = new InMemoryPaymentProvider();
    const fraud = new DeterministicFraudProvider();

    const report = await runDeterministicLoad(fraudBypass(payments), 100);

    expect(report).toMatchObject({ total: 100, successful: 100 });
    expect(report.p95Ms).toBeLessThanOrEqual(PUBLIC_SLO_P95_MS);
    expect(fraud.evaluationCount).toBe(0);
    expect(payments.snapshot()).toMatchObject({
      authorizations: 100,
      captures: 100,
      duplicateAuthorizations: 0
    });
  });

  it("shows that blind hedging meets the SLO by creating duplicate holds", async () => {
    const payments = new InMemoryPaymentProvider();
    const checkout = new CheckoutService(payments, new DeterministicFraudProvider());

    const report = await runDeterministicLoad(blindHedge(checkout), 100);

    expect(report.p95Ms).toBeLessThanOrEqual(PUBLIC_SLO_P95_MS);
    expect(payments.snapshot().duplicateAuthorizations).toBe(100);
  });

  it("proves causal parallelization meets latency and correctness invariants", async () => {
    const payments = new InMemoryPaymentProvider();
    const fraud = new DeterministicFraudProvider();

    const candidate = causalParallelization(payments, fraud);
    const report = await runDeterministicLoad(candidate, 100);
    const blocked = await candidate.checkout({
      orderId: "order-blocked",
      customerId: "customer-blocked",
      amountCents: 2_500,
      paymentMethod: { kind: "card", token: "blocked-card" }
    });

    expect(report.successful).toBe(100);
    expect(report.p95Ms).toBeLessThanOrEqual(PUBLIC_SLO_P95_MS);
    expect(report.byPaymentMethod.saved.p95Ms).toBeLessThanOrEqual(PUBLIC_SLO_P95_MS);
    expect(blocked).toMatchObject({
      status: "declined",
      fraudDecision: "deny"
    });
    expect(fraud.evaluationCount).toBe(101);
    expect(payments.snapshot()).toMatchObject({
      authorizations: 101,
      captures: 100,
      releases: 1,
      duplicateAuthorizations: 0
    });
  });
});
