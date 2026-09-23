// Отправка писем: SMTP (провайдер в РФ; Mailpit локально) или лог (разработка и тесты).
import type { Env, Logger } from '@sde/server-kit';
import nodemailer from 'nodemailer';
import type { RenderedEmail } from './templates';

export interface Mailer {
  send(to: string, email: RenderedEmail): Promise<{ messageId: string | null }>;
}

class SmtpMailer implements Mailer {
  private readonly transport: nodemailer.Transporter;

  constructor(
    private readonly env: Env,
  ) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
    });
  }

  async send(to: string, email: RenderedEmail): Promise<{ messageId: string | null }> {
    const info = (await this.transport.sendMail({ from: this.env.EMAIL_FROM, to, ...email })) as { messageId?: string };
    return { messageId: info.messageId ?? null };
  }
}

/** Только разработка и тесты: в лог пишется тема письма, но не адрес и не ссылки (SECURITY.md, 7). */
class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async send(_to: string, email: RenderedEmail): Promise<{ messageId: string | null }> {
    this.logger.info({ subject: email.subject }, 'Email (log provider): not delivered');
    return { messageId: null };
  }
}

export function createMailer(env: Env, logger: Logger): Mailer {
  return env.EMAIL_PROVIDER === 'smtp' ? new SmtpMailer(env) : new LogMailer(logger);
}
