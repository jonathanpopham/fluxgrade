import { digestJson } from "./canonical-json.js";

import {
  EVIDENCE_SCHEMA_VERSION,
  parseEvidenceEvent,
  parseNewEvidenceEvent,
  type EvidenceEvent,
  type NewEvidenceEvent
} from "./event.js";

export type ChainFailureCode =
  | "invalid_event"
  | "session_mismatch"
  | "sequence_mismatch"
  | "previous_digest_mismatch"
  | "payload_digest_mismatch"
  | "event_digest_mismatch";

export type ChainVerification =
  | { valid: true; headDigest: string | null }
  | {
      valid: false;
      index: number;
      code: ChainFailureCode;
      message: string;
    };

const MAX_EVENT_CHAIN_LENGTH = 100_000;


export function digestEvent(event: EvidenceEvent): string {
  const parsed = parseEvidenceEvent(event);
  const { eventDigest: _eventDigest, ...preimage } = parsed;
  return digestJson(preimage);
}

/**
 * Appends in O(1) after a caller-verified chain tail.
 * Untrusted histories must pass `verifyEventChain` before their final event is supplied here.
 */
export function appendEvent(
  previous: EvidenceEvent | null,
  input: NewEvidenceEvent
): EvidenceEvent {
  const parsedInput = parseNewEvidenceEvent(input);
  let sequence = 1;
  let previousEventDigest: string | null = null;

  if (previous) {
    const parsedPrevious = parseEvidenceEvent(previous);
    if (parsedPrevious.payloadDigest !== digestJson(parsedPrevious.payload)) {
      throw new Error("Cannot append after an event with an invalid payload digest.");
    }
    if (parsedPrevious.eventDigest !== digestEvent(parsedPrevious)) {
      throw new Error("Cannot append after an event with an invalid event digest.");
    }
    if (parsedPrevious.sessionId !== parsedInput.sessionId) {
      throw new Error("Cannot append evidence from a different session.");
    }
    if (parsedPrevious.sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Cannot append: evidence sequence space exhausted.");
    }
    sequence = parsedPrevious.sequence + 1;
    previousEventDigest = parsedPrevious.eventDigest;
  }

  const preimage = {
    ...parsedInput,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    sequence,
    payloadDigest: digestJson(parsedInput.payload),
    previousEventDigest
  };

  return parseEvidenceEvent({
    ...preimage,
    eventDigest: digestJson(preimage)
  });
}

export function verifyEventChain(events: readonly unknown[]): ChainVerification {
  let eventCount: number;
  try {
    eventCount = events.length;
    if (
      !Number.isSafeInteger(eventCount) ||
      eventCount < 0 ||
      eventCount > MAX_EVENT_CHAIN_LENGTH
    ) {
      return failure(
        0,
        "invalid_event",
        `Evidence history must contain at most ${MAX_EVENT_CHAIN_LENGTH} events.`
      );
    }
  } catch (error) {
    return failure(0, "invalid_event", errorMessage(error));
  }
  let sessionId: string | undefined;
  let previousDigest: string | null = null;

  for (let index = 0; index < eventCount; index += 1) {
    let event: EvidenceEvent;
    try {
      event = parseEvidenceEvent(events[index]);
    } catch (error) {
      return failure(index, "invalid_event", errorMessage(error));
    }

    if (sessionId === undefined) sessionId = event.sessionId;
    else if (event.sessionId !== sessionId) {
      return failure(index, "session_mismatch", "Session changed within one evidence chain.");
    }

    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      return failure(
        index,
        "sequence_mismatch",
        `Expected sequence ${expectedSequence}, received ${event.sequence}.`
      );
    }

    if (event.previousEventDigest !== previousDigest) {
      return failure(
        index,
        "previous_digest_mismatch",
        "The previous-event digest does not match the verified predecessor."
      );
    }

    const payloadDigest = digestJson(event.payload);
    if (event.payloadDigest !== payloadDigest) {
      return failure(
        index,
        "payload_digest_mismatch",
        "The payload digest does not match the canonical payload."
      );
    }

    const eventDigest = digestEvent(event);
    if (event.eventDigest !== eventDigest) {
      return failure(
        index,
        "event_digest_mismatch",
        "The event digest does not match the canonical envelope preimage."
      );
    }

    previousDigest = event.eventDigest;
  }

  return { valid: true, headDigest: previousDigest };
}

export function assertValidEventChain(events: readonly unknown[]): string | null {
  const verification = verifyEventChain(events);
  if (!verification.valid) {
    throw new Error(
      `Invalid evidence chain at index ${verification.index} (${verification.code}): ${verification.message}`
    );
  }
  return verification.headDigest;
}

function failure(
  index: number,
  code: ChainFailureCode,
  message: string
): ChainVerification {
  return { valid: false, index, code, message };
}

function errorMessage(error: unknown): string {
  try {
    const candidate = error instanceof Error ? error.message : error;
    return typeof candidate === "string" ? candidate : String(candidate);
  } catch {
    return "Evidence event validation failed.";
  }
}
