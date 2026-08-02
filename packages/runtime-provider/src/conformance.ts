import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  IdempotencyConflictError,
  RuntimeCapabilityError,
  RuntimeInputError,
  RuntimeNotFoundError,
  RuntimeProviderError,
  RuntimeStateError,
  type RuntimeOperation,
  type RuntimeProvider,
  type RuntimeProviderErrorCode
} from "./provider.js";
import {
  FULL_RUNTIME_CAPABILITIES,
  type CreateRuntimeRequest,
  type PrepareRuntimeRequest,
  type PreparedRuntime,
  type RuntimeLease,
  type RuntimeProviderCapabilities,
  type SubmittedArtifact
} from "./types.js";

export type RuntimeProviderFactory = () => RuntimeProvider | Promise<RuntimeProvider>;

export type ConformanceCaseResult =
  | { readonly id: string; readonly status: "passed" }
  | { readonly id: string; readonly status: "failed"; readonly message: string };

export interface RuntimeProviderConformanceReport {
  readonly profile: "full";
  readonly providerId: string;
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
  readonly cases: readonly ConformanceCaseResult[];
}

export interface RuntimeProviderConformanceOptions {
  /**
   * Bounds diagnostics but cannot cancel a nonconforming provider; use a disposable test account.
   */
  readonly caseTimeoutMs?: number;
}

interface ConformanceRequirement {
  readonly id: string;
  verify(provider: RuntimeProvider, leases: string[]): Promise<void>;
}

interface ExpectedProviderError {
  readonly type: typeof RuntimeProviderError;
  readonly operation: RuntimeOperation;
  readonly code: RuntimeProviderErrorCode;
  readonly retryable: boolean;
}

