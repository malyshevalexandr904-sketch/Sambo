export { Prisma, PrismaClient } from '../generated/client/index.js';
export type * from '../generated/client/index.js';
export { publicId, uuidv7 } from './uuid';
export {
  DUPLICATE_SIMILARITY_THRESHOLD,
  findAthleteDuplicates,
  findExactPersons,
  normalizeName,
} from './people';
export { createPrismaClient, type DbClient, type Tx } from './client';
