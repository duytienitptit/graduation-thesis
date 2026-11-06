export interface ImageInput {
  mimeType: string;
  data: Buffer;
}

export interface ImageRequest {
  prompt: string;
  /** Reference images sent along with the prompt. */
  images: ImageInput[];
}

export interface ImageResult {
  image: ImageInput;
  model: string;
  costUsd: number;
}

export class ImageProviderError extends Error {
  constructor(
    message: string,
    /** True when trying again may work, such as a rate limit or a server error. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Keeps the image API swappable. Only the backend ever calls this. */
export abstract class ImageProvider {
  abstract generate(request: ImageRequest): Promise<ImageResult>;
}
