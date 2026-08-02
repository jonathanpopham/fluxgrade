import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

import { describe, expect, it } from "vitest";

import {
  MISSION_SCHEMA_VERSION,
  loadMissionYaml,
  missionJsonSchema,
  parseMission,
  type MissionManifest
} from "../src/index.js";

const validYaml = readFileSync(
  new URL("../fixtures/minimal.valid.yaml", import.meta.url),
  "utf8"
);
const missingEvaluatorYaml = readFileSync(
  new URL("../fixtures/missing-evaluator.invalid.yaml", import.meta.url),
  "utf8"
);

function validMission(): MissionManifest {
  return loadMissionYaml(validYaml);
}

describe("mission manifests", () => {
  it("loads the versioned valid fixture", () => {
    const mission = validMission();

    expect(mission).toMatchObject({
      schemaVersion: MISSION_SCHEMA_VERSION,
      id: "checkout-latency",
      version: "1.0.0",
      candidate: {
        digest: `sha256:${"1".repeat(64)}`
      },
      evaluator: {
        image: `ghcr.io/fluxgrade/checkout-evaluator@sha256:${"3".repeat(64)}`
      }
    });
    expect(mission.runtime.images).toHaveLength(1);
  });

  it("rejects unknown schema versions", () => {
    const mission = validMission();

    expect(() => parseMission({ ...mission, schemaVersion: "2.0.0" })).toThrow(
      /schemaVersion/
    );
  });

  it("rejects non-canonical mission versions", () => {
    const mission = validMission();

    for (const invalidVersion of ["01.0.0", "v1.0.0", "1.0.0\n"]) {
      expect(() => parseMission({ ...mission, version: invalidVersion })).toThrow(
        /semantic version/i
      );
    }
  });

  it("rejects mutable runtime and evaluator image tags", () => {
    const mutableRuntime = structuredClone(validMission());
    mutableRuntime.runtime.images[0]!.image = "ghcr.io/fluxgrade/checkout-api:latest";
    expect(() => parseMission(mutableRuntime)).toThrow(/immutable OCI image digest/i);

    const mutableEvaluator = structuredClone(validMission());
    mutableEvaluator.evaluator.image = "ghcr.io/fluxgrade/checkout-evaluator:v1";
    expect(() => parseMission(mutableEvaluator)).toThrow(/immutable OCI image digest/i);
  });

  it("accepts fully qualified OCI digest references with valid separators", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    for (const repository of ["check--worker", "check__worker"]) {
      const mission = validMission();
      mission.evaluator.image = `registry.example.com/team/${repository}@${digest}`;
      expect(() => parseMission(mission)).not.toThrow();
    }
  });

  it("requires a canonical candidate artifact digest", () => {
    const missingDigest = validMission();
    delete (missingDigest.candidate as Partial<MissionManifest["candidate"]>).digest;
    expect(() => parseMission(missingDigest)).toThrow(/candidate|digest/i);

    for (const digest of [
      "sha256:abc",
      `sha256:${"A".repeat(64)}`,
      `sha256:${"a".repeat(64)}\n`,
      `sha512:${"a".repeat(64)}`
    ]) {
      const mission = validMission();
      mission.candidate.digest = digest;
      expect(() => parseMission(mission)).toThrow(/SHA-256 digest/i);
    }
  });

  it("rejects non-normalized and line-terminated package paths", () => {
    for (const artifact of [
      "/candidate.tar",
      "../candidate.tar",
      "candidate/../repository.tar",
      "candidate//repository.tar",
      "candidate/repository.tar\n"
    ]) {
      const mission = validMission();
      mission.candidate.artifact = artifact;
      expect(() => parseMission(mission)).toThrow(/normalized relative path/i);
    }
  });

  it("rejects duplicate network allowlist hosts", () => {
    const mission = validMission();
    mission.limits.network.allowedHosts.push("registry.npmjs.org");

    expect(() => parseMission(mission)).toThrow(/duplicate allowed host/i);
  });

  it("rejects the fixture without an evaluator digest", () => {
    expect(() => loadMissionYaml(missingEvaluatorYaml)).toThrow(/evaluator|image/i);
  });

  it("rejects duplicate event IDs", () => {
    const mission = validMission();
    const event = mission.events[0]!;
    mission.events.push({ ...event });

    expect(() => parseMission(mission)).toThrow(/duplicate event ID/i);
  });

  it("rejects unknown trigger dependencies and cycles", () => {
    const unknownDependency = validMission();
    unknownDependency.events[0]!.dependsOn = ["missing-event"];
    expect(() => parseMission(unknownDependency)).toThrow(/unknown event/i);

    const cycle = validMission();
    cycle.events = [
      {
        id: "event-a",
        definition: "events/a.yaml",
        dependsOn: ["event-b"]
      },
      {
        id: "event-b",
        definition: "events/b.yaml",
        dependsOn: ["event-a"]
      }
    ];
    expect(() => parseMission(cycle)).toThrow(/cycle/i);
  });

  it("accepts an acyclic event dependency graph", () => {
    const mission = validMission();
    mission.events.push({
      id: "support-update",
      definition: "events/support-update.yaml",
      dependsOn: ["provider-degradation"]
    });

    expect(parseMission(mission).events).toHaveLength(2);
  });

  it("rejects duplicate YAML keys", () => {
    const duplicateTitle = validYaml.replace(
      "title: Checkout latency incident",
      "title: Checkout latency incident\ntitle: Duplicate"
    );

    expect(() => loadMissionYaml(duplicateTitle)).toThrow(/map keys must be unique/i);
  });

  it("bounds YAML source size, nesting, and alias expansion", () => {
    expect(() => loadMissionYaml("a".repeat(1_000_001))).toThrow(/character limit/i);

    const deepYaml = `${Array.from(
      { length: 60 },
      (_, index) => `${"  ".repeat(index)}level-${index}:`
    ).join("\n")}\n${"  ".repeat(60)}value`;
    expect(() => loadMissionYaml(deepYaml)).toThrow(/nesting depth/i);

    const aliasBomb = `base: &base [value]\nitems:\n${Array.from(
      { length: 101 },
      () => "  - *base"
    ).join("\n")}`;
    expect(() => loadMissionYaml(aliasBomb)).toThrow(/alias/i);
  });

  it("exports an executable strict JSON Schema for authoring tools", () => {
    expect(missionJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining([
        "schemaVersion",
        "id",
        "version",
        "title",
        "candidate",
        "runtime",
        "evaluator",
        "policies",
        "events",
        "objectives",
        "limits"
      ]),
      $comment: expect.stringMatching(/parseMission.*event.*acyclic/i)
    });

    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(missionJsonSchema);
    expect(validate(validMission())).toBe(true);

    const traversal = validMission();
    traversal.candidate.artifact = "../candidate.tar";
    expect(validate(traversal)).toBe(false);

    const nestedUnknown = structuredClone(validMission()) as MissionManifest & {
      candidate: MissionManifest["candidate"] & { unexpected?: boolean };
    };
    nestedUnknown.candidate.unexpected = true;
    expect(validate(nestedUnknown)).toBe(false);

    const duplicateCapability = validMission();
    duplicateCapability.runtime.capabilities.push("docker-compose");
    expect(validate(duplicateCapability)).toBe(false);

    const contradictoryNetwork = validMission();
    contradictoryNetwork.limits.network = {
      outbound: "deny",
      allowedHosts: ["registry.npmjs.org"]
    };
    expect(validate(contradictoryNetwork)).toBe(false);

    const duplicateHost = validMission();
    duplicateHost.limits.network.allowedHosts.push("registry.npmjs.org");
    expect(validate(duplicateHost)).toBe(false);

    const duplicateDependency = validMission();
    duplicateDependency.events[0]!.dependsOn = ["provider-degradation", "provider-degradation"];
    expect(validate(duplicateDependency)).toBe(false);

    expect(JSON.parse(JSON.stringify(missionJsonSchema))).toEqual(missionJsonSchema);
  });
});
