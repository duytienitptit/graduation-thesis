# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Phases 0 to 7 of `docs/02-implementation-plan.md` are done, with the real two-account Telegram check deferred to the owner. The repo is a pnpm workspace (`apps/api` and `apps/web`).

- `pnpm install`, then `pnpm dev` starts everything: services, migrations, seed, API on 4000, web on 3000.
- `pnpm services:up` starts PostgreSQL (port 5433), Redis (6379) and MinIO (9000, console 9001); `pnpm services:down` stops them.
- `pnpm --filter api dev` runs the API on port 4000; `GET /health` checks the 3 services.
- `pnpm db:migrate` creates and applies migrations, then run `pnpm --filter api prisma:generate`, because Prisma 7 does not generate during migrate. `pnpm db:seed` adds the seeded users.
- `pnpm --filter web dev` runs the web app on port 3000.
- If `prisma migrate dev` refuses in a non-interactive shell, write the SQL with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` and apply it with `prisma migrate deploy`.
- A killed test run can leave a stray Jest worker and seeded designers set to Busy. Check for both if tests turn flaky.
- `pnpm test` runs the API tests, which need the services up. `pnpm build` builds.
- `pnpm test:e2e` runs the Playwright test on its own API (4100) and web (3100), with the bot off, so it can run beside `pnpm dev`. It needs the services up and `pnpm exec playwright install chromium` once.
- The API is ES modules: relative imports end in `.js`.
- Every API route needs login unless marked `@Public()`. Limit by role with `@Roles()`, and read the user with `@CurrentUser()`.
- Push to a user with `RealtimeGateway.emitToUser`. Socket.IO connections need the token in `auth.token`.
- Tests use their own queue prefix (`apps/api/jest.setup.cjs`), so a running dev worker never takes their jobs.
- `IMAGE_PROVIDER=fake` is the default and costs nothing; `nano-banana` calls Google and costs money.
- `TELEGRAM_ENABLED=true` runs the bot by long polling. One running copy per token.
- Copy `.env.example` to `.env`. Keys go only in `.env`, which is git-ignored.

## Project

Graduation thesis by a 3-person team: a website for ordering custom-printed shirts, designed with AI or with a real designer reached through Telegram. There is no online payment; a manager phones the customer to confirm each order.

Planned stack: Next.js, NestJS, PostgreSQL with Prisma, Redis with BullMQ, Socket.IO, Telegram Bot API, R2 or S3. All three people share one backend and one database.

## Docs

- `docs/01-ai-and-designer-design.md` is the design for this owner's scope. It is approved, and it wins over the overview where they differ.
- `docs/02-implementation-plan.md` is the build order, with status per phase.
- `docs/00-project-overview.md` covers the whole system. Its sections 5 and 6 show the original assignment, which has since changed.
- `docs/diagrams/` holds the Mermaid source diagrams and the overview picture, which has Vietnamese labels. 

## Ownership

The owner of this checkout does Person 3's work plus AI image creation: the question set, image generation and editing, the required views, locking the product, and the designer branch (tasks, queue, Telegram, chat).

- Person 1: login, permissions, products, pricing, orders, dashboard shell.
- Person 2: shared file service and AI statistics.

Person 1 and Person 2 have agreed to this split. There is no shared project yet: build this part alone on the planned stack, with login and files behind replaceable interfaces, and connect it later.

## Working here

- Do not settle architecture, data model, API or scope questions alone. Present options with a recommendation and let the owner decide.
- Write docs in English. The product UI is Vietnamese.
- Follow the phase order in the plan, and update its status as phases finish.
- Split each phase into small steps. Do one step, then stop for the owner's review before the next.
