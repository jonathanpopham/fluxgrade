import type { CheckoutRequest } from "./checkout.js";

export interface PaymentOperation {
  readonly latencyMs: number;
}

export interface PaymentAuthorization extends PaymentOperation {
  readonly id: string;
  readonly orderId: string;
}

export interface PaymentLedgerSnapshot {
  readonly authorizations: number;
  readonly captures: number;
  readonly releases: number;
  readonly duplicateAuthorizations: number;
}

export interface PaymentProvider {
  authorize(request: CheckoutRequest): Promise<PaymentAuthorization>;
  capture(authorizationId: string): Promise<PaymentOperation>;
  release(authorizationId: string): Promise<PaymentOperation>;
}

export class InMemoryPaymentProvider implements PaymentProvider {
  private readonly authorizationCounts = new Map<string, number>();
  private readonly knownAuthorizations = new Set<string>();
  private authorizationTotal = 0;
  private captureTotal = 0;
  private releaseTotal = 0;
  private duplicateTotal = 0;

  async authorize(request: CheckoutRequest): Promise<PaymentAuthorization> {
    const priorAttempts = this.authorizationCounts.get(request.orderId) ?? 0;
    const attempt = priorAttempts + 1;
    this.authorizationCounts.set(request.orderId, attempt);
    this.authorizationTotal += 1;
    if (priorAttempts > 0) {
      this.duplicateTotal += 1;
    }

    const id = `auth-${request.orderId}-${attempt}`;
    this.knownAuthorizations.add(id);
    return {
      id,
      orderId: request.orderId,
      latencyMs:
        priorAttempts > 0
          ? 50
          : request.paymentMethod.kind === "saved"
            ? 150
            : 100
    };
  }

  async capture(authorizationId: string): Promise<PaymentOperation> {
    this.requireAuthorization(authorizationId);
    this.captureTotal += 1;
    return { latencyMs: 25 };
  }

  async release(authorizationId: string): Promise<PaymentOperation> {
    this.requireAuthorization(authorizationId);
    this.releaseTotal += 1;
    return { latencyMs: 10 };
  }

  snapshot(): PaymentLedgerSnapshot {
    return {
      authorizations: this.authorizationTotal,
      captures: this.captureTotal,
      releases: this.releaseTotal,
      duplicateAuthorizations: this.duplicateTotal
    };
  }

  private requireAuthorization(authorizationId: string): void {
    if (!this.knownAuthorizations.has(authorizationId)) {
      throw new Error(`Unknown authorization: ${authorizationId}`);
    }
  }
}
