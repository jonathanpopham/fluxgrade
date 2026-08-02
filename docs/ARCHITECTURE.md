# Fluxgrade architecture

Status: proposed architecture for the agent-first SaaS

## 1. Product boundary

Fluxgrade has four surfaces:

1. **Trailer and public site** for discovery
2. **Local mission client** for serious play
3. **Employer and reviewer portal** for private assessments
4. **Replay and result pages** for evidence, competition, and verification

The local client is the primary candidate experience. The web application is the commercial and administrative surface. The runtime and evaluator are independent services.

## 2. Candidate experience

A typical session is:

```bash
fluxgrade login
fluxgrade accept fg_invite_7YJ2
fluxgrade start
cd ~/Fluxgrade/checkout-latency-7YJ2
hermes
```

The generated checkout contains:

```text
checkout-latency-7YJ2/
├── README.md                 # Mission handoff and connection map
├── AGENTS.md                 # Agent-readable operating context
├── .env                      # Mode 0600, short-lived session credentials
├── .gitignore
├── src/
├── tests/
├── runbooks/
├── incidents/
│   └── updates/              # Durable mission events appear here
└── .fluxgrade/
    ├── session.json          # Non-secret session metadata
    ├── policy.json           # Tool, network, retention, and time policy
    ├── inbox/                # Event files written by the local sidecar
    └── evidence/             # Local spool awaiting acknowledgement
```

The candidate talks to Hermes, Codex, Claude Code, OMP, or another agent normally. The agent reads the repository and uses ordinary commands plus a small Fluxgrade CLI/MCP surface.

### Universal local commands

```text
fluxgrade status
fluxgrade events
fluxgrade inspect <resource>
fluxgrade check
fluxgrade deploy
fluxgrade submit
```

### Agent tool surface

```text
mission_status
list_events
inspect_environment
run_public_checks
deploy_candidate
submit_mission
```

The MCP surface is optional. Every capability also has a CLI form so Fluxgrade works with any agent or no agent.

## 3. Human-computer interaction

### Primary interaction

The human provides intent, constraints, authorization, skepticism, and judgment through agent conversation.

### Shared memory

Repository files preserve the brief, code, plans, incident updates, findings, tests, and final report.

### Feedback

Tests, logs, traces, metrics, deployment outcomes, and application behavior establish what is true.

### Mission events

The session service emits signed events. The local sidecar:

1. appends the event to `.fluxgrade/inbox/`;
2. writes a human-readable copy under `incidents/updates/` when appropriate;
3. emits a terminal and OS notification;
4. exposes the event through CLI and MCP;
5. lets native agent adapters inject it at the next safe conversational boundary.

A web HUD is optional and never required.

## 4. System topology

```text
                           Fluxgrade SaaS control plane

  Public site       Employer portal       Replay/result verifier
       |                    |                         |
       +--------------------+-------------------------+
                            |
                     Control Plane API
                            |
       +--------------------+--------------------------+
       |                    |                          |
  Organization         Session                 Mission registry
  and billing          orchestrator            and policy service
       |                    |                          |
       +--------------------+--------------------------+
                            |
                   Append-only event service
                            |
        +-------------------+--------------------+
        |                   |                    |
   PostgreSQL          Object storage        Signing/KMS
   projections         artifacts             result signatures

                            |
                   Runtime Provider Interface
                            |
       +--------------------+--------------------------+
       |                    |                          |
 E2B/managed MVP     Fluxgrade AWS data plane   Customer data plane
                                             Fargate/EKS/self-hosted
       |                    |                          |
       +--------------------+--------------------------+
                            |
                 Isolated mission environment
                   |                      |
            Candidate-visible       Hidden evaluator
            running system          separate boundary
                   ^
                   |
        Session gateway and credential broker
                   ^
                   |
      Local Fluxgrade sidecar <-> local repository <-> user's agent
```

## 5. Control plane

The control plane is a multi-tenant SaaS responsible for:

- organizations, users, memberships, and roles;
- subscriptions, usage, invoices, and entitlements;
- public mission catalog and seasons;
- private challenge libraries and employer policies;
- invitations and candidate consent;
- session lifecycle and leases;
- runtime placement and capacity;
- event sequencing and immutable evidence manifests;
- artifacts, evaluations, scoring, reports, and appeals;
- result signing and public verification;
- deployment registration for customer-hosted runners.

