import { Global, Module } from '@nestjs/common';
import { CsrfGuard, CsrfService } from './csrf';
import { RateLimitGuard, RateLimitService } from './rate-limit';

@Global()
@Module({
  providers: [CsrfService, CsrfGuard, RateLimitService, RateLimitGuard],
  exports: [CsrfService, CsrfGuard, RateLimitService, RateLimitGuard],
})
export class SecurityModule {}
