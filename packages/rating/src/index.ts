// Рейтинг спортсменов (docs/RATING_ARCHITECTURE.md): формула и правила (чистые функции), версии правил и расчёт
// схватки в БД — общий код api и worker.
export * from './elo.js';
export * from './rules.js';
export * from './rule-sets.js';
export * from './calculate.js';
export * from './sink.js';
export * from './rankings.js';
