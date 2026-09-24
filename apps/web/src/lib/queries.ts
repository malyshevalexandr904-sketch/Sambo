'use client';
import type { DataEnvelope, Me, RegionDto, CountryDto } from '@sde/contracts';
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
