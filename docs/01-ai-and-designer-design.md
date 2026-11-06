# Design: AI image creation and the designer branch

> Written: 2026-11-06 · Status: **approved by the project owner on 2026-11-06**
> Read with [00-project-overview.md](00-project-overview.md) and the assignment diagram [diagrams/02-team-assignment.mmd](diagrams/02-team-assignment.mmd). The picture overview is [diagrams/00-project-flow-overview.png](diagrams/00-project-flow-overview.png).
> Where this document differs from the overview, **this document wins** (see section 11).
> Items marked **[Claude's proposal]** began as Claude's calls and were approved with this document. Section 13 lists what is still open. The build order is in [02-implementation-plan.md](02-implementation-plan.md).
> The product UI is in Vietnamese. Labels are translated here: "Agree" is `Đồng ý`, "Done" is `Hoàn thành`, "Take task" is `Nhận task`, Free is `Rảnh`, Busy is `Bận`.

---

## 1. Purpose

The system lets customers order shirts printed with their own design. This document describes the part that takes a customer from **a need** to **a locked product with at least 3 images**, through AI or with help from a real designer.

Customers often cannot put an idea into words, and they do not know when they need human help. So:

- A question set captures the right needs up front, so customers **do not have to generate many images**.
- The system always asks whether the customer wants to continue with AI or needs a designer.

This is part of a 3-person graduation thesis.

## 2. Scope

### In this part
- Question set per shirt type, and turning answers into a prompt.
- Image API connection, image queue, image editing, version storage.
- Creating and approving the required views, locking the product.
- The whole designer branch: tasks, queue, Telegram, taking tasks, chat, sample approval, completion.
- Designer and task administration, designer statistics.

### Not in this part
| Part | Owner |
|---|---|
| Login, permissions, products, pricing, orders, dashboard shell | Person 1 |
| File service, AI statistics | Person 2 |
| Sending images to the workshop | Designer handles it outside the system; this part only hands data to Person 1 |

### Not in the first version
- Charging for a designer: it is **free**, and the system has no online payment.
- Real chat with an LLM: only the question set and an edit-request box.
- Print file generation: images are product images, not production files.
- Scripting the designer's working steps.
- Products beyond the 3 shirt types in section 4.

### Counts as failure even if it runs
- Two designers get the same task.
- A designer is stuck in Busy forever and cannot receive new tasks.
- The views of one product look like different products.
- The customer must generate many images to get the right sample.
- The image API key is exposed to the browser.

## 3. Overall flow

```
Choose shirt and specs (Person 1)
→ Answer the question set, may upload images
→ AI creates the first image
→ Before each further create or edit: ask "continue with AI or need a designer?"

   AI branch:       edit until an image is OK
   Designer branch: task → designer takes it → chat → customer presses "Agree"
                    → designer sends the final → presses "Done"

→ There is a main image, which is the front angle
→ AI creates the back and logo close-up views, plus extra views if the customer wants
→ Customer approves each view; a rejected view is regenerated alone
→ Only with the 3 required views can the product be locked → Order (Person 1)
```

Mandatory rule: **the customer must have at least one AI image** before choosing a designer. The first creation does not ask. The question is shown as two buttons beside the edit box, "Edit with AI" and "Need a designer", on every further edit (owner's choice, 2026-11-06).

## 4. Question set

Only ask what changes the image. Material, shirt colour, size and quantity are already in Person 1's step, so they are not asked again. Most are quick choices. The wording below is translated; the UI is Vietnamese.

**Common to all 3 shirt types**
1. Who or what occasion is the shirt for? (personal, group/class, team, company, event, gift)
2. Style? (minimal, energetic, bold, cute, classic)
3. Which colours should appear, which to avoid?
4. Is there text on the shirt? If yes, enter the exact content.
5. Anything you do not want on the shirt?
6. Anything else to describe? (optional)

**Printed shirt**
1. What is the main image?
2. Image style? (cartoon, hand-drawn, photo-like, text only)
3. Where is it printed and how big? (large mid-chest, small left chest)
4. Is the back plain or printed?

**Football shirt**
1. Team name?
2. Pattern? (plain, vertical stripes, horizontal stripes, diagonal stripes, gradient)
3. Collar? (round, V-neck, polo)
4. Is there a team logo, and where? (with upload)
5. Sample name and number on the back? (only to show on the sample image)
6. Any sponsor name?

**Volleyball shirt**
1. Team name?
2. Sleeve? (sleeveless, short sleeve)
3. Pattern?
4. Is there a team logo, and where? (with upload)
5. Where is the number printed (front, back, both)? Sample name and number?
6. Is a differently coloured libero shirt needed?

The wording is a draft that the project owner reviewed, removing the "other sportswear" type.

**[Claude's proposal]**
- The printed shirt also has an upload box for a reference image.
- Questions are stored as configuration per shirt type, not hard-coded in the UI.
- Answers are saved with the design session and attached to the task if the customer moves to a designer.
- Person 1's catalog has a field for shirt type (printed, football, volleyball) to select the right question set.
- The libero shirt is only stored as a note in the answers, with no separate image required.

## 5. AI image creation

- **Login:** required before using AI.
- **Limit:** 20 images per account per day. Regenerating an angle counts.
- **Upload:** customers can upload images, which are sent to AI with the prompt.
- **Prompt:** built from answers and product specs (shirt type, colour, material). Every text on the shirt is listed with its size role and a letter-by-letter spelling, because the image model otherwise drops Vietnamese accents (owner's request, 2026-11-06).
- **Editing:** the customer types a request in the edit box. Each edit creates a new version, and old versions stay viewable.
- **Async handling:** requests enter a BullMQ queue, a worker calls the API, retries automatically on error, and reports to the customer if it still fails. The UI shows a generating state.
- **Image API:** the test build uses Google's **Nano Banana 2** (`gemini-3.1-flash-image`), with an API key from **Google AI Studio** (owner's choice after the trial, 2026-11-06). API calls sit in a separate layer so the variant or provider can change without touching the flow. The API is only called from the backend.

**Cost (third-party figures, check against Google's price list):** about $0.039 per image for Nano Banana (2.5 Flash Image), $0.067 for Nano Banana 2 at 1K, $0.134 for Pro.

**[Claude's proposal]**
- Failed generations do not count against the limit.
- The limit resets at 00:00 Vietnam time. When out of credits, show the reset time and still allow choosing a designer.
- Only PNG and JPG, at most 10 MB per image.
- Each generation returns one image.

## 6. Views and locking the product

- Each product **must have 3 views: front, back, logo close-up**. The customer can add more views if needed.
- The main image is the front angle: the OK image on the AI branch, or the final on the designer branch.
- AI creates the other views, using the main image as reference and describing the view in the prompt, with an instruction to keep the product unchanged. The back uses the question answers on the AI branch, and the designer's back description or image on the designer branch.
- The customer approves each angle. A rejected angle is regenerated alone, without affecting approved angles.
- The lock button opens only when the 3 required views are approved.
- If AI cannot produce an acceptable angle, the customer can choose a designer at this step. The designer sends that angle in place of the AI image, and the customer approves it like any other angle.
- A locked product is a **set of at least 3 images**, handed to Person 1's review step in one format for both branches.

**[Claude's proposal]**
- Images cannot be edited after locking. To change them, start a new session.
- Changing size or quantity does not affect the design, including when the manager adjusts during the confirmation call. Changing shirt type, colour or material requires a new session, because those are in the image (Q9, needs Person 1's agreement).
- Handover data includes the images, the question answers and customer uploads, because exact text, numbers and the original logo exist only there.
- On a printed shirt with no logo, the close-up shows the main print.
- Extra views are chosen by typing what to show, at most 2 per product, and each counts against the daily limit.
- Choosing a designer at the angle step creates a new task with the main image as reference and the angle named. The old task is not reopened.

## 7. Designer branch

### 7.1 Creating a task and finding a designer
- The customer chooses a designer and enters requirements. The AI image and question answers are attached. No fee.
- The customer sees "Finding a designer…" and the working hours 9:00–17:00.
- If a designer is free during hours: send Telegram to **all** free designers.
- Out of hours: the task can still be created and stays queued, and Telegram is sent at 9:00 the next day.
- Nobody takes it: the system tells the customer. After **48 hours** untaken, the customer may cancel the task.

**[Claude's proposal]**
- The 48 hours run continuously from task creation, including out of hours. If the customer does not cancel, the task keeps waiting.
- Tell the customer at creation if no designer is free or it is out of hours. If Telegram was sent and nobody takes the task within 2 working hours, tell them once more.
- Each waiting task is sent to every free designer, oldest first. A designer who becomes free receives messages for all waiting tasks. Taking one makes them Busy, so their other buttons report a rejection.
- Untaken tasks are re-sent at 9:00 each day.
- The "Take task" button still works after 17:00, because working hours only limit sending.
- Hours use Vietnam time, every day of the week.
- Before a designer takes the task, the customer can cancel after 48 hours. Once taken, cancelling is handled by the manager.
- While waiting for a designer, the customer cannot keep editing with AI in the same session, to avoid two branches running in parallel.

### 7.2 Taking a task
- The designer presses "Take task" on Telegram. The system checks the task is still open **and** the designer is still free.
- The first presser gets the task and switches to Busy.
- Later pressers are rejected with a reason (already taken / you are busy).
- The others' Telegram messages change to "already taken".
- Check and assign must be **one atomic database operation**.
- Each designer works on one task at a time.

### 7.3 Working
- The customer is told someone took the task, and both chat in the system through Socket.IO. Messages are stored, and files can be sent.
- The designer consults and works their own way. **The system does not script the steps.**
- The system provides: chat, sample image sending, an **"Agree"** button for the customer, a **"Done"** button for the designer.
- Samples appear in chat, with no separate approval screen. The customer requests edits by message.
- Chat files are PNG, JPG and PDF, at most 10 MB (owner's choice, 2026-11-06).
- A customer's message sends the designer a Telegram notice, at most once per 10 minutes per task (owner's choice, 2026-11-06).

### 7.4 Completion
1. The customer presses "Agree" on a sample.
2. The designer sends the final, which is one main image, and must also describe the back or attach a back image, because the main image only shows the front.
3. The designer presses "Done": the task ends, the designer returns to Free, and the system checks the queue.
4. The main image moves to the angle step in section 6.

**[Claude's proposal]** "Done" can only be pressed after the customer pressed "Agree" and the final and back content were sent.

Owner's choices (2026-11-06):
- "Agree" works on any sample and belongs to that sample. A new sample cancels it. The final needs a standing "Agree", and it can be re-sent until "Done"; the newest counts.
- "Done" starts the angle step at once. The back and close-up count against the customer's daily limit; out of credits, they wait as on the AI branch.
- The final becomes an approved front view, because the customer already agreed. There is no second approval.
- A designer's back image goes to AI as a reference, and AI draws the back.

### 7.5 Stuck tasks
- **Designer silent:** after 24 hours without activity the system alerts the manager, who returns the task to the queue.
- **Customer silent:** the designer closes the task with a reason and returns to Free.

**[Claude's proposal]**
- "No activity" means no message or image sent in the task, and only counts while the customer is waiting for the designer's reply.
- When a task returns to the queue, chat history is kept for the new designer to read.
- If a task closes because the customer went silent, the customer can return to the design session and create a new task.
- When the manager returns or cancels a task, that designer goes to Free.
- Besides Free and Busy, the manager can set a designer to **Paused** so they receive no messages, for leave or repeated silence.

## 8. Manager

- Manage designers and Telegram linking.
- Handle slow tasks, cancel tasks, return tasks to the queue.
- View designer, task and progress statistics; figures are pushed to Person 1's dashboard.

**[Claude's proposal]** Telegram linking uses a link with a one-time code: the designer logs in on the web, opens the link to the bot, and the system records the Telegram account.

## 9. Connection points with others

| With | What | Direction |
|---|---|---|
| Person 1 | Roles, guards, how to get the current user | In |
| Person 1 | Chosen product and specs | In |
| Person 1 | Locked product with its images | Out |
| Person 1 | Task and designer figures for the dashboard | Out |
| Person 2 | Upload, expiring links, download permission checks | In |
| Person 2 | Data for each image generation (result, error, cost) for AI statistics | Out |

The overview assigned `DesignVersion`, `AiJob` and `FinalDesign` to Person 2. Since AI now belongs here, those tables move here, and `FileObject` stays with Person 2.

**[Claude's proposal]** This part owns the shared Socket.IO gateway (Q10), since chat and AI results are its two heaviest users. The whole team must agree.

## 10. Technology and constraints

- Next.js, TypeScript, Tailwind, shadcn/ui on the frontend; NestJS, TypeScript on the backend; PostgreSQL with Prisma; Redis with BullMQ; Socket.IO; Telegram Bot API; R2 or S3 through Person 2's file service.
- One backend and one database shared by the team, but the shared project does not exist yet. This part is built first on its own with the same stack and connected later.
- While building alone, login and the file service are stand-ins behind small interfaces, so Person 1's and Person 2's real versions can replace them. **[Claude's proposal]**
- Designers use the designer area on the web to chat and send images. Telegram is for notifications and taking tasks.

### Test before going deep
Run a quick trial with Nano Banana, since results may change the API choice:
1. Do the views of one shirt keep the same product?
2. Are Vietnamese text with diacritics, team names and numbers correct?
3. Does an uploaded logo keep its shape, especially in the close-up?

**[Claude's proposal]** Pass criterion: a viewer recognises it as the same shirt, since the image is a reference, not a print file. Small text and logo errors are acceptable, because exact content is in the handover data. If it fails, try Nano Banana 2, then Pro, before changing the approach.

## 11. Changes from the overview

| Overview | Now |
|---|---|
| Customer locks one image | Customer locks a product with 3 required views: front, back, logo close-up |
| Designer final goes straight to Person 1 | The final is the main image; AI adds the other views before Person 1 |
| Person 2 owns AI and design versions | Moved here; Person 2 keeps the file service and AI statistics |
| Q2: real chat or prompt | Question set and edit box, no LLM chat |
| Q3: upload or not | Yes |
| Q4: usage limit | 20 images per account per day |
| Q5: login required | Required |
| Q6: which API | Nano Banana 2 for the test build |

Person 1 and Person 2 have agreed to the new split (2026-11-06). The exact locked product format and API contracts still need to be written down with them.

## 12. Left to the builder

- Table, field and status names and folder structure, as long as the behaviour above holds.
- Retry policy and timeouts of the queue.
- Wording of prompts and Telegram messages.
- UI layout.

## 13. Open questions for the project owner

Raised by the independent review, not answered yet:

1. **Thesis deadline.** Nothing will be cut, so this only sets the pace.
