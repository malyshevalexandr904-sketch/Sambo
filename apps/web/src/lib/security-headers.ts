// Заголовки безопасности всех ответов web (SECURITY.md, 6); CSP с nonce — в middleware.
// Камера разрешена только своему origin: сканер QR на прибытии (Phase 4b) снимает с камеры планшета.
// `camera=()` запретил бы её и нашей странице — getUserMedia отказывал бы даже по HTTPS.
// Микрофон — тоже только своему origin: режим «по свистку» на планшете ковра слушает свисток арбитра (07.11.2026).
export const PERMISSIONS_POLICY = 'camera=(self), microphone=(self), geolocation=()';

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];
