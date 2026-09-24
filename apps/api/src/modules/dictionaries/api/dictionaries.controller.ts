import { Body, Controller, Get, HttpCode, Put, Req, Res } from '@nestjs/common';
import { CountryCode, DICTIONARY_NAMES, DictionaryCodeParam, type DictionaryName } from '@sde/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ValidParam, ValidQuery } from '../../../common/validation/zod.pipe';
import { PLATFORM_SCOPE, Public, RequirePermission } from '../../access';
import { type CachedDictionary, DictionariesService } from '../application/dictionaries.service';

const RegionsQuery = z.object({ countryCode: CountryCode.default('RU') });

/** Ответ справочника с HTTP-кэшем и ETag (API.md, 3.7). */
function send<T>(req: Request, res: Response, dict: CachedDictionary<T>): { data: T[] } | undefined {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('ETag', dict.etag);
  if (req.header('if-none-match') === dict.etag) {
    res.status(304);
    return undefined;
  }
  return { data: dict.items };
}

@Controller('dictionaries')
@Public()
export class DictionariesController {
  constructor(private readonly dictionaries: DictionariesService) {}

  @Get('countries')
  async countries(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    return send(req, res, await this.dictionaries.countries());
  }

  @Get('regions')
  async regions(
    @ValidQuery(RegionsQuery) q: z.infer<typeof RegionsQuery>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    return send(req, res, await this.dictionaries.regions(q.countryCode));
  }

  @Get('sport-ranks')
  async sportRanks(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    return send(req, res, await this.dictionaries.sportRanks());
  }

  @Get('referee-categories')
  async refereeCategories(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    return send(req, res, await this.dictionaries.refereeCategories());
  }

  @Get('disciplines')
  async disciplines(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    return send(req, res, await this.dictionaries.disciplines());
  }

  @Get('document-types')
  async documentTypes(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    return send(req, res, await this.dictionaries.documentTypes());
  }
}

@Controller('admin/dictionaries')
export class AdminDictionariesController {
  constructor(private readonly dictionaries: DictionariesService) {}

  @Put(':name/:code')
  @RequirePermission('dictionary.manage', PLATFORM_SCOPE)
  @HttpCode(204)
  async upsert(
    @ValidParam('name', z.enum(DICTIONARY_NAMES)) name: DictionaryName,
    @ValidParam('code', DictionaryCodeParam) code: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.dictionaries.upsert(name, code, body);
  }
}
