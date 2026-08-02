import type { FraudProvider } from "./fraud.js";
import type { PaymentProvider } from "./payments.js";

export type PaymentMethodKind = "card" | "saved";
export type FraudDecision = "allow" | "review" | "deny";

export interface CheckoutRequest {
  readonly orderId: string;
  readonly customerId: string;
  readonly amountCents: number;
  readonly paymentMethod: {
    readonly kind: PaymentMethodKind;
    readonly token: string;
  };
}

export interface CheckoutResult {
  readonly orderId: string;
  readonly status: "succeeded" | "declined";
  readonly durationMs: number;
  readonly authorizationId: string;
  readonly fraudDecision: FraudDecision;
}

export interface CheckoutHandler {
  checkout(request: CheckoutRequest): Promise<CheckoutResult>;
}

export class CheckoutService implements CheckoutHandler {
  constructor(
    private readonly payments: PaymentProvider,
    private readonly fraud: FraudProvider
  ) {}

  async checkout(request: CheckoutRequest): Promise<CheckoutResult> {
    const authorization = await this.payments.authorize(request);
    const fraud = await this.fraud.evaluate(request);
    if (fraud.decision !== "allow") {
      const release = await this.payments.release(authorization.id);
      return {
        orderId: request.orderId,
        status: "declined",
        durationMs: authorization.latencyMs + fraud.latencyMs + release.latencyMs,
        authorizationId: authorization.id,
        fraudDecision: fraud.decision
      };
    }
    const capture = await this.payments.capture(authorization.id);
    return {
      orderId: request.orderId,
      status: "succeeded",
      durationMs: authorization.latencyMs + fraud.latencyMs + capture.latencyMs,
      authorizationId: authorization.id,
      fraudDecision: fraud.decision
    };
  }
}
