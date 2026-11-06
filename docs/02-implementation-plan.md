# Implementation plan: AI image creation and the designer branch

> Written: 2026-11-06 · Based on the approved [01-ai-and-designer-design.md](01-ai-and-designer-design.md).
> The thesis deadline is unknown, so phases are ordered by risk and dependency, without dates. All features are in scope.

## 1. Approach

- Build this part alone on the agreed stack, and connect it to Person 1 and Person 2 later.
- Test the riskiest unknown first: whether Nano Banana keeps one product across views.
- Keep every outside dependency behind a small interface, with a local stand-in.
- Finish each phase as something that runs and can be shown, before starting the next.
- Split each phase into small steps. Do one step at a time and stop for the owner's review before the next (owner's rule, 2026-11-06).

## 2. Project setup

The owner approved these on 2026-11-06.

| Topic | Proposal | Why |
|---|---|---|
| Repo | `git init` in this folder | Nothing is under version control yet |
| Layout | pnpm workspace with `apps/web` (Next.js) and `apps/api` (NestJS) | One repo to run and demo; easy to move modules into the team project |
| Local services | Docker Compose with PostgreSQL, Redis and MinIO (Chainguard image, because `minio/minio` can no longer be pulled) | MinIO speaks the S3 API, so real file storage can replace it through config |
| Backend modules | `design`, `ai`, `task`, `telegram`, `chat`, plus stand-ins in `integrations` | Matches the module-per-owner plan, so they can be copied into the shared backend |
| Tests | Jest in the API (ESM mode, because NestJS 12 ships ES modules only), one Playwright happy path across the app | Jest is the NestJS default |

### Stand-ins

| Interface | Stand-in now | Replaced by |
|---|---|---|
| Current user and role | Dev login with seeded customer, designer and manager | Person 1's guards |
| Product and specs | Seeded 3 shirt types | Person 1's catalog |
| File storage | Local module on MinIO, with the planned upload-url and download-url shape, plus `POST /files/:id/complete` to check the real file after upload | Person 2's file service |
| Locked product output | A read endpoint returning the locked product | Person 1's order step |
| Image API | Fake provider returning sample images, plus the real Nano Banana provider | Stays; the fake is kept for tests |
| Telegram | Fake sender in tests, real bot in development | Stays |

## 3. Phases

Status: ⬜ not started · 🟨 in progress · ✅ done

### ✅ Phase 0 — Nano Banana trial (throwaway)
Done 2026-11-06. The owner chose **Nano Banana 2** (`gemini-3.1-flash-image`), with a Google AI Studio key and billing on (the free tier allows 0 image requests).

Findings from one run per shirt type (images in the git-ignored `trial/output/`; the throwaway script was removed after phase 4):
- Views keep one product, and Vietnamese text is correct once each text is listed with its spelling.
- Descriptions in [square brackets] are drawn, not printed.
- Nano Banana (`gemini-2.5-flash-image`) with the earlier prompt lost accents in small text.
- The close-up of the printed shirt added a second line of text, which breaks "same product". The owner chose to keep AI redrawing the close-up (2026-11-06), with a stricter prompt in phase 4.
- Open prompt tuning: stripes come out tone on tone, and close-ups should frame the logo more tightly.
- Open: a white collar did not carry to the back on one real run, and one logo close-up came out tilted; the customer rejects and regenerates those.
- Open: the model puts the logo on the right of the image even when the wearer's right chest is chosen, and an edit asking to move it did nothing. Exact placement stays in the handover data.

### ✅ Phase 1 — Project skeleton
- Repo, workspace, Docker Compose, Prisma, base API and web app.
- Stand-ins for user, products and files. Socket.IO gateway with authenticated connections.

Steps (the owner reviews each one before the next):
- ✅ 1.1 Repo, pnpm workspace, Docker Compose with PostgreSQL, Redis and MinIO running
- ✅ 1.2 Base NestJS API with a health endpoint that checks the 3 services
- ✅ 1.3 Prisma schema, first migration, seeded customer, designer and manager
- ✅ 1.4 Dev login stand-in, guards and current user
- ✅ 1.5 File stand-in on MinIO: upload URL, download URL, permission check
- ✅ 1.6 Socket.IO gateway with authenticated connections
- ✅ 1.7 Next.js web app: login screen, upload and view an image
- ✅ 1.8 One command starts everything; run the "Done when" check

**Done when:** one command starts everything, a seeded user can log in, and an image can be uploaded and viewed.

### ✅ Phase 2 — Question set and design session
- Question configuration for the 3 shirt types, the question screen, optional uploads, saved answers.
- Prompt builder from answers and specs.

