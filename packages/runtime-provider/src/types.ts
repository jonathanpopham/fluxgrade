export type RuntimeCapability = string;

export const FULL_RUNTIME_CAPABILITIES: readonly RuntimeCapability[] = Object.freeze([
  "service-read",
  "artifact-submit",
  "deploy",
  "checkpoint",
  "evaluate"
]);

export type RuntimeLifecycleState = "ready" | "running" | "destroyed";

export interface RuntimeLimits {
  readonly durationMs: number;
  readonly cpuMillicores: number;
  readonly memoryMiB: number;
  readonly diskMiB: number;
}

export interface RuntimeProviderCapabilities {
  readonly providerId: string;
  readonly capabilities: readonly RuntimeCapability[];
  readonly maxArtifactBytes: number;
}

export interface PrepareRuntimeRequest {
  readonly idempotencyKey: string;
  readonly missionId: string;
  readonly missionVersion: string;
  readonly imageDigests: readonly string[];
  readonly requiredCapabilities: readonly RuntimeCapability[];
  readonly limits: RuntimeLimits;
}

/** Validated immutable runtime inputs; this descriptor owns no lease or external resource. */
export interface PreparedRuntime {
  /** Opaque provider descriptor identifier. */
  readonly id: string;
  readonly providerId: string;
  readonly missionId: string;
  readonly missionVersion: string;
  readonly state: "ready";
}

export interface CreateRuntimeRequest {
  readonly idempotencyKey: string;
  readonly sessionId: string;
  readonly preparedRuntimeId: string;
}

export interface RuntimeLease {
  /** Provider-wide unique among runtime leases. */
  readonly id: string;
  readonly sessionId: string;
  readonly preparedRuntimeId: string;
  readonly state: RuntimeLifecycleState;
}

export interface RuntimeHealthRequest {
  readonly leaseId: string;
}

export interface RuntimeHealth {
  readonly leaseId: string;
  readonly state: Exclude<RuntimeLifecycleState, "destroyed">;
  readonly status: "ready" | "healthy";
}

export interface ReadServiceRequest {
  readonly leaseId: string;
  readonly serviceId: string;
  readonly path: string;
}

export interface ServiceResponse {
  readonly leaseId: string;
  readonly serviceId: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

export interface SubmitArtifactRequest {
  readonly idempotencyKey: string;
  readonly leaseId: string;
  readonly digest: string;
  readonly content: Uint8Array;
}

export interface SubmittedArtifact {
  /** Provider-wide unique among submitted artifacts. */
  readonly id: string;
  readonly leaseId: string;
  readonly digest: string;
  readonly bytes: number;
}

export interface DeployRequest {
  readonly idempotencyKey: string;
  readonly leaseId: string;
  readonly artifactId: string;
  readonly serviceId: string;
}

export interface Deployment {
  /** Opaque deployment result identifier. */
  readonly id: string;
  readonly leaseId: string;
  readonly artifactId: string;
  readonly serviceId: string;
  readonly state: "running";
}

export interface CheckpointRequest {
  readonly idempotencyKey: string;
  readonly leaseId: string;
  readonly label: string;
}

export interface RuntimeCheckpoint {
  /** Provider-wide unique among runtime checkpoints. */
  readonly id: string;
  readonly leaseId: string;
  readonly label: string;
}

export interface EvaluateRequest {
  readonly idempotencyKey: string;
  readonly leaseId: string;
  readonly checkpointId: string;
}

export interface RuntimeEvaluation {
  /** Opaque evaluation result identifier. */
  readonly id: string;
  readonly leaseId: string;
  readonly checkpointId: string;
  readonly passed: boolean;
  readonly score: number;
}

export interface DestroyRuntimeRequest {
  readonly idempotencyKey: string;
  readonly leaseId: string;
}

export interface DestroyedRuntime {
  readonly leaseId: string;
  readonly destroyed: true;
}
