# Ghép nối với nhóm: phần AI và nhánh designer

> Viết ngày 2026-11-10 cho Người 1 và Người 2. Mã nguồn: https://github.com/duytienitptit/graduation-thesis (nhánh `main`).
> Tài liệu này viết bằng tiếng Việt vì gửi cho nhóm; các tài liệu thiết kế khác trong `docs/` vẫn bằng tiếng Anh.

## 1. Phần này đã làm được gì

Phần này đưa khách từ **nhu cầu** đến **sản phẩm đã chốt, có ít nhất 3 ảnh** (mặt trước, mặt sau, cận logo), bằng AI hoặc với designer thật qua Telegram. Phase 0 đến 8 trong [02-implementation-plan.md](02-implementation-plan.md) đã xong:

- Bộ câu hỏi cho 3 loại áo (áo in, áo bóng đá, áo bóng chuyền), lưu câu trả lời, tải ảnh tham khảo.
- Tạo và sửa ảnh bằng AI (Nano Banana 2 của Google), qua hàng đợi, giới hạn 20 ảnh mỗi ngày mỗi tài khoản.
- Tạo các góc từ ảnh chính, duyệt hoặc tạo lại từng góc, chốt sản phẩm.
- Nhánh designer: tạo task, gửi Telegram cho designer rảnh, bấm nhận task (ai bấm trước được), chat trên web, ảnh mẫu, nút "Đồng ý", bản cuối có nội dung mặt sau, nút "Hoàn thành", rồi sang bước tạo góc.
- Ngoại lệ: báo khách khi 2 giờ làm việc chưa ai nhận, khách hủy sau 48 giờ, cảnh báo quản lí khi designer im lặng 24 giờ, designer đóng task kèm lý do, nhờ designer làm lại một góc.
- 270 test API, 3 test Playwright chạy trên trình duyệt thật.

**Chưa làm:** phase 9 (màn hình quản lí, API số liệu cho dashboard và thống kê AI) và phase 10 (ghép nối, tài liệu này là bước đầu).

## 2. Chạy thử

Cần Node 24 (bản đang dùng để phát triển), pnpm và Docker Desktop.

```bash
git clone https://github.com/duytienitptit/graduation-thesis.git
cd graduation-thesis
pnpm install
pnpm dev
```

- `pnpm dev` tự tạo `.env` từ `.env.example`, bật PostgreSQL (cổng 5433), Redis (6379), MinIO (9000), chạy migration, seed, rồi chạy API ở cổng 4000 và web ở cổng 3000.
- Mặc định `IMAGE_PROVIDER=fake`: ảnh là ảnh mẫu, không tốn tiền. Muốn ảnh thật thì điền `GEMINI_API_KEY` và đặt `IMAGE_PROVIDER=nano-banana` (khoảng $0.067 một ảnh).
- Bot Telegram mặc định tắt. Muốn bật cần `TELEGRAM_BOT_TOKEN` và `TELEGRAM_ENABLED=true`. Mỗi token chỉ chạy được một bản.
- Đăng nhập tạm không cần mật khẩu: `khach@example.test`, `designer@example.test`, `designer2@example.test`, `quanli@example.test`.
- Test: `pnpm test` (API) và `pnpm test:e2e` (Playwright, cần chạy `pnpm exec playwright install chromium` một lần).

Key chỉ để trong `.env`, file này không được commit.

## 3. Cấu trúc mã

```
apps/api   NestJS 12 (ES modules), Prisma 7, BullMQ, Socket.IO
  src/design        phiên thiết kế, câu hỏi, ảnh, các góc, chốt sản phẩm
  src/ai            gọi API ảnh, hàng đợi, worker
  src/task          task, designer, phân phối, kiểm tra định kỳ
  src/chat          chat, ảnh mẫu, Đồng ý, bản cuối
  src/telegram      bot, liên kết tài khoản, gửi thông báo
  src/realtime      cổng Socket.IO dùng chung
  src/integrations  các phần tạm thay cho Người 1 và Người 2 (xem mục 4)
  prisma/           schema và migration
apps/web   Next.js 16, Tailwind, giao diện tiếng Việt
e2e/       test Playwright
```

## 4. Chỗ cần ghép: các phần đang tạm

Phần của Người 1 và Người 2 hiện là bản tạm, nằm sau interface nhỏ trong `apps/api/src/integrations/`. Khi ghép, mỗi người cung cấp class thật cho interface đó; phần còn lại của code không phải sửa.

### 4.1 Người 1: đăng nhập và quyền

File: `integrations/auth/auth.port.ts`

```ts
interface AuthUser { id: string; email: string; name: string; role: 'CUSTOMER' | 'DESIGNER' | 'MANAGER' }
abstract class AuthPort {
  verifyToken(token: string): Promise<AuthUser | null>;
}
```

