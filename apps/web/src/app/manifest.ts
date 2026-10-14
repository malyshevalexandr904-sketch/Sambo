// Манифест PWA (Phase 8b): установка на экран «Домой» и Web Push. На iPhone/iPad push работает только у сайта,
// добавленного на экран «Домой» (iOS 16.4+), — для этого и нужен манифест с display: standalone.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'SAMBO Digital',
    short_name: 'SAMBO',
    description: 'Турниры по самбо: заявки, жеребьёвка, табло, результаты',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1d4ed8',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