Steps (the owner reviews each one before the next):
- ✅ 2.1 Catalog stand-in: the 3 shirt types with their colours, materials and sizes, behind an interface
- ✅ 2.2 Question configuration for the 3 shirt types, in a config file (owner's choice), served by the API
- ✅ 2.3 Design session: table, create and read, with a snapshot of the chosen specs
- ✅ 2.4 Save answers: check them against the configuration, attach uploaded images
- ✅ 2.5 Prompt builder from answers and specs, unit-tested per shirt type
- ✅ 2.6 Web: choose shirt and specs screen (stand-in for Person 1's step)
- ✅ 2.7 Web: question screen with uploads and saved answers
- ✅ 2.8 Run the "Done when" check in a real browser

**Done when:** a customer answers the questions and a session stores them; prompt builder is unit-tested per shirt type.

### ✅ Phase 3 — AI image creation
- `ImageProvider` interface, fake and Nano Banana providers, called only from the backend.
- BullMQ job with retries, job records with result, error and cost.
- Versions, edit box, version history, daily limit of 20, live status over Socket.IO.

Steps (the owner reviews each one before the next):
- ✅ 3.1 `ImageProvider` interface, fake provider, Nano Banana 2 provider, chosen by config
- ✅ 3.2 Backend file storage: save generated images, read customer uploads to send to the API
- ✅ 3.3 Design version and AI job tables
- ✅ 3.4 BullMQ queue and worker with retries, recording result, error, cost and duration
- ✅ 3.5 Create the first image from a session, with the daily limit of 20
- ✅ 3.6 Edit requests, new versions and version history
- ✅ 3.7 Live status over Socket.IO
- ✅ 3.8 Web: generating state, image, edit box, version history, limit message
- ✅ 3.9 Run the "Done when" check, with the fake provider and once with the real one

**Done when:** a customer creates and edits images end to end; a failed job reports to the customer and does not use up the limit; the limit is enforced.

### ✅ Phase 4 — Views and locking
- Mark the main image as the front view, generate the back and logo close-up.
- Approve or regenerate each view alone, up to 2 extra views, lock when the 3 required views are approved.
- Locked product read endpoint with images, answers and uploads.

Steps (the owner reviews each one before the next):
- ✅ 4.1 Product view table; the customer picks the OK image as the main front view
- ✅ 4.2 Prompts for the back and close-up views, checked with real images
- ✅ 4.3 Generate the back and close-up through the queue, counted against the limit
- ✅ 4.4 Approve a view, or regenerate it alone without touching approved views
- ✅ 4.5 Up to 2 extra views, chosen by typing what to show
- ✅ 4.6 Lock the product once the 3 required views are approved
- ✅ 4.7 Locked product read endpoint with images, answers and uploads
- ✅ 4.8 Web: views screen, approval, extra views, lock button
- ✅ 4.9 Run the "Done when" check, with the fake provider and once with the real one

**Done when:** the full AI branch runs from questions to a locked product, with the fake provider in tests and the real one in a demo.

### ✅ Phase 5 — Tasks and dispatch
- Offer "continue with AI or need a designer?" once an AI image exists.
- Task creation, queue, designer states (Free, Busy, Paused), working hours in Vietnam time.
- Atomic claim, and dispatch on creation, at 9:00 and when a designer becomes free.

Steps (the owner reviews each one before the next):
- ✅ 5.1 Designer profiles with Free, Busy and Paused, and a second seeded designer
- ✅ 5.2 Task table and task creation with requirements, the AI image and the answers
- ✅ 5.3 While waiting for a designer, block AI edits in that session
- ✅ 5.4 Working hours 9:00 to 17:00 Vietnam time, tested with a fixed clock
- ✅ 5.5 Dispatch to free designers, oldest task first, behind a notice interface with a fake sender
- ✅ 5.6 Dispatch triggers: on creation, at 9:00, and when a designer becomes free
- ✅ 5.7 Atomic claim, with concurrent claims tested on real PostgreSQL
- ✅ 5.8 Web: AI-or-designer choice, requirement form, "Finding a designer" state
- ✅ 5.9 Run the "Done when" check

**Done when:** a test runs concurrent claims against real PostgreSQL and exactly one wins; out-of-hours tasks wait until 9:00, tested with a fixed clock.

### ✅ Phase 6 — Telegram
- Bot, one-time-code account linking, "Take task" messages sent through BullMQ with retries.
- Button handling, rejection reasons, "already taken" edits to others' messages.

Steps (the owner reviews each one before the next):
- ✅ 6.1 Bot connection by long polling (owner's choice), chosen by config, with the fake sender kept for tests
- ✅ 6.2 One-time-code account linking, with a link button in a small designer page
- ✅ 6.3 "Take task" messages through BullMQ with retries, and message ids stored
- ✅ 6.4 Button handling, using the atomic claim, with rejection reasons
- ✅ 6.5 Change other designers' messages to "already taken"
- 🟨 6.6 Check with 2 real linked accounts: deferred by the owner on 2026-11-06, who will run it later. A test covers it with real handlers, claim and PostgreSQL, and a fake Telegram. One real account has claimed a task; the second account and the real message edit are not verified.

**Done when:** with 2 real linked Telegram accounts, the first press wins, the second is rejected, and messages update.

### ✅ Phase 7 — Chat and completion
- Designer area on the web, chat with stored messages and files, sample images in chat.
- "Agree" button, final with required back content, "Done" button with its conditions.
- Hand the main image to the views step, with the designer's back content.

Owner's choices (2026-11-06):
- Chat files are PNG, JPG and PDF, at most 10 MB.
- "Done" moves the session to the views step at once and starts the back and close-up, counted against the customer's daily limit.
- The final becomes an approved front view, with no second approval by the customer.
- A designer's back image goes to AI as a reference, and AI draws the back.
- "Agree" works on any sample and belongs to that sample. A new sample cancels it. The final needs a standing "Agree" and can be re-sent until "Done"; the newest counts.
- Messages are sent by REST and received live over Socket.IO.
- The task module checks file permission, then asks `FilesPort` for the link through a new method. This needs Person 2's agreement in phase 10.
- `/designer` holds state, Telegram, the current task and past tasks. `/designer/tasks/[id]` holds the customer's information and the chat.
- After a claim the bot sends a link to the task page. A customer's message sends a Telegram notice, at most once per 10 minutes per task.

Steps (the owner reviews each one before the next):
- ✅ 7.1 Task message table, task fields for the agreed sample, final and back content, and a finished task status
- ✅ 7.2 File and session access: a designer reads the files of their task, and both sides read chat files
- ✅ 7.3 Designer task API: current task, past tasks, and one task with its requirement, AI image, answers and uploads
- ✅ 7.4 Chat API: stored messages and files, only for the task's two people, pushed live over Socket.IO, with the Telegram notice for customer messages
- ✅ 7.5 Sample images in chat and the customer's "Agree" button
- ✅ 7.6 The final: one main image, with a required back description or back image
- ✅ 7.7 "Done" with its conditions: the task ends, the designer returns to Free, and the queue is checked
- ✅ 7.8 Hand over to the views step: the final becomes the front view, and the back uses the designer's content
- ✅ 7.9 Web: designer area, with the task list and the task page, and the bot's link to it after a claim
- ✅ 7.10 Web: one chat component for both sides, replacing the customer's "designer took it" panel
- ✅ 7.11 Web: "Agree", the final form and "Done", then on to the views screen
- ✅ 7.12 Playwright happy path, then the "Done when" check in a real browser

**Done when:** the full designer branch runs from task to a locked product, and a Playwright test covers the happy path.

Done 2026-11-06. `pnpm test:e2e` runs the path in Chromium on its own API and web, with the bot off and fake images. The task is claimed through the `dev-claim` route, because a browser cannot press the Telegram button. Not verified: the bot's link after a real claim, a real Telegram notice for a customer message, and a real image of a back made from designer content.

### ⬜ Phase 8 — Exceptions
- Customer notices when nobody takes a task, daily re-send, cancel after 48 hours.
- 24-hour silence alert, designer closes a task when the customer is silent.
- Choosing a designer at the view step: new task naming the view, the designer's image replaces it.

**Done when:** each rule has a test with a fixed clock, and no path leaves a designer stuck in Busy.

### ⬜ Phase 9 — Manager tools and statistics
- Designer list and states, Telegram links, slow tasks, cancel, return to queue with chat kept.
- Designer and task statistics endpoint for Person 1's dashboard.
- Per-generation data for Person 2's AI statistics.

**Done when:** a manager can resolve a stuck task from the UI, and both data endpoints return real figures.

### ⬜ Phase 10 — Connect to the team
- Agree and write down the API contracts with Person 1 and Person 2. Start this earlier if their code appears.
- Swap stand-ins for real login, catalog, file service and order step.
- Merge modules and Prisma models into the shared project.

**Done when:** one order goes from choosing a shirt to the manager's call in the shared project.

## 4. Data outline

Names are not final. The builder decides fields.

| Area | Holds |
|---|---|
| Design session | Customer, product and spec snapshot, answers, status |
| Design version | Image file, prompt, source (AI or designer), parent version |
| AI job | Status, model, error, cost, duration |
| Product view | Session, view type, chosen version, approval state |
| Locked product | Session, its views, lock time |
| Designer profile | User, state, Telegram link |
| Task | Session, requirement, state, assigned designer, target view if any, back content |
| Task message | Task, sender, text, file |
| Telegram notice | Task, designer, message id, so sent messages can be edited |

## 5. Scope

All features in the design are required. The owner decided on 2026-11-06 that nothing is cut, even if time runs short.

## 6. Needed from the owner

| Item | Needed by |
|---|---|
| OK on the project setup in section 2 | Given 2026-11-06 |
| Thesis deadline | Any time, to plan the pace |

Keys go in a local `.env` file that is never committed.
