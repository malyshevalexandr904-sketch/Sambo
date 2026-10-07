// Публичный интерфейс модуля scheduling.
export { SchedulingModule } from './scheduling.module';
export { ScheduleQueriesService } from './application/schedule-queries.service';
export { CrewAccessService, type MatchResource } from './application/crew-access.service';
export { projectQueue, type QueueItem, type QueueProjection } from './domain/queue';