It never executes candidate code.

### Recommended initial hosting

- Public/trailer and portal: Next.js on Vercel or equivalent edge hosting
- Control Plane API and workers: containers on AWS ECS
- Database: PostgreSQL on RDS
- Artifacts: versioned S3 buckets
- Signing: AWS KMS asymmetric keys
- Email: transactional provider behind an adapter
- Billing: Stripe behind a billing domain service
- Operational telemetry: OpenTelemetry to a separate backend
- Durable jobs: PostgreSQL queue plus transactional outbox initially

Long-lived session orchestration should not live only in short-duration web functions. The portal may be serverless, but the API, event ingest, and workers should be durable container services.

### Core records

```text
organizations
users
memberships
subscriptions
missions
mission_versions
mission_variants
policies
invitations
sessions
runtime_leases
session_events
artifacts
evaluations
scores
reports
result_credentials
appeals
runner_installations
```

Every tenant-owned record carries an organization identifier. Database access is enforced both in application authorization and PostgreSQL row-level security for high-risk tables.

## 6. Runtime plane

Candidate and agent code is untrusted. Runtime implementations sit behind a provider-neutral interface:

```ts
interface RuntimeProvider {
  prepare(spec: RuntimeSpec): Promise<PreparedRuntime>;
  create(spec: SessionRuntimeSpec): Promise<RuntimeLease>;
  execute(lease: RuntimeLease, command: RestrictedCommand): AsyncIterable<Output>;
  expose(lease: RuntimeLease, service: ServiceSpec): Promise<SessionEndpoint>;
  snapshot(lease: RuntimeLease): Promise<RuntimeCheckpoint>;
  inspect(lease: RuntimeLease): Promise<RuntimeHealth>;
  destroy(lease: RuntimeLease): Promise<void>;
}
```

The mission engine depends on Fluxgrade lifecycle semantics, not E2B, ECS, Fly, or Kubernetes-specific concepts.

### Runtime choices

#### MVP

Use a purpose-built managed sandbox such as E2B after a focused security and network-policy proof. It supplies rapid, API-driven isolated environments without forcing Fluxgrade to operate a microVM scheduler.

#### Fluxgrade-hosted production

Use dedicated AWS accounts and VPCs for assessment workloads. ECS Fargate is the first enterprise-capable backend because each task runs in an isolated virtual environment with dedicated task resources and customer-controllable VPC networking. A stronger EKS plus Kata or direct Firecracker backend can follow if threat models require it.

#### Customer-hosted runtime

Deploy an outbound-only Fluxgrade runner into the customer's AWS account or Kubernetes cluster. Candidate code, private mission images, logs, artifacts, and hidden evaluators remain in the customer boundary.

The runner establishes an mTLS connection to the SaaS control plane and leases work. The SaaS never opens an inbound connection into the customer network.

## 7. Deployment modes

### A. Public local practice

- Public mission source exists under `trials/public/`.
- Local repo is materialized on the player's machine.
- The running system may be local Docker Compose or a Fluxgrade-hosted sandbox.
- Open Stack results disclose the tool and runtime policy.
- No claim of strict comparability is made.

### B. Fluxgrade-hosted private assessment

- Employer creates an invitation in the SaaS portal.
- A sealed variant is selected server-side.
- Candidate receives only candidate-visible source and session credentials.
- Running system and hidden evaluator live in an isolated Fluxgrade data plane.
- Evidence and artifacts follow employer retention policy.

### C. Customer-VPC data plane

- Fluxgrade SaaS keeps organization, invitation, and report metadata.
- Runtime, private mission registry, evidence artifacts, and evaluation stay in the customer's account.
- Customer KMS, S3, CloudWatch, ECR, VPC, and identity controls apply.
- The outbound runner sends only policy-approved result projections to the SaaS.

### D. Fully private deployment

- Control plane, portal, runner, database, object storage, signing, and identity integration run in the customer's environment.
- Delivery uses signed container images plus Terraform and Helm.
- OIDC/SAML integrates with customer identity.
- Updates are pull-based and signed.
- An offline license option supports disconnected environments.

