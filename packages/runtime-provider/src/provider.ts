import { createHash } from "node:crypto";
import { FULL_RUNTIME_CAPABILITIES } from "./types.js";

import type {
  CheckpointRequest,
  CreateRuntimeRequest,
  Deployment,
  DeployRequest,
  DestroyedRuntime,
  DestroyRuntimeRequest,
  EvaluateRequest,
  PrepareRuntimeRequest,
  PreparedRuntime,
  ReadServiceRequest,
  RuntimeCapability,
  RuntimeCheckpoint,
  RuntimeEvaluation,
  RuntimeHealth,
  RuntimeHealthRequest,
  RuntimeLease,
  RuntimeProviderCapabilities,
  ServiceResponse,
  SubmitArtifactRequest,
  SubmittedArtifact
} from "./types.js";

export type RuntimeOperation =
  | "getCapabilities"
  | "prepare"
  | "create"
  | "health"
  | "readService"
  | "submitArtifact"
  | "deploy"
  | "checkpoint"
  | "evaluate"
  | "destroy";

export type RuntimeProviderErrorCode =
  | "invalid-request"
  | "not-found"
  | "invalid-state"
  | "unsupported-capability"
  | "idempotency-conflict"
  | "provider-unavailable";

export class RuntimeProviderError extends Error {
  constructor(
    readonly operation: RuntimeOperation,
    readonly code: RuntimeProviderErrorCode,
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "RuntimeProviderError";
  }
}

export class RuntimeInputError extends RuntimeProviderError {
  constructor(operation: RuntimeOperation, message: string) {
    super(operation, "invalid-request", message);
    this.name = "RuntimeInputError";
  }
}

export class RuntimeNotFoundError extends RuntimeProviderError {
  constructor(operation: RuntimeOperation, message: string) {
    super(operation, "not-found", message);
    this.name = "RuntimeNotFoundError";
  }
}

export class RuntimeStateError extends RuntimeProviderError {
  constructor(operation: RuntimeOperation, message: string) {
    super(operation, "invalid-state", message);
    this.name = "RuntimeStateError";
  }
}

export class RuntimeCapabilityError extends RuntimeProviderError {
  constructor(operation: RuntimeOperation, message: string) {
    super(operation, "unsupported-capability", message);
    this.name = "RuntimeCapabilityError";
  }
}

export class IdempotencyConflictError extends RuntimeProviderError {
  constructor(operation: RuntimeOperation, message: string) {
    super(operation, "idempotency-conflict", message);
    this.name = "IdempotencyConflictError";
  }
}

export class RuntimeUnavailableError extends RuntimeProviderError {
  constructor(operation: RuntimeOperation, message: string) {
    super(operation, "provider-unavailable", message, true);
    this.name = "RuntimeUnavailableError";
  }
}

export interface RuntimeProvider {
  getCapabilities(): Promise<RuntimeProviderCapabilities>;
  /** Validates/cache-primes immutable inputs and MUST NOT allocate lease-owned resources. */
  prepare(request: PrepareRuntimeRequest): Promise<PreparedRuntime>;
  create(request: CreateRuntimeRequest): Promise<RuntimeLease>;
  health(request: RuntimeHealthRequest): Promise<RuntimeHealth>;
  readService(request: ReadServiceRequest): Promise<ServiceResponse>;
  submitArtifact(request: SubmitArtifactRequest): Promise<SubmittedArtifact>;
  deploy(request: DeployRequest): Promise<Deployment>;
  checkpoint(request: CheckpointRequest): Promise<RuntimeCheckpoint>;
  evaluate(request: EvaluateRequest): Promise<RuntimeEvaluation>;
  destroy(request: DestroyRuntimeRequest): Promise<DestroyedRuntime>;
}

interface LeaseRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly preparedRuntimeId: string;
  state: "ready" | "running" | "destroyed";
  readonly artifacts: Map<string, SubmittedArtifact>;
  readonly services: Set<string>;
  readonly checkpoints: Set<string>;
}
type ActiveLeaseRecord = LeaseRecord & { state: "ready" | "running" };
type RunningLeaseRecord = LeaseRecord & { state: "running" };


