# Project overview — Custom print ordering system (AI + Designer)

> This document organises the existing information (2 flow diagrams, the technology table, the assignment table).
> The original diagrams are kept in [diagrams/](diagrams/), with Vietnamese versions in [diagrams/vi/](diagrams/vi/).
> Items marked ❓ are **not settled** and need team discussion (collected in section 8).
>
> **Update, 2026-11-06:** [01-ai-and-designer-design.md](01-ai-and-designer-design.md) overrides this document where they differ. In particular, AI image creation moved from Person 2 to Person 3, and the customer now locks a product with 3 required views instead of one image. Sections 5 and 6 below still show the original assignment.
>
> The product UI is in Vietnamese. Button and status names are translated here, for example "Take task" is `Nhận task`, Free is `Rảnh`, Busy is `Bận`.

---

## 1. What does the project do? (30-second summary)

The customer visits the website, **chooses a product** (type, model, material, colour, size, quantity) and sees the estimated price.
The customer then **creates a design** to print on the product in one of two ways:

- **Do it yourself with AI**: describe the idea → AI generates an image → ask AI to edit until satisfied.
- **Hire a real designer**: the system automatically finds a free designer via **Telegram**; the designer takes the job, then chats and sends samples for the customer to approve.

Once the **design is locked**, the customer submits an **order request** (phone number required, **no online payment**).
The **manager** phones the customer to confirm, locks the order, then **hands the file over to production**.

```
Choose product ─▶ Design (AI or Designer) ─▶ Lock design ─▶ Order ─▶ Manager calls to confirm ─▶ Production
```

---

## 2. Roles (actors)

| Role | Who | What they do in the system |
|---|---|---|
| **Customer** | Buyer | Chooses products, designs with AI / chats with a designer, approves samples, submits orders |
| **Designer** | Real designer | Takes tasks via Telegram, chats with customers, sends samples and the final version |
| **Manager** | Admin | Manages accounts, products, prices; calls customers to lock orders; monitors AI and tasks; views the dashboard |
| **Automated system** | Backend | Calls AI to create images, dispatches tasks to designers, sends Telegram messages |
| **Production** | Outside the system | Receives locked orders and production files |

---

## 3. End-to-end business flow (5 stages)

### Stage A — Choose a product
1. The customer chooses a **type** and **model** (catalog configured by the manager).
2. The customer chooses **specs**: material, colour, size… and **quantity**.
3. The system shows the **unit price** and **estimated total** (using pricing rules configured by the manager).

### Stage B — Design (2 branches)

According to both diagrams, the customer **always starts with AI**, then chooses a direction:

```
Customer describes idea ─▶ AI creates sample ─▶ Customer views sample ─┬─ "Edit with AI"        ─▶ back to AI
                                                                       ├─ "Choose AI sample"    ─▶ Lock design (go to C)
                                                                       └─ "Work with a designer" ─▶ Designer branch below
```

**Designer branch** (automatic task dispatch):

| Step | Explanation |
|---|---|
| 1. Create task | The customer creates a task with requirements and a reference sample → the task enters the **queue** |
| 2. Find designer | Is any designer **Free**? No → wait. Yes → send **Telegram** to all free designers |
| 3. Take task | The designer presses **"Take task"**. The system checks: is the task still open *and* is the designer still free? |
| 4a. Success | The **first** presser gets the task → switches to **Busy**; the others' Telegram messages update to "already taken" |
| 4b. Failure | Report the rejection reason (already taken / you are busy) |
| 5. Work | Designer and customer **chat in the system**, the designer sends samples → the customer **approves** or **requests edits** (repeat) |
| 6. Finish | Customer agrees → designer sends the **final version** → task complete → designer returns to **Free** → system checks the queue for the next task |

### Stage C — Ordering (customer)
1. The customer **reviews**: product, locked design, specs, quantity, price.
2. Enters a **phone number (required)**, contact name and notes (optional).
3. Submits → the system creates an order with status **"Awaiting contact"** and **saves the price at order time** (so later price changes do not affect old orders).

### Stage D — Manager confirms the order
The manager phones the customer and records the result:

| Contact result | Action | Next |
|---|---|---|
| Could not reach | Record, schedule a callback | Call again |
| Needs adjustment | Edit information, agree again with the customer | Call again |
| Customer cancels | Cancel the order, record the reason | End |
| Customer confirms | Lock the order | Go to E |

Every contact, change and confirmation is **saved in history**.

### Stage E — Handover to production
The manager checks the file (design, specs, quantity, locked price) → hands it to **production**.

### Admin functions (parallel, not on the main flow)
| Function | Affects |
|---|---|
| Statistics dashboard (users, designers, AI, tasks, orders) | Aggregates data from all 3 subsystems |
| Accounts, permissions, Telegram linking | Decides who can receive tasks |
| Products, models, specs, pricing rules | Supplies catalog and prices to Stage A |
| Monitor AI, tasks, notifications; handle slow or cancelled tasks, return to queue | Exception handling |
| Support, complaints, system logs | — |

---

## 4. Architecture and technology

