import { deflateSync } from 'node:zlib';
import { APIRequestContext, Browser, expect, Page, test } from '@playwright/test';
import { API_PORT } from '../playwright.config';
import { CUSTOMER, DESIGNER } from './test-data';

const API = `http://localhost:${API_PORT}`;

/** A real PNG of one colour, so the browser shows it. */
function png(red: number, green: number, blue: number) {
  const size = 240;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(size * 3).map((_, index) => [red, green, blue][index % 3]),
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const image = (name: string, red: number, green: number, blue: number) => ({
  name,
  mimeType: 'image/png',
  buffer: png(red, green, blue),
});

const pdf = {
  name: 'brief.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
};

async function tokenFor(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/dev-login`, { data: { email } });
  return (await res.json()).token as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Questions and the first AI image come before this flow, so they are set up directly. */
async function sessionWithImage(request: APIRequestContext, token: string) {
  const headers = auth(token);
  const session = await (
    await request.post(`${API}/design/sessions`, {
      headers,
      data: {
        productId: 'printed-shirt',
        colourId: 'white',
        materialId: 'cotton',
        size: 'M',
        quantity: 2,
      },
    })
  ).json();

  const answers = {
    main_image: 'Một con mèo đội mũ',
    image_style: 'cartoon',
    print_placement: 'large-centre-chest',
    back_print: 'plain',
    occasion: 'personal',
    style: 'minimal',
    has_text: 'no',
  };
  const saved = await request.put(`${API}/design/sessions/${session.id}/answers`, {
    headers,
    data: { answers },
  });
  expect(saved.ok()).toBe(true);
  const submitted = await request.post(`${API}/design/sessions/${session.id}/answers/submit`, {
    headers,
  });
  expect(submitted.ok()).toBe(true);
  const created = await request.post(`${API}/design/sessions/${session.id}/images`, { headers });
  expect(created.ok()).toBe(true);
  return session.id as string;
}

/** Logs in through the real login screen, in a browser of its own. */
async function open(browser: Browser, name: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByRole('button', { name }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
  return page;
}

const say = async (page: Page, text: string) => {
  await page.getByLabel('Tin nhắn', { exact: true }).last().fill(text);
  await page.getByRole('button', { name: 'Gửi', exact: true }).click();
};

test('a task goes from the customer through a designer to a locked product', async ({
  browser,
  request,
}) => {
  const customerToken = await tokenFor(request, CUSTOMER.email);
  const designerToken = await tokenFor(request, DESIGNER.email);
  const sessionId = await sessionWithImage(request, customerToken);

  const customer = await open(browser, CUSTOMER.name);
  const designer = await open(browser, DESIGNER.name);
  await expect(designer.getByText('Bạn chưa có task nào.')).toBeVisible();

  await test.step('the customer asks for a designer', async () => {
    await customer.goto(`/design/${sessionId}`);
    await customer.getByRole('button', { name: 'Cần designer hỗ trợ' }).click();
    await customer.getByLabel('Bạn cần designer giúp gì?').fill('Làm con mèo dễ thương hơn');
    await customer.getByRole('button', { name: 'Gửi cho designer' }).click();
    await expect(customer.getByText('Đang tìm designer…')).toBeVisible();
  });

  await test.step('the designer takes the task, and both pages update live', async () => {
    const workspace = await request.get(`${API}/design/sessions/${sessionId}/workspace`, {
      headers: auth(customerToken),
    });
    const { task } = await workspace.json();
    // Stands in for the Telegram button, which a browser cannot press.
    const claimed = await request.post(`${API}/tasks/${task.id}/dev-claim`, {
      headers: auth(designerToken),
    });
    expect(claimed.ok()).toBe(true);

    await expect(customer.getByText('Đã có designer nhận')).toBeVisible();
    await designer.getByTestId('current-task').getByRole('link').click();
    await expect(designer.getByTestId('task-requirement')).toHaveText('Làm con mèo dễ thương hơn');
    await expect(designer.getByText('Một con mèo đội mũ')).toBeVisible();
    await expect(designer.getByAltText('Ảnh AI khách gửi')).toBeVisible();
  });

  await test.step('they chat and send files', async () => {
    await say(customer, 'Chào bạn, mèo to hơn nhé');
    await expect(designer.getByText('Chào bạn, mèo to hơn nhé')).toBeVisible();

    await say(designer, 'Mình làm ngay');
    await expect(customer.getByText('Mình làm ngay')).toBeVisible();

    await customer.getByTestId('chat-file').setInputFiles(pdf);
    await expect(designer.getByRole('link', { name: 'Mở tệp PDF' })).toBeVisible();

    await designer.reload();
    await expect(designer.getByText('Chào bạn, mèo to hơn nhé')).toBeVisible();
  });

  await test.step('nothing can finish before the customer agrees', async () => {
    await expect(designer.getByTestId('final-hint')).toBeVisible();
    await expect(designer.getByRole('button', { name: 'Hoàn thành', exact: true })).toBeDisabled();
  });

  await test.step('the designer sends a sample and the customer agrees', async () => {
    await designer.getByTestId('chat-sample').setInputFiles(image('mau.png', 214, 36, 110));
    const sample = customer.getByTestId('message-SAMPLE');
    await expect(sample.getByAltText('Ảnh mẫu')).toBeVisible();
    await sample.getByRole('button', { name: 'Đồng ý mẫu này' }).click();
    await expect(designer.getByText('Khách đã đồng ý mẫu này')).toBeVisible();
    await expect(customer.getByText('Bạn đã đồng ý một mẫu.')).toBeVisible();
  });

  await test.step('the task page fits a phone', async () => {
    await designer.setViewportSize({ width: 375, height: 812 });
    const overflow = await designer.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await designer.screenshot({ path: 'test-results/designer-phone.png', fullPage: true });
    await designer.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step('the final needs back content, then "Done" opens', async () => {
    await designer.getByTestId('final-image').setInputFiles(image('cuoi.png', 31, 63, 209));
    const send = designer.getByRole('button', { name: 'Gửi bản cuối' });
    await expect(send).toBeDisabled();

    await designer.getByLabel('Mô tả mặt sau').fill('In chữ MÈO nhỏ giữa lưng');
    await send.click();

    await expect(customer.getByTestId('message-FINAL').getByAltText('Bản cuối')).toBeVisible();
    await expect(customer.getByText('In chữ MÈO nhỏ giữa lưng')).toBeVisible();
    // The newest message is in view, even though images grew the list after it rendered.
    await expect(customer.getByTestId('message-FINAL').getByAltText('Bản cuối')).toBeInViewport();

    await designer.getByRole('button', { name: 'Hoàn thành', exact: true }).click();
    await designer.screenshot({ path: 'test-results/designer-before-done.png', fullPage: true });
    await customer.screenshot({ path: 'test-results/customer-chat.png', fullPage: true });
    await designer.getByRole('button', { name: 'Xác nhận hoàn thành' }).click();
    await expect(designer.getByRole('status').filter({ hasText: 'Task đã hoàn thành.' })).toBeVisible();
  });

  await test.step('the customer moves to the views without reloading', async () => {
    const front = customer.getByTestId('view-FRONT');
    await expect(front.getByText('Đã duyệt')).toBeVisible();
    await expect(front.getByAltText('Mặt trước')).toBeVisible();

    for (const type of ['view-BACK', 'view-CLOSE_UP']) {
      await customer.getByTestId(type).getByRole('button', { name: 'Duyệt' }).click();
      await expect(customer.getByTestId(type).getByText('Đã duyệt')).toBeVisible();
    }

    await customer.getByRole('button', { name: 'Chốt sản phẩm' }).click();
    await customer.getByRole('button', { name: 'Chốt sản phẩm' }).click();
    await expect(customer.getByText('Sản phẩm đã được chốt.')).toBeVisible();
    await customer.screenshot({ path: 'test-results/customer-locked.png', fullPage: true });
  });

  await test.step('the locked product and the designer are as they should be', async () => {
    const workspace = await request.get(`${API}/design/sessions/${sessionId}/workspace`, {
      headers: auth(customerToken),
    });
    const { lockedProductId } = await workspace.json();
    const locked = await (
      await request.get(`${API}/design/locked-products/${lockedProductId}`, {
        headers: auth(customerToken),
      })
    ).json();
    expect(locked.source).toBe('DESIGNER');
    expect(locked.views.map((view: { type: string }) => view.type).sort()).toEqual([
      'BACK',
      'CLOSE_UP',
      'FRONT',
    ]);

    await designer.goto('/designer');
    await expect(designer.getByText('Rảnh')).toBeVisible();
    await expect(designer.getByTestId('past-tasks').getByRole('link')).toHaveCount(1);
    await designer.screenshot({ path: 'test-results/designer-area.png', fullPage: true });
  });
});
