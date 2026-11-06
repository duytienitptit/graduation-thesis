import { FilePurpose } from '../../generated/prisma/enums.js';
import { AuthUser } from '../auth/auth.port.js';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface CreateUploadInput {
  mimeType: AllowedMimeType;
  size: number;
  purpose: FilePurpose;
}

export interface UploadTicket {
  fileId: string;
  uploadUrl: string;
  /** Send these exact headers with the PUT; the URL is signed for them. */
  headers: Record<string, string>;
  expiresIn: number;
}

export interface StoredImage {
  mimeType: string;
  data: Buffer;
}

export interface DownloadLink {
  url: string;
  expiresIn: number;
}

/**
 * What the app needs from file storage.
 * Person 2's file service replaces MinioFilesService by providing this token.
 */
export abstract class FilesPort {
  abstract createUpload(user: AuthUser, input: CreateUploadInput): Promise<UploadTicket>;
  abstract completeUpload(user: AuthUser, fileId: string): Promise<void>;
  abstract getDownloadLink(user: AuthUser, fileId: string): Promise<DownloadLink>;
  /** Stores an image the backend made, such as an AI result. */
  abstract saveImage(ownerId: string, image: StoredImage): Promise<string>;
  /** Reads a file for the backend. Callers check permission first. */
  abstract readImage(fileId: string): Promise<StoredImage>;
  /** True when every file is fully uploaded and belongs to this user. */
  abstract ownsReadyFiles(user: AuthUser, fileIds: string[]): Promise<boolean>;
}
