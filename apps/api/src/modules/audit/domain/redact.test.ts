import { describe, expect, it } from 'vitest';
import { auditDiff, REDACTED } from './redact';

describe('auditDiff', () => {
  it('keeps only changed fields and redacts personal data', () => {
    const d = auditDiff(
      { name: 'Клуб', lastName: 'Иванов', status: 'ACTIVE', version: 1, updatedAt: new Date() },
      { name: 'Клуб «Витязь»', lastName: 'Петров', status: 'ACTIVE', version: 2, updatedAt: new Date() },
    );
    expect(d.before).toEqual({ name: 'Клуб', lastName: REDACTED });
    expect(d.after).toEqual({ name: 'Клуб «Витязь»', lastName: REDACTED });
  });

  it('redacts nested secrets on creation', () => {
    const d = auditDiff(null, { email: 'a@b.ru', legalDetails: { inn: '7700000000' }, slug: 'club' });
    expect(d.before).toBeNull();
    expect(d.after).toEqual({ email: REDACTED, legalDetails: { inn: REDACTED }, slug: 'club' });
    expect(JSON.stringify(d)).not.toContain('a@b.ru');
    expect(JSON.stringify(d)).not.toContain('7700000000');
  });
});
