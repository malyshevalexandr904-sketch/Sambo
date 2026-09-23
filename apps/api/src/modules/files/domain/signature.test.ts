import { describe, expect, it } from 'vitest';
import { sanitizeFileName, signatureMatches } from './signature';

describe('file signature', () => {
  it('accepts real PNG, JPEG, PDF, WebP', () => {
    expect(
      signatureMatches('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe(true);
    expect(signatureMatches('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(signatureMatches('application/pdf', Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(signatureMatches('image/webp', Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe(true);
  });

  it('rejects a disguised file', () => {
    expect(signatureMatches('image/png', Buffer.from('<svg onload=alert(1)>'))).toBe(false);
    expect(signatureMatches('application/pdf', Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(signatureMatches('text/csv', Buffer.from('<html><script>'))).toBe(false);
    expect(signatureMatches('image/svg+xml', Buffer.from('<svg/>'))).toBe(false);
  });

  it('sanitizes file names', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\x\\логотип клуба.png')).toBe('логотип клуба.png');
    expect(sanitizeFileName('..hidden')).toBe('hidden');
    expect(sanitizeFileName('a\u0000b<c>.pdf')).toBe('a_b_c_.pdf');
  });
});