- Mọi route cần đăng nhập, trừ route có `@Public()`. Token gửi ở header `Authorization: Bearer <token>`. Socket.IO gửi token ở `auth.token`.
- Phân quyền bằng `@Roles(Role.CUSTOMER)` và lấy người dùng bằng `@CurrentUser()` (trong `auth.decorators.ts`).
- Bản tạm `DevAuthService` ký JWT bằng `AUTH_JWT_SECRET`, đi kèm route `POST /auth/dev-login` và `GET /auth/dev-users`, sẽ bỏ khi ghép.
- Cần 3 vai trò: khách hàng, designer, quản lí. Bảng `User` hiện là bản tạm; phần này chỉ cần `id`, `email`, `name`, `role`.

### 4.2 Người 1: danh mục áo

File: `integrations/catalog/catalog.port.ts`

```ts
interface Product {
  id: string; name: string;
  shirtType: 'PRINTED' | 'FOOTBALL' | 'VOLLEYBALL'; // chọn bộ câu hỏi, danh mục thật cần có trường này
  colours: { id: string; name: string; hex: string }[];
  materials: { id: string; name: string }[];
  sizes: string[];
}
abstract class CatalogPort {
  listProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
}
```

Khi khách bắt đầu thiết kế, phần này lưu một bản chụp sản phẩm và thông số đã chọn (`specSnapshot`), nên sửa danh mục sau đó không làm đổi phiên thiết kế cũ.

### 4.3 Người 2: dịch vụ file

File: `integrations/files/files.port.ts`. Bản tạm `MinioFilesService` dùng MinIO (tương thích S3).

| Hàm | Dùng để | Ghi chú |
|---|---|---|
| `createUpload(user, {mimeType, size, purpose})` | Tạo link tải lên thẳng kho | Đã có trong kế hoạch ban đầu |
| `completeUpload(user, fileId)` | Kiểm tra file thật sau khi tải lên (đúng loại, ≤ 10 MB) | **Mới**, cần thống nhất |
| `getDownloadLink(user, fileId)` | Link tải có hạn, kiểm tra quyền (chủ file hoặc quản lí) | Đã có |
| `getLink(fileId)` | Link tải khi phần này đã tự kiểm tra quyền (designer xem file của khách trong task, khách xem ảnh của designer) | **Mới**, cần thống nhất |
| `saveImage(ownerId, image)` | Backend lưu ảnh AI tạo ra | **Mới**, cần thống nhất |
| `readImage(fileId)` | Backend đọc ảnh để gửi cho API ảnh | **Mới**, cần thống nhất |
| `ownsReadyFiles(user, fileIds, mimeTypes?)` | Kiểm tra file đã tải xong, thuộc người này và đúng loại | **Mới**, cần thống nhất |

- Loại file: PNG, JPG ở mọi nơi; **PDF chỉ trong chat** (`purpose = CHAT`), vì các chỗ khác có thể gửi file sang API ảnh.
- `purpose`: `AI_IMAGE`, `REFERENCE`, `CHAT`, `FINAL_DESIGN`.
- Bảng `FileObject` hiện là bản tạm; khi ghép, bảng thật của Người 2 thay thế.

### 4.4 Người 2: số liệu cho thống kê AI

Mỗi lần gọi API ảnh được lưu một dòng trong bảng `AiJob`: loại (tạo, sửa, góc), trạng thái, model, lỗi, chi phí (USD), thời gian chạy, số lần thử, thời điểm tạo và xong. **API trả số liệu này chưa làm (phase 9)**; hai bên cần thống nhất định dạng trước.

### 4.5 Người 1: nhận sản phẩm đã chốt

`GET /design/locked-products/:id` trả về một định dạng chung cho cả hai nhánh:

```json
{
  "id": "…", "sessionId": "…", "customerId": "…", "lockedAt": "…",
  "source": "AI | DESIGNER",
  "product": { "product": {…}, "colour": {…}, "material": {…}, "size": "M", "quantity": 2 },
  "answers": { "main_image": "…", "has_text": "yes", "text_content": "…" },
  "views": [{ "type": "FRONT | BACK | CLOSE_UP | EXTRA", "position": 0, "description": null,
              "source": "AI | DESIGNER", "fileId": "…", "imageUrl": "…" }],
  "uploads": [{ "fileId": "…", "url": "…" }]
}
```

- Ảnh chỉ là ảnh minh họa, không phải file in. Chữ, số và logo gốc chính xác nằm trong `answers` và `uploads`.
- Đổi size hoặc số lượng không ảnh hưởng thiết kế. Đổi loại áo, màu hoặc chất liệu cần phiên mới (cần Người 1 đồng ý).
- **Còn mở:** phần này nên gọi sang bước đặt hàng của Người 1, hay Người 1 đọc qua API này?

### 4.6 Người 1: dashboard

Số liệu designer và task (số task chờ, đang làm, xong, thời gian nhận...) sẽ làm ở phase 9. Cần thống nhất định dạng với dashboard.

## 5. Socket.IO