interface IdempotencyRecord {
  readonly signature: string;
  readonly result: unknown;
}

const FULL_IMAGE_DIGEST =
  /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)+@sha256:[0-9a-f]{64}(?![\s\S])/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}(?![\s\S])/u;
const MEMORY_CAPABILITIES: RuntimeProviderCapabilities = {
  providerId: "memory",
  capabilities: [...FULL_RUNTIME_CAPABILITIES],
  maxArtifactBytes: 10 * 1024 * 1024
};

export class InMemoryRuntimeProvider implements RuntimeProvider {
  readonly #prepared = new Map<string, PreparedRuntime>();
  readonly #leases = new Map<string, LeaseRecord>();
  readonly #sessionLeases = new Map<string, string>();
  readonly #idempotency = new Map<string, IdempotencyRecord>();
  #preparedSequence = 0;
  #leaseSequence = 0;
  #artifactSequence = 0;
  #deploymentSequence = 0;
  #checkpointSequence = 0;
  #evaluationSequence = 0;

  async getCapabilities(): Promise<RuntimeProviderCapabilities> {
    return structuredClone(MEMORY_CAPABILITIES);
  }
  /** Clears all fake-provider state; use one instance per test or reset it between scenarios. */
  reset(): void {
    this.#prepared.clear();
    this.#leases.clear();
    this.#sessionLeases.clear();
    this.#idempotency.clear();
    this.#preparedSequence = 0;
    this.#leaseSequence = 0;
    this.#artifactSequence = 0;
    this.#deploymentSequence = 0;
    this.#checkpointSequence = 0;
    this.#evaluationSequence = 0;
  }


