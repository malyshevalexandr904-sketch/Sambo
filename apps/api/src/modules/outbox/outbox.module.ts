import { Global, Module } from '@nestjs/common';
import { EmailRequestService, OutboxService } from './application/outbox.service';

@Global()
@Module({ providers: [OutboxService, EmailRequestService], exports: [OutboxService, EmailRequestService] })
export class OutboxModule {}
