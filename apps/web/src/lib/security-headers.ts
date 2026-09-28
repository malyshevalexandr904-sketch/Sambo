// Заголовки безопасности всех ответов web (SECURITY.md, 6); CSP с nonce — в middleware.
// Камера разрешена только своему origin: сканер QR на прибытии (Phase 4b) снимает с камеры планшета.
// `camera=()` запретил бы её и нашей странице — getUserMedia отказывал бы даже по HTTPS.
export const PERMISSIONS_POLICY = 'camera=(self), microphone=(), geolocation=()';

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];