  async prepare(request: PrepareRuntimeRequest): Promise<PreparedRuntime> {
    const operation = "prepare";
    requireRequest(request, operation);
    requireText(request.missionId, "missionId", operation);
    requireText(request.missionVersion, "missionVersion", operation);
    requireStringArray(request.imageDigests, "imageDigests", operation);
    const imageDigests = uniqueSorted(request.imageDigests, "imageDigests", operation);
    if (imageDigests.length === 0) {
      throw new RuntimeInputError(operation, "imageDigests must contain at least one image.");
    }
    for (const imageDigest of imageDigests) {
      if (!FULL_IMAGE_DIGEST.test(imageDigest)) {
        throw new RuntimeInputError(operation, `Invalid immutable image digest: ${imageDigest}`);
      }
    }
    requireStringArray(request.requiredCapabilities, "requiredCapabilities", operation);
    const requiredCapabilities = uniqueSorted(
      request.requiredCapabilities,
      "requiredCapabilities",
      operation
    );
    const supportedCapabilities = new Set<RuntimeCapability>(MEMORY_CAPABILITIES.capabilities);
    for (const capability of requiredCapabilities) {
      if (!supportedCapabilities.has(capability)) {
        throw new RuntimeCapabilityError(operation, `Unsupported runtime capability: ${capability}`);
      }
    }
    validateLimits(request, operation);

    const signature = JSON.stringify([
      request.missionId,
      request.missionVersion,
      imageDigests,
      requiredCapabilities,
      request.limits.durationMs,
      request.limits.cpuMillicores,
      request.limits.memoryMiB,
      request.limits.diskMiB
    ]);
    return this.#idempotent(
      operation,
      request.missionId,
      request.idempotencyKey,
      signature,
      () => {
      this.#preparedSequence += 1;
      const prepared: PreparedRuntime = {
        id: `prepared-${this.#preparedSequence}`,
        providerId: MEMORY_CAPABILITIES.providerId,
        missionId: request.missionId,
        missionVersion: request.missionVersion,
        state: "ready"
      };
      this.#prepared.set(prepared.id, prepared);
      return prepared;
      }
    );
  }

  async create(request: CreateRuntimeRequest): Promise<RuntimeLease> {
    const operation = "create";
    requireRequest(request, operation);
    requireText(request.sessionId, "sessionId", operation);
    requireText(request.preparedRuntimeId, "preparedRuntimeId", operation);
    const signature = JSON.stringify([request.sessionId, request.preparedRuntimeId]);
    return this.#idempotent(
      operation,
      request.sessionId,
      request.idempotencyKey,
      signature,
      () => {
      if (!this.#prepared.has(request.preparedRuntimeId)) {
        throw new RuntimeNotFoundError(
          operation,
          `Prepared runtime not found: ${request.preparedRuntimeId}`
        );
      }
      if (this.#sessionLeases.has(request.sessionId)) {
        throw new RuntimeStateError(operation, `Session already has a runtime: ${request.sessionId}`);
      }
      this.#leaseSequence += 1;
      const record: LeaseRecord = {
        id: `lease-${this.#leaseSequence}`,
        sessionId: request.sessionId,
        preparedRuntimeId: request.preparedRuntimeId,
        state: "ready",
        artifacts: new Map<string, SubmittedArtifact>(),
        services: new Set<string>(),
        checkpoints: new Set<string>()
      };
      this.#leases.set(record.id, record);
      this.#sessionLeases.set(record.sessionId, record.id);
      return leaseSnapshot(record);
      }
    );
  }

  async health(request: RuntimeHealthRequest): Promise<RuntimeHealth> {
    const operation = "health";
    requireRequest(request, operation);
    const record = this.#requireActiveLease(request.leaseId, operation);
    return {
      leaseId: record.id,
      state: record.state,
      status: record.state === "running" ? "healthy" : "ready"
    };
  }

  async readService(request: ReadServiceRequest): Promise<ServiceResponse> {
    const operation = "readService";
    requireRequest(request, operation);
    const record = this.#requireActiveLease(request.leaseId, operation);
    requireText(request.serviceId, "serviceId", operation);
    requireText(request.path, "path", operation);
    if (!request.path.startsWith("/")) {
      throw new RuntimeInputError(operation, "Service path must start with '/'.");
    }
    if (record.state !== "running" || !record.services.has(request.serviceId)) {
      throw new RuntimeStateError(
        operation,
        `Service is not running on lease ${request.leaseId}: ${request.serviceId}`
      );
    }
    return {
      leaseId: record.id,
      serviceId: request.serviceId,
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ serviceId: request.serviceId, path: request.path, status: "ok" })
    };
  }

  async submitArtifact(request: SubmitArtifactRequest): Promise<SubmittedArtifact> {
    const operation = "submitArtifact";
    requireRequest(request, operation);
    requireText(request.leaseId, "leaseId", operation);
    requireText(request.digest, "digest", operation);
    if (!SHA256_DIGEST.test(request.digest)) {
      throw new RuntimeInputError(operation, `Invalid artifact digest: ${request.digest}`);
    }
    if (!(request.content instanceof Uint8Array)) {
      throw new RuntimeInputError(operation, "Artifact content must be a Uint8Array.");
    }
    const bytes = request.content.byteLength;
    if (bytes <= 0 || bytes > MEMORY_CAPABILITIES.maxArtifactBytes) {
      throw new RuntimeInputError(
        operation,
        `Artifact bytes must be between 1 and ${MEMORY_CAPABILITIES.maxArtifactBytes}.`
      );
    }
    const actualDigest = `sha256:${createHash("sha256").update(request.content).digest("hex")}`;
    if (actualDigest !== request.digest) {
      throw new RuntimeInputError(operation, "Artifact digest does not match its content.");
    }
    const signature = JSON.stringify([request.leaseId, request.digest]);
    return this.#idempotent(
      operation,
      request.leaseId,
      request.idempotencyKey,
      signature,
      () => {
        const record = this.#requireActiveLease(request.leaseId, operation);
        this.#artifactSequence += 1;
        const artifact: SubmittedArtifact = {
          id: `artifact-${this.#artifactSequence}`,
          leaseId: record.id,
          digest: request.digest,
          bytes
        };
        record.artifacts.set(artifact.id, artifact);
        return artifact;
      }
    );
  }

  async deploy(request: DeployRequest): Promise<Deployment> {
    const operation = "deploy";
    requireRequest(request, operation);
    requireText(request.leaseId, "leaseId", operation);
    requireText(request.artifactId, "artifactId", operation);
    requireText(request.serviceId, "serviceId", operation);
    const signature = JSON.stringify([request.leaseId, request.artifactId, request.serviceId]);
    return this.#idempotent(
      operation,
      request.leaseId,
      request.idempotencyKey,
      signature,
      () => {
      const record = this.#requireActiveLease(request.leaseId, operation);
      if (!record.artifacts.has(request.artifactId)) {
        throw new RuntimeStateError(
          operation,
          `Artifact is not available on lease ${request.leaseId}: ${request.artifactId}`
        );
      }
      this.#deploymentSequence += 1;
      record.state = "running";
      record.services.add(request.serviceId);
      return {
        id: `deployment-${this.#deploymentSequence}`,
        leaseId: record.id,
        artifactId: request.artifactId,
        serviceId: request.serviceId,
        state: "running"
      };
      }
    );
  }

  async checkpoint(request: CheckpointRequest): Promise<RuntimeCheckpoint> {
    const operation = "checkpoint";
    requireRequest(request, operation);
    requireText(request.leaseId, "leaseId", operation);
    requireText(request.label, "label", operation);
    const signature = JSON.stringify([request.leaseId, request.label]);
    return this.#idempotent(
      operation,
      request.leaseId,
      request.idempotencyKey,
      signature,
      () => {
      const record = this.#requireRunningLease(request.leaseId, operation);
      this.#checkpointSequence += 1;
      const checkpoint: RuntimeCheckpoint = {
        id: `checkpoint-${this.#checkpointSequence}`,
        leaseId: record.id,
        label: request.label
      };
      record.checkpoints.add(checkpoint.id);
      return checkpoint;
      }
    );
  }

  async evaluate(request: EvaluateRequest): Promise<RuntimeEvaluation> {
    const operation = "evaluate";
    requireRequest(request, operation);
    requireText(request.leaseId, "leaseId", operation);
    requireText(request.checkpointId, "checkpointId", operation);
    const signature = JSON.stringify([request.leaseId, request.checkpointId]);
    return this.#idempotent(
      operation,
      request.leaseId,
      request.idempotencyKey,
      signature,
      () => {
      const record = this.#requireRunningLease(request.leaseId, operation);
      if (!record.checkpoints.has(request.checkpointId)) {
        throw new RuntimeStateError(
          operation,
          `Checkpoint is not available on lease ${request.leaseId}: ${request.checkpointId}`
        );
      }
      this.#evaluationSequence += 1;
      return {
        id: `evaluation-${this.#evaluationSequence}`,
        leaseId: record.id,
        checkpointId: request.checkpointId,
        passed: true,
        score: 100
      };
      }
    );
  }

  async destroy(request: DestroyRuntimeRequest): Promise<DestroyedRuntime> {
    const operation = "destroy";
    requireRequest(request, operation);
    requireText(request.leaseId, "leaseId", operation);
    const signature = JSON.stringify([request.leaseId]);
    return this.#idempotent(
      operation,
      request.leaseId,
      request.idempotencyKey,
      signature,
      () => {
        const record = this.#requireLease(request.leaseId, operation);
        if (record.state === "destroyed") {
          throw new RuntimeStateError(operation, `Runtime lease is destroyed: ${request.leaseId}`);
        }
        record.state = "destroyed";
        record.artifacts.clear();
        record.services.clear();
        record.checkpoints.clear();
        if (this.#sessionLeases.get(record.sessionId) === record.id) {
          this.#sessionLeases.delete(record.sessionId);
        }
        return { leaseId: record.id, destroyed: true };
      }
    );
  }

  #idempotent<T>(
    operation: RuntimeOperation,
    scope: string,
    idempotencyKey: string,
    signature: string,
    createResult: () => T
  ): T {
    requireText(scope, "idempotencyScope", operation);
    requireText(idempotencyKey, "idempotencyKey", operation);
    const scopedKey = JSON.stringify([operation, scope, idempotencyKey]);
    const existing = this.#idempotency.get(scopedKey);
    if (existing) {
      if (existing.signature !== signature) {
        throw new IdempotencyConflictError(
          operation,
          `Idempotency key was reused with a different ${operation} request.`
        );
      }
      return structuredClone(existing.result) as T;
    }
    const result = createResult();
    this.#idempotency.set(scopedKey, {
      signature,
      result: structuredClone(result)
    });
    return structuredClone(result);
  }

  #requireLease(leaseId: string, operation: RuntimeOperation): LeaseRecord {
    requireText(leaseId, "leaseId", operation);
    const record = this.#leases.get(leaseId);
    if (!record) throw new RuntimeNotFoundError(operation, `Runtime lease not found: ${leaseId}`);
    return record;
  }

  #requireActiveLease(
    leaseId: string,
    operation: RuntimeOperation
  ): ActiveLeaseRecord {
    const record = this.#requireLease(leaseId, operation);
    assertActiveLease(record, leaseId, operation);
    return record;
  }

  #requireRunningLease(
    leaseId: string,
    operation: RuntimeOperation
  ): RunningLeaseRecord {
    const record = this.#requireActiveLease(leaseId, operation);
    assertRunningLease(record, leaseId, operation);
    return record;
  }
}
function assertActiveLease(
  record: LeaseRecord,
  leaseId: string,
  operation: RuntimeOperation
): asserts record is ActiveLeaseRecord {
  if (record.state === "destroyed") {
    throw new RuntimeStateError(operation, `Runtime lease is destroyed: ${leaseId}`);
  }
}

