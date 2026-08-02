# Fluxgrade reality check

Date: 2026-08-01

## Verdict

Fluxgrade is not yet the agent-first SaaS described in `docs/ARCHITECTURE.md`. It is a polished, deployed, deterministic browser trailer plus a verified pnpm/TypeScript/Vitest workspace foundation, recovered product thesis, architecture, implementation plan, and active Beads graph.

The current implementation delivers its existing README promise and preserves that trailer behind dedicated regression gates. It now also supports clean frozen pnpm installs and empty monorepo commands, but it does not yet deliver real repositories, normal coding agents, isolated running systems, dynamic requirements, private assessments, signed evidence, rankings, or private deployment.

This distinction is intentional and must remain explicit in marketing and project status.

## Evidence examined

- `README.md`
- `docs/PRODUCT_ORIGINS.md`
- `docs/ARCHITECTURE.md`
- `docs/plans/2026-08-01-agent-first-vertical-slice.md`
- `GAMELOOP_BRAINSTORM_CONTEXT.md`
- `src/app.js`
- `src/game-engine.js`
- `tests/e2e.mjs`
- deployed site at `https://jonathanpopham.com/fluxgrade/`
- current Git branches, refs, and repository status
- recovered original Codex sessions and local one-pagers
- Beads graph under `.beads/`
- `bvr --robot-triage`, `--robot-insights`, `--robot-plan`, and `--robot-next`

## What works now

| Capability | Status | Evidence |
|---|---|---|
| Static mission trailer | WORKING | Deployed site loads and completes |
| Deterministic mission state machine | WORKING | Five Node tests pass |
| Optimal scoring path | WORKING | Unit and E2E tests produce the expected result |
| Mobile mission flow | WORKING | Playwright E2E passes |
| Seeded local leaderboard | WORKING WITH LIMITS | Browser-local, deliberately not authoritative |
| Public positioning and visual identity | WORKING | Live GitHub Pages artifact |
| Recovered original product intent | WORKING | Primary-source synthesis in `PRODUCT_ORIGINS.md` |
| Agent-first workspace foundation | WORKING | Clean-temp `pnpm install --frozen-lockfile` and `pnpm check` pass |
| Provenance-aware evidence chain | WORKING | `@fluxgrade/evidence-schema` build, 18 deterministic tests, portable fixture, and built-package append/verify smoke pass |
| Versioned mission package contract | WORKING | `@fluxgrade/mission-schema` build, 15 deterministic tests, YAML fixtures, Ajv-validated JSON Schema, and built-package loader smoke pass |
| Provider-neutral runtime contract | WORKING | `@fluxgrade/runtime-provider` build, 9 tests, full-profile conformance, and built-package lifecycle smoke pass; this is a contract and in-memory test fake, not a real runtime |
| Checkout-latency candidate seed | WORKING WITH LIMITS | Deterministic broken checkout service, saved-method skew, stale wrong design note, 9 authoring tests covering naive and causal variants, byte-reproducible pinned archive, and clean extracted install/build/server smoke pass; no mission runtime or evaluator yet |
| SaaS and private-deployment architecture | DESIGNED, UNIMPLEMENTED | `ARCHITECTURE.md` |
| Executable implementation graph | IN PROGRESS | Beads `fluxgrade-c90.1` through `.6` closed; 28 open Beads remain |

## What does not exist yet

| Vision goal | Status | Bead coverage |
|---|---|---|
| Normal local agent as primary interface | NOT_STARTED | `fluxgrade-c90.10` through `.14` |
| Stateful running-system simulator | NOT_STARTED | `fluxgrade-c90.7` |
| Separate hidden evaluator | NOT_STARTED | `fluxgrade-c90.8` |
| Midstream requirement or incident updates | NOT_STARTED | `fluxgrade-c90.9`, `.11` |
| Credential-brokered deploy boundary | NOT_STARTED | `fluxgrade-c90.13` |
| Frozen clean submission | NOT_STARTED | `fluxgrade-c90.15` |
| Provenance-aware result report | NOT_STARTED | `fluxgrade-c90.16` |
| Deterministic serious-mission replay | NOT_STARTED | `fluxgrade-c90.17` |
| Real-agent end-to-end playthrough | NOT_STARTED | `fluxgrade-c90.19` |
| Managed remote runtime | NOT_STARTED | `fluxgrade-c90.20`, `.21` |
| Hosted session API and gateway | NOT_STARTED | `fluxgrade-c90.22` |
| Organizations and authorization | NOT_STARTED | `fluxgrade-c90.23` |
| Private challenge releases | NOT_STARTED | `fluxgrade-c90.24` |
| Employer invitations and consent | NOT_STARTED | `fluxgrade-c90.25` |
| Reviewer and appeal workflow | NOT_STARTED | `fluxgrade-c90.26` |
| Billing | NOT_STARTED | `fluxgrade-c90.27` |
| Public seasons, ratings, and rematches | NOT_STARTED | `fluxgrade-c90.28` |
| Signed result verification | NOT_STARTED | `fluxgrade-c90.29` |
| Enterprise identity and retention | NOT_STARTED | `fluxgrade-c90.30` |
| Customer-VPC runtime | NOT_STARTED | `fluxgrade-c90.31` |
| Fully private deployment | NOT_STARTED | `fluxgrade-c90.32` |
| Calibration and validity evidence | NOT_STARTED | `fluxgrade-c90.33` |

