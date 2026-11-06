import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

export function createS3Client(config: ConfigService, maxAttempts?: number) {
  return new S3Client({
    endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
    region: config.getOrThrow<string>('S3_REGION'),
    forcePathStyle: true,
    maxAttempts,
    // Otherwise signed upload URLs demand a checksum that browsers do not send.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
      secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
    },
  });
}
