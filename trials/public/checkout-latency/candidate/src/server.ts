import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import {
  CheckoutService,
  type CheckoutHandler,
  type CheckoutRequest,
  type PaymentMethodKind
} from "./checkout.js";
import { DeterministicFraudProvider } from "./fraud.js";
import { InMemoryPaymentProvider } from "./payments.js";

export function createCheckoutServer(
  checkout: CheckoutHandler = new CheckoutService(
    new InMemoryPaymentProvider(),
    new DeterministicFraudProvider()
  )
): Server {
  return createServer((request, response) => {
    void routeRequest(checkout, request, response).catch(() => {
      writeJson(response, 400, { error: "invalid-checkout-request" });
    });
  });
}

async function routeRequest(
  checkout: CheckoutHandler,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://checkout.local");
  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, { status: "ready" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/checkout") {
    const payload: unknown = JSON.parse(await readBody(request));
    if (!isCheckoutRequest(payload)) {
      writeJson(response, 400, { error: "invalid-checkout-request" });
      return;
    }
    writeJson(response, 200, await checkout.checkout(payload));
    return;
  }
  writeJson(response, 404, { error: "not-found" });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 64 * 1024) {
      throw new Error("request-too-large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isCheckoutRequest(value: unknown): value is CheckoutRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("orderId" in value) ||
    !("customerId" in value) ||
    !("amountCents" in value) ||
    !("paymentMethod" in value)
  ) {
    return false;
  }
  const paymentMethod = value.paymentMethod;
  if (
    typeof paymentMethod !== "object" ||
    paymentMethod === null ||
    Array.isArray(paymentMethod) ||
    !("kind" in paymentMethod) ||
    !("token" in paymentMethod)
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.orderId) &&
    isNonEmptyString(value.customerId) &&
    typeof value.amountCents === "number" &&
    Number.isSafeInteger(value.amountCents) &&
    value.amountCents > 0 &&
    isPaymentMethodKind(paymentMethod.kind) &&
    isNonEmptyString(paymentMethod.token)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isPaymentMethodKind(value: unknown): value is PaymentMethodKind {
  return value === "card" || value === "saved";
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent || response.destroyed) {
    return;
  }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  createCheckoutServer().listen(port, "0.0.0.0", () => {
    process.stdout.write(`checkout listening on ${port}\n`);
  });
}
