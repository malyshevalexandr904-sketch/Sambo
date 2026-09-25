'use client';
import {
  type CountryDto,
  type DataEnvelope,
  type DisciplineDto,
  type DocumentTypeDto,
  type Me,
  type MyAthlete,
  type RankedDictionaryDto,
  type RegionDto,
  ROLE_PERMISSIONS,
} from '@sde/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const qk = {
  me: ['me'] as const,
  users: (params: object) => ['admin', 'users', params] as const,
  user: (id: string) => ['admin', 'users', id] as const,
  organizations: (params: object) => ['organizations', params] as const,
  organization: (id: string) => ['organizations', id] as const,
  members: (id: string) => ['organizations', id, 'members'] as const,
  audit: (params: object) => ['audit', params] as const,
  settings: ['settings'] as const,
  sessions: ['sessions'] as const,
  countries: ['dict', 'countries'] as const,
  regions: (country: string) => ['dict', 'regions', country] as const,
  sportRanks: ['dict', 'sport-ranks'] as const,
  refereeCategories: ['dict', 'referee-categories'] as const,
  documentTypes: ['dict', 'document-types'] as const,
  disciplines: ['dict', 'disciplines'] as const,
  athletes: (params: object) => ['athletes', params] as const,
  athlete: (id: string) => ['athletes', id] as const,
  athleteRanks: (id: string) => ['athletes', id, 'ranks'] as const,
  athleteConsents: (id: string) => ['athletes', id, 'consents'] as const,
  myAthletes: ['me', 'athletes'] as const,
  coaches: (params: object) => ['coaches', params] as const,
  referees: (params: object) => ['referees', params] as const,
  documents: (params: object) => ['documents', params] as const,
  consentTemplates: (params: object) => ['consent-templates', params] as const,
  importJob: (id: string) => ['imports', id] as const,
  rulesets: ['rulesets'] as const,
  ruleset: (id: string) => ['rulesets', id] as const,
  ageGroups: (params: object) => ['age-groups', params] as const,
  categoryTemplates: (params: object) => ['category-templates', params] as const,
};

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => (await api<DataEnvelope<Me>>('/me')).data,
    staleTime: 60_000,
  });
}

export function useCountries() {
  return useQuery({
    queryKey: qk.countries,
    queryFn: async () => (await api<DataEnvelope<CountryDto[]>>('/dictionaries/countries')).data,
    staleTime: Infinity,
  });
}

export function useRegions(countryCode: string) {
  return useQuery({
    queryKey: qk.regions(countryCode),
    queryFn: async () =>
      (await api<DataEnvelope<RegionDto[]>>('/dictionaries/regions', { query: { countryCode } })).data,
    staleTime: Infinity,
    enabled: countryCode.length === 2,
  });
}

export const isPlatformUser = (me: Me | undefined): boolean => (me?.grants.platform.length ?? 0) > 0;

/** Может создать организацию с полномочиями: платформенная роль или право создавать дочерние (федерация). */
export const canCreateWithAuthority = (me: Me | undefined): boolean =>
  isPlatformUser(me) ||
  (me?.grants.organizations ?? []).some((g) =>
    g.roles.some((r) => ROLE_PERMISSIONS[r]['organization.create_child'] !== undefined),
  );

export function useSportRanks() {
  return useQuery({
    queryKey: qk.sportRanks,
    queryFn: async () => (await api<DataEnvelope<RankedDictionaryDto[]>>('/dictionaries/sport-ranks')).data,
    staleTime: Infinity,
  });
}

export function useRefereeCategories() {
  return useQuery({
    queryKey: qk.refereeCategories,
    queryFn: async () =>
      (await api<DataEnvelope<RankedDictionaryDto[]>>('/dictionaries/referee-categories')).data,
    staleTime: Infinity,
  });
}

export function useDocumentTypes() {
  return useQuery({
    queryKey: qk.documentTypes,
    queryFn: async () => (await api<DataEnvelope<DocumentTypeDto[]>>('/dictionaries/document-types')).data,
    staleTime: Infinity,
  });
}

export function useDisciplines() {
  return useQuery({
    queryKey: qk.disciplines,
    queryFn: async () => (await api<DataEnvelope<DisciplineDto[]>>('/dictionaries/disciplines')).data,
    staleTime: Infinity,
  });
}

/** Спортсмены по связи: сам пользователь и дети, где он законный представитель. */
export function useMyAthletes(enabled = true) {
  return useQuery({
    queryKey: qk.myAthletes,
    queryFn: async () => (await api<DataEnvelope<MyAthlete[]>>('/me/athletes')).data,
    staleTime: 60_000,
    enabled,
  });
}

/** Название по языку интерфейса. */
export const pickName = (name: { ru: string; en: string }, locale: string): string =>
  locale === 'en' ? name.en : name.ru;
