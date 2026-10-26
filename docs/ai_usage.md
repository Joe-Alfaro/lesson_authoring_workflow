# How AI was used to build this

The project was built by AI coding agents (Claude Code sessions on Claude Opus-class models)
directed by one human owner. This note says how the work was split, where people and agents
checked it, and how LLM spend was kept in bounds (R33).

## Sessions and roles

An agent orchestrator ran a tree of sessions, each in its own git worktree and branch:

- **A technical lead session** turned the brief into the stack and design decisions (with
  alternatives and tradeoffs, kept in a decisions log) and answered escalations.
- **An orchestrator (project manager) session** wrote the requirements with done checks
  (`docs/requirements/lesson-authoring.md`), split the milestones into tasks, wrote each worker's
  brief, reviewed their decisions, merged validated branches and tracked spend. It didn't write
  feature code.
- **Specialised worker sessions**, one task each:
  - a **research** worker read a handful of public example lessons to derive the lesson schema
    and the prompt's style guide (notes only; no example text in the repo);
  - a **data** worker extracted the standards reference data from the official PDFs with a
    reproducible script;
  - a **designer** wrote the style guide, the screen spec and 38 HTML mockups
    (`docs/design/`) before any UI was built;
  - **test agents** wrote the failing tests and the module contract (the `src/*/README.md` files)
    for each requirement area first;
  - **implementers** (backend, frontend, deploy) made those tests pass without changing them,
    except for test edits the orchestrator approved and recorded;
  - **fresh validators**, started with no access to the private working notes, checked each
    milestone against the requirements' done checks by running the app, and reported gaps that
    went back to the implementer;
  - a **load** worker wrote and ran the R28/R29 scripts, and this documentation was written by a
    technical-writer worker.

The same model wrote the generation prompt template, the per-lesson-type guidance and the
assist prompts, from the research notes and the measured failures of real test runs (for example
the post-processing rules in `src/generation/post_process.ts` came from slips seen in those
runs).

## Gates

Automated, on every branch before merge:

- `npm run check`: format, lint, type check, unit, component and integration tests (against a
  real Postgres), and the scrub check that keeps client-identifying terms out of tracked files.
- `npm run test:e2e`: Playwright against the real app with a fake model, including axe
  accessibility checks on every page with a form.
- `npm run docker:smoke` for the production image, and the load scripts for R28/R29.

Human gates: the owner approved the requirements, the stack, the build, the hosted demo and the
spend cap before work started on each. Agents were not allowed to create external resources,
push, or spend beyond their task's allowance; the hosting project and its secrets were set up
only after the owner's approval.

Checked by reading or by eye rather than by tests (by the lead and orchestrator sessions, with the
owner deciding on anything escalated):

- the mockups, approved before UI work began; end-to-end runs save a screenshot of each mockup
  state for comparison (no pixel diffs);
- generated lesson quality, by reading lessons from the few real-model runs, which led to the
  prompt and post-processing changes above;
- each validator's report and each implementer's decisions before merging;
- the hosted deployment, walked through with the post-deploy checklist in `docs/deploy.md`.

## LLM spend

- A hard budget for the whole project, with a small share for development on the low-cost
  (Haiku-class) model and the rest reserved for a full-unit run and the hosted demo.
- **No test calls a real model.** Unit and integration tests use an in-process fake client; the
  end-to-end, smoke and load runs use a stand-in Anthropic API reached through
  `ANTHROPIC_BASE_URL`, so the real adapter runs but nothing reaches Anthropic.
- Real calls were allowed only when a task said so, on the low-cost model, for a stated number
  of lessons (at most three without explicit approval), and each was logged with model, tokens and
  cost.
- The app enforces the same discipline at run time: per-run and global caps stored in the
  database (R12), and a low cap on the hosted demo.
