import { createHash } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import { ImageProvider, ImageRequest, ImageResult } from './image-provider.js';

const SIZE = 256;

function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** A solid PNG whose colour depends on the prompt, so different prompts look different. */
function solidPng(red: number, green: number, blue: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 2, 0, 0, 0], 8);

  const row = Buffer.alloc(1 + SIZE * 3);
  for (let x = 0; x < SIZE; x++) row.set([red, green, blue], 1 + x * 3);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(SIZE).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** For development and tests: costs nothing and needs no key. */
export class FakeImageProvider extends ImageProvider {
  async generate({ prompt }: ImageRequest): Promise<ImageResult> {
    const [red, green, blue] = createHash('sha256').update(prompt).digest();
    return {
      image: { mimeType: 'image/png', data: solidPng(red, green, blue) },
      model: 'fake',
      costUsd: 0,
    };
  }
}
