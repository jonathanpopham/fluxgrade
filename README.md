# Fluxgrade

Fluxgrade is a playable MVP for competitive, AI-native software engineering
missions. Instead of solving a static coding puzzle, the player directs a
simulated coding agent through a production incident, responds to a changing
requirement, and earns a replayable score.

The MVP is deliberately static and client-side:

- no account is required;
- no prompts or code leave the browser;
- the latest result is saved in `localStorage` and compared with a clearly
  labeled seeded leaderboard;
- the agent and production system are deterministic simulations.

This isolates the product question: is the reactive mission loop fun enough
that engineers want to replay it and compete?

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm serve
```

Open <http://127.0.0.1:4173>.

## Verify

```bash
pnpm check
```

The production site is published with GitHub Pages at
<https://jonathanpopham.com/fluxgrade/>.
