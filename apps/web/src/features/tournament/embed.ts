// Встроенный плеер трансляции и видео (правки 05.11.2026): ссылка на ролик → адрес плеера для iframe.

/** Адрес встроенного плеера: YouTube, Rutube, VK Видео; иначе — null (только ссылка). */
export function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtube.com' && u.searchParams.get('v'))
      return `https://www.youtube-nocookie.com/embed/${u.searchParams.get('v')}`;
    if (host === 'youtube.com' && u.pathname.startsWith('/live/'))
      return `https://www.youtube-nocookie.com/embed/${u.pathname.split('/')[2]}`;
    if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed${u.pathname}`;
    const rutube = /^\/(?:video|live\/video)\/([a-z0-9]+)/i.exec(u.pathname);
    if (host === 'rutube.ru' && rutube) return `https://rutube.ru/play/embed/${rutube[1]}`;
    const vk = /video(-?\d+)_(\d+)/.exec(url);
    if ((host === 'vk.com' || host === 'vkvideo.ru') && vk)
      return `https://vk.com/video_ext.php?oid=${vk[1]}&id=${vk[2]}&hd=2`;
    return null;
  } catch {
    return null;
  }
}
