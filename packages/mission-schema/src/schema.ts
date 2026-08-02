import { parseDocument, visit } from "yaml";
import { z } from "zod";

export const MISSION_SCHEMA_VERSION = "1.0.0" as const;

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/u,
    "Expected a lowercase kebab-case identifier"
  );
const version = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?![\s\S])/u,
    "Expected a semantic version"
  );
const sha256Digest = z
  .string()
  .regex(
    /^sha256:[0-9a-f]{64}(?![\s\S])/u,
    "Expected a lowercase SHA-256 digest"
  );
const immutableImage = z.string().regex(
  /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)+@sha256:[0-9a-f]{64}(?![\s\S])/u,
  "Expected a fully qualified immutable OCI image digest reference"
);
const relativePath = z
  .string()
  .min(1)
  .max(512)
  .regex(
    /^(?!\/)(?!.*\\)(?!.*\/\/)(?!\.{1,2}(?:\/|(?![\s\S])))(?!.*\/\.{1,2}(?:\/|(?![\s\S]))).+(?![\s\S])/u,
    "Expected a normalized relative path"
  );
const hostname = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?![\s\S])/u,
    "Expected a lowercase hostname"
  );
const candidateSchema = z.strictObject({
  artifact: relativePath,
  digest: sha256Digest
});

const runtimeImageSchema = z.strictObject({
  id: identifier,
  image: immutableImage
});

const runtimeSchema = z
  .strictObject({
    entrypoint: relativePath,
    images: z.array(runtimeImageSchema).min(1).max(128),
    seededVariant: identifier,
    capabilities: z.array(identifier).max(128)
  })
  .superRefine((runtime, context) => {
    const imageIds = new Set<string>();
    for (let index = 0; index < runtime.images.length; index += 1) {
      const imageId = runtime.images[index]!.id;
      if (imageIds.has(imageId)) {
        context.addIssue({
          code: "custom",
          path: ["images", index, "id"],
          message: `Duplicate runtime image ID: ${imageId}`
        });
      }
      imageIds.add(imageId);
    }

    const capabilities = new Set<string>();
    for (let index = 0; index < runtime.capabilities.length; index += 1) {
      const capability = runtime.capabilities[index]!;
      if (capabilities.has(capability)) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index],
          message: `Duplicate runtime capability: ${capability}`
        });
      }
      capabilities.add(capability);
    }
  });

const evaluatorSchema = z.strictObject({
  image: immutableImage,
  checks: relativePath,
  rubric: relativePath
});

const policiesSchema = z.strictObject({
  source: relativePath,
  retentionClass: identifier,
  scoringModelVersion: version
});

const eventSchema = z.strictObject({
  id: identifier,
  definition: relativePath,
  dependsOn: z.array(identifier).max(128)
});

const objectiveSchema = z.strictObject({
  id: identifier,
  description: z.string().min(1).max(2_000),
  visibility: z.enum(["public", "hidden"]),
  weight: z.number().int().positive().max(100)
});

const networkLimitsSchema = z
  .strictObject({
    outbound: z.enum(["deny", "allowlist"]),
    allowedHosts: z.array(hostname).max(256)
  })
  .superRefine((network, context) => {
    if (network.outbound === "deny" && network.allowedHosts.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["allowedHosts"],
        message: "allowedHosts must be empty when outbound access is denied"
      });
    }

    const allowedHosts = new Set<string>();
    for (let index = 0; index < network.allowedHosts.length; index += 1) {
      const allowedHost = network.allowedHosts[index]!;
      if (allowedHosts.has(allowedHost)) {
        context.addIssue({
          code: "custom",
          path: ["allowedHosts", index],
          message: `Duplicate allowed host: ${allowedHost}`
        });
      }
      allowedHosts.add(allowedHost);
    }
  });

const limitsSchema = z.strictObject({
  durationSeconds: z.number().int().positive().max(86_400),
  cpuMillicores: z.number().int().positive().max(128_000),
  memoryMiB: z.number().int().positive().max(1_048_576),
  diskMiB: z.number().int().positive().max(10_485_760),
  network: networkLimitsSchema
});

