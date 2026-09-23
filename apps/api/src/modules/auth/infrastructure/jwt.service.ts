// Access token: JWT HS256 с kid для ротации ключей (ARCHITECTURE.md, 6).
import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@sde/server-kit';
import { errors, jwtVerify, SignJWT } from 'jose';
import { ENV } from '../../../config/config.module';
import { DomainError } from '../../../common/errors/domain-error';
import { ACCESS_TOKEN_TTL_SECONDS } from '../domain/session-policy';

export interface AccessClaims {
  sub: string;
  sid: string;
  pv: number;
}

const ISSUER = 'sde';
const AUDIENCE = 'sde-api';

@Injectable()
export class JwtService {
  private readonly current: { kid: string; key: Uint8Array };
  private readonly keys: Map<string, Uint8Array>;

  constructor(@Inject(ENV) env: Env) {
    const enc = new TextEncoder();
    this.current = { kid: env.JWT_KID, key: enc.encode(env.JWT_SECRET) };
    this.keys = new Map([[env.JWT_KID, this.current.key]]);
    if (env.JWT_PREVIOUS_SECRET && env.JWT_PREVIOUS_KID)
      this.keys.set(env.JWT_PREVIOUS_KID, enc.encode(env.JWT_PREVIOUS_SECRET));
  }

  async sign(claims: AccessClaims, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ sid: claims.sid, pv: claims.pv })
      .setProtectedHeader({ alg: 'HS256', kid: this.current.kid, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.current.key);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  async verify(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(
        token,
        (header) => {
          const key = header.kid ? this.keys.get(header.kid) : undefined;
          if (!key) throw new DomainError('UNAUTHENTICATED');
          return key;
        },
        { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] },
      );
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.pv !== 'number'
      ) {
        throw new DomainError('UNAUTHENTICATED');
      }
      return { sub: payload.sub, sid: payload.sid, pv: payload.pv };
    } catch (e) {
      if (e instanceof errors.JWTExpired) throw new DomainError('TOKEN_EXPIRED');
      if (e instanceof DomainError) throw e;
      throw new DomainError('UNAUTHENTICATED');
    }
  }
}
