export { canonicalJson, digestJson } from "./canonical-json.js";
export {
  EVIDENCE_SCHEMA_VERSION,
  evidenceEventSchema,
  jsonValueSchema,
  newEvidenceEventSchema,
  parseEvidenceEvent,
  parseNewEvidenceEvent,
  type EvidenceEvent,
  type JsonValue,
  type NewEvidenceEvent
} from "./event.js";
export {
  appendEvent,
  assertValidEventChain,
  digestEvent,
  verifyEventChain,
  type ChainFailureCode,
  type ChainVerification
} from "./hash-chain.js";