export const missionSchema = z
  .strictObject({
    schemaVersion: z.literal(MISSION_SCHEMA_VERSION),
    id: identifier,
    version,
    title: z.string().min(1).max(256),
    candidate: candidateSchema,
    runtime: runtimeSchema,
    evaluator: evaluatorSchema,
    policies: policiesSchema,
    events: z.array(eventSchema).max(1_024),
    objectives: z.array(objectiveSchema).min(1).max(128),
    limits: limitsSchema
  })
  .superRefine((mission, context) => {
    const eventIds = new Set<string>();
    const dependenciesById = new Map<string, readonly string[]>();
    for (let index = 0; index < mission.events.length; index += 1) {
      const event = mission.events[index]!;
      if (eventIds.has(event.id)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "id"],
          message: `Duplicate event ID: ${event.id}`
        });
      }
      eventIds.add(event.id);
      dependenciesById.set(event.id, event.dependsOn);

      const dependencies = new Set<string>();
      for (let dependencyIndex = 0; dependencyIndex < event.dependsOn.length; dependencyIndex += 1) {
        const dependency = event.dependsOn[dependencyIndex]!;
        if (dependencies.has(dependency)) {
          context.addIssue({
            code: "custom",
            path: ["events", index, "dependsOn", dependencyIndex],
            message: `Duplicate event dependency: ${dependency}`
          });
        }
        dependencies.add(dependency);
      }
    }

    for (let eventIndex = 0; eventIndex < mission.events.length; eventIndex += 1) {
      const event = mission.events[eventIndex]!;
      for (
        let dependencyIndex = 0;
        dependencyIndex < event.dependsOn.length;
        dependencyIndex += 1
      ) {
        const dependency = event.dependsOn[dependencyIndex]!;
        if (!eventIds.has(dependency)) {
          context.addIssue({
            code: "custom",
            path: ["events", eventIndex, "dependsOn", dependencyIndex],
            message: `Event ${event.id} depends on unknown event: ${dependency}`
          });
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (eventId: string): boolean => {
      if (visiting.has(eventId)) return false;
      if (visited.has(eventId)) return true;
      visiting.add(eventId);
      const dependencies = dependenciesById.get(eventId) ?? [];
      for (const dependency of dependencies) {
        if (eventIds.has(dependency) && !visit(dependency)) return false;
      }
      visiting.delete(eventId);
      visited.add(eventId);
      return true;
    };

    for (let index = 0; index < mission.events.length; index += 1) {
      const eventId = mission.events[index]!.id;
      if (!visit(eventId)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "dependsOn"],
          message: `Event trigger graph contains a cycle involving: ${eventId}`
        });
        break;
      }
    }

    const objectiveIds = new Set<string>();
    let totalWeight = 0;
    for (let index = 0; index < mission.objectives.length; index += 1) {
      const objective = mission.objectives[index]!;
      if (objectiveIds.has(objective.id)) {
        context.addIssue({
          code: "custom",
          path: ["objectives", index, "id"],
          message: `Duplicate objective ID: ${objective.id}`
        });
      }
      objectiveIds.add(objective.id);
      totalWeight += objective.weight;
    }
    if (totalWeight !== 100) {
      context.addIssue({
        code: "custom",
        path: ["objectives"],
        message: `Objective weights must total 100, received ${totalWeight}`
      });
    }
  });

export type MissionManifest = z.infer<typeof missionSchema>;

export function parseMission(value: unknown): MissionManifest {
  return missionSchema.parse(value);
}

export function loadMissionYaml(source: string): MissionManifest {
  if (source.length > 1_000_000) {
    throw new Error("Mission YAML exceeds the 1,000,000 character limit.");
  }
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join("\n"));
  }

  let nodeCount = 0;
  visit(document, (_key, _node, path) => {
    nodeCount += 1;
    if (nodeCount > 10_000) throw new Error("Mission YAML exceeds the 10,000 node limit.");
    if (path.length > 100) throw new Error("Mission YAML exceeds the nesting depth limit.");
  });

  return parseMission(document.toJS({ maxAliasCount: 100 }));
}

const generatedMissionJsonSchema = z.toJSONSchema(missionSchema) as Record<string, unknown>;
const missionJsonProperties = generatedMissionJsonSchema.properties as Record<
  string,
  Record<string, unknown>
>;
const runtimeJsonProperties = missionJsonProperties.runtime!.properties as Record<
  string,
  Record<string, unknown>
>;
runtimeJsonProperties.capabilities!.uniqueItems = true;
const eventJsonSchema = missionJsonProperties.events!;
const eventItemJsonSchema = eventJsonSchema.items as Record<string, unknown>;
const eventJsonProperties = eventItemJsonSchema.properties as Record<
  string,
  Record<string, unknown>
>;
eventJsonProperties.dependsOn!.uniqueItems = true;
const limitsJsonProperties = missionJsonProperties.limits!.properties as Record<
  string,
  Record<string, unknown>
>;
const networkJsonSchema = limitsJsonProperties.network!;
const networkJsonProperties = networkJsonSchema.properties as Record<
  string,
  Record<string, unknown>
>;
networkJsonProperties.allowedHosts!.uniqueItems = true;
networkJsonSchema.allOf = [
  {
    if: {
      properties: { outbound: { const: "deny" } },
      required: ["outbound"]
    },
    then: {
      properties: { allowedHosts: { type: "array", maxItems: 0 } }
    }
  }
];
generatedMissionJsonSchema.$comment =
  "Use parseMission for cross-item invariants: runtime image IDs, event IDs, and objective IDs must be unique; event dependencies must reference known IDs and form an acyclic graph; objective weights must total 100.";

export const missionJsonSchema = generatedMissionJsonSchema;
