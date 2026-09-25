import { Module } from '@nestjs/common';
import { PeopleService } from './application/people.service';

/** Люди: без собственных маршрутов, используется модулями профилей и «я». */
@Module({ providers: [PeopleService], exports: [PeopleService] })
export class PeopleModule {}
