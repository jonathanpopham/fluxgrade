# Fluxgrade contributor notes

## Current trailer

- This repository is currently a dependency-light static web application.
- Preserve relative asset URLs so GitHub Pages can serve the project at `/fluxgrade/`.
- Keep scoring and mission transitions in `src/game-engine.js`; DOM behavior belongs in `src/app.js`.
- Every scored decision needs deterministic unit coverage.
- Run `npm test` and `npm run test:e2e` before publishing.
- The current agent is explicitly a simulation. Do not imply that player input is sent to a real model unless a real, consented backend is added.

## Product truth

- Read `GOAL.md`, `README.md`, `docs/PRODUCT_ORIGINS.md`, `docs/ARCHITECTURE.md`, and `docs/REALITY_CHECK.md` before planning substantial work.
- The current browser game is the trailer. The serious product is an agent-first repository mission platform.
- Candidate repositories and running-system outcomes are authoritative. Agent claims are not proof.
- Never commit session credentials. Render secret values as `[REDACTED]` in evidence and documentation.

## Planning and execution

For every nontrivial plan, implementation, refactor, release, or deployment:

1. Initialize or update the Beads graph using `br`.
2. Put the complete plan, acceptance criteria, dependencies, tests, and proof requirements into self-contained beads.
3. Use `bvr` in robot mode to inspect priority, cycles, bottlenecks, and execution tracks. Never run bare `bvr` or silently substitute the interactive TUI.
4. Claim only the bead currently being implemented.
5. Run the reality-check workflow against actual code, tests, deployed state, documentation claims, and bead coverage.
6. Test the real artifact before closing the bead.
7. Flush portable Beads state with `br sync --flush-only`.
8. Commit and push verified work, then verify the remote branch contains the intended commit.

Useful commands:

```bash
br ready --json
br dep cycles
bvr --robot-triage
bvr --robot-next
bvr --robot-plan
bvr --robot-insights
```

## Verification

At minimum, preserve the current trailer gates:

```bash
npm test
npm run test:e2e
```

Do not claim SaaS, real assessments, signed hiring evidence, hosted runtimes, or private deployment until the corresponding implementation bead is exercised end to end.
