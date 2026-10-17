// Phase 9a — регистрация в системе по ролям: полнота заявки, документы по сценарию, куда уходит заявка.
import { describe, expect, it } from 'vitest';
import { SYSTEM_SETTING_DEFAULTS, SYSTEM_SETTINGS } from './admin.js';
import { notificationLink } from './notifications.js';
import {
  allowedDocumentTypes,
  DEFAULT_ONBOARDING_DOCUMENT_RULES,
  documentRulesFor,
  type OnboardingCompleteness,
  OnboardingCreate,
  OnboardingPatch,
  onboardingProblems,
  onboardingReviewTarget,
  OnboardingSubmit,
} from './onboarding.js';

const TODAY = '2026-10-16';
const rules = DEFAULT_ONBOARDING_DOCUMENT_RULES;

const athlete = (over: Partial<OnboardingCompleteness> = {}): OnboardingCompleteness => ({
  role: 'ATHLETE',
  kind: 'REGISTRATION',
  inOrganization: false,
  legalForm: null,
  hasQualification: false,
  refereeCategoryCode: null,
  organizationId: null,
  coachId: null,
  lastName: 'Петров',
  firstName: 'Илья',
  birthDate: '2012-05-01',
  gender: 'MALE',
  phone: '+79991234567',
  contactEmail: 'parent@example.ru',
  telegram: null,
  contactChannels: ['EMAIL'],
  organization: null,
  documentTypes: [],
  ...over,
});

const codes = (r: OnboardingCompleteness) =>
  onboardingProblems(r, rules, TODAY).map((p) => `${p.path}:${p.code}`);

describe('onboarding completeness', () => {
  it('an independent athlete needs personal data and contacts, identity document optional', () => {
    expect(codes(athlete())).toEqual([]);
    expect(codes(athlete({ phone: null, contactChannels: [] }))).toEqual([
      'phone:required',
      'contactChannels:required',
    ]);
  });

  it('an athlete in an organization chooses the organization and a coach', () => {
    expect(codes(athlete({ inOrganization: true }))).toEqual(['organizationId:required', 'coachId:required']);
    expect(codes(athlete({ inOrganization: true, organizationId: 'o', coachId: 'c' }))).toEqual([]);
    expect(codes(athlete({ inOrganization: null }))).toEqual(['inOrganization:required']);
  });

  it('checks the age range of the role', () => {
    expect(codes(athlete({ birthDate: '1990-01-01' }))).toEqual(['birthDate:birth_date_out_of_range']);
    expect(codes(athlete({ role: 'COACH', birthDate: '2012-05-01', documentTypes: ['PASSPORT'] }))).toEqual([
      'birthDate:birth_date_out_of_range',
    ]);
  });

  it('a referee needs a category, a passport and the referee book', () => {
    const referee = athlete({ role: 'REFEREE', inOrganization: null, birthDate: '1985-03-03' });
    expect(codes(referee)).toEqual([
      'refereeCategoryCode:required',
      'documents.PASSPORT:document_required',
      'documents.REFEREE_BOOK:document_required',
    ]);
    expect(
      codes({ ...referee, refereeCategoryCode: 'CAT_1', documentTypes: ['PASSPORT', 'REFEREE_BOOK'] }),
    ).toEqual([]);
  });

  it('a coach with a qualification category attaches the qualification document', () => {
    const coach = athlete({
      role: 'COACH',
      birthDate: '1980-01-01',
      hasQualification: true,
      documentTypes: ['PASSPORT'],
    });
    expect(codes(coach)).toEqual(['documents.COACH_QUALIFICATION:document_required']);
    expect(codes({ ...coach, hasQualification: false })).toEqual([]);
  });

  it('an organization head: EGRUL extract only for a Russian legal entity', () => {
    const org = {
      name: 'Клуб самбо «Пример»',
      shortName: 'Пример',
      type: 'CLUB' as const,
      legalForm: 'FOREIGN' as const,
      countryCode: 'KZ',
      regionId: null,
      city: 'Алматы',
      inn: null,
      ogrn: null,
      legalName: null,
      legalAddress: null,
    };
    const head = athlete({
      role: 'ORGANIZATION_HEAD',
      inOrganization: null,
      birthDate: '1975-01-01',
      legalForm: 'FOREIGN',
      organization: org,
      documentTypes: ['PASSPORT'],
    });
    expect(codes(head)).toEqual([]);
    const ru = {
      ...head,
      legalForm: 'RU_LEGAL_ENTITY' as const,
      organization: { ...org, legalForm: 'RU_LEGAL_ENTITY' as const },
    };
    expect(codes(ru)).toEqual([
      'organization.inn:required',
      'organization.legalName:required',
      'organization.legalAddress:required',
      'organization.countryCode:must_be_ru',
      'documents.EGRUL_EXTRACT:document_required',
    ]);
  });

  it('Telegram as a channel needs the username', () => {
    expect(codes(athlete({ contactChannels: ['TELEGRAM'] }))).toEqual(['telegram:required']);
    expect(codes(athlete({ contactChannels: ['TELEGRAM'], telegram: 'sambo_kid' }))).toEqual([]);
  });

  it('joining an organization later needs no personal data or documents again', () => {
    const join = athlete({
      kind: 'JOIN_ORGANIZATION',
      lastName: null,
      firstName: null,
      birthDate: null,
      phone: null,
      contactChannels: [],
    });
    expect(codes(join)).toEqual(['organizationId:required', 'coachId:required']);
    expect(codes({ ...join, role: 'REFEREE' })).toEqual(['kind:not_allowed', 'refereeCategoryCode:required']);
  });
});

