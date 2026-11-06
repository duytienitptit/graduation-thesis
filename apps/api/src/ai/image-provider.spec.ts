import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { createImageProvider } from './ai.module.js';
import { FakeImageProvider } from './fake-image.provider.js';
import { ImageProviderError } from './image-provider.js';
import { NANO_BANANA_2, NanoBananaProvider } from './nano-banana.provider.js';

const SECRET = 'test-secret-key';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

const imageBody = {
  candidates: [
    {
      content: {
        parts: [
          { text: 'here you go' },
          { inlineData: { mimeType: 'image/png', data: Buffer.from('pixels').toString('base64') } },
        ],
      },
    },
  ],
};

describe('FakeImageProvider', () => {
  it('returns a free PNG that depends on the prompt', async () => {
    const provider = new FakeImageProvider();
    const one = await provider.generate({ prompt: 'one', images: [] });
    const two = await provider.generate({ prompt: 'two', images: [] });
    expect([...one.image.data.subarray(0, 4)]).toEqual(PNG_SIGNATURE);
    expect(one.costUsd).toBe(0);
    expect(one.image.data.equals(two.image.data)).toBe(false);
  });
});

describe('NanoBananaProvider', () => {
  const provider = new NanoBananaProvider(SECRET);
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const generate = () => provider.generate({ prompt: 'a shirt', images: [] });

  it('sends the prompt and reference images, with the key only in a header', async () => {
    fetchMock.mockResolvedValue(json(200, imageBody));
    await provider.generate({
      prompt: 'a shirt',
      images: [{ mimeType: 'image/jpeg', data: Buffer.from('logo') }],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`${NANO_BANANA_2}:generateContent`);
    expect(url).not.toContain(SECRET);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(SECRET);

    const parts = JSON.parse(init.body as string).contents[0].parts;
    expect(parts[0]).toEqual({ text: 'a shirt' });
    expect(parts[1].inline_data).toEqual({
      mime_type: 'image/jpeg',
      data: Buffer.from('logo').toString('base64'),
    });
  });

  it('returns the image, model and cost', async () => {
    fetchMock.mockResolvedValue(json(200, imageBody));
    const result = await generate();
    expect(result.image.data.toString()).toBe('pixels');
    expect(result.image.mimeType).toBe('image/png');
    expect(result.model).toBe(NANO_BANANA_2);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [403, false],
  ])('treats HTTP %i as retryable: %s', async (status, retryable) => {
    fetchMock.mockResolvedValue(json(status, { error: { message: `bad key ${SECRET}` } }));
    const error = (await generate().catch((e) => e)) as ImageProviderError;
    expect(error).toBeInstanceOf(ImageProviderError);
    expect(error.retryable).toBe(retryable);
    expect(error.message).not.toContain(SECRET);
  });

  it('retries a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    const error = (await generate().catch((e) => e)) as ImageProviderError;
    expect(error.retryable).toBe(true);
  });

  it('reports a blocked request without retrying', async () => {
    fetchMock.mockResolvedValue(json(200, { promptFeedback: { blockReason: 'SAFETY' } }));
    const error = (await generate().catch((e) => e)) as ImageProviderError;
    expect(error.message).toContain('SAFETY');
    expect(error.retryable).toBe(false);
  });

  it('reports a reply with no image', async () => {
    fetchMock.mockResolvedValue(
      json(200, { candidates: [{ content: { parts: [{ text: 'no' }] }, finishReason: 'STOP' }] }),
    );
    const error = (await generate().catch((e) => e)) as ImageProviderError;
    expect(error.message).toContain('STOP');
  });
});

describe('createImageProvider', () => {
  const config = (values: Record<string, string>) =>
    new ConfigService(values) as ConfigService;

  it('uses the fake provider unless told otherwise', () => {
    const before = process.env.IMAGE_PROVIDER;
    delete process.env.IMAGE_PROVIDER;
    try {
      expect(createImageProvider(config({}))).toBeInstanceOf(FakeImageProvider);
    } finally {
      if (before !== undefined) process.env.IMAGE_PROVIDER = before;
    }
  });

  it('uses Nano Banana when configured', () => {
    const provider = createImageProvider(
      config({ IMAGE_PROVIDER: 'nano-banana', GEMINI_API_KEY: SECRET }),
    );
    expect(provider).toBeInstanceOf(NanoBananaProvider);
  });

  it('refuses to start with an unknown provider', () => {
    expect(() => createImageProvider(config({ IMAGE_PROVIDER: 'other' }))).toThrow('other');
  });
});
