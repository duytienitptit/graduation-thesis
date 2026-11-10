# Team integration: AI image creation and the designer branch

> Written 2026-11-10 for Persons 1 and 2, and for the AI assistants they work with. Source: https://github.com/duytienitptit/graduation-thesis (branch `main`).
> For an explained, diagram-based version for people, read [04-team-overview-diagrams.md](04-team-overview-diagrams.md) (Vietnamese).
> Design source of truth: [01-ai-and-designer-design.md](01-ai-and-designer-design.md). Build order and status: [02-implementation-plan.md](02-implementation-plan.md).

## 1. Scope and status

This part takes a customer from a need to a **locked product with at least 3 images** (front, back, logo close-up), through AI or with a real designer reached by Telegram. Phases 0 to 8 are done:

- Question set for 3 shirt types (`PRINTED`, `FOOTBALL`, `VOLLEYBALL`), saved answers, reference uploads.
- AI image creation and editing (Google Nano Banana 2, `gemini-3.1-flash-image`) through a BullMQ queue, with a limit of 20 images per account per Vietnam day.
- Views from the main image; approve or regenerate each view; lock the product.
- Designer branch: task, Telegram notice to free designers, atomic claim, web chat, samples, "Agree", final with required back content, "Done", then the views step.
- Exceptions: a customer notice after 2 working hours untaken, customer cancel after 48 hours untaken, a manager alert after 24 hours of designer silence, the designer closing a task with a reason, a task for one view.
- 270 API tests (Jest, real PostgreSQL, Redis and MinIO) and 3 Playwright tests.

Not built: phase 9 (manager screens, statistics endpoints for Person 1's dashboard and Person 2's AI statistics) and phase 10 (integration; this document starts it).

## 2. Running it

Requires Node 24 (the version used in development), pnpm and Docker Desktop.

```bash
git clone https://github.com/duytienitptit/graduation-thesis.git
cd graduation-thesis
pnpm install
pnpm dev
```

- `pnpm dev` copies `.env.example` to `.env` if missing, starts PostgreSQL (5433), Redis (6379) and MinIO (9000, console 9001), applies migrations, seeds users, and runs the API on 4000 and the web app on 3000.
- `IMAGE_PROVIDER=fake` is the default and costs nothing. `IMAGE_PROVIDER=nano-banana` with `GEMINI_API_KEY` calls Google, about $0.067 per image.
- The Telegram bot is off by default. `TELEGRAM_ENABLED=true` with `TELEGRAM_BOT_TOKEN` runs it by long polling; only one running copy per token.
- Stand-in logins, no password: `khach@example.test` (customer), `designer@example.test`, `designer2@example.test` (designers), `quanli@example.test` (manager).
- `pnpm test` runs the API tests; `pnpm test:e2e` runs Playwright on its own API (4100) and web (3100) after `pnpm exec playwright install chromium` once. Both need the Docker services up.
- Keys go only in `.env`, which is git-ignored.

## 3. Code layout

```
apps/api            NestJS 12, ES modules (relative imports end in .js), Prisma 7, BullMQ, Socket.IO
  src/design        sessions, question sets, prompts, images, views, locking, "Done" (task-completion.controller.ts)
  src/ai            ImageProvider (fake, nano-banana), image queue and worker
  src/task          tasks, designers, dispatch, 9:00 and 10-minute schedulers, access checks, task checks
  src/chat          messages, samples, "Agree", final
  src/telegram      bot, account linking, notice worker
  src/realtime      shared Socket.IO gateway (RealtimeGateway.emitToUser)
  src/integrations  stand-ins for Persons 1 and 2: auth, catalog, files
  prisma/           schema.prisma and migrations
apps/web            Next.js 16, Tailwind, shadcn/ui; product UI in Vietnamese
e2e/                Playwright tests and their test data
```

## 4. Integration points

Persons 1 and 2's parts are stand-ins behind abstract classes in `apps/api/src/integrations/`. To integrate, provide a real implementation for the same Nest token. No other module imports the stand-ins directly.

### 4.1 Person 1: login and roles

`integrations/auth/auth.port.ts`:

```ts
interface AuthUser { id: string; email: string; name: string; role: 'CUSTOMER' | 'DESIGNER' | 'MANAGER' }
abstract class AuthPort {
  abstract verifyToken(token: string): Promise<AuthUser | null>;
}
```

- A global `AuthGuard` requires login on every route except those marked `@Public()`. HTTP sends `Authorization: Bearer <token>`; Socket.IO sends the token in `auth.token`.
- `@Roles(Role.X)` limits by role; `@CurrentUser()` reads the user (`auth.decorators.ts`).
- The stand-in `DevAuthService` signs JWTs with `AUTH_JWT_SECRET` and serves `POST /auth/dev-login`, `GET /auth/dev-users` and `GET /auth/me`. `POST /tasks/:id/dev-claim` (used by Playwright instead of the Telegram button) is refused when `NODE_ENV=production`.
- The `User` table is a stand-in. This part reads only `id`, `email`, `name` and `role`, and relates to `User` from `DesignSession`, `AiJob`, `Task`, `TaskMessage`, `DesignerProfile` and `FileObject`.