const DEFAULT_CASE_TIMEOUT_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const IMAGE_DIGEST = `ghcr.io/fluxgrade/conformance-runtime@sha256:${"b".repeat(64)}`;
const SECOND_IMAGE_DIGEST = `ghcr.io/fluxgrade/conformance-sidecar@sha256:${"d".repeat(64)}`;
const REQUIREMENTS: readonly ConformanceRequirement[] = [
  {
    id: "capabilities",
    async verify(provider) {
      assertFullCapabilities(await provider.getCapabilities());
    }
  },
  {
    id: "lifecycle",
    async verify(provider, leases) {
      const lease = await openRuntime(provider, "lifecycle", leases);
      const ready = await provider.health({ leaseId: lease.id });
      requireCondition(
        ready.leaseId === lease.id && ready.state === "ready" && ready.status === "ready",
        "New lease health identity or state is incorrect."
      );

      const artifactRequest = submitRequest(lease.id, "lifecycle-artifact", "lifecycle artifact");
      const artifact = await provider.submitArtifact(artifactRequest);
      requireCondition(
        artifact.id.length > 0 &&
          artifact.leaseId === lease.id &&
          artifact.digest === artifactRequest.digest &&
          artifact.bytes === artifactRequest.content.byteLength,
        "Submitted artifact provenance or metadata is incorrect."
      );
      const deployment = await provider.deploy({
        idempotencyKey: "lifecycle-deploy",
        leaseId: lease.id,
        artifactId: artifact.id,
        serviceId: "checkout"
      });
      requireCondition(
        deployment.id.length > 0 &&
          deployment.state === "running" &&
          deployment.leaseId === lease.id &&
          deployment.artifactId === artifact.id &&
          deployment.serviceId === "checkout",
        "Deployment state or provenance is incorrect."
      );

      const healthy = await provider.health({ leaseId: lease.id });
      requireCondition(
        healthy.leaseId === lease.id &&
          healthy.state === "running" &&
          healthy.status === "healthy",
        "Deployed lease is not healthy."
      );
      const response = await provider.readService({
        leaseId: lease.id,
        serviceId: "checkout",
        path: "/health"
      });
      requireCondition(
        response.status === 200 && response.leaseId === lease.id && response.serviceId === "checkout",
        "Service read response or provenance is incorrect."
      );

      const checkpoint = await provider.checkpoint({
        idempotencyKey: "lifecycle-checkpoint",
        leaseId: lease.id,
        label: "pre-evaluation"
      });
      requireCondition(
        checkpoint.id.length > 0 &&
          checkpoint.leaseId === lease.id &&
          checkpoint.label === "pre-evaluation",
        "Checkpoint identity or provenance is incorrect."
      );
      const evaluation = await provider.evaluate({
        idempotencyKey: "lifecycle-evaluate",
        leaseId: lease.id,
        checkpointId: checkpoint.id
      });
      requireCondition(
        evaluation.id.length > 0 &&
          evaluation.leaseId === lease.id &&
          evaluation.checkpointId === checkpoint.id &&
          typeof evaluation.passed === "boolean" &&
          Number.isFinite(evaluation.score),
        "Evaluation identity, provenance, or result is incorrect."
      );

      const destroyed = await provider.destroy({
        idempotencyKey: "lifecycle-destroy",
        leaseId: lease.id
      });
      requireCondition(
        destroyed.destroyed && destroyed.leaseId === lease.id,
        "Destroy did not confirm the requested teardown."
      );

      await requireDestroyedLeaseFailures(provider, lease, artifact.id, checkpoint.id);
      requireCondition(leases.pop() === lease.id, "Lifecycle teardown tracking diverged.");

      const recreated = await createChecked(provider, leases, {
        idempotencyKey: "lifecycle-recreate",
        sessionId: lease.sessionId,
        preparedRuntimeId: lease.preparedRuntimeId
      });
      requireCondition(
        recreated.id !== lease.id && recreated.state === "ready",
        "Destroyed session could not acquire a fresh lease."
      );
    }
  },
  {
    id: "idempotency",
    async verify(provider, leases) {
      const sharedKey = "shared-operation-key";
      const prepare = { ...prepareRequest("idempotency"), idempotencyKey: sharedKey };
      const firstPrepared = await prepareChecked(provider, prepare);
      const equivalentPrepare: PrepareRuntimeRequest = {
        ...prepare,
        imageDigests: [SECOND_IMAGE_DIGEST, IMAGE_DIGEST],
        requiredCapabilities: [...prepare.requiredCapabilities].reverse(),
        limits: {
          diskMiB: prepare.limits.diskMiB,
          memoryMiB: prepare.limits.memoryMiB,
          cpuMillicores: prepare.limits.cpuMillicores,
          durationMs: prepare.limits.durationMs
        }
      };
      requireSame(firstPrepared, await provider.prepare(equivalentPrepare), "prepare");
      await requireIdempotencyConflict(
        provider.prepare({ ...prepare, missionVersion: "2.0.0" }),
        "prepare"
      );

      const create = {
        idempotencyKey: sharedKey,
        sessionId: "ses-conformance-idempotency",
        preparedRuntimeId: firstPrepared.id
      };
      const firstLease = await createChecked(provider, leases, create);
      requireSame(firstLease, await provider.create(structuredClone(create)), "create");
      await requireIdempotencyConflict(
        provider.create({ ...create, preparedRuntimeId: "prepared-conflict" }),
        "create"
      );

      const artifactRequest = submitRequest(firstLease.id, sharedKey, "idempotent artifact");
      const [artifact, replayedArtifact] = await Promise.all([
        provider.submitArtifact(artifactRequest),
        provider.submitArtifact(structuredClone(artifactRequest))
      ]);
      requireSame(artifact, replayedArtifact, "concurrent submitArtifact");
      await requireIdempotencyConflict(
        provider.submitArtifact(submitRequest(firstLease.id, sharedKey, "conflicting artifact")),
        "submitArtifact"
      );

      const deployRequest = {
        idempotencyKey: sharedKey,
        leaseId: firstLease.id,
        artifactId: artifact.id,
        serviceId: "checkout"
      };
      const deployment = await provider.deploy(deployRequest);
      requireSame(deployment, await provider.deploy(structuredClone(deployRequest)), "deploy");
      await requireIdempotencyConflict(
        provider.deploy({ ...deployRequest, serviceId: "conflicting-service" }),
        "deploy"
      );

      const checkpointRequest = {
        idempotencyKey: sharedKey,
        leaseId: firstLease.id,
        label: "stable"
      };
      const checkpoint = await provider.checkpoint(checkpointRequest);
      requireSame(checkpoint, await provider.checkpoint(structuredClone(checkpointRequest)), "checkpoint");
      await requireIdempotencyConflict(
        provider.checkpoint({ ...checkpointRequest, label: "conflicting-label" }),
        "checkpoint"
      );

      const evaluationRequest = {
        idempotencyKey: sharedKey,
        leaseId: firstLease.id,
        checkpointId: checkpoint.id
      };
      const evaluation = await provider.evaluate(evaluationRequest);
      requireSame(evaluation, await provider.evaluate(structuredClone(evaluationRequest)), "evaluate");
      await requireIdempotencyConflict(
        provider.evaluate({ ...evaluationRequest, checkpointId: "checkpoint-conflict" }),
        "evaluate"
      );

      const destroyRequest = {
        idempotencyKey: sharedKey,
        leaseId: firstLease.id
      };
      const destroyed = await provider.destroy(destroyRequest);
      requireSame(destroyed, await provider.destroy(structuredClone(destroyRequest)), "destroy");
      requireSame(artifact, await provider.submitArtifact(structuredClone(artifactRequest)), "submitArtifact after teardown");
      requireSame(deployment, await provider.deploy(structuredClone(deployRequest)), "deploy after teardown");
      requireSame(checkpoint, await provider.checkpoint(structuredClone(checkpointRequest)), "checkpoint after teardown");
      requireSame(evaluation, await provider.evaluate(structuredClone(evaluationRequest)), "evaluate after teardown");
      requireCondition(leases.pop() === firstLease.id, "Idempotency teardown tracking diverged.");
    }
  },
  {
    id: "typed-errors",
    async verify(provider, leases) {
      await requireProviderError(provider.health({ leaseId: "lease-missing" }), {
        type: RuntimeNotFoundError,
        operation: "health",
        code: "not-found",
        retryable: false
      });
      await requireProviderError(provider.prepare({ ...prepareRequest("bad-input"), missionId: " invalid" }), {
        type: RuntimeInputError,
        operation: "prepare",
        code: "invalid-request",
        retryable: false
      });
      const malformedPrepare: Promise<unknown> = Reflect.apply(provider.prepare, provider, [
        { ...prepareRequest("missing-limits"), limits: undefined }
      ]);
      await requireProviderError(malformedPrepare, {
        type: RuntimeInputError,
        operation: "prepare",
        code: "invalid-request",
        retryable: false
      });
      await requireProviderError(
        provider.prepare({
          ...prepareRequest("unsupported-capability"),
          requiredCapabilities: ["unsupported-for-conformance"]
        }),
        {
          type: RuntimeCapabilityError,
          operation: "prepare",
          code: "unsupported-capability",
          retryable: false
        }
      );
      await requireProviderError(
        provider.create({
          idempotencyKey: "typed-error-create",
          sessionId: "ses-typed-error-missing",
          preparedRuntimeId: "prepared-missing"
        }),
        {
          type: RuntimeNotFoundError,
          operation: "create",
          code: "not-found",
          retryable: false
        }
      );

      const prepare = prepareRequest("typed-errors");
      const prepared = await prepareChecked(provider, prepare);
      await requireProviderError(provider.prepare({ ...prepare, missionVersion: "9.9.9" }), {
        type: IdempotencyConflictError,
        operation: "prepare",
        code: "idempotency-conflict",
        retryable: false
      });
      const lease = await createChecked(provider, leases, {
        idempotencyKey: "typed-errors-create-ready",
        sessionId: "ses-conformance-typed-errors",
        preparedRuntimeId: prepared.id
      });
      const badArtifact = submitRequest(lease.id, "typed-errors-bad-digest", "actual bytes");
      await requireProviderError(
        provider.submitArtifact({ ...badArtifact, digest: `sha256:${"0".repeat(64)}` }),
        {
          type: RuntimeInputError,
          operation: "submitArtifact",
          code: "invalid-request",
          retryable: false
        }
      );
      const malformedDestroy: Promise<unknown> = Reflect.apply(provider.destroy, provider, [
        { idempotencyKey: "typed-errors-malformed-lease", leaseId: 1n }
      ]);
      await requireProviderError(malformedDestroy, {
        type: RuntimeInputError,
        operation: "destroy",
        code: "invalid-request",
        retryable: false
      });
      const malformedRead: Promise<unknown> = Reflect.apply(provider.readService, provider, [
        { leaseId: lease.id, serviceId: "checkout", path: 42 }
      ]);
      await requireProviderError(malformedRead, {
        type: RuntimeInputError,
        operation: "readService",
        code: "invalid-request",
        retryable: false
      });
      await requireProviderError(
        provider.readService({ leaseId: lease.id, serviceId: "checkout", path: "/health" }),
        {
          type: RuntimeStateError,
          operation: "readService",
          code: "invalid-state",
          retryable: false
        }
      );
    }
  },
  {
    id: "session-isolation",
    async verify(provider, leases) {
      const prepared = await prepareChecked(provider, prepareRequest("isolation"));
      const firstLease = await createChecked(provider, leases, {
        idempotencyKey: "shared-create-key",
        sessionId: "ses-conformance-isolation-first",
        preparedRuntimeId: prepared.id
      });
      const secondLease = await createChecked(provider, leases, {
        idempotencyKey: "shared-create-key",
        sessionId: "ses-conformance-isolation-second",
        preparedRuntimeId: prepared.id
      });

      const firstArtifact = await submitAndDeploy(provider, firstLease, "shared-artifact-key", "shared-deploy-key", "service-first", "first session artifact");
      const secondArtifact = await submitAndDeploy(provider, secondLease, "shared-artifact-key", "shared-deploy-key", "service-second", "second session artifact");
      requireCondition(
        firstArtifact.id.length > 0 &&
          secondArtifact.id.length > 0 &&
          firstArtifact.id !== secondArtifact.id &&
          firstArtifact.leaseId === firstLease.id &&
          secondArtifact.leaseId === secondLease.id,
        "Artifact IDs are not provider-unique or provenance crossed session boundaries."
      );

      await requireProviderError(
        provider.deploy({
          idempotencyKey: "isolation-cross-deploy",
          leaseId: secondLease.id,
          artifactId: firstArtifact.id,
          serviceId: "cross-service"
        }),
        {
          type: RuntimeStateError,
          operation: "deploy",
          code: "invalid-state",
          retryable: false
        }
      );
      await requireProviderError(
        provider.readService({ leaseId: secondLease.id, serviceId: "service-first", path: "/health" }),
        {
          type: RuntimeStateError,
          operation: "readService",
          code: "invalid-state",
          retryable: false
        }
      );

      const firstCheckpoint = await provider.checkpoint({
        idempotencyKey: "shared-checkpoint-key",
        leaseId: firstLease.id,
        label: "first"
      });
      const secondCheckpoint = await provider.checkpoint({
        idempotencyKey: "shared-checkpoint-key",
        leaseId: secondLease.id,
        label: "second"
      });
      requireCondition(
        firstCheckpoint.id.length > 0 &&
          secondCheckpoint.id.length > 0 &&
          firstCheckpoint.id !== secondCheckpoint.id &&
          firstCheckpoint.leaseId === firstLease.id &&
          secondCheckpoint.leaseId === secondLease.id,
        "Checkpoint IDs are not provider-unique or provenance crossed session boundaries."
      );
      await requireProviderError(
        provider.evaluate({
          idempotencyKey: "isolation-cross-evaluate",
          leaseId: secondLease.id,
          checkpointId: firstCheckpoint.id
        }),
        {
          type: RuntimeStateError,
          operation: "evaluate",
          code: "invalid-state",
          retryable: false
        }
      );
      const ownEvaluation = await provider.evaluate({
        idempotencyKey: "shared-evaluate-key",
        leaseId: secondLease.id,
        checkpointId: secondCheckpoint.id
      });
      requireCondition(
        ownEvaluation.leaseId === secondLease.id && ownEvaluation.checkpointId === secondCheckpoint.id,
        "Evaluation provenance crossed session boundaries."
      );
    }
  }
];

