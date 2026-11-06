import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Role } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthUser } from '../auth/auth.port.js';
import {
  CreateUploadInput,
  DownloadLink,
  FilesPort,
  IMAGE_MIME_TYPES,
  MAX_FILE_SIZE,
  StoredImage,
  UploadTicket,
} from './files.port.js';
import { createS3Client } from './s3.client.js';

const UPLOAD_URL_SECONDS = 5 * 60;
const DOWNLOAD_URL_SECONDS = 10 * 60;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};
const SIGNATURES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
};

/** Stand-in file service on MinIO. Files go straight from the browser to storage. */
@Injectable()
export class MinioFilesService extends FilesPort implements OnModuleInit, OnModuleDestroy {
  private readonly s3;
  private readonly bucket: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super();
    this.s3 = createS3Client(config);
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
  }

  async onModuleInit() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  onModuleDestroy() {
    this.s3.destroy();
  }

  async createUpload(user: AuthUser, input: CreateUploadInput): Promise<UploadTicket> {
    const id = randomUUID();
    const storageKey = `${input.purpose.toLowerCase()}/${user.id}/${id}.${EXTENSIONS[input.mimeType]}`;
    await this.prisma.fileObject.create({
      data: { id, ownerId: user.id, storageKey, ...input },
    });

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        ContentType: input.mimeType,
        ContentLength: input.size,
      }),
      {
        expiresIn: UPLOAD_URL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      fileId: id,
      uploadUrl,
      headers: { 'Content-Type': input.mimeType },
      expiresIn: UPLOAD_URL_SECONDS,
    };
  }

  /** Storage cannot judge content, so the real size and type are checked here. */
  async completeUpload(user: AuthUser, fileId: string) {
    const file = await this.findFile(fileId);
    if (file.ownerId !== user.id) throw new ForbiddenException();
    if (file.status === 'READY') return;

    const target = { Bucket: this.bucket, Key: file.storageKey };
    const head = await this.s3.send(new HeadObjectCommand(target)).catch(() => null);
    if (!head) throw new ConflictException('File has not been uploaded');

    const start = await this.s3.send(new GetObjectCommand({ ...target, Range: 'bytes=0-7' }));
    const bytes = await start.Body!.transformToByteArray();
    const validType = SIGNATURES[file.mimeType].every((byte, index) => bytes[index] === byte);

    if (!validType || (head.ContentLength ?? 0) > MAX_FILE_SIZE) {
      await this.s3.send(new DeleteObjectCommand(target));
      await this.prisma.fileObject.delete({ where: { id: file.id } });
      throw new BadRequestException('File must be a PNG, JPG or PDF of at most 10 MB');
    }

    await this.prisma.fileObject.update({ where: { id: file.id }, data: { status: 'READY' } });
  }

  async getDownloadLink(user: AuthUser, fileId: string): Promise<DownloadLink> {
    const file = await this.findFile(fileId);
    if (file.ownerId !== user.id && user.role !== Role.MANAGER) throw new ForbiddenException();
    return this.linkTo(file);
  }

  async getLink(fileId: string) {
    return this.linkTo(await this.findFile(fileId));
  }

  private async linkTo(file: { status: string; storageKey: string }): Promise<DownloadLink> {
    if (file.status !== 'READY') throw new ConflictException('File has not been uploaded');

    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: file.storageKey }),
      { expiresIn: DOWNLOAD_URL_SECONDS },
    );
    return { url, expiresIn: DOWNLOAD_URL_SECONDS };
  }

  async saveImage(ownerId: string, image: StoredImage) {
    const id = randomUUID();
    const extension = EXTENSIONS[image.mimeType] ?? 'bin';
    const storageKey = `ai_image/${ownerId}/${id}.${extension}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: image.data,
        ContentType: image.mimeType,
      }),
    );
    await this.prisma.fileObject.create({
      data: {
        id,
        ownerId,
        storageKey,
        mimeType: image.mimeType,
        size: image.data.length,
        purpose: 'AI_IMAGE',
        status: 'READY',
      },
    });
    return id;
  }

  async readImage(fileId: string): Promise<StoredImage> {
    const file = await this.findFile(fileId);
    const object = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: file.storageKey }),
    );
    return {
      mimeType: file.mimeType,
      data: Buffer.from(await object.Body!.transformToByteArray()),
    };
  }

  async ownsReadyFiles(
    user: AuthUser,
    fileIds: string[],
    mimeTypes: readonly string[] = IMAGE_MIME_TYPES,
  ) {
    const count = await this.prisma.fileObject.count({
      where: {
        id: { in: fileIds },
        ownerId: user.id,
        status: 'READY',
        mimeType: { in: [...mimeTypes] },
      },
    });
    return count === new Set(fileIds).size;
  }

  private async findFile(id: string) {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!file) throw new NotFoundException();
    return file;
  }
}
