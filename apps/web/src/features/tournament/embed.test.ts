import { describe, expect, it } from 'vitest';
import { embedUrl } from './embed';

describe('embedUrl', () => {
  it('YouTube: обычная ссылка, короткая и прямой эфир', () => {
    expect(embedUrl('https://www.youtube.com/watch?v=abc123')).toBe(
      'https://www.youtube-nocookie.com/embed/abc123',
    );
    expect(embedUrl('https://youtu.be/abc123')).toBe('https://www.youtube-nocookie.com/embed/abc123');
    expect(embedUrl('https://www.youtube.com/live/xyz')).toBe('https://www.youtube-nocookie.com/embed/xyz');
  });

  it('Rutube и VK Видео', () => {
    expect(embedUrl('https://rutube.ru/video/0a1b2c3d/')).toBe('https://rutube.ru/play/embed/0a1b2c3d');
    expect(embedUrl('https://vk.com/video-123_456')).toBe(
      'https://vk.com/video_ext.php?oid=-123&id=456&hd=2',
    );
    expect(embedUrl('https://vkvideo.ru/video-123_456')).toBe(
      'https://vk.com/video_ext.php?oid=-123&id=456&hd=2',
    );
  });

  it('другие сайты и мусор — только ссылкой', () => {
    expect(embedUrl('https://example.com/stream')).toBeNull();
    expect(embedUrl('not a url')).toBeNull();
  });
});