Do not build mode D for the first pilot, but keep boundaries and dependencies compatible with it. In particular, core assessment logic must not depend directly on Vercel, Stripe, WorkOS, or a Fluxgrade-owned cloud account.

## 8. Mission package

A mission is an executable, signed specification:

```text
missions/checkout-latency/
├── mission.yaml
├── candidate/
│   ├── repository.tar.zst
│   ├── README.template.md
│   └── AGENTS.template.md
├── runtime/
│   ├── compose.yaml
│   ├── image.lock
│   └── seed/
├── events/
│   ├── duplicate-holds.yaml
│   └── provider-degradation.yaml
├── evaluator/
│   ├── image.lock
│   ├── checks.yaml
│   └── rubric.yaml
├── policies/
│   ├── public-open.yaml
│   ├── standard.yaml
│   └── private.yaml
└── manifest.sig
```

`mission.yaml` pins:

- mission and schema versions;
- candidate repository digest;
- runtime image digests;
- evaluator digest;
- permitted event graph and seeded variant;
- resource and network limits;
- event triggers;
- public objectives and hidden invariants;
- scoring model version;
- retention classification;
- supported runtime capabilities.

Public packages can be committed in this repository. Private packages and evaluator sources live in a private mission-authoring repository and signed OCI registry.

## 9. Session gateway and credentials

The `.env` file contains session-scoped capabilities, not cloud provider keys:

```bash
FLUXGRADE_SESSION_ID=ses_...
FLUXGRADE_GATEWAY_URL=https://ses_....run.fluxgrade.dev
FLUXGRADE_TOKEN=fgs_...
LOGS_URL=https://ses_....run.fluxgrade.dev/logs
METRICS_URL=https://ses_....run.fluxgrade.dev/metrics
```

Credential rules:

- file mode 0600;
- ignored by Git;
- short expiration with automatic renewal through the local sidecar;
- least-privilege scopes such as `logs:read`, `deploy:create`, and `submission:create`;
- bound to session and policy;
- revocable immediately;
- never valid against provider control APIs;
- redacted from evidence and logs.

The gateway enforces authentication, rate limits, request budgets, and audit events. It prevents candidate code from addressing hidden evaluator services directly.

## 10. Deployment and evaluation path

Candidate deployment does not expose provider credentials:

1. Agent runs `fluxgrade deploy`.
2. Client creates a Git bundle or content-addressed patch from the allowed repository root.
3. Client signs the submission manifest with its session key.
4. Gateway uploads the artifact to session storage.
5. Runtime worker applies it to a clean candidate build environment.
6. Public build checks run.
7. Candidate artifact deploys to the simulated canary.
8. Runtime emits telemetry and system consequences.
9. Hidden evaluator observes through an isolated service identity.
10. Promotion or rollback follows mission rules or candidate instruction.

At final submission, evaluation runs from a clean image and recorded repository digest, never from mutable candidate processes.

## 11. Evidence model

Events have explicit provenance:

- **Control-plane authoritative:** invitation, policy acceptance, session state, event delivery, leases
- **Runtime authoritative:** requests, deployments, service health, telemetry, resource use
- **Evaluator authoritative:** hidden checks, invariant violations, final outcome
- **Client observed:** local commands, public test runs, Git state, agent metadata
- **Candidate supplied:** incident report, rationale, optional transcript

A local machine cannot be made magically trustworthy. Client-observed events are useful evidence but are never represented as server-attested facts.

Each event includes:

```text
session_id
sequence
occurred_at
received_at
source
source_instance
kind
schema_version
payload_digest
previous_event_digest
signature
visibility
retention_class
```

The hash chain detects mutation and omission inside each source stream. Server receipt acknowledgements anchor local events. Large payloads are content-addressed objects, not embedded database rows.

Operational telemetry is separate from assessment evidence. OpenTelemetry traces help operate Fluxgrade; versioned assessment events support replay and scoring. They have different retention and access policies.

## 12. Scoring and reports

Primary scoring is based on:

- final correctness and hidden invariants;
- running-system recovery;
- response to requirement changes;
- robustness, performance, and reversibility;
- verification evidence;
- resource and time policy.

Agent transcript length, prompt count, and tool-call count do not directly improve the score.

A result identifies:

