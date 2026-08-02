import type { CheckoutRequest, FraudDecision } from "./checkout.js";

export interface FraudEvaluation {
  readonly decision: FraudDecision;
  readonly latencyMs: number;
}

export interface FraudProvider {
  evaluate(request: CheckoutRequest): Promise<FraudEvaluation>;
}

export class DeterministicFraudProvider implements FraudProvider {
  private readonly attemptsByOrder = new Map<string, number>();
  private evaluations = 0;

  get evaluationCount(): number {
    return this.evaluations;
  }

  async evaluate(request: CheckoutRequest): Promise<FraudEvaluation> {
    const priorAttempts = this.attemptsByOrder.get(request.orderId) ?? 0;
    this.attemptsByOrder.set(request.orderId, priorAttempts + 1);
    this.evaluations += 1;

    const decision: FraudDecision = request.paymentMethod.token.startsWith("blocked-")
      ? "deny"
      : "allow";
    const latencyMs =
      priorAttempts > 0
        ? 40
        : request.paymentMethod.kind === "saved"
          ? 210
          : 120;

    return { decision, latencyMs };
  }
}