/** Runs the full provider profile: every standard Fluxgrade runtime capability is mandatory. */
export async function runRuntimeProviderConformance(
  factory: RuntimeProviderFactory,
  options: RuntimeProviderConformanceOptions = {}
): Promise<RuntimeProviderConformanceReport> {
  const timeoutMs = options.caseTimeoutMs ?? DEFAULT_CASE_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(`caseTimeoutMs must be an integer between 1 and ${MAX_TIMER_DELAY_MS}.`);
  }

  const identityProvider = await withTimeout(
    Promise.resolve().then(factory),
    timeoutMs,
    "provider identity factory"
  );
  const identity = await withTimeout(
    identityProvider.getCapabilities(),
    timeoutMs,
    "provider identity capability discovery"
  );
  assertFullCapabilities(identity);
  const cases: ConformanceCaseResult[] = [];
  let passed = 0;

  // Requirements run sequentially because each may provision stateful external resources.
  for (const requirement of REQUIREMENTS) {
    let provider: RuntimeProvider | null = null;
    const leases: string[] = [];
    let failure: string | null = null;
    try {
      const caseProvider = await withTimeout(
        Promise.resolve().then(factory),
        timeoutMs,
        `${requirement.id} provider factory`
      );
      provider = caseProvider;
      const caseIdentity = await withTimeout(
        caseProvider.getCapabilities(),
        timeoutMs,
        `${requirement.id} capability discovery`
      );
      assertFullCapabilities(caseIdentity);
      requireCondition(
        caseIdentity.providerId === identity.providerId,
        `${requirement.id} factory returned provider ${caseIdentity.providerId}, expected ${identity.providerId}.`
      );
      await withTimeout(
        requirement.verify(caseProvider, leases),
        timeoutMs,
        `${requirement.id} conformance case`
      );
    } catch (error) {
      failure = errorMessage(error);
    }

    if (provider !== null) {
      for (let index = leases.length - 1; index >= 0; index -= 1) {
        const leaseId = leases[index]!;
        try {
          await withTimeout(
            provider.destroy({
              idempotencyKey: `conformance-cleanup-${requirement.id}-${leaseId}`,
              leaseId
            }),
            timeoutMs,
            `${requirement.id} cleanup for ${leaseId}`
          );
        } catch (error) {
          const cleanupFailure = `Cleanup failed for ${leaseId}: ${errorMessage(error)}`;
          failure = failure === null ? cleanupFailure : `${failure}; ${cleanupFailure}`;
        }
      }
    }

    if (failure === null) {
      passed += 1;
      cases.push({ id: requirement.id, status: "passed" });
    } else {
      cases.push({ id: requirement.id, status: "failed", message: failure });
    }
  }

  return {
    profile: "full",
    providerId: identity.providerId,
    passed,
    failed: REQUIREMENTS.length - passed,
    total: REQUIREMENTS.length,
    cases
  };
}

