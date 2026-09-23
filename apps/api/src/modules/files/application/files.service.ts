// Файлы: presigned-загрузка, проверка после загрузки, выдача ссылок (API.md, 3.5; ADR-14).
import { Injectable } from '@nestjs/common';
import {
  type DownloadUrl,
  type FileBucket,
  type StoredFileDto,
  UPLOAD_POLICIES,
  type UploadPurpose,
  type UploadRequest,
  type UploadTicket,
} from '@sde/contracts';
import { type StoredFile, type Tx, uuidv7 } from '@sde/db';
import { sha256Hex } from '@sde/server-kit';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { AuditService, DataAccessLogService } from '../../audit';
import { extensionFor, sanitizeFileName, signatureMatches } from '../domain/signature';

const UPLOAD_TTL_SECONDS = 600;
const DOWNLOAD_TTL_SECONDS = 60;

/** Кто может загружать файл с данной целью. Цели без политики запрещены (deny by default). */
export type UploadPurposePolicy = (user: AuthUser) => Promise<boolean>;
/** Кто может скачать приватный файл данной цели (документ → document.view, Phase 3). */
export type FileAccessPolicy = (user: AuthUser, file: StoredFile) => Promise<boolean>;

/** Ключ в приватном хранилище, куда загружаются публичные медиа до проверки. */
const stagingKey = (fileId: string): string => `incoming/${fileId}`;

@Injectable()
export class FilesService {
  private readonly uploadPolicies = new Map<UploadPurpose, UploadPurposePolicy>();
  private readonly accessPolicies = new Map<UploadPurpose, FileAccessPolicy>();

  constructor(
    private readonly db: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly accessLog: DataAccessLogService,
  ) {
    // Phase 2: логотип организации может загрузить любой вошедший с подтверждённым email —
    // файл привязывается к организации отдельно, при проверке права organization.update.
    this.registerUploadPolicy('ORGANIZATION_LOGO', (user) => Promise.resolve(user.emailVerified));
  }

  registerUploadPolicy(purpose: UploadPurpose, policy: UploadPurposePolicy): void {
    this.uploadPolicies.set(purpose, policy);
  }

  registerAccessPolicy(purpose: UploadPurpose, policy: FileAccessPolicy): void {
    this.accessPolicies.set(purpose, policy);
  }

  toDto(file: StoredFile): StoredFileDto {
    return {
      id: file.id,
      bucket: file.bucket,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: Number(file.sizeBytes),
      sha256: file.sha256,
      status: file.status,
      createdAt: file.createdAt.toISOString(),
      publicUrl: file.bucket === 'PUBLIC_MEDIA' && file.status === 'AVAILABLE' ? this.storage.publicUrl(file.storageKey) : null,
    };
  }

  publicUrl(storageKey: string): string {
    return this.storage.publicUrl(storageKey);
  }

  async createUpload(user: AuthUser, req: UploadRequest): Promise<UploadTicket> {
    const policy = UPLOAD_POLICIES[req.purpose];
    const allowed = this.uploadPolicies.get(req.purpose);
    if (!allowed || !(await allowed(user))) throw new DomainError('FORBIDDEN', { purpose: req.purpose });
    if (!policy.mimeTypes.includes(req.mimeType)) {
      throw new DomainError('UNSUPPORTED_FILE_TYPE', { allowed: policy.mimeTypes });
    }
    if (req.sizeBytes > policy.maxSizeBytes) throw new DomainError('FILE_TOO_LARGE', { maxSizeBytes: policy.maxSizeBytes });

    const id = uuidv7();
    const now = new Date();
    const prefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const storageKey = `${prefix}/${id}.${extensionFor(req.mimeType)}`;
    await this.db.storedFile.create({
      data: {
        id,
        bucket: policy.bucket,
        purpose: req.purpose,
        storageKey,
        originalName: sanitizeFileName(req.fileName),
        mimeType: req.mimeType,
        sizeBytes: BigInt(req.sizeBytes),
        sha256: req.sha256,
        uploadedById: user.id,
      },
    });
    const target = this.uploadTarget({ id, bucket: policy.bucket, storageKey });
    const post = await this.storage.presignPost(target.bucket, target.key, {
      contentType: req.mimeType,
      maxSizeBytes: req.sizeBytes,
      expiresSeconds: UPLOAD_TTL_SECONDS,
    });
    return { fileId: id, uploadUrl: post.url, fields: post.fields, expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString() };
  }

