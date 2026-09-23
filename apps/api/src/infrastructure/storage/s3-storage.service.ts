import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { FileBucket } from '@sde/contracts';
import type { Env } from '@sde/server-kit';
import { ENV } from '../../config/config.module';
import { type PresignedPost, StorageService, type StoredObjectInfo } from './storage.service';

@Injectable()
export class S3StorageService extends StorageService {
  private readonly client: S3Client;
  /** Клиент для подписи ссылок, которые открывает браузер (публичный адрес хранилища). */
  private readonly signer: S3Client;
  private readonly buckets: Record<FileBucket, string>;

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
    const common = {
      region: env.STORAGE_REGION,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY },
    };
    this.client = new S3Client({ ...common, endpoint: env.STORAGE_ENDPOINT });
    this.signer = new S3Client({ ...common, endpoint: env.STORAGE_PUBLIC_ENDPOINT ?? env.STORAGE_ENDPOINT });
    this.buckets = {
      PUBLIC_MEDIA: env.STORAGE_BUCKET_PUBLIC,
      PRIVATE_DOCUMENTS: env.STORAGE_BUCKET_PRIVATE,
      GENERATED: env.STORAGE_BUCKET_GENERATED,
    };
  }

  async presignPost(
    bucket: FileBucket,
    key: string,
    opts: { contentType: string; maxSizeBytes: number; expiresSeconds: number },
  ): Promise<PresignedPost> {
    const { url, fields } = await createPresignedPost(this.signer, {
      Bucket: this.buckets[bucket],
      Key: key,
      Expires: opts.expiresSeconds,
      Fields: { 'Content-Type': opts.contentType },
      Conditions: [
        ['eq', '$key', key],
        ['eq', '$Content-Type', opts.contentType],
        ['content-length-range', 1, opts.maxSizeBytes],
      ],
    });
    return { url, fields };
  }

  async head(bucket: FileBucket, key: string): Promise<StoredObjectInfo | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.buckets[bucket], Key: key }));
      return { sizeBytes: Number(res.ContentLength ?? 0), contentType: res.ContentType ?? null };
    } catch (e) {
      if (e instanceof NotFound || (e as { name?: string }).name === 'NotFound') return null;
      throw e;
    }
  }

  async read(bucket: FileBucket, key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }));
    if (!res.Body) return Buffer.alloc(0);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async copy(
    from: { bucket: FileBucket; key: string },
    to: { bucket: FileBucket; key: string },
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.buckets[to.bucket],
        Key: to.key,
        CopySource: `${this.buckets[from.bucket]}/${from.key}`,
        ContentType: contentType,
        MetadataDirective: 'REPLACE',
      }),
    );
  }

  async delete(bucket: FileBucket, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.buckets[bucket], Key: key }));
  }

  async presignGet(bucket: FileBucket, key: string, expiresSeconds: number, downloadName: string): Promise<string> {
    const safeName = encodeURIComponent(downloadName.replace(/["\\\r\n]/g, '_'));
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${safeName}`,
      }),
      { expiresIn: expiresSeconds },
    );
  }

  publicUrl(key: string): string {
    return `${this.env.STORAGE_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.buckets.PRIVATE_DOCUMENTS }));
  }
}
