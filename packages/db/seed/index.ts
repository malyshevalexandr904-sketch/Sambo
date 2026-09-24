// Seed для разработки (раздел 47 ТЗ; DATABASE.md, 11). Все данные вымышленные. Идемпотентен: повторный запуск
// обновляет те же записи. Спортсмены, турнир, категории и заявки добавляются в seed с Phase 3–4.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { hashPassword, sealTotpSecret, totpKey } from '@sde/server-kit';
import { type OrganizationType, PrismaClient, type RoleScope } from '../generated/client';
import { SEED_ORGANIZATIONS, SEED_USERS } from './data';

const envFile = path.resolve(__dirname, '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Seed: environment variable ${name} is required`);
  return value;
}

const today = new Date(new Date().toISOString().slice(0, 10));

async function seedOrganizations(db: PrismaClient): Promise<void> {
  for (const org of SEED_ORGANIZATIONS) {
    const region = await db.region.findUniqueOrThrow({ where: { code: org.regionCode } });
    const data = {
      type: org.type as OrganizationType,
      parentId: org.parentId,
      name: org.name,
      shortName: org.shortName,
      slug: org.slug,
      countryCode: 'RU',
      regionId: region.id,
      city: org.city,
      contactEmail: org.contactEmail,
      status: 'ACTIVE' as const,
    };
    await db.organization.upsert({ where: { id: org.id }, create: { id: org.id, ...data }, update: data });
    await db.$executeRaw`DELETE FROM organization_closure WHERE descendant_id = ${org.id}::uuid`;
    await db.$executeRaw`INSERT INTO organization_closure (ancestor_id, descendant_id, depth) VALUES (${org.id}::uuid, ${org.id}::uuid, 0)`;
    if (org.parentId) {
      await db.$executeRaw`
        INSERT INTO organization_closure (ancestor_id, descendant_id, depth)
        SELECT ancestor_id, ${org.id}::uuid, depth + 1 FROM organization_closure WHERE descendant_id = ${org.parentId}::uuid`;
    }
  }
}

async function seedUsers(
  db: PrismaClient,
  password: string,
  adminTotpSecret: string,
  key: Buffer,
): Promise<void> {
  const secretHash = await hashPassword(password);
  const roles = new Map(
    (await db.role.findMany()).map((r) => [r.code, r as { id: string; scope: RoleScope }]),
  );
  for (const u of SEED_USERS) {
    const personData = {
      lastName: u.person.lastName,
      firstName: u.person.firstName,
      birthDate: new Date(u.person.birthDate),
      gender: u.person.gender,
      countryCode: 'RU',
    };
    await db.person.upsert({
      where: { id: u.personId },
      create: { id: u.personId, ...personData },
      update: personData,
    });
    const userData = {
      email: u.email,
      displayName: u.displayName,
      status: 'ACTIVE' as const,
      emailVerifiedAt: today,
      locale: 'ru',
      personId: u.personId,
      totpSecretEnc: u.totp ? sealTotpSecret(key, u.id, adminTotpSecret) : null,
      totpEnabledAt: u.totp ? today : null,
      permissionsVersion: { increment: 1 },
    };
    await db.user.upsert({
      where: { id: u.id },
      create: { id: u.id, ...userData, permissionsVersion: 1 },
      update: userData,
    });
    await db.authIdentity.upsert({
      where: { provider_providerSubject: { provider: 'EMAIL_PASSWORD', providerSubject: u.email } },
      create: {
        id: u.identityId,
        userId: u.id,
        provider: 'EMAIL_PASSWORD',
        providerSubject: u.email,
        secretHash,
      },
      update: { secretHash },
    });
    for (const grant of u.grants) {
      const role = roles.get(grant.role);
      if (!role) throw new Error(`Seed: role ${grant.role} not found — apply migrations first`);
      if (!grant.organizationId) {
        const existing = await db.platformRoleAssignment.findFirst({
          where: { userId: u.id, roleId: role.id, revokedAt: null },
        });
        if (!existing)
          await db.platformRoleAssignment.create({ data: { id: grant.id, userId: u.id, roleId: role.id } });
        continue;
      }
      await db.organizationMembership.upsert({
        where: { id: grant.id },
        create: {
          id: grant.id,
          organizationId: grant.organizationId,
          userId: u.id,
          roleId: role.id,
          status: 'ACTIVE',
          validFrom: today,
        },
        update: { status: 'ACTIVE', validTo: null },
      });
    }
  }
}

async function main(): Promise<void> {
  const db = new PrismaClient({ datasourceUrl: required('DATABASE_URL') });
  try {
    const key = totpKey(required('TOTP_ENCRYPTION_KEY'));
    await seedOrganizations(db);
    await seedUsers(db, required('SEED_PASSWORD'), required('SEED_ADMIN_TOTP_SECRET'), key);
    process.stdout.write(
      [
        'Seed completed. Fictional accounts (password from SEED_PASSWORD):',
        ...SEED_USERS.map(
          (u) =>
            `  ${u.email.padEnd(28)} ${u.grants.map((g) => g.role).join(', ') || '—'}${u.totp ? '  [TOTP: SEED_ADMIN_TOTP_SECRET]' : ''}`,
        ),
        '',
      ].join('\n'),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
