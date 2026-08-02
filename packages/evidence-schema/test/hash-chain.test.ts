import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  EVIDENCE_SCHEMA_VERSION,
  appendEvent,
  assertValidEventChain,
  canonicalJson,
  digestEvent,
  digestJson,
  parseEvidenceEvent,
  verifyEventChain,
  type EvidenceEvent,
  type NewEvidenceEvent
} from "../src/index.js";

const firstInput: NewEvidenceEvent = {
  sessionId: "ses_checkout_001",
  source: "runtime",
  sourceInstance: "runtime-local-1",
  kind: "deployment.completed",
  occurredAt: "2026-08-01T12:00:00.000Z",
  receivedAt: "2026-08-01T12:00:00.100Z",
  payload: {
    service: "checkout",
    metrics: { p95: 612, errors: 4.2 },
    regions: ["iad", "fra"]
  },
  visibility: "candidate",
  retentionClass: "public-practice"
};

const secondInput: NewEvidenceEvent = {
  sessionId: "ses_checkout_001",
  source: "evaluator",
  sourceInstance: "evaluator-local-1",
  kind: "invariant.checked",
  occurredAt: "2026-08-01T12:00:01.000Z",
  receivedAt: "2026-08-01T12:00:01.050Z",
  payload: { invariant: "no-duplicate-holds", passed: true },
  visibility: "reviewer",
  retentionClass: "public-practice"
};

describe("canonical JSON", () => {
  it("sorts object keys recursively and hashes the exact canonical bytes", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ z: { b: 2, a: 1 }, a: [3, { d: 4, c: 5 }] })).toBe(
      '{"a":[3,{"c":5,"d":4}],"z":{"a":1,"b":2}}'
    );
    expect(digestJson({ b: 2, a: 1 })).toBe(
      "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"
    );
  });

  it("rejects values that JSON cannot represent deterministically", () => {
    expect(() => canonicalJson({ value: undefined })).toThrow(/JSON value/i);
    expect(() => canonicalJson(Number.NaN)).toThrow(/finite/i);
    expect(() => canonicalJson(new Date("2026-08-01T00:00:00.000Z"))).toThrow(/plain object/i);
  });

  it("rejects non-portable strings and stateful array properties", () => {
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get: () => 1
    });
    accessor.length = 1;
    const extended = [1] as number[] & { extra?: number };
    extended.extra = 2;

    expect(() => canonicalJson("\ud800")).toThrow(/Unicode scalar/i);
    expect(() => canonicalJson({ "\udc00": 1 })).toThrow(/Unicode scalar/i);
    expect(() => canonicalJson(accessor)).toThrow(/data propert/i);
    expect(() => canonicalJson(extended)).toThrow(/array propert/i);
  });
});

