import { Module } from '@nestjs/common';
import { FilesController } from './api/files.controller';
import { FilesService } from './application/files.service';

@Module({ controllers: [FilesController], providers: [FilesService], exports: [FilesService] })
export class FilesModule {}