Cổng Socket.IO dùng chung, đẩy sự kiện cho từng người dùng qua `RealtimeGateway.emitToUser`. Đề xuất phần này giữ cổng chung vì chat và kết quả ảnh là hai thứ dùng nhiều nhất; **cả nhóm cần đồng ý (câu Q10)**.

| Sự kiện | Gửi cho | Nội dung |
|---|---|---|
| `design.image-job` | Khách | Ảnh đang tạo, xong hoặc lỗi |
| `design.task` | Khách và designer của task | Task đổi trạng thái (trang tự tải lại) |
| `task.message` | Khách và designer của task | Tin nhắn chat mới |
| `task.alert` | Quản lí | Designer im lặng 24 giờ |

## 6. Danh sách API chính

Đều cần đăng nhập, trừ `/health`. Vai trò ghi trong ngoặc.

**Thiết kế (`/design`)**
- `GET /design/products/:productId/questions`: bộ câu hỏi
- `POST /design/sessions` (khách): tạo phiên với sản phẩm và thông số; `GET /design/sessions`, `GET /design/sessions/:id`
- `PUT /design/sessions/:id/answers`, `POST …/answers/submit` (khách)
- `POST …/images`, `POST …/edits` (khách): tạo và sửa ảnh AI
- `GET …/workspace`: mọi thứ màn hình cần
- `POST …/main-image` (khách): chọn ảnh chính, bắt đầu tạo các góc
- `POST …/views/:viewId/generate | regenerate | approve`, `POST …/views` (góc thêm), `POST …/lock` (khách)
- `GET /design/locked-products/:id`

**Task và chat**
- `POST /design/sessions/:id/tasks` (khách): nhờ designer cho cả áo
- `POST /design/sessions/:id/views/:viewId/tasks` (khách): nhờ designer cho một góc
- `GET /tasks/:id`, `GET /tasks/:id/messages`, `POST /tasks/:id/messages`
- `POST /tasks/:id/samples`, `POST /tasks/:id/final`, `POST /tasks/:id/done`, `POST /tasks/:id/close` (designer)
- `POST /tasks/:id/agree`, `POST /tasks/:id/cancel` (khách)
- `GET /designers/me`, `GET /designers/me/tasks`, `POST /designers/me/telegram-link` (designer)

**File (bản tạm của Người 2):** `POST /files/upload-url`, `POST /files/:id/complete`, `GET /files/:id/download-url`
**Danh mục (bản tạm của Người 1):** `GET /catalog/products`, `GET /catalog/products/:id`

## 7. Cách ghép đề xuất

Dự án chung chưa có, nên đây là đề xuất để cả nhóm bàn:

1. Chọn một repo chung. Có thể dùng repo này làm gốc vì đã có sẵn workspace, Docker và test, rồi Người 1 và Người 2 đưa module của mình vào `apps/api/src`.
2. Gộp schema Prisma: giữ các bảng của phần này (`DesignSession`, `DesignVersion`, `AiJob`, `ProductView`, `LockedProduct`, `DesignerProfile`, `Task`, `TaskMessage`, `TaskNotice`, `TelegramLinkCode`). `User` và `FileObject` thay bằng bảng thật của Người 1 và Người 2, giữ tên cột hoặc sửa các chỗ tham chiếu.
3. Mỗi người thay một bản tạm bằng module thật, cung cấp cùng token (`AuthPort`, `CatalogPort`, `FilesPort`). Chạy `pnpm test` sau mỗi lần thay.
4. Thống nhất các mục "còn mở" ở mục 8 trước khi viết code ghép.

## 8. Cần nhóm thống nhất

| Việc | Với ai |
|---|---|
| Các hàm mới của `FilesPort` (mục 4.3), PDF trong chat | Người 2 |
| Định dạng số liệu AI cho thống kê | Người 2 |
| Định dạng sản phẩm đã chốt, và ai gọi ai ở bước đặt hàng | Người 1 |
| Trường `shirtType` trong danh mục thật | Người 1 |
| Định dạng số liệu task và designer cho dashboard | Người 1 |
| Ai giữ cổng Socket.IO chung (Q10) | Cả nhóm |
| Đổi loại áo, màu, chất liệu cần phiên mới (Q9) | Người 1 |
| Hạn nộp khóa luận | Cả nhóm |

## 9. Chưa kiểm tra thật

- Telegram với 2 tài khoản thật: ai bấm trước được, người sau bị từ chối, tin nhắn đổi thành "đã có người nhận". Đã có test với Telegram giả.
- Tin Telegram thật: link sau khi nhận task, báo khi khách nhắn, đổi thành "đã hủy".
- Ảnh mặt sau thật tạo từ nội dung của designer.

Thiết kế chi tiết: [01-ai-and-designer-design.md](01-ai-and-designer-design.md). Thứ tự xây dựng và trạng thái: [02-implementation-plan.md](02-implementation-plan.md).