function prepareRequest(suffix: string): PrepareRuntimeRequest {
  return {
    idempotencyKey: `conformance-prepare-${suffix}`,
    missionId: "conformance-mission",
    missionVersion: "1.0.0",
    imageDigests: [IMAGE_DIGEST, SECOND_IMAGE_DIGEST],
    requiredCapabilities: [...FULL_RUNTIME_CAPABILITIES],
    limits: {
      durationMs: 60_000,
      cpuMillicores: 1_000,
      memoryMiB: 512,
      diskMiB: 1_024
    }
  };
}

async function prepareChecked(
  provider: RuntimeProvider,
  request: PrepareRuntimeRequest
): Promise<PreparedRuntime> {
  const capabilities = await provider.getCapabilities();
  const prepared = await provider.prepare(request);
  requireCondition(
    typeof prepared.id === "string" &&
      prepared.id.length > 0 &&
      prepared.providerId === capabilities.providerId &&
      prepared.missionId === request.missionId &&
      prepared.missionVersion === request.missionVersion &&
      prepared.state === "ready",
    "Prepared runtime identity or provenance is incorrect."
  );
  return prepared;
}

async function createChecked(
  provider: RuntimeProvider,
  leases: string[],
  request: CreateRuntimeRequest
): Promise<RuntimeLease> {
  const lease = await provider.create(request);
  let duplicateId = false;
  if (typeof lease.id === "string" && lease.id.length > 0) {
    for (const leaseId of leases) {
      if (leaseId === lease.id) {
        duplicateId = true;
        break;
      }
    }
    if (!duplicateId) leases.push(lease.id);
  }
  requireCondition(
    typeof lease.id === "string" &&
      lease.id.length > 0 &&
      !duplicateId &&
      lease.sessionId === request.sessionId &&
      lease.preparedRuntimeId === request.preparedRuntimeId &&
      lease.state === "ready",
    "Runtime lease identity or provenance is incorrect."
  );
  return lease;
}

