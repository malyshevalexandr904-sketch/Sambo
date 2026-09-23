import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  AUTH_MODE_HEADER,
  type BearerLoginResponse,
  ChangePasswordRequest,
  COOKIE_REFRESH,
  type DataEnvelope,
  ForgotPasswordRequest,
  LoginRequest,
  type Me,
  RefreshRequest,
  RegisterRequest,
  ResetPasswordRequest,
  type SessionDto,
  type TokenPair,
  TokenRequest,
  TotpCodeRequest,
} from '@sde/contracts';
import type { Env } from '@sde/server-kit';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { CurrentUser } from '../../../common/context/current-user';
import { type AuthUser, RequestContextStore } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { ok } from '../../../common/http/http';
import { CsrfService } from '../../../common/security/csrf';
import { RateLimit } from '../../../common/security/rate-limit';
import { UuidParam, ValidBody, ZodValidationPipe } from '../../../common/validation/zod.pipe';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { Authenticated, Public } from '../../access';
import { AuthService, type LoginResult } from '../application/auth.service';
import { SessionService } from '../application/session.service';
import { TotpService } from '../application/totp.service';
import { clearSessionCookies, setCsrfCookie, setSessionCookies, tokenPair } from './cookies';

const wantsBearer = (req: Request): boolean => req.header(AUTH_MODE_HEADER)?.toLowerCase() === 'bearer';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly csrf: CsrfService,
    private readonly db: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Веб: сессия в cookie + новый CSRF-токен. Bearer-клиент: токены в теле. */
  private respond(req: Request, res: Response, result: LoginResult): DataEnvelope<Me | BearerLoginResponse> {
    if (wantsBearer(req)) return ok({ me: result.me, tokens: tokenPair(result.session) });
    setSessionCookies(res, result.session, this.env.COOKIE_SECURE);
    setCsrfCookie(res, this.csrf.issue(), this.env.COOKIE_SECURE);
    return ok(result.me);
  }

  @Get('csrf')
  @Public()
  csrfToken(@Res({ passthrough: true }) res: Response): DataEnvelope<{ csrfToken: string }> {
    const token = this.csrf.issue();
    setCsrfCookie(res, token, this.env.COOKIE_SECURE);
    return ok({ csrfToken: token });
  }

  @Post('register')
  @Public()
  @RateLimit('auth')
  @HttpCode(202)
  async register(@ValidBody(RegisterRequest) body: RegisterRequest): Promise<DataEnvelope<{ status: 'VERIFICATION_SENT' }>> {
    await this.auth.register(body);
    return ok({ status: 'VERIFICATION_SENT' });
  }

  @Post('verify-email')
  @Public()
  @RateLimit('auth')
  @HttpCode(200)
  async verifyEmail(
    @ValidBody(TokenRequest) body: z.infer<typeof TokenRequest>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Me | BearerLoginResponse>> {
    return this.respond(req, res, await this.auth.verifyEmail(body.token));
  }

  @Post('login')
  @Public()
  @RateLimit('auth')
  @HttpCode(200)
  async login(
    @ValidBody(LoginRequest) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Me | BearerLoginResponse>> {
    return this.respond(req, res, await this.auth.login(body));
  }

  @Post('refresh')
  @Public()
  @RateLimit('auth')
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(RefreshRequest.optional())) body: z.infer<typeof RefreshRequest> | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<TokenPair | { status: 'REFRESHED' }>> {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const raw = body?.refreshToken ?? cookies?.[COOKIE_REFRESH];
    if (!raw) throw new DomainError('REFRESH_TOKEN_INVALID');
    try {
      const session = await this.sessions.rotate(raw);
      if (body?.refreshToken || wantsBearer(req)) return ok(tokenPair(session));
      setSessionCookies(res, session, this.env.COOKIE_SECURE);
      return ok({ status: 'REFRESHED' });
    } catch (e) {
      if (!body?.refreshToken) clearSessionCookies(res, this.env.COOKIE_SECURE);
      throw e;
    }
  }

  @Post('logout')
  @Authenticated()
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(user.sessionId);
    clearSessionCookies(res, this.env.COOKIE_SECURE);
  }

  @Post('password/forgot')
  @Public()
  @RateLimit('auth')
  @HttpCode(202)
  async forgot(@ValidBody(ForgotPasswordRequest) body: z.infer<typeof ForgotPasswordRequest>): Promise<void> {
    await this.auth.forgotPassword(body.email, RequestContextStore.current().locale);
  }

  @Post('password/reset')
  @Public()
  @RateLimit('auth')
  @HttpCode(204)
  async reset(@ValidBody(ResetPasswordRequest) body: z.infer<typeof ResetPasswordRequest>): Promise<void> {
    await this.auth.resetPassword(body.token, body.newPassword);
  }

  @Post('password/change')
  @Authenticated()
  @RateLimit('auth')
  @HttpCode(204)
  async change(@CurrentUser() user: AuthUser, @ValidBody(ChangePasswordRequest) body: z.infer<typeof ChangePasswordRequest>): Promise<void> {
    await this.auth.changePassword(user.id, user.sessionId, body.currentPassword, body.newPassword);
  }

  @Get('sessions')
  @Authenticated()
  async listSessions(@CurrentUser() user: AuthUser): Promise<DataEnvelope<SessionDto[]>> {
    return ok(await this.sessions.list(user.id, user.sessionId));
  }

  @Delete('sessions/:id')
  @Authenticated()
  @HttpCode(204)
  async revokeSession(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<void> {
    if (!(await this.sessions.belongsTo(id, user.id))) throw new DomainError('NOT_FOUND', { resource: 'session' });
    await this.db.tx((tx) => this.sessions.revoke(tx, id, 'user_revoked'));
    await this.sessions.blockSessions([id]);
  }

  @Post('totp/setup')
  @Authenticated()
  @HttpCode(200)
  async totpSetup(@CurrentUser() user: AuthUser): Promise<DataEnvelope<{ otpauthUri: string }>> {
    return ok(await this.totp.setup(user.id));
  }

  @Post('totp/enable')
  @Authenticated()
  @RateLimit('auth')
  @HttpCode(200)
  async totpEnable(
    @CurrentUser() user: AuthUser,
    @ValidBody(TotpCodeRequest) body: z.infer<typeof TotpCodeRequest>,
  ): Promise<DataEnvelope<{ recoveryCodes: string[] }>> {
    return ok(await this.totp.enable(user.id, body.code));
  }

  @Post('totp/disable')
  @Authenticated()
  @RateLimit('auth')
  @HttpCode(204)
  async totpDisable(@CurrentUser() user: AuthUser, @ValidBody(TotpCodeRequest) body: z.infer<typeof TotpCodeRequest>): Promise<void> {
    await this.totp.disable(user.id, body.code);
  }
}
