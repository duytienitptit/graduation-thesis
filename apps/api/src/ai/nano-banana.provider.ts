import {
  ImageInput,
  ImageProvider,
  ImageProviderError,
  ImageRequest,
  ImageResult,
} from './image-provider.js';

export const NANO_BANANA_2 = 'gemini-3.1-flash-image';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 60_000;
// Third-party figure from the design doc. Check it against Google's price list.
const COST_PER_IMAGE_USD = 0.067;

interface GeminiPart {
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** Google's Nano Banana 2. The key goes in a header, so it never appears in a URL or a log. */
export class NanoBananaProvider extends ImageProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = NANO_BANANA_2,
  ) {
    super();
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    const body = await this.call(request);
    const image = this.extractImage(body);
    return { image, model: this.model, costUsd: COST_PER_IMAGE_USD };
  }

  private async call({ prompt, images }: ImageRequest) {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/${this.model}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                ...images.map((image) => ({
                  inline_data: {
                    mime_type: image.mimeType,
                    data: image.data.toString('base64'),
                  },
                })),
              ],
            },
          ],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
        }),
      });
    } catch {
      throw new ImageProviderError('Image API could not be reached', true);
    }

    if (!res.ok) {
      // A rate limit or a server fault may pass; anything else will fail the same way again.
      const retryable = res.status === 429 || res.status >= 500;
      throw new ImageProviderError(`Image API returned ${res.status}`, retryable);
    }
    return (await res.json()) as GeminiResponse;
  }

  private extractImage(body: GeminiResponse): ImageInput {
    const candidate = body.candidates?.[0];
    const part = candidate?.content?.parts?.find((candidatePart) => candidatePart.inlineData);
    if (part?.inlineData) {
      return {
        mimeType: part.inlineData.mimeType,
        data: Buffer.from(part.inlineData.data, 'base64'),
      };
    }

    const reason = body.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'unknown';
    throw new ImageProviderError(`Image API returned no image (${reason})`, false);
  }
}
