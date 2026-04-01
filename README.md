# Block Coding Puzzles
A Next.js 16 application that teaches sequencing, loops, and conditionals through a neon pet-clinic story. The UI follows the "frontend skill" guidance: a full-bleed hero poster, restrained typography, and a WebGL stage that mirrors the provided layout reference (Spark on the left, two stepping stones, jelly obstacle, two more stones, and the treat goal).

## Visual + Interaction North Star
- **Visual thesis:** cotton-candy night arcade with magenta/violet glow, glass panels, and sprite-led storytelling.
- **Content plan:** hero poster → level map (exactly three puzzles) → puzzle workspace overlay → analytics/replay surface.
- **Interaction thesis:** workspace slides away/condenses while runs animate, TTS explains goals, and CTAs use rubber-band motion + high-contrast gradients.

## Repository Layout
```
app/                Next.js app router surfaces
  page.tsx         Landing/level map
  (game)/levels/[id]
                     Puzzle runtime + workspace
  (analytics)/analytics
                     Telemetry dashboard
  api/*             Session, event batch, analytics routes
components/        BlockWorkspace, PuzzleExperience, WebGL GameScene, AnalyticsBoard
lib/               blockEngine runtime + telemetry + SQLite helper
data/              Puzzle definitions and block palette metadata
public/assets/     Provided backgrounds and sprites (used verbatim)
scripts/           Seed + verification utilities (tsx)
```
SQLite lives at `tmp/block-coding-puzzles.db` and auto-initializes schema/tables on first import.

## Getting Started
1. **Install:** `npm install` (Node 24.11+, npm 11.6+ per brief).
2. **Develop:** `npm run dev` → `http://localhost:3000`.
3. **Seed / reset DB:** `npm run seed` (syncs puzzle metadata, ensures demo user, and keeps the WAL/foreign-key pragmas active).

## Gameplay Surfaces
- **Landing / Level Map:** glass card hero with CTA to `/levels/1`, plus a "Exactly three pastel puzzles" row. Each puzzle card shows the concept, story, goal, available blocks, and deep link.
- **Block Workspace (client component):**
  - Left palette groups blocks by Movement / Actions / Control / Logic / Sensing.
  - Right column pins the `On Start` stack, supports drag-reorder via `@dnd-kit`, and exposes a "Parking Area" banner for detached blocks (explicit warning: detached blocks do not run).
  - Parameter editing is inline, nested blocks (repeat / conditionals) show chip lists with remove buttons, and a Show Code toggle reveals the generated text form.
- **Controls & Accessibility:** Play, Reset, and speed toggles (Slow/Normal/Fast) are always visible; all buttons are `<button>` elements with focus styles. A text-to-speech button narrates the goal. Keyboard focus order respects the UI layout.
- **Failure feedback:** any incorrect run shows `Oops!` plus the hint from `puzzle.hintMap` (covers target not reached, wrong item, wrong order, obstacle collision, and missing conditionals). Success banners confirm telemetry capture.
- **WebGL scene:** `GameScene` (React Three Fiber + Drei) reassembles the provided layout reference exactly: Spark sprite on the far left, two stepping stones, jelly obstacle midline, two more stones, and the treat at the right edge. Movements interpolate smoothly for both live runs and analytics replays.

## Telemetry, SQLite, and APIs
- **Database schema:** `lib/db.ts` creates `users, sessions, puzzles, attempts, events, movements, puzzle_progress` tables with WAL + foreign keys enabled.
- **Server helpers (`lib/telemetry.ts`):** ensure users/progression, start/end sessions, record attempts (including events + per-step movements), aggregate analytics, and stream replay payloads.
- **API routes:**
  - `POST /api/session/start` → `{ sessionId, userId, puzzleId, startedAt }`.
  - `POST /api/session/end` → updates status/notes and returns the session row.
  - `POST /api/events/batch` → validates payload, writes attempt/events/movements, and responds with counts.
  - `GET /api/analytics/overview` → totals + per-puzzle aggregates.
  - `GET /api/analytics/puzzle?puzzleId=1` → recent attempts with timestamps/speed/outcome.
  - `GET /api/analytics/replay?attemptId=##` → puzzle metadata + stored movement steps for replay.
- **Analytics dashboard (`/analytics`):** overview metrics, per-puzzle attempt list (select to replay), and embedded WebGL scene that reuses the stored steps.

## Verification & Utility Scripts
All scripts run via `tsx` (ESM) and hit the real SQLite file.

| Command | Purpose |
| --- | --- |
| `npm run lint` | Lints the entire repo with `eslint.config.mjs` (Next + custom overrides). |
| `npm run build` | Compiles the Next.js 16 app to ensure the app/router + API routes succeed. |
| `npm run test:logic` | Runs deterministic block-engine programs to prove sequencing, obstacle failure, and the conditional puzzle all behave as expected. |
| `npm run test:telemetry` | Executes a successful run, stores it via `recordAttempt`, and prints aggregate telemetry totals. |
| `npm run verify:runtime` | Simulates a failed run, persists telemetry, and fetches both analytics + replay payloads to make sure analytics dashboards can render stored movements. |
| `npm run seed` | Syncs puzzle definitions into SQLite and provisions a demo user. |

## Implementation Notes
- **Data-driven puzzles:** `data/puzzles.ts` encodes the layout (tile coordinates, assets, hints, success criteria) so future lessons can be added without touching core logic.
- **Block engine:** `lib/blockEngine.ts` compiles connected block trees, enforces max step counts, handles jump collisions, emits per-block events, and exposes `codeFromBlocks` + `MovementStep` data for the UI and telemetry.
- **Telemetry-first architecture:** client sends raw block events + steps to `/api/events/batch`; SQLite persists attempts/events/movements and also unlocks the next puzzle on successful runs.
- **Accessibility:** All primary controls are buttons with focus styles, messages never rely on color alone, and the workspace warns when blocks are detached. Goal narration uses the browser's SpeechSynthesis API (optional text-to-speech requirement).
- **Assets:** The scene strictly uses `/public/assets/backgrounds/background.jpg` plus `/public/assets/sprites/{main_character,place,obstacle,food}.png`, laid out exactly like the `design/layout_refs/layout.png` instructions.

Happy building!
