import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { FilePurpose } from '../../generated/prisma/enums.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import { AuthUser } from '../auth/auth.port.js';
import { ALLOWED_MIME_TYPES, AllowedMimeType, FilesPort, MAX_FILE_SIZE } from './files.port.js';

// AI images are stored by the backend, never uploaded by a client.
const CLIENT_PURPOSES: FilePurpose[] = [
  FilePurpose.REFERENCE,
  FilePurpose.CHAT,
  FilePurpose.FINAL_DESIGN,
];

class CreateUploadDto {
  @IsIn(ALLOWED_MIME_TYPES)
  mimeType!: AllowedMimeType;

  @IsInt()
  @Min(1)
  @Max(MAX_FILE_SIZE)
  size!: number;

  @IsIn(CLIENT_PURPOSES)
  purpose!: FilePurpose;
}

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesPort) {}

  @Post('upload-url')
  createUpload(@CurrentUser() user: AuthUser, @Body() body: CreateUploadDto) {
    return this.files.createUpload(user, body);
  }

  @Post(':id/complete')
  @HttpCode(204)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.completeUpload(user, id);
  }

  @Get(':id/download-url')
  downloadUrl(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.getDownloadLink(user, id);
  }
}
