// Сведения об операторе ПДн для политики и текста согласия (152-ФЗ, ст. 9, ч. 4; ст. 18.1). Берутся из окружения
// сервера (deploy/server/.env, docs/DEPLOYMENT.md): сайт перечитывает их при каждом запросе, пересборка не нужна.

export interface Operator {
  /** Полное наименование юрлица или ФИО индивидуального предпринимателя. */
  name: string | null;
  /** ИНН и ОГРН (ОГРНИП) одной строкой. */
  registry: string | null;
  address: string | null;
  email: string | null;
}

const value = (v: string | undefined): string | null => (v && v.trim() !== '' ? v.trim() : null);

export function operator(): Operator {
  return {
    name: value(process.env.OPERATOR_NAME),
    registry: value(process.env.OPERATOR_REGISTRY),
    address: value(process.env.OPERATOR_ADDRESS),
    email: value(process.env.OPERATOR_EMAIL),
  };
}
