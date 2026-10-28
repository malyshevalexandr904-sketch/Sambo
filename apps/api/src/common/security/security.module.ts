import { Global, Module } from '@nestjs/common';
import { CsrfGuard, CsrfService } from './csrf';
import { DemoReadOnlyGuard } from './demo';
import { RateLimitGuard, RateLimitService } from './rate-limit';

@Global()
@Module({
  providers: [CsrfService, CsrfGuard, RateLimitService, RateLimitGuard, DemoReadOnlyGuard],
  exports: [CsrfService, CsrfGuard, RateLimitService, RateLimitGuard, DemoReadOnlyGuard],
})
export class SecurityModule {}
