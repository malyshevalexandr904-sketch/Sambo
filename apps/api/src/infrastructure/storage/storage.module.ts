import { Global, Module } from '@nestjs/common';
import { S3StorageService } from './s3-storage.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [{ provide: StorageService, useClass: S3StorageService }],
  exports: [StorageService],
})
export class StorageModule {}