## Current blockers

1. **The core interaction loop is unproven.** No person has completed a real repository mission through their normal agent because that mission runtime does not exist.
2. **The hosting backend is not selected.** Vendor isolation, networking, lifecycle, regions, private deployment, and real cost must be verified through the shared conformance bakeoff rather than assumed from marketing.
3. **The assessment signal is unvalidated.** There is no evidence yet for variant equivalence, reviewer consistency, candidate discrimination, adverse impact, or employer usefulness.
4. **The current repository architecture is still a static game plus foundational contracts and one candidate seed.** The candidate archive is real and independently runnable, but no durable API, workers, database, object storage, CLI, sidecar, gateway, evaluator, stateful mission runtime, or real provider implementation exists.
5. **Private deployment is only an architectural boundary.** There is no Terraform, Helm, outbound runner, customer-cloud proof, upgrade path, or disconnected installation.

## Would completing every current bead close the gap?

Mostly at the implementation level, but not automatically at the product-validity level.

The graph now covers the serious local mission, hosted runtime, SaaS control plane, public arena, private challenge workflow, signed results, customer-VPC data plane, full private deployment, and calibration pipeline. If every bead were implemented and closed with the evidence it requires, Fluxgrade would materially deliver the architecture.

However, implementation alone cannot guarantee:

- that engineers want to replay the mission;
- that employers trust and pay for the report;
- that private challenge variants are equivalent;
- that results predict job performance;
- that the platform has acceptable adverse-impact characteristics;
- that the selected sandbox is secure enough for the actual threat model;
- that a customer accepts the private deployment operational model.

Those claims require real playtests, pilot data, design partners, security review, and explicit kill criteria. The Beads graph includes those proving activities, but their outcomes cannot be predetermined.

## Beads and BVR findings

The implementation plan was converted into one epic and 34 self-contained child beads, including this publication and verification task. Dependencies were added with `br` and analyzed using the requested `bvr` binary in robot mode.

Observed graph state after reality-check remediation:

- no dependency cycles;
- first recommended bead: `fluxgrade-c90.1`, freeze current trailer behavior;
- the original graph had no explicit calibration/validity bead;
- `fluxgrade-c90.33` was added to cover variant equivalence, reviewer consistency, discrimination, adverse impact, employer usefulness, and pilot kill criteria;
- private invitations and reviewer reports now depend on the calibration pipeline.

## Correct critical path

1. Freeze the trailer.
2. Establish workspace tooling and contracts.
3. Build one real local mission.
4. Prove the mission through three real-agent playthroughs.
5. Run the runtime-provider bakeoff.
6. Move the unchanged protocol to remote hosting.
7. Add the minimum session API.
8. Only then add employer administration, billing, rankings, and enterprise deployment.

## Claims allowed today

Accurate:

> Fluxgrade currently has a playable trailer and a complete agent-first product architecture. The serious repository mission runtime is the next implementation milestone.

Not accurate:

> Fluxgrade currently runs real AI-native assessments, produces verified hiring signals, or supports private deployment.

## Next gate

The next shipped proof is not a dashboard or account system. It is one end-to-end `checkout-latency` mission completed through a normal coding agent with:

- a real local repository;
- a running stateful system;
- a credential-brokered deployment;
- a durable midstream event;
- a clean hidden evaluation;
- an evidence report;
- replay after teardown.

Until that works, the browser game remains the only running product artifact.
