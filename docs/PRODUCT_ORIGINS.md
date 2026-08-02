# Fluxgrade product origins

This document records the original product intent recovered on 2026-08-01. It separates primary artifacts from later interpretations so future design work does not accidentally turn Fluxgrade into a browser game or generic coding test.

## Primary artifacts

### 1. Original pitch

Source:

`~/.codex/sessions/2026/07/28/rollout-2026-07-28T18-16-34-019faacd-145c-7b52-bd57-5f82faa054b5.jsonl`

The initiating prompt said, in substance:

- LeetCode is obsolete because AI can solve conventional exercises.
- Public challenges should be available for practice.
- Private hosted challenges should produce signed, verified results.
- The interface is an agent prompt.
- Players may bring their own skills.
- Public challenges are sorted by difficulty and users are ranked algorithmically.
- Private problems are not public and may change while the candidate works.

This is the earliest recovered statement of the product. The sentence that matters most is:

> The UI is an agent prompt.

### 2. Original product one-pagers

Recovered local artifacts:

- `~/agentic-engineering-assessment/one-pager.html`
- `~/agentic-engineering-assessment/cofounder-one-pager.html`
- `~/agentic-engineering-assessment/agentic-engineering-assessment-one-pager.html`
- `~/ai-native-assessment-one-pager/index.html`
- `~/ai-native-assessment-one-pager/ai-native-technical-assessment-one-pager.pdf`

The earliest employer-oriented memo defines:

- a realistic unseen backend repository;
- a comparable agent environment;
- a mid-task requirement change;
- hidden behavioral tests;
- a short defense or handoff;
- an evidence-backed, signed employer report;
- three sealed variants and one public practice variant;
- explicit pilot kill criteria around reviewer consistency, variant equivalence, candidate discrimination, manager usefulness, and cost.

A later one-pager sharpened the public/private split:

> Practice happens in public. Hiring evidence is produced in private.

### 3. Published thesis

Sources:

- `~/jonathanpopham.github.io/ai-native-assessment/index.html`
- `https://jonathanpopham.com/ai-native-assessment/`

The published page describes three connected products:

1. Public challenge arena
2. Dynamic private challenge
3. Signed, verified result

It says the platform measures whether an engineer:

- finds the crux;
- uses tools well instead of accepting agent output blindly;
- handles a moving brief;
- ships sturdy code and can defend the tradeoffs.

### 4. Feasibility and architecture ideation

Source session:

`~/.codex/sessions/2026/07/29/rollout-2026-07-29T14-10-09-019faf11-d654-7933-86ea-84da1f2b55b9.jsonl`

The recovered plan identified:

- an evidence-first dynamic assessment engine;
- controlled, open, and practice fairness modes;
- versioned executable challenge kits;
- reviewer evidence reports;
- a calibration and validity pipeline;
- isolated workspaces;
- append-only evidence;
- hidden evaluators;
- signed results;
- public and sealed challenge libraries.

The plan correctly stated that the hard problem is not the IDE or leaderboard. The hard problem is proving that results measure engineering judgment fairly across agents, models, and challenge variants.

### 5. Game-loop and local-stack ideation

Source:

`~/fluxgrade/GAMELOOP_BRAINSTORM_CONTEXT.md`

This is a complete 1,102-line transcript packet containing the original plan, Codility research, competition design, game-loop ideation, trailer build, and local-stack design.

Important conclusions already reached there:

- Fluxgrade should be the referee, not the IDE.
- The real loop uses an unfamiliar system, live consequences, requirement changes, verification, replay, and competition.
- Local-agent play and hosted standardized play are distinct modes.
- Agent behavior is evidence, not an activity contest.
- Scoring should primarily follow system outcomes.
- Public competition drives developer adoption while private assessments monetize the signal.

### 6. Current trailer

Sources:

- `~/fluxgrade`
- `https://jonathanpopham.com/fluxgrade/`
- `https://github.com/jonathanpopham/fluxgrade`

The current static game deliberately tests whether a reactive mission is legible and fun. It is not the intended production interaction model. It uses a deterministic simulated agent, five decisions, local storage, and a seeded leaderboard.

Its proper role is:

- interactive trailer;
- onboarding explanation;
- visual identity reference;
- acquisition artifact.

It should not become the foundation of the serious mission runtime.

## Canonical product intent

Fluxgrade is an agent-first software mission platform. A player receives a real repository and access to a running system, then uses their normal local agent and tools to investigate, change, deploy, and verify that system under evolving conditions. Fluxgrade provisions the environment, introduces events, records evidence, evaluates outcomes, and produces a replayable result.

The primary surfaces are:

1. Agent conversation as the control plane
2. Repository files as shared durable context
3. Tests, telemetry, Git, and deployment state as evidence
4. Running-system consequences as feedback
5. A final evidence report as the result

The website is secondary. It exists for discovery, organization administration, invitations, reports, replays, billing, and public identity. It is not where serious play happens.

## Original product loop

```text
Discover or receive invitation
  -> Claim a versioned mission
  -> Materialize a real repository locally
  -> Connect to an isolated running system
  -> Work through the player's normal agent
  -> Observe real tests and telemetry
  -> Receive a stateful requirement or incident update
  -> Adapt, deploy, and verify
  -> Submit repository state and incident report
  -> Run isolated hidden evaluation
  -> Produce evidence-backed result and replay
  -> Rematch, rank, or inform an employer decision
```

## Two products sharing one engine

### Public arena

- Released practice missions
- Open Stack and standardized competitive divisions
- Ratings, seasons, rivals, replays, and rematches
- Public source may live in this repository under `trials/public/`
- Results are competitive evidence, not employment credentials by default

### Private assessment

- Employer invitations
- Sealed challenge variants
- Explicit model, tool, network, time, and identity policies
- Private mission packages stored outside the public repository
- Hidden evaluation and structured human review
- Retention, appeals, accommodations, and auditable signed reports

## Non-negotiable design principles

1. **The repo is the interface.** Do not build a replacement IDE.
2. **The agent conversation is the primary HCI.** Avoid multiple-choice mechanics and website clicking.
3. **The system answers through consequences.** Do not reveal correctness through decorative UI.
4. **Claims require evidence.** Agent prose cannot establish truth by itself.
5. **The referee stays outside candidate control.** Hidden evaluation and authoritative state never run inside the candidate trust boundary.
6. **Local evidence is attributed, not magically trusted.** The platform distinguishes server-observed, evaluator-observed, and client-reported events.
7. **Public and private content remain separate.** Released missions cannot later be treated as sealed hiring tasks.
8. **Fairness modes are explicit.** A bring-anything run and a standardized hosted run do not share a misleading universal rank.
9. **Results are versioned.** Every result identifies mission, variant, runtime, policy, evaluator, and scoring versions.
10. **Private deployment is architectural, not a later fork.** Control plane, runtime plane, evidence storage, and identity boundaries must be separable from the first implementation.

## Decisions superseded by the current direction

The earlier local-stack design proposed a browser HUD beside the terminal. The current direction supersedes that as the default. Live mission state should be available through the CLI, MCP, repository inbox, and agent adapters. A web view may exist for spectators or optional monitoring, but the player must not need it.

The earlier game prototype used explicit decision cards. Those remain valid only for the trailer. Serious missions are open-ended repositories and running systems.

The earlier architecture emphasized a hosted browser workspace. That remains useful for a controlled Standard League or a customer policy that prohibits local checkout, but it is not the default agent-first experience.