async function openRuntime(
  provider: RuntimeProvider,
  suffix: string,
  leases: string[]
): Promise<RuntimeLease> {
  const prepared = await prepareChecked(provider, prepareRequest(suffix));
  const lease = await createChecked(provider, leases, {
    idempotencyKey: `conformance-create-${suffix}`,
    sessionId: `ses-conformance-${suffix}`,
    preparedRuntimeId: prepared.id
  });
  return lease;
}

function submitRequest(leaseId: string, idempotencyKey: string, body: string): {
  readonly idempotencyKey: string;
  readonly leaseId: string;
  readonly digest: string;
  readonly content: Uint8Array;
} {
  const content = new TextEncoder().encode(body);
  return {
    idempotencyKey,
    leaseId,
    digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    content
  };
}

async function submitAndDeploy(
  provider: RuntimeProvider,
  lease: RuntimeLease,
  artifactKey: string,
  deployKey: string,
  serviceId: string,
  body: string
): Promise<SubmittedArtifact> {
  const request = submitRequest(lease.id, artifactKey, body);
  const artifact = await provider.submitArtifact(request);
  requireCondition(
    artifact.id.length > 0 &&
      artifact.leaseId === lease.id &&
      artifact.digest === request.digest &&
      artifact.bytes === request.content.byteLength,
    "Artifact identity or provenance is incorrect."
  );
  const deployment = await provider.deploy({
    idempotencyKey: deployKey,
    leaseId: lease.id,
    artifactId: artifact.id,
    serviceId
  });
  requireCondition(
    deployment.id.length > 0 &&
      deployment.leaseId === lease.id &&
      deployment.artifactId === artifact.id &&
      deployment.serviceId === serviceId,
    "Deployment identity or provenance is incorrect."
  );
  return artifact;
}

