import { describe, expect, it } from 'vitest';
import { callPhrase, speakableName, winnerPhrase } from './announcer';

const pair = (red: string | null, blue: string | null) => ({ red: { publicName: red }, blue: { publicName: blue } });

describe('announcer phrases', () => {
  it('drops initials from public names', () => {
    expect(speakableName('Иванов И.')).toBe('Иванов');
    expect(speakableName('Петров-Водкин А. Б.')).toBe('Петров-Водкин');
    expect(speakableName('Сидоров')).toBe('Сидоров');
    expect(speakableName(null)).toBeNull();
    expect(speakableName('—')).toBeNull();
  });

  it('calls the pair red first, then who gets ready', () => {
    expect(callPhrase(2, pair('Иванов И.', 'Петров П.'), pair('Сидоров С.', 'Кузнецов К.'))).toEqual([
      'Ковёр 2.',
      'На ковёр вызываются: Иванов, Петров.',
      'Готовятся: Сидоров и Кузнецов.',
    ]);
  });

  it('omits «Готовятся» when the next pair is unknown', () => {
    expect(callPhrase(1, pair('Иванов И.', 'Петров П.'), null)).toHaveLength(2);
    expect(callPhrase(1, pair('Иванов И.', 'Петров П.'), pair('Сидоров С.', null))).toHaveLength(2);
    expect(callPhrase(1, pair('Иванов И.', null))).toEqual([]);
  });

  it('announces the winner only', () => {
    expect(winnerPhrase({ ...pair('Иванов И.', 'Петров П.'), result: { winnerSide: 'BLUE' } })).toEqual([
      'Победу одержал Петров.',
    ]);
    expect(winnerPhrase({ ...pair('Иванов И.', 'Петров П.'), result: { winnerSide: null } })).toEqual([]);
    expect(winnerPhrase({ ...pair('Иванов И.', 'Петров П.'), result: null })).toEqual([]);
  });
});
