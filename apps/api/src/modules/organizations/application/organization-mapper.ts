import type { Organization as OrganizationDto, OrganizationSummary } from '@sde/contracts';
import type { Organization, OrganizationLegalDetails, StoredFile } from '@sde/db';

export type OrganizationRow = Organization & {
  logo: Pick<StoredFile, 'storageKey' | 'status' | 'bucket'> | null;
  legalDetails?: OrganizationLegalDetails | null;
};

export const ORGANIZATION_INCLUDE = {
  logo: { select: { storageKey: true, status: true, bucket: true } },
} as const;

export function toSummary(row: OrganizationRow, publicUrl: (key: string) => string): OrganizationSummary {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    shortName: row.shortName,
    slug: row.slug,
    status: row.status,
    parentId: row.parentId,
    countryCode: row.countryCode,
    regionId: row.regionId,
    city: row.city,
    logoUrl:
      row.logo && row.logo.status === 'AVAILABLE' && row.logo.bucket === 'PUBLIC_MEDIA'
        ? publicUrl(row.logo.storageKey)
        : null,
  };
}

/** Реквизиты (`legalDetails`) отдаются только пользователям с organization.update (API.md, 3.4). */
export function toDetail(
  row: OrganizationRow,
  publicUrl: (key: string) => string,
  opts: { includeLegal: boolean; allowedActions: string[] },
): OrganizationDto {
  const legal = opts.includeLegal && row.legalDetails ? row.legalDetails : null;
  return {
    ...toSummary(row, publicUrl),
    address: row.address,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    website: row.website,
    logoFileId: row.logoFileId,
    legalDetails: legal
      ? {
          legalName: legal.legalName,
          inn: legal.inn,
          kpp: legal.kpp ?? undefined,
          ogrn: legal.ogrn ?? undefined,
          legalAddress: legal.legalAddress,
        }
      : null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    allowedActions: opts.allowedActions,
  };
}