async function requireDestroyedLeaseFailures(
  provider: RuntimeProvider,
  lease: RuntimeLease,
  artifactId: string,
  checkpointId: string
): Promise<void> {
  await requireProviderError(provider.health({ leaseId: lease.id }), {
    type: RuntimeStateError,
    operation: "health",
    code: "invalid-state",
    retryable: false
  });
  await requireProviderError(provider.readService({ leaseId: lease.id, serviceId: "checkout", path: "/health" }), {
    type: RuntimeStateError,
    operation: "readService",
    code: "invalid-state",
    retryable: false
  });
  await requireProviderError(provider.submitArtifact(submitRequest(lease.id, "post-destroy-artifact", "late artifact")), {
    type: RuntimeStateError,
    operation: "submitArtifact",
    code: "invalid-state",
    retryable: false
  });
  await requireProviderError(provider.deploy({ idempotencyKey: "post-destroy-deploy", leaseId: lease.id, artifactId, serviceId: "checkout" }), {
    type: RuntimeStateError,
    operation: "deploy",
    code: "invalid-state",
    retryable: false
  });
  await requireProviderError(provider.checkpoint({ idempotencyKey: "post-destroy-checkpoint", leaseId: lease.id, label: "late" }), {
    type: RuntimeStateError,
    operation: "checkpoint",
    code: "invalid-state",
    retryable: false
  });
  await requireProviderError(provider.evaluate({ idempotencyKey: "post-destroy-evaluate", leaseId: lease.id, checkpointId }), {
    type: RuntimeStateError,
    operation: "evaluate",
    code: "invalid-state",
    retryable: false
  });
}