describe('document rules', () => {
  it('apply per scenario and are configurable', () => {
    const s = {
      role: 'ORGANIZATION_HEAD' as const,
      kind: 'REGISTRATION' as const,
      inOrganization: null,
      legalForm: 'OTHER' as const,
      hasQualification: false,
      refereeCategoryCode: null,
    };
    expect(allowedDocumentTypes(rules, s)).toEqual(['PASSPORT', 'OTHER']);
    expect(allowedDocumentTypes(rules, { ...s, legalForm: 'RU_LEGAL_ENTITY' })).toEqual([
      'PASSPORT',
      'EGRUL_EXTRACT',
      'OTHER',
    ]);
    // 0.13.0: у каждой роли можно приложить документ (PDF или фото), в том числе при присоединении к организации —
    // там все документы по желанию.
    for (const role of ['ORGANIZATION_HEAD', 'COACH', 'ATHLETE', 'REFEREE'] as const) {
      expect(allowedDocumentTypes(rules, { ...s, role }), role).toContain('OTHER');
    }
    const joinCoach = documentRulesFor(rules, { ...s, role: 'COACH', kind: 'JOIN_ORGANIZATION' });
    expect(joinCoach.map((r) => r.typeCodes[0])).toEqual(['PASSPORT', 'OTHER']);
    expect(joinCoach.every((r) => !r.required)).toBe(true);
    const custom = [
      {
        role: 'REFEREE' as const,
        typeCodes: ['MEDICAL_CERTIFICATE'],
        required: true,
        when: { refereeCategories: ['NATIONAL'] },
      },
    ];
    const referee = { ...s, role: 'REFEREE' as const, legalForm: null, refereeCategoryCode: 'NATIONAL' };
    expect(documentRulesFor(custom, referee)).toHaveLength(1);
    expect(documentRulesFor(custom, { ...referee, refereeCategoryCode: 'CAT_3' })).toHaveLength(0);
    expect(
      SYSTEM_SETTINGS['onboarding.documentRules'].safeParse(
        SYSTEM_SETTING_DEFAULTS['onboarding.documentRules'],
      ).success,
    ).toBe(true);
  });
});

describe('onboarding schemas', () => {
  it('never accept a status or an applicant from the client, normalize Telegram and require consent', () => {
    const parsed = OnboardingCreate.parse({
      role: 'COACH',
      status: 'APPROVED',
      userId: 'x',
      telegram: '@coach_ivan',
    });
    expect(parsed).toEqual({ role: 'COACH', kind: 'REGISTRATION', telegram: 'coach_ivan' });
    expect(OnboardingPatch.safeParse({ contactChannels: ['EMAIL', 'EMAIL'] }).success).toBe(false);
    expect(OnboardingPatch.safeParse({ phone: '89991234567' }).success).toBe(false);
    expect(OnboardingSubmit.safeParse({}).success).toBe(false);
    expect(OnboardingSubmit.safeParse({ consentPersonalData: true }).success).toBe(true);
  });

  it('routes requests and notification links', () => {
    expect(onboardingReviewTarget({ role: 'ATHLETE', kind: 'REGISTRATION', inOrganization: true })).toBe(
      'ORGANIZATION',
    );
    expect(onboardingReviewTarget({ role: 'COACH', kind: 'REGISTRATION', inOrganization: false })).toBe(
      'PLATFORM',
    );
    expect(
      onboardingReviewTarget({ role: 'ORGANIZATION_HEAD', kind: 'REGISTRATION', inOrganization: null }),
    ).toBe('PLATFORM');
    expect(notificationLink('onboarding.awaiting_review', { requestId: 'r1' })).toBe('/onboarding/review/r1');
    expect(notificationLink('onboarding.decided', { requestId: 'r1', status: 'APPROVED' })).toBe(
      '/onboarding',
    );
  });
});
