import { Module } from '@nestjs/common';
import { LocalLeakedPasswordChecker } from '@sde/server-kit';
import { UsersModule } from '../users';
import { AuthController } from './api/auth.controller';
import { AuthGuard } from './api/auth.guard';
import { AuthService, LEAKED_PASSWORD_CHECKER } from './application/auth.service';
import { SessionService } from './application/session.service';
import { TotpService } from './application/totp.service';
import { VerificationTokenService } from './application/verification-token.service';
import { JwtService } from './infrastructure/jwt.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    TotpService,
    VerificationTokenService,
    JwtService,
    AuthGuard,
    { provide: LEAKED_PASSWORD_CHECKER, useClass: LocalLeakedPasswordChecker },
  ],
  exports: [AuthGuard, SessionService, VerificationTokenService, JwtService],
})
export class AuthModule {}
