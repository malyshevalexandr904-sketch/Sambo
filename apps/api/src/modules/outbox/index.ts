export { OutboxModule } from './outbox.module';
export {
  EmailRequestService,
  OutboxService,
  type EmailRequest,
  type EnqueueEvent,
  type TxEvent,
  type TxEventHandler,
} from './application/outbox.service';
