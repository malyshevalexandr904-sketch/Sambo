// Простые контурные значки интерфейса (24×24, цвет — currentColor). Декоративные: подпись всегда рядом текстом.
import type { ReactNode } from 'react';

const PATHS = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  flag: <path d="M5 21V4m0 0h11l-2 4 2 4H5" />,
  clipboard: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4h6v3H9zM9 12h6M9 16h4" />
    </>
  ),
  whistle: (
    <>
      <circle cx="9" cy="14" r="5" />
      <path d="M12 10.5 20 7v4l-6 1.5M9 14h.01" />
    </>
  ),
  megaphone: <path d="M4 10v4h3l7 4V6L7 10H4zM17 9a4 4 0 0 1 0 6" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </>
  ),
  file: (
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h4" />
    </>
  ),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  scale: <path d="M12 4v16M5 20h14M5 8h14M7 8l-3 6a3 3 0 0 0 6 0zM17 8l-3 6a3 3 0 0 0 6 0z" />,
  book: <path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  shield: <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6zM9 12l2 2 4-4" />,
  bell: <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />,
  building: <path d="M4 21V5l8-2v18M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20" />,
  trophy: (
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6v4H9z" />
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  medal: (
    <>
      <path d="M8 3h3l1 5M16 3h-3l-1 5" />
      <circle cx="12" cy="15" r="6" />
    </>
  ),
  chart: <path d="M4 20V4M4 20h16M7 15l4-4 3 3 5-6" />,
  swords: <path d="M14 4h6v6L9 21l-6-6zM4 4h6l2 2M20 20l-4-4M4 20l4-4" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z" />
      <path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8M16 7l2 2M14 9l2 2" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v12H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
