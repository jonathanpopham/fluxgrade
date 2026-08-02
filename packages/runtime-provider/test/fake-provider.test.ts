import { describe, expect, it } from "vitest";

import {
  IdempotencyConflictError,
  InMemoryRuntimeProvider,
  RuntimeNotFoundError,
  RuntimeStateError,
  RuntimeUnavailableError,
  runRuntimeProviderConformance,
  type DestroyedRuntime,
  type DestroyRuntimeRequest,
  type PrepareRuntimeRequest
} from "../src/index.js";

const imageDigest = `ghcr.io/fluxgrade/checkout-api@sha256:${"a".repeat(64)}`;
class NoopDestroyProvider extends InMemoryRuntimeProvider {
  override async destroy(request: DestroyRuntimeRequest): Promise<DestroyedRuntime> {
    return { leaseId: request.leaseId, destroyed: true };
  }
}
class AlternateIdentityProvider extends InMemoryRuntimeProvider {
  override async getCapabilities() {
    return { ...(await super.getCapabilities()), providerId: "alternate-memory" };
  }
}



function prepareRequest(): PrepareRuntimeRequest {
  return {
    idempotencyKey: "prepare-checkout-latency-v1",
    missionId: "checkout-latency",
    missionVersion: "1.0.0",
    imageDigests: [imageDigest],
    requiredCapabilities: [
      "service-read",
      "artifact-submit",
      "deploy",
      "checkpoint",
      "evaluate"
    ],
    limits: {
      durationMs: 1_800_000,
      cpuMillicores: 2_000,
      memoryMiB: 2_048,
      diskMiB: 4_096
    }
  };
}

describe("runtime provider contract", () => {
  it("passes every reusable conformance requirement against the in-memory provider", async () => {
    const report = await runRuntimeProviderConformance(() => new InMemoryRuntimeProvider());

    expect(report).toMatchObject({
      profile: "full",
      providerId: "memory",
      passed: 5,
      total: 5,
      failed: 0
    });
    expect(report.cases).toEqual([
      expect.objectContaining({ id: "capabilities", status: "passed" }),
      expect.objectContaining({ id: "lifecycle", status: "passed" }),
      expect.objectContaining({ id: "idempotency", status: "passed" }),
      expect.objectContaining({ id: "typed-errors", status: "passed" }),
      expect.objectContaining({ id: "session-isolation", status: "passed" })
    ]);
  });

  it("rejects a provider that reports teardown without changing runtime state", async () => {
    const report = await runRuntimeProviderConformance(() => new NoopDestroyProvider());

    expect(report.failed).toBeGreaterThan(0);
    expect(report.cases).toContainEqual(
      expect.objectContaining({ id: "lifecycle", status: "failed" })
    );
  });

  it("rejects factories that switch provider identity between cases", async () => {
    let calls = 0;
    const report = await runRuntimeProviderConformance(() => {
      calls += 1;
      return calls === 1 ? new InMemoryRuntimeProvider() : new AlternateIdentityProvider();
    });

    expect(report).toMatchObject({ providerId: "memory", passed: 0, failed: 5 });
    expect(report.cases[0]).toMatchObject({ status: "failed" });
  });

  it("bounds conformance when a provider factory hangs", async () => {
    const { promise } = Promise.withResolvers<InMemoryRuntimeProvider>();

    await expect(
      runRuntimeProviderConformance(() => promise, { caseTimeoutMs: 5 })
    ).rejects.toThrow(/provider identity factory exceeded 5ms/);
    await expect(
      runRuntimeProviderConformance(() => new InMemoryRuntimeProvider(), {
        caseTimeoutMs: 2_147_483_648
      })
    ).rejects.toThrow(/between 1 and 2147483647/);
  });

  it("replays identical mutation keys and rejects conflicting reuse", async () => {
    const provider = new InMemoryRuntimeProvider();
    const request = prepareRequest();
    const first = await provider.prepare(request);
    const replay = await provider.prepare(structuredClone(request));

    expect(replay).toEqual(first);
    await expect(
      provider.prepare({ ...request, missionVersion: "1.0.1" })
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("uses typed failures for missing leases and invalid lifecycle transitions", async () => {
    const provider = new InMemoryRuntimeProvider();
    await expect(
      provider.create({
        idempotencyKey: "create-missing",
        sessionId: "ses-missing",
        preparedRuntimeId: "prepared-missing"
      })
    ).rejects.toBeInstanceOf(RuntimeNotFoundError);

    const prepared = await provider.prepare(prepareRequest());
    const lease = await provider.create({
      idempotencyKey: "create-session",
      sessionId: "ses-001",
      preparedRuntimeId: prepared.id
    });
    await expect(
      provider.readService({ leaseId: lease.id, serviceId: "checkout", path: "/health" })
    ).rejects.toBeInstanceOf(RuntimeStateError);

    await provider.destroy({ idempotencyKey: "destroy-session", leaseId: lease.id });
    await expect(provider.health({ leaseId: lease.id })).rejects.toBeInstanceOf(
      RuntimeStateError
    );
  });

  it("returns snapshots that cannot mutate provider state", async () => {
    const provider = new InMemoryRuntimeProvider();
    const request = prepareRequest();
    const first = await provider.prepare(request);
    Reflect.set(first, "state", "destroyed");

    expect(await provider.prepare(request)).toMatchObject({ state: "ready" });
  });

  it("resets retained fake state between independent scenarios", async () => {
    const provider = new InMemoryRuntimeProvider();
    const request = prepareRequest();
    const prepared = await provider.prepare(request);
    const lease = await provider.create({
      idempotencyKey: "reset-create",
      sessionId: "ses-reset",
      preparedRuntimeId: prepared.id
    });

    provider.reset();

    await expect(provider.health({ leaseId: lease.id })).rejects.toBeInstanceOf(
      RuntimeNotFoundError
    );
    await expect(provider.prepare(request)).resolves.toMatchObject({ id: "prepared-1" });
  });

  it("marks provider-unavailable failures as retryable", () => {
    const error = new RuntimeUnavailableError("prepare", "offline");

    expect(error).toMatchObject({
      code: "provider-unavailable",
      operation: "prepare",
      retryable: true
    });
  });
});
