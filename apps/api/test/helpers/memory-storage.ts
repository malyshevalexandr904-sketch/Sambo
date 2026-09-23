import type { FileBucket } from '@sde/contracts';
import { type PresignedPost, StorageService, type StoredObjectInfo } from '../../src/infrastructure/storage/storage.service';

/** Хранилище в памяти вместо S3: проверяется логика API, а не провайдер. S3 проверяется в CI (MinIO). */
export class MemoryStorage extends StorageService {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  private k(bucket: FileBucket, key: string): string {
    return `${bucket}/${key}`;
  }

  put(bucket: FileBucket, key: string, body: Buffer, contentType = 'application/octet-stream'): void {
    this.objects.set(this.k(bucket, key), { body, contentType });
  }

  async presignPost(bucket: FileBucket, key: string): Promise<PresignedPost> {
    return { url: `memory://${bucket}`, fields: { key, bucket } };
  }

  async head(bucket: FileBucket, key: string): Promise<StoredObjectInfo | null> {
    const o = this.objects.get(this.k(bucket, key));
    return o ? { sizeBytes: o.body.length, contentType: o.contentType } : null;
  }

  async read(bucket: FileBucket, key: string): Promise<Buffer> {
    const o = this.objects.get(this.k(bucket, key));
    if (!o) throw new Error('NoSuchKey');
    return o.body;
  }

  async copy(from: { bucket: FileBucket; key: string }, to: { bucket: FileBucket; key: string }, contentType: string): Promise<void> {
    const o = await this.read(from.bucket, from.key);
    this.put(to.bucket, to.key, o, contentType);
  }

  async delete(bucket: FileBucket, key: string): Promise<void> {
    this.objects.delete(this.k(bucket, key));
  }

  async presignGet(bucket: FileBucket, key: string, expiresSeconds: number): Promise<string> {
    return `memory://${bucket}/${key}?expires=${expiresSeconds}`;
  }

  publicUrl(key: string): string {
    return `http://storage.test/test-public/${key}`;
  }

  async ping(): Promise<void> {
    return;
  }
}