function assertRunningLease(
  record: ActiveLeaseRecord,
  leaseId: string,
  operation: RuntimeOperation
): asserts record is RunningLeaseRecord {
  if (record.state !== "running") {
    throw new RuntimeStateError(operation, `Runtime lease is not running: ${leaseId}`);
  }
}


function leaseSnapshot(record: LeaseRecord): RuntimeLease {
  return {
    id: record.id,
    sessionId: record.sessionId,
    preparedRuntimeId: record.preparedRuntimeId,
    state: record.state
  };
}

function requireRequest(value: unknown, operation: RuntimeOperation): asserts value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuntimeInputError(operation, "Request must be an object.");
  }
}

function requireText(
  value: unknown,
  field: string,
  operation: RuntimeOperation
): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new RuntimeInputError(operation, `${field} must be non-empty without outer whitespace.`);
  }
}

function requireStringArray(
  value: unknown,
  field: string,
  operation: RuntimeOperation
): asserts value is readonly string[] {
  if (!Array.isArray(value)) {
    throw new RuntimeInputError(operation, `${field} must be an array.`);
  }
  for (const item of value) requireText(item, field, operation);
}

function validateLimits(request: PrepareRuntimeRequest, operation: RuntimeOperation): void {
  const limits: unknown = request.limits;
  if (typeof limits !== "object" || limits === null || Array.isArray(limits)) {
    throw new RuntimeInputError(operation, "Runtime limits must be an object.");
  }
  const values = [
    Reflect.get(limits, "durationMs"),
    Reflect.get(limits, "cpuMillicores"),
    Reflect.get(limits, "memoryMiB"),
    Reflect.get(limits, "diskMiB")
  ];
  for (const value of values) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      throw new RuntimeInputError(operation, "Runtime limits must be positive safe integers.");
    }
  }
}

function uniqueSorted(
  values: readonly string[],
  field: string,
  operation: RuntimeOperation
): string[] {
  const seen = new Set<string>();
  const sorted: string[] = [];
  for (const value of values) {
    requireText(value, field, operation);
    if (seen.has(value)) {
      throw new RuntimeInputError(operation, `${field} must not contain duplicates.`);
    }
    seen.add(value);
    sorted.push(value);
  }
  sorted.sort();
  return sorted;
}
