import type {
  CheckoutHandler,
  CheckoutResult,
  PaymentMethodKind
} from "./checkout.js";

export interface LatencySlice {
  readonly requests: number;
  readonly successful: number;
  readonly p95Ms: number;
}

export interface LoadReport extends LatencySlice {
  readonly total: number;
  readonly byPaymentMethod: Readonly<Record<PaymentMethodKind, LatencySlice>>;
}

export async function runDeterministicLoad(
  checkout: CheckoutHandler,
  requestCount: number
): Promise<LoadReport> {
  const operations: Array<
    Promise<{ readonly kind: PaymentMethodKind; readonly result: CheckoutResult }>
  > = [];

  for (let index = 0; index < requestCount; index += 1) {
    const kind: PaymentMethodKind = index % 5 === 0 ? "saved" : "card";
    const request = {
      orderId: `order-${String(index + 1).padStart(4, "0")}`,
      customerId: `customer-${String((index % 20) + 1).padStart(2, "0")}`,
      amountCents: 1_000 + index,
      paymentMethod: {
        kind,
        token: `${kind}-token-${String(index + 1).padStart(4, "0")}`
      }
    } as const;
    operations.push(
      checkout.checkout(request).then((result) => ({ kind, result }))
    );
  }

  const samples = await Promise.all(operations);
  const allDurations: number[] = [];
  const cardDurations: number[] = [];
  const savedDurations: number[] = [];
  let successful = 0;
  let cardSuccessful = 0;
  let savedSuccessful = 0;

  for (const sample of samples) {
    allDurations.push(sample.result.durationMs);
    if (sample.result.status === "succeeded") {
      successful += 1;
    }
    if (sample.kind === "saved") {
      savedDurations.push(sample.result.durationMs);
      if (sample.result.status === "succeeded") {
        savedSuccessful += 1;
      }
    } else {
      cardDurations.push(sample.result.durationMs);
      if (sample.result.status === "succeeded") {
        cardSuccessful += 1;
      }
    }
  }

  return {
    total: samples.length,
    requests: samples.length,
    successful,
    p95Ms: percentile95(allDurations),
    byPaymentMethod: {
      card: {
        requests: cardDurations.length,
        successful: cardSuccessful,
        p95Ms: percentile95(cardDurations)
      },
      saved: {
        requests: savedDurations.length,
        successful: savedSuccessful,
        p95Ms: percentile95(savedDurations)
      }
    }
  };
}

function percentile95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  values.sort((left, right) => left - right);
  const index = Math.ceil(values.length * 0.95) - 1;
  return values[index] ?? 0;
}