```
┌──────────────────────────── Next.js + TypeScript (Tailwind + shadcn/ui) ────────────────────────────┐
│       Customer website        │          Designer area          │            Admin pages            │
└───────────────┬───────────────┴────────────────┬────────────────┴─────────────────┬─────────────────┘
                │ REST API                       │ Socket.IO (realtime)             │
┌───────────────▼────────────────────────────────▼──────────────────────────────────▼─────────────────┐
│                               NestJS + TypeScript (1 shared backend)                                │
│   Person 1 modules: auth, product, pricing, order │ Person 2 modules: ai-design, file │ Person 3 modules: task, telegram, chat │
└──────┬──────────────────┬──────────────────────┬──────────────────────┬──────────────────────┬──────┘
       │ Prisma           │ BullMQ               │                      │                      │
┌──────▼──────┐   ┌───────▼───────┐      ┌───────▼────────┐     ┌───────▼────────┐     ┌───────▼────────┐
│ PostgreSQL  │   │ Redis (queue) │      │ AI image API   │     │ Telegram Bot   │     │ Cloudflare R2  │
│             │   │               │      │ (e.g. OpenAI)  │     │ API            │     │ / Amazon S3    │
└─────────────┘   └───────────────┘      └────────────────┘     └────────────────┘     └────────────────┘
```

| Component | Technology | Role |
|---|---|---|
| Frontend | Next.js, TypeScript | Customer website, designer area, admin pages |
| UI design | Tailwind CSS + shadcn/ui | Forms, dashboard, product lists, chat UI |
| Backend | NestJS, TypeScript | Accounts, pricing, design, tasks, orders, permissions |
| Main database | PostgreSQL | Users, products, prices, tasks, messages, orders |
| Database access | Prisma | Schema management and queries |
| Realtime chat | Socket.IO | Messages, task status updates, live notifications |
| Queue | Redis + BullMQ | AI image jobs, Telegram sending, retries on error |
| Telegram | Telegram Bot API | Notify free designers, handle the "Take task" button |
| AI design | Image API (e.g. OpenAI) | Generate / edit designs from prompts; called from the backend to hide the API key |
| Image and file storage | Cloudflare R2 or Amazon S3 | AI images, reference images, final design files |

> ℹ️ The screenshot of the technology table was cut off at the last row. If more rows exist below (e.g. deploy, auth), add them here.

---

## 5. Assignment for 3 people

Each person owns **their whole module** (UI + API + data), sharing **1 NestJS backend** and **1 PostgreSQL**.

| Person | Colour | Scope | Stages |
|---|---|---|---|
| **Person 1** | 🔵 Blue | Accounts and permissions, products, pricing, ordering, contact and order locking, admin **shell** + main dashboard | A, C, D, E |
| **Person 2** | 🟢 Green | AI chat, image creation/editing, **design versions**, **shared file service**, AI admin and statistics | B (AI branch) + file infrastructure |
| **Person 3** | 🟠 Orange | Tasks, queue, Telegram, designer chat, sample approval, progress monitoring, designer statistics | B (designer branch) |

### Connection points between the 3 people (the most fragile area)

```
  Person 1                        Person 2                         Person 3
  ────────                        ────────                         ────────
  Choose specs (SPEC) ──────────▶ Customer enters prompt
                                  Customer chooses "Need designer" ─▶ Create task (with reference sample)
  Pre-order review (REVIEW) ◀──── Save locked AI design
  Pre-order review (REVIEW) ◀──────────────────────────────────── Designer final version
                                  File service ───────────────────▶ Chat files + designer samples
  Auth / permissions ────────────────────────────────────────────▶ Chat, designer takes task
  Main dashboard ◀─────────────── AI statistics
  Main dashboard ◀─────────────────────────────────────────────── Task statistics
```

**3 things to agree early** (from the assignment table):
1. **Permissions** from Person 1 (which roles, which guards, where the user comes from).
2. **File storage API** from Person 2 (upload, get link, check download permission).
3. **Structure of the "locked design"** — so Person 2 (AI) and Person 3 (designer) hand over one format to Person 1's order.

---

## 6. Person 2 in detail (original assignment)

### 6.1 Scope

| # | Item | Description |
|---|---|---|
| 1 | **Chat / prompt with AI** | UI for the customer to describe ideas or request edits |
| 2 | **AI queue** | Put requests into BullMQ, worker calls the create/edit API, retries on error |
| 3 | **Design versions** | Each create/edit produces 1 version; the customer reviews history and picks a version |
| 4 | **Lock AI design** | Mark the final version → hand over to ordering (Person 1) |
| 5 | **Switch to designer** | When the customer chooses "Need a real designer" → create a task (Person 3) with the AI image as reference |
| 6 | **Shared file service** | Upload, store in R2/S3, expiring download links, permission checks — **used by all 3** |
| 7 | **AI admin and statistics** | Image history, errors, usage (count, cost) → push figures to Person 1's dashboard |

### 6.2 Flow

