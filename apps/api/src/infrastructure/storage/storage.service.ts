// Хранилище файлов (ADR-14; ARCHITECTURE.md, 18). Интерфейс позволяет подменить S3 в тестах.
import type { FileBucket } from '@sde/contracts';

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

export interface StoredObjectInfo {
  sizeBytes: number;
  contentType: string | null;
}

export abstract class StorageService {
  /** Presigned POST с условиями на ключ, тип и размер. */
  abstract presignPost(
    bucket: FileBucket,
    key: string,
    opts: { contentType: string; maxSizeBytes: number; expiresSeconds: number },
  ): Promise<PresignedPost>;

  abstract head(bucket: FileBucket, key: string): Promise<StoredObjectInfo | null>;

  /** Содержимое объекта целиком (файлы ограничены 20 МБ политиками загрузки). */
  abstract read(bucket: FileBucket, key: string): Promise<Buffer>;

  abstract copy(
    from: { bucket: FileBucket; key: string },
    to: { bucket: FileBucket; key: string },
    contentType: string,
  ): Promise<void>;

  abstract delete(bucket: FileBucket, key: string): Promise<void>;

  abstract presignGet(
    bucket: FileBucket,
    key: string,
    expiresSeconds: number,
    downloadName: string,
  ): Promise<string>;

  abstract publicUrl(key: string): string;

  abstract ping(): Promise<void>;
}