- mission, variant, runtime, policy, evaluator, and scoring versions;
- final repository digest;
- authoritative outcome evidence;
- client-reported supporting evidence;
- reviewer rubric and disagreements;
- integrity confidence and known limitations;
- signature and verification URL.

Hiring reports must remain role-specific and experimental until pilot evidence supports validity claims.

## 13. Security baseline

- No untrusted execution in the control plane.
- VM, microVM, or hardened sandbox boundary for candidate code.
- No privileged containers, Docker socket, host mounts, host PID, or host network.
- Non-root process, dropped capabilities, seccomp, resource and process limits.
- Default-deny inbound and narrowly controlled outbound.
- Cloud metadata endpoints blocked.
- Independent watchdog and hard session TTL.
- Hidden evaluator outside candidate namespace and filesystem.
- Mission images and manifests signed and digest-pinned.
- Per-session identities and encryption keys.
- Secrets brokered and redacted.
- PII separated from technical evidence.
- Employer-defined retention and deletion.
- Export and appeal paths for candidates.
- Sandbox escape and evaluator-exfiltration tests before private pilots.

## 14. SaaS concerns beyond runtime

A full product also requires:

- organization roles and least-privilege administration;
- invitation expiration, reassignment, and cancellation;
- candidate consent, accommodations, and privacy notices;
- role-specific assessment blueprints;
- challenge authoring, review, calibration, release, and retirement;
- billing entitlements and usage metering;
- support tooling and audit logs;
- data export, deletion, and retention enforcement;
- appeals and reviewer disagreement workflows;
- SSO/SAML and SCIM for enterprise;
- status page, incident response, backup, and restore drills;
- accessibility for all required web surfaces;
- regional placement and customer data residency;
- signed deployment and supply-chain controls;
- abuse, resource exhaustion, and denial-of-wallet protection.

## 15. Initial repository shape

The static trailer can coexist with the SaaS in a monorepo:

```text
fluxgrade/
├── apps/
│   ├── trailer/                 # Existing static game
│   ├── portal/                  # Public, employer, reviewer, replay UI
│   ├── api/                     # Control Plane API
│   └── worker/                  # Durable orchestration and evaluation jobs
├── crates/
│   ├── fluxgrade-cli/           # Local client and sidecar
│   └── evidence-spool/          # Local durable event spool and signing
├── packages/
│   ├── domain/
│   ├── mission-schema/
│   ├── evidence-schema/
│   ├── scoring/
│   ├── reports/
│   ├── runtime-provider/
│   └── sdk/
├── providers/
│   ├── local-docker/
│   ├── managed-sandbox/
│   └── aws-fargate/
├── trials/
│   └── public/
├── tests/
│   ├── e2e/
│   ├── adversarial/
│   ├── conformance/
│   └── calibration/
├── infra/
│   ├── saas/
│   ├── customer-vpc/
│   └── private/
└── docs/
```

The existing static files can move into `apps/trailer/` only when implementation begins. Do not reorganize them as part of design documentation alone.

## 16. Hosting recommendation

Start with:

- Vercel for the minimal website and portal
- AWS ECS for API and workers
- RDS PostgreSQL
- S3 and KMS
- A managed sandbox provider behind `RuntimeProvider`
- Local Docker provider for public development and conformance tests

Add customer-VPC Fargate once a real employer requires private data-plane placement. Build a complete private control plane only after a design partner requires it.

The important irreversible choice is not the first sandbox vendor. It is preserving the boundary between control plane, runtime plane, evaluator, local client, and evidence store.

## 17. Sources requiring procurement validation

Web search was unavailable during this design pass. Direct vendor documentation was reachable, and AWS currently states that each Fargate task runs on isolated virtual infrastructure and does not share network interfaces, ephemeral storage, CPU, or memory with other tasks. E2B, Daytona, Fly, Modal, and other sandbox limits, regions, prices, network controls, and private deployment commitments must be validated against current contracts before selection.

Reference starting points:

- E2B documentation: https://e2b.dev/docs
- Daytona documentation: https://www.daytona.io/docs
- AWS Fargate security: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-security-considerations.html
- Fly Machines: https://fly.io/docs/machines/
- Firecracker: https://firecracker-microvm.github.io/