  /** Публичные медиа загружаются в приватное хранилище и публикуются только после проверки. */
  private uploadTarget(file: { id: string; bucket: FileBucket; storageKey: string }): { bucket: FileBucket; key: string } {
    return file.bucket === 'PUBLIC_MEDIA'
      ? { bucket: 'PRIVATE_DOCUMENTS', key: stagingKey(file.id) }
      : { bucket: file.bucket, key: file.storageKey };
  }

  /** Проверка размера, SHA-256 и сигнатуры. Несовпадение — файл удаляется и отклоняется. */
  async complete(user: AuthUser, fileId: string): Promise<StoredFileDto> {
    const file = await this.db.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.uploadedById !== user.id) throw new DomainError('NOT_FOUND', { resource: 'file' });
    if (file.status === 'AVAILABLE') return this.toDto(file);
    if (file.status !== 'PENDING_UPLOAD') throw new DomainError('INVALID_TRANSITION', { from: file.status, to: 'AVAILABLE', allowed: [] });

    const target = this.uploadTarget(file);
    const info = await this.storage.head(target.bucket, target.key);
    const content = info ? await this.storage.read(target.bucket, target.key) : null;
    const valid =
      content !== null &&
      content.length === Number(file.sizeBytes) &&
      sha256Hex(content) === file.sha256 &&
      signatureMatches(file.mimeType, content);
    if (!valid) {
      if (info) await this.storage.delete(target.bucket, target.key);
      await this.db.storedFile.update({ where: { id: file.id }, data: { status: 'REJECTED' } });
      throw new DomainError('FILE_CONTENT_MISMATCH');
    }
    if (file.bucket === 'PUBLIC_MEDIA') {
      await this.storage.copy(target, { bucket: 'PUBLIC_MEDIA', key: file.storageKey }, file.mimeType);
      await this.storage.delete(target.bucket, target.key);
    }
    const updated = await this.db.tx(async (tx) => {
      const saved = await tx.storedFile.update({ where: { id: file.id }, data: { status: 'AVAILABLE', verifiedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'file.uploaded',
        entityType: 'StoredFile',
        entityId: file.id,
        after: { purpose: file.purpose, mimeType: file.mimeType, sizeBytes: Number(file.sizeBytes) },
      });
      return saved;
    });
    return this.toDto(updated);
  }

  async downloadUrl(user: AuthUser, fileId: string): Promise<DownloadUrl> {
    const file = await this.db.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.status !== 'AVAILABLE' || file.deletedAt) throw new DomainError('NOT_FOUND', { resource: 'file' });
    if (file.bucket === 'PUBLIC_MEDIA') {
      return { url: this.storage.publicUrl(file.storageKey), expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    }
    const policy = this.accessPolicies.get(file.purpose as UploadPurpose);
    const allowed = policy ? await policy(user, file) : file.uploadedById === user.id;
    if (!allowed) {
      await this.accessLog.record('DENIED', 'StoredFile', file.id);
      throw new DomainError('NOT_FOUND', { resource: 'file' });
    }
    const url = await this.storage.presignGet(file.bucket, file.storageKey, DOWNLOAD_TTL_SECONDS, file.originalName);
    await this.accessLog.record('DOWNLOAD', 'StoredFile', file.id);
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString() };
  }

  /**
   * Файл можно привязать к сущности, только если его загрузил этот же пользователь, он проверен
   * и загружен с нужной целью (API.md, 3.4: logoFileId).
   */
  async assertAttachable(tx: Tx, fileId: string, userId: string, purpose: UploadPurpose, field: string): Promise<void> {
    const file = await tx.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.uploadedById !== userId || file.status !== 'AVAILABLE' || file.purpose !== purpose) {
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: field, code: 'invalid_file' }] });
    }
  }
}