describe("event hash chains", () => {
  it("appends deterministic envelopes whose digest omits only eventDigest", () => {
    const first = appendEvent(null, firstInput);
    const repeated = appendEvent(null, {
      ...firstInput,
      payload: {
        regions: ["iad", "fra"],
        metrics: { errors: 4.2, p95: 612 },
        service: "checkout"
      }
    });

    expect(first).toEqual(repeated);
    expect(first.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION);
    expect(first.sequence).toBe(1);
    expect(first.previousEventDigest).toBeNull();
    expect(first.payloadDigest).toBe(digestJson(first.payload));
    expect(first.eventDigest).toBe(digestEvent(first));

    const { eventDigest: _omitted, ...digestPreimage } = first;
    expect(first.eventDigest).toBe(digestJson(digestPreimage));
  });

  it("links multiple sources in one session and verifies the head", () => {
    const first = appendEvent(null, firstInput);
    const second = appendEvent(first, secondInput);
    const verification = verifyEventChain([first, second]);

    expect(second.sequence).toBe(2);
    expect(second.previousEventDigest).toBe(first.eventDigest);
    expect(verification).toEqual({ valid: true, headDigest: second.eventDigest });
    expect(() => assertValidEventChain([first, second])).not.toThrow();
  });

  it("detects payload alteration without trusting the recorded payload digest", () => {
    const first = appendEvent(null, firstInput);
    const altered = structuredClone(first);
    altered.payload.metrics = { p95: 80, errors: 0 };

    expect(verifyEventChain([altered])).toMatchObject({
      valid: false,
      index: 0,
      code: "payload_digest_mismatch"
    });
  });

  it("rejects stateful payload representations before schema cloning", () => {
    const payload = [1] as number[] & { extra?: number };
    payload.extra = 2;
    expect(() => appendEvent(null, { ...firstInput, payload })).toThrow(/array propert/i);

    const first = appendEvent(null, { ...firstInput, payload: [1] });
    const altered = structuredClone(first);
    const alteredPayload = altered.payload as number[] & { extra?: number };
    alteredPayload.extra = 2;
    expect(verifyEventChain([altered])).toMatchObject({
      valid: false,
      index: 0,
      code: "invalid_event"
    });
  });

  it("binds schema validation to the canonical descriptor snapshot", () => {
    const input = new Proxy(
      { ...firstInput, payload: [1] },
      {
        get(target, property, receiver) {
          if (property === "payload") return [2];
          return Reflect.get(target, property, receiver);
        }
      }
    );

    expect(appendEvent(null, input).payload).toEqual([1]);
  });

  it("detects provenance changes through event digest recomputation", () => {
    const first = appendEvent(null, firstInput);
    const altered = { ...first, sourceInstance: "candidate-controlled" };

    expect(verifyEventChain([altered])).toMatchObject({
      valid: false,
      index: 0,
      code: "event_digest_mismatch"
    });
  });

  it("rejects sequence gaps and broken previous-event links", () => {
    const first = appendEvent(null, firstInput);
    const second = appendEvent(first, secondInput);
    const sequenceGap = { ...second, sequence: 3 };
    const brokenLink = { ...second, previousEventDigest: "0".repeat(64) };

    expect(verifyEventChain([first, sequenceGap])).toMatchObject({
      valid: false,
      index: 1,
      code: "sequence_mismatch"
    });
    expect(verifyEventChain([first, brokenLink])).toMatchObject({
      valid: false,
      index: 1,
      code: "previous_digest_mismatch"
    });
  });

  it("refuses to append to a tampered tail or a different session", () => {
    const first = appendEvent(null, firstInput);
    const tampered = { ...first, kind: "candidate.rewritten" };

    expect(() => appendEvent(tampered, secondInput)).toThrow(/event digest/i);
    expect(() =>
      appendEvent(first, { ...secondInput, sessionId: "ses_checkout_other" })
    ).toThrow(/session/i);
  });

  it("reports malformed envelopes instead of throwing", () => {
    const first = appendEvent(null, firstInput);
    const malformed = { ...first, schemaVersion: "2.0.0" } as EvidenceEvent;

    expect(verifyEventChain([malformed])).toMatchObject({
      valid: false,
      index: 0,
      code: "invalid_event"
    });
  });

  it("returns a structured failure for non-portable payload strings", () => {
    const first = appendEvent(null, firstInput);
    const malformed = { ...first, payload: "\ud800" };

    expect(() => verifyEventChain([malformed])).not.toThrow();
    expect(verifyEventChain([malformed])).toMatchObject({
      valid: false,
      index: 0,
      code: "invalid_event"
    });
  });

  it("contains hostile error coercion while verifying untrusted input", () => {
    const hostileError = Object.create(null) as Record<PropertyKey, unknown>;
    hostileError[Symbol.toPrimitive] = () => {
      throw new Error("secondary coercion");
    };
    const maliciousEvent = new Proxy(
      {},
      {
        ownKeys() {
          throw hostileError;
        }
      }
    );

    expect(() => verifyEventChain([maliciousEvent])).not.toThrow();
    expect(verifyEventChain([maliciousEvent])).toMatchObject({
      valid: false,
      index: 0,
      code: "invalid_event"
    });

    const hostileMessage = {
      [Symbol.toPrimitive]() {
        throw new Error("secondary message coercion");
      }
    };
    const errorWithHostileMessage = new Proxy(new Error("validation failed"), {
      get(target, property, receiver) {
        if (property === "message") return hostileMessage;
        return Reflect.get(target, property, receiver);
      }
    });
    const hostileMessageEvent = new Proxy(
      {},
      {
        ownKeys() {
          throw errorWithHostileMessage;
        }
      }
    );
    const verification = verifyEventChain([hostileMessageEvent]);
    expect(verification).toMatchObject({ valid: false, code: "invalid_event" });
    if (!verification.valid) expect(typeof verification.message).toBe("string");
    expect(() => assertValidEventChain([hostileMessageEvent])).toThrow(
      /Invalid evidence chain/
    );
  });

  it("contains hostile history-container access", () => {
    const maliciousHistory = new Proxy([], {
      get(target, property, receiver) {
        if (property === "length") throw new Error("hostile length");
        return Reflect.get(target, property, receiver);
      }
    });

    expect(() => verifyEventChain(maliciousHistory)).not.toThrow();
    expect(verifyEventChain(maliciousHistory)).toMatchObject({
      valid: false,
      index: 0,
      code: "invalid_event"
    });

    const oversizedHistory = new Proxy([], {
      get(target, property, receiver) {
        if (property === "length") return Number.MAX_SAFE_INTEGER;
        return Reflect.get(target, property, receiver);
      }
    });
    expect(verifyEventChain(oversizedHistory)).toMatchObject({
      valid: false,
      index: 0,
      code: "invalid_event",
      message: expect.stringMatching(/at most 100000/)
    });
  });

  it("never normalizes persisted provenance before recomputing its digest", () => {
    const first = appendEvent(null, firstInput);
    const altered = { ...first, sourceInstance: ` ${first.sourceInstance} ` };

    expect(verifyEventChain([altered])).toMatchObject({
      valid: false,
      index: 0,
      code: "invalid_event"
    });
  });

  it("rejects impossible local links and exhausted sequence space", () => {
    const first = appendEvent(null, firstInput);
    expect(() =>
      parseEvidenceEvent({ ...first, previousEventDigest: "0".repeat(64) })
    ).toThrow(/previousEventDigest/i);
    expect(() => parseEvidenceEvent({ ...first, sequence: 2 })).toThrow(
      /previousEventDigest/i
    );

    const maxTailDraft = {
      ...first,
      sequence: Number.MAX_SAFE_INTEGER,
      previousEventDigest: "a".repeat(64)
    };
    const maxTail = {
      ...maxTailDraft,
      eventDigest: digestEvent(maxTailDraft)
    };
    expect(() => appendEvent(maxTail, secondInput)).toThrow(/sequence space exhausted/i);
  });

  it("verifies the portable chain fixture with a stable head digest", () => {
    const events = JSON.parse(
      readFileSync(new URL("../fixtures/valid-chain.json", import.meta.url), "utf8")
    ) as unknown[];

    expect(verifyEventChain(events)).toEqual({
      valid: true,
      headDigest: "1bf093a2cd753faff2c4dbb676e772d4ca2f69e691f2045688490a465599b9e0"
    });
  });
});
