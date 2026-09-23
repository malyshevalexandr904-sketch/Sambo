import { Module } from '@nestjs/common';
import { AdminDictionariesController, DictionariesController } from './api/dictionaries.controller';
import { DictionariesService } from './application/dictionaries.service';

@Module({
  controllers: [DictionariesController, AdminDictionariesController],
  providers: [DictionariesService],
  exports: [DictionariesService],
})
export class DictionariesModule {}