### 4.2 Person 1: product catalog

`integrations/catalog/catalog.port.ts`:

```ts
interface Product {
  id: string;
  name: string;
  shirtType: 'PRINTED' | 'FOOTBALL' | 'VOLLEYBALL'; // selects the question set; the real catalog needs it
  colours: { id: string; name: string; hex: string }[];
  materials: { id: string; name: string }[];
  sizes: string[];
}
abstract class CatalogPort {
  abstract listProducts(): Promise<Product[]>;
  abstract getProduct(id: string): Promise<Product | null>;
}
```

`POST /design/sessions` stores a snapshot of the product and chosen specs in `DesignSession.specSnapshot`, so catalog changes never alter an existing session.

### 4.3 Person 2: file service

`integrations/files/files.port.ts`; stand-in `MinioFilesService` on MinIO (S3 API). Files go from the browser straight to storage by a signed URL.

| Method | Purpose | Status |
|---|---|---|
| `createUpload(user, { mimeType, size, purpose })` | Signed upload URL and a `PENDING` file row | In the original plan |
| `completeUpload(user, fileId)` | Checks the stored bytes (magic number, ≤ 10 MB), deletes bad files, marks `READY` | New: needs agreement |
| `getDownloadLink(user, fileId)` | Expiring link; owner or manager only | In the original plan |
| `getLink(fileId)` | Expiring link after the caller checked permission (designer reading a task's files, customer reading designer images) | New: needs agreement |
| `saveImage(ownerId, image)` | Backend stores an AI result | New: needs agreement |
| `readImage(fileId)` | Backend reads bytes to send to the image API | New: needs agreement |
| `ownsReadyFiles(user, fileIds, mimeTypes?)` | All files are `READY`, owned by the user, and of these types (default PNG, JPG) | New: needs agreement |

- Types: PNG and JPG everywhere; PDF only with `purpose = CHAT`, because other files can reach the image API.
- `purpose`: `AI_IMAGE` (backend only), `REFERENCE`, `CHAT`, `FINAL_DESIGN`.
- The `FileObject` table is a stand-in for Person 2's table.

### 4.4 Person 2: data for AI statistics

Every image request is one `AiJob` row: `kind` (`CREATE`, `EDIT`, `VIEW`), `status` (`QUEUED`, `RUNNING`, `DONE`, `FAILED`), `model`, `error`, `costUsd`, `durationMs`, `attempts`, `createdAt`, `finishedAt`, `customerId`, `sessionId`. Failed jobs do not count against the daily limit. **No endpoint serves these figures yet (phase 9)**; the format needs agreement.

### 4.5 Person 1: the locked product

`GET /design/locked-products/:id` (the customer who owns it, or a manager) returns one format for both branches:

```json
{
  "id": "uuid", "sessionId": "uuid", "customerId": "uuid", "lockedAt": "ISO date",
  "source": "AI | DESIGNER",
  "product": { "product": { "id": "", "name": "", "shirtType": "" }, "colour": {}, "material": {}, "size": "M", "quantity": 2 },
  "answers": { "question_id": "answer or file ids" },
  "views": [{ "type": "FRONT | BACK | CLOSE_UP | EXTRA", "position": 0, "description": null,
              "source": "AI | DESIGNER", "fileId": "uuid", "imageUrl": "expiring URL" }],
  "uploads": [{ "fileId": "uuid", "url": "expiring URL" }]
}
```

- `source` at the top is the front view's source. Each view has its own, since a designer can redo one view.
- Images are product pictures, not print files. Exact text, numbers and the original logo are only in `answers` and `uploads`.
- Changing size or quantity does not affect the design. Changing shirt type, colour or material needs a new session (Q9, needs Person 1's agreement).
- **Open:** does this part call Person 1's order step on lock, or does Person 1 read this endpoint?

### 4.6 Person 1: dashboard figures

Designer and task figures (waiting, assigned, done, time to take) are phase 9. The format needs agreement.

## 5. Socket.IO

One gateway (`RealtimeGateway`); a connection joins room `user:<id>` after the token check. All events are nudges or full payloads per user; clients reload state on `connect`, so a missed event loses nothing. This part proposes owning the shared gateway, since chat and image results are its heaviest users; **the whole team must agree (Q10)**.

| Event | Sent to | Payload |
|---|---|---|
| `design.image-job` | Customer | `{ jobId, sessionId, status }` |
| `design.task` | Customer and the task's designer | `{ sessionId, taskId }` |
| `task.message` | Customer and the task's designer | The full message, as from `GET /tasks/:id/messages` |
| `task.alert` | Every manager | `{ taskId, kind: 'designer-silent', since }` |

## 6. Routes

All need login except `GET /health`. Role limits in parentheses; `:id` is a UUID.

Design:
- `GET /design/products/:productId/questions`
- `POST /design/sessions` (customer); `GET /design/sessions` (customer); `GET /design/sessions/:id`
- `PUT /design/sessions/:id/answers`, `POST /design/sessions/:id/answers/submit` (customer)
- `POST /design/sessions/:id/images`, `POST /design/sessions/:id/edits` (customer)
- `GET /design/sessions/:id/workspace`: everything the design screen needs, including the latest whole-shirt task and each view's latest task
- `POST /design/sessions/:id/main-image` (customer)
- `POST /design/sessions/:id/views/:viewId/generate | regenerate | approve`, `POST /design/sessions/:id/views`, `POST /design/sessions/:id/lock` (customer)
- `GET /design/locked-products/:id`

Tasks and chat:
- `POST /design/sessions/:id/tasks` (customer): whole-shirt task
- `POST /design/sessions/:id/views/:viewId/tasks` (customer): view task
- `GET /tasks/:id`, `GET /tasks/:id/messages`: the task's customer, its designer, or a manager
- `POST /tasks/:id/messages`: the task's customer or designer
- `POST /tasks/:id/samples`, `/final`, `/done`, `/close` (designer)
- `POST /tasks/:id/agree`, `/cancel` (customer)
- `GET /designers/me`, `GET /designers/me/tasks`, `POST /designers/me/telegram-link` (designer)

Stand-ins: `POST /files/upload-url`, `POST /files/:id/complete`, `GET /files/:id/download-url`; `GET /catalog/products`, `GET /catalog/products/:id`.

Errors with a `code` in the body: `daily-limit` (429), `not-agreed`, `not-ready`, `too-early`, `not-waiting`, `front-view`, `view-approved`, `view-with-designer` (409), `back-required` (400).

## 7. Rules other parts must not break

- **Session status** (`DesignSession.status`): `ANSWERING` → `ANSWERED` (answers submitted) → `VIEWS` (main image chosen, or a whole-shirt task done) → `LOCKED`. A whole-shirt task moves `ANSWERED` → `DESIGNER`; cancel or close moves it back to `ANSWERED`. View tasks never change the session status.
- **Task status**: `WAITING` → `ASSIGNED` (claim) → `DONE` or `CLOSED`; `WAITING` → `CANCELLED` (customer, after 48 hours).
- **Designer state**: `FREE`, `BUSY`, `PAUSED`. The claim sets `BUSY` and assigns the task in one transaction with conditional updates, so two designers never get one task. `DONE` and `CLOSED` set `BUSY` back to `FREE` in the same transaction that ends the task; a `PAUSED` designer stays paused.
- A designer sees a task's files only through this part's own checks, then `FilesPort.getLink`.
- Working hours are 9:00 to 17:00 Vietnam time, every day; they limit sending, not taking. A scheduler re-sends waiting tasks at 9:00, and task checks run every 10 minutes.
- Tests share the dev database: they create users on their own `*.test` domains, use their own queue prefix, and clean up.

## 8. Suggested integration path

There is no shared project yet. A proposal for the team:

1. Choose one repository. This one can be the base, since it has the workspace, Docker services and tests; Persons 1 and 2 add their modules under `apps/api/src`.
2. Merge the Prisma schemas. Keep this part's tables: `DesignSession`, `DesignVersion`, `AiJob`, `ProductView`, `LockedProduct`, `DesignerProfile`, `Task`, `TaskMessage`, `TaskNotice`, `TelegramLinkCode`. Replace `User` and `FileObject` with the real tables, keeping the column names or updating the relations.
3. Replace one stand-in at a time by providing `AuthPort`, `CatalogPort` or `FilesPort`. Run `pnpm test` and `pnpm test:e2e` after each.
4. Settle section 9 before writing integration code.

## 9. Needs the team's agreement

| Item | With |
|---|---|
| New `FilesPort` methods (4.3) and PDF in chat | Person 2 |
| Format of AI statistics data (4.4) | Person 2 |
| Locked product format, and who calls whom at the order step (4.5) | Person 1 |
| `shirtType` in the real catalog (4.2) | Person 1 |
| Format of task and designer figures for the dashboard (4.6) | Person 1 |
| Owner of the shared Socket.IO gateway (Q10) | Whole team |
| Changing shirt type, colour or material needs a new session (Q9) | Person 1 |
| Thesis deadline | Whole team |

## 10. Not verified for real

- Telegram with two real linked accounts: first press wins, the second is refused, messages change to "already taken". Covered by a test with real handlers and PostgreSQL and a fake Telegram.
- Real Telegram messages: the link after a claim, the notice for a customer message, the "cancelled" edit.
- A real back image made from a designer's content with Nano Banana 2.