function assertFullCapabilities(capabilities: RuntimeProviderCapabilities): void {
  requireCondition(
    typeof capabilities.providerId === "string" &&
      capabilities.providerId.length > 0 &&
      capabilities.providerId === capabilities.providerId.trim(),
    "providerId must be non-empty without outer whitespace."
  );
  requireCondition(
    Number.isSafeInteger(capabilities.maxArtifactBytes) && capabilities.maxArtifactBytes > 0,
    "maxArtifactBytes must be a positive safe integer."
  );
  requireCondition(Array.isArray(capabilities.capabilities), "capabilities must be an array.");
  const advertised = new Set(capabilities.capabilities);
  requireCondition(
    advertised.size === capabilities.capabilities.length,
    "Capabilities must not contain duplicates."
  );
  for (const capability of FULL_RUNTIME_CAPABILITIES) {
    requireCondition(advertised.has(capability), `Missing full-profile capability: ${capability}`);
  }
}

function requireIdempotencyConflict(
  operation: Promise<unknown>,
  runtimeOperation: RuntimeOperation
): Promise<void> {
  return requireProviderError(operation, {
    type: IdempotencyConflictError,
    operation: runtimeOperation,
    code: "idempotency-conflict",
    retryable: false
  });
}

async function requireProviderError(operation: Promise<unknown>, expected: ExpectedProviderError): Promise<void> {
  try {
    await operation;
  } catch (error) {
    requireCondition(
      error instanceof expected.type,
      `${expected.operation} returned ${errorName(error)} instead of ${expected.type.name}.`
    );
    requireCondition(
      error.code === expected.code && error.operation === expected.operation && error.retryable === expected.retryable,
      `${expected.operation} returned incorrect typed error metadata.`
    );
    return;
  }
  throw new Error(`${expected.operation} unexpectedly succeeded.`);
}

function requireSame(first: unknown, second: unknown, operation: string): void {
  requireCondition(isDeepStrictEqual(first, second), `${operation} did not replay the original result.`);
}

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const { promise: exceeded, reject } = Promise.withResolvers<never>();
  const timeout = setTimeout(
    () => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)),
    timeoutMs
  );
  return Promise.race([operation, exceeded]).finally(() => clearTimeout(timeout));
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function errorMessage(error: unknown): string {
  try {
    const candidate = error instanceof Error ? error.message : error;
    return typeof candidate === "string" ? candidate : String(candidate);
  } catch {
    return "Unknown conformance failure.";
  }
}
