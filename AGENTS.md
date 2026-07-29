# Fluxgrade contributor notes

- This repository is a dependency-light static web application.
- Preserve relative asset URLs so GitHub Pages can serve the project at
  `/fluxgrade/`.
- Keep scoring and mission transitions in `src/game-engine.js`; DOM behavior
  belongs in `src/app.js`.
- Every scored decision needs deterministic unit coverage.
- Run `npm test` and `npm run test:e2e` before publishing.
- The current agent is explicitly a simulation. Do not imply that player input
  is sent to a real model unless a real, consented backend is added.
