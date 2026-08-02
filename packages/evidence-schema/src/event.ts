import { z } from "zod";

import { canonicalJson, isWellFormedUnicode } from "./canonical-json.js";

export const EVIDENCE_SCHEMA_VERSION = "1.0.0" as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface NewEvidenceEvent {
  sessionId: string;
  source: string;
  sourceInstance: string;
  kind: string;
  occurredAt: string;
  receivedAt: string;
  payload: JsonValue;
  visibility: string;
  retentionClass: string;
}

export interface EvidenceEvent extends NewEvidenceEvent {
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  sequence: number;
  payloadDigest: string;
  previousEventDigest: string | null;
  eventDigest: string;
}

const nonEmptyIdentifier = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), "Must not have surrounding whitespace")
  .refine(isWellFormedUnicode, "Must contain only valid Unicode scalar values");
const sha256Digest = z.string().regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");
const jsonString = z
  .string()
  .refine(isWellFormedUnicode, "Must contain only valid Unicode scalar values");
const jsonScalar = z.union([z.null(), z.boolean(), z.number().finite(), jsonString]);

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonScalar, z.array(jsonValueSchema), z.record(jsonString, jsonValueSchema)])
);

export const newEvidenceEventSchema = z.strictObject({
  sessionId: nonEmptyIdentifier,
  source: nonEmptyIdentifier,
  sourceInstance: nonEmptyIdentifier,
  kind: nonEmptyIdentifier,
  occurredAt: z.iso.datetime({ offset: true }),
  receivedAt: z.iso.datetime({ offset: true }),
  payload: jsonValueSchema,
  visibility: nonEmptyIdentifier,
  retentionClass: nonEmptyIdentifier
});

export const evidenceEventSchema = newEvidenceEventSchema
  .extend({
    schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    payloadDigest: sha256Digest,
    previousEventDigest: sha256Digest.nullable(),
    eventDigest: sha256Digest
  })
  .superRefine((event, context) => {
    const isGenesis = event.sequence === 1;
    if (isGenesis !== (event.previousEventDigest === null)) {
      context.addIssue({
        code: "custom",
        path: ["previousEventDigest"],
        message: "previousEventDigest must be null exactly when sequence is 1"
      });
    }
  });

export function parseNewEvidenceEvent(value: unknown): NewEvidenceEvent {
  const snapshot: unknown = JSON.parse(canonicalJson(value));
  newEvidenceEventSchema.parse(snapshot);
  return snapshot as NewEvidenceEvent;
}

export function parseEvidenceEvent(value: unknown): EvidenceEvent {
  const snapshot: unknown = JSON.parse(canonicalJson(value));
  evidenceEventSchema.parse(snapshot);
  return snapshot as EvidenceEvent;
}