```
[Person 1: product + specs chosen]
        │
        ▼
 Customer enters prompt / edit request ◀────────────┐
        │                                           │
        ▼                                           │
 Create job in the queue (BullMQ)                   │
        │                                           │
        ▼                                           │
 Worker calls AI API ──error──▶ retry / report      │
        │                                           │
        ▼                                           │
 Save image to R2/S3 + save "design version" in DB  │
        │                                           │
        ▼                                           │
 Notify customer (realtime) ──▶ Customer chooses ───┤ "Keep editing with AI"
                                         │
                       ┌─────────────────┴──────────────────┐
                       ▼                                    ▼
              "Lock AI sample"                      "Need a real designer"
              → save locked design                  → create task (Person 3)
              → go to ordering (Person 1)
```

### 6.3 Draft data (for discussion — not settled)

| Table | Meaning | Main fields (suggested) |
|---|---|---|
| `FileObject` | Every file in the system (shared by 3 people) | id, ownerId, storageKey, mimeType, size, purpose (AI_IMAGE / REFERENCE / CHAT / FINAL_DESIGN), createdAt |
| `DesignSession` | 1 customer design session for 1 product | id, customerId, productId / specSnapshot, status, createdAt |
| `DesignVersion` | 1 sample image in a session — **shared by AI and designer images** | id, sessionId, parentVersionId, prompt?, fileId, source (AI / DESIGNER), taskId?, createdAt |
| `AiJob` | 1 AI call | id, versionId, status (QUEUED / RUNNING / DONE / FAILED), model, error, cost, durationMs |
| `FinalDesign` | Locked design — **the handover "contract" to the order** | id, sessionId, versionId, fileId, source (AI / DESIGNER), taskId?, lockedAt |

### 6.4 Planned APIs for other people

| API | Used by | Notes |
|---|---|---|
| `POST /files/upload-url` → presigned URL | Person 1, 2, 3 | Upload directly to R2/S3, the backend does not carry the file |
| `GET /files/:id/download-url` | All 3 | Check permission before issuing an expiring link |
| `GET /final-designs/:id` | Person 1 (orders) | Get the locked design for review / production file |
| `POST /final-designs` (source = DESIGNER) | Person 3 | When the designer sends the final version → create FinalDesign in the same format |
| `GET /admin/ai/stats` | Person 1 (dashboard) | Generation count, error rate, cost |

---

## 7. Observations from the diagrams (for the team to check)

1. ✅ **The customer always goes through AI first** before choosing a designer — **intentional**, kept.
2. ✅ **The order of locking a designer sample does not matter.** System view: *the customer only views images → picks → orders.* How the designer works is internal; for the system, a designer's output is just **a sample image to choose**, the same as an AI image.
3. ✅ **AI and designer images live in one list.** Each image records its source (AI / designer). `DesignVersion` is managed by **Person 2**; Person 3 adds designer images through Person 2's API. Person 1 only reads "the image the customer chose" from one place.
4. ✅ **No free designer → show "Finding a designer…"** and notify when someone takes the task. The UI shows **designer working hours: 9:00 – 17:00**. **Requests are still accepted out of hours**: the task stays queued, and Telegram is sent at 9:00 the next day. (Person 3's part.)
5. **AI results return asynchronously** (via the queue) → they must reach the UI. Share Person 3's Socket.IO or use polling?

### Consequence of decision 2
Everything the customer sees to choose from is a **"sample image"**, differing only in source:

```
AI-created image ───┐
                    ├──▶ Customer's sample list ──▶ Customer picks an image ──▶ "Locked design" ──▶ Order
Designer image ─────┘
```

---

## 8. ❓ Open questions (brainstorm)

Status of Q2–Q6 is updated in the design document, section 11.

### Decisions directly affecting the AI part
| # | Question | Options | Notes |
|---|---|---|---|
| Q1 | ✅ **What does AI generate?** | **Settled: product images only** (a product already carrying the design, e.g. "black T-shirt printed with a tiger") | The prompt must include product type, colour and material from Person 1's spec step. Production receives this image as a **reference**, not a print file |
| Q2 | **Is "chat with AI" real chat or just a prompt?** | (a) Prompt box → image · (b) Chat with an LLM to explore ideas, then the LLM writes the image prompt | (b) is better for the thesis defence but costs more work |
| Q3 | **Can customers upload reference images / logos for AI?** | Yes / No | Related to the API's edit feature |
| Q4 | **AI usage limit** | Per user per day · per session · unlimited | Protects API cost |
| Q5 | **Must users log in to use AI?** | Required · let guests try a few times | Related to Person 1's auth |
| Q6 | **Which image API?** | OpenAI · Gemini · Stability · … | Consider price, text quality in images, edit support |

### Team-wide decisions
| # | Question |
|---|---|
| Q7 | ⏳ **FinalDesign** format shared by AI and designer (section 6.3) — **one shared list is settled** (point 3), exact fields are not |
| Q8 | **R2 or S3**? (R2 has no egress fees, S3 is more common) |
| Q9 | If the customer changes product / specs **after** designing, is the old design still usable? |
| Q10 | Realtime: **1 shared Socket.IO gateway** (who owns it?) or each module on its own? |
