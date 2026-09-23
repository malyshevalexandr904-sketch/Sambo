// Логирование: pino, JSON, redaction (ARCHITECTURE.md, 20; SECURITY.md, 7).
import pino, { type LoggerOptions } from 'pino';

/** Пути, которые никогда не попадают в лог. Проверяется тестом redaction. */
export const REDACT_PATHS: string[] = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'refreshToken',
  'accessToken',
  'totpCode',
  'code',
  'recoveryCodes',
  'secret',
  'sealedParams',
  'lastName',
  'firstName',
  'middleName',
  'birthDate',
  'email',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.totpCode',
  '*.code',
  '*.secret',
  '*.sealedParams',
  '*.lastName',
  '*.firstName',
  '*.middleName',
  '*.birthDate',
  '*.email',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'req.body',
  'headers.authorization',
  'headers.cookie',
];

export function loggerOptions(level: string, service: string): LoggerOptions {
  return {
    level,
    base: { service },
    messageKey: 'msg',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: { level: (label) => ({ level: label }) },
  };
}

export function createLogger(level: string, service: string, destination?: pino.DestinationStream): pino.Logger {
  return destination ? pino(loggerOptions(level, service), destination) : pino(loggerOptions(level, service));
}

export type Logger = pino.Logger;
