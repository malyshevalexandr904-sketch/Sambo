// Integration: законные представители и согласия (API.md, 4.2; G-01): приглашение и привязка аккаунта,
// подтверждение тренером, электронные согласия только от представителя, бумажные — сканом, отзыв.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createOrg,
  createTestApp,
  createUser,
  login,
  resetData,
  sentEmails,
  type Session,
  type TestApp,
  tokenFromUrl,
} from './helpers/app';
import { athleteInput, givePerson, PDF, publishConsentTemplates, send, upload } from './helpers/phase3';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetData(t);
});

async function clubWithAthlete(): Promise<{ club: string; coach: Session; athleteId: string }> {
  const club = await createOrg(t, { type: 'CLUB' });
  const u = await createUser(t, { orgs: [{ organizationId: club, role: 'COACH' }] });
  await givePerson(t, u.id, { lastName: 'Тренеров', firstName: 'Сергей', birthDate: '1990-01-01' });
  const coach = await login(t, u.email);
  const athleteId = (await send(coach, 'post', '/api/v1/athletes', athleteInput(club))).body.data
    .id as string;
  return { club, coach, athleteId };
}

const MOTHER = {
  lastName: 'Самбистова',
  firstName: 'Мария',
  middleName: 'Ивановна',
  birthDate: '1985-04-04',
  gender: 'FEMALE',
};

describe('guardians', () => {
  it('invites a guardian, links the account, shows the child only after verification', async () => {
    const { coach, athleteId } = await clubWithAthlete();
    const added = await send(coach, 'post', `/api/v1/athletes/${athleteId}/guardians`, {
      person: MOTHER,
      relation: 'MOTHER',
      email: 'Mother@Family.Local',
    });
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({ relation: 'MOTHER', verifiedAt: null, hasAccount: false });
    const [mail] = await sentEmails(t, 'guardian.invite');
    expect(mail?.to).toBe('mother@family.local');
    expect(JSON.stringify(mail?.params)).not.toContain('Самбистов');

    // Приглашение принимает только владелец приглашённого адреса.
    const stranger = await login(t, (await createUser(t)).email);
    const token = tokenFromUrl(mail?.params.acceptUrl);
    expect((await send(stranger, 'post', '/api/v1/guardian-invites/accept', { token })).status).toBe(403);
    const motherUser = await createUser(t, { email: 'mother@family.local' });
    const mother = await login(t, motherUser.email);
    const accepted = await send(mother, 'post', '/api/v1/guardian-invites/accept', { token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toEqual([
      expect.objectContaining({
        relation: 'GUARDIAN',
        verified: false,
        publicName: 'Самбистов П.',
        consentsStatus: null,
      }),
    ]);
    expect((await send(mother, 'post', '/api/v1/guardian-invites/accept', { token })).body.error.code).toBe(
      'TOKEN_EXPIRED',
    );
    expect((await mother.agent.get(`/api/v1/athletes/${athleteId}`)).status).toBe(404);

    // Подтверждение тренером (видел документ) открывает данные ребёнка.
    await send(coach, 'post', `/api/v1/athletes/${athleteId}/guardians/${added.body.data.id}/verify`, {
      basis: 'DOCUMENT_SHOWN',
    }).expect(200);
    const card = await mother.agent.get(`/api/v1/athletes/${athleteId}`).expect(200);
    expect(card.body.data.relation).toBe('GUARDIAN');
    expect(card.body.data.allowedActions).toEqual(
      expect.arrayContaining(['consent.give', 'document.upload']),
    );
    expect(card.body.data.allowedActions).not.toContain('athlete.update');
    expect(card.body.data.guardians[0]).toMatchObject({
      hasAccount: true,
      verificationBasis: 'DOCUMENT_SHOWN',
    });
    const mine = await mother.agent.get('/api/v1/me/athletes').expect(200);
    expect(mine.body.data[0]).toMatchObject({ verified: true, consentsStatus: { PD_PROCESSING: 'MISSING' } });
  });

  it('reuses the record of the same parent for a second child and ends a link with a reason', async () => {
    const { club, coach, athleteId } = await clubWithAthlete();
    const second = (
      await send(
        coach,
        'post',
        '/api/v1/athletes',
        athleteInput(club, {
          person: { lastName: 'Самбистова', firstName: 'Анна', birthDate: '2015-02-02', gender: 'FEMALE' },
        }),
      )
    ).body.data.id as string;
    const g1 = await send(coach, 'post', `/api/v1/athletes/${athleteId}/guardians`, {
      person: MOTHER,
      relation: 'MOTHER',
    });
    const g2 = await send(coach, 'post', `/api/v1/athletes/${second}/guardians`, {
      person: MOTHER,
      relation: 'MOTHER',
    });
    expect(g2.body.data.personId).toBe(g1.body.data.personId);
    expect(
      (
        await send(coach, 'post', `/api/v1/athletes/${athleteId}/guardians`, {
          person: MOTHER,
          relation: 'MOTHER',
        })
      ).body.error.code,
    ).toBe('ALREADY_EXISTS');
    const athletePerson = (
      await t.admin.athleteProfile.findUniqueOrThrow({ where: { id: athleteId }, include: { person: true } })
    ).person;
    const self = await send(coach, 'post', `/api/v1/athletes/${athleteId}/guardians`, {
      person: {
        lastName: athletePerson.lastName,
        firstName: athletePerson.firstName,
        birthDate: '2013-05-17',
        gender: 'MALE',
      },
      relation: 'OTHER',
    });
    expect(self.body.error.details.fields).toEqual([{ path: 'person', code: 'guardian_is_athlete' }]);
    await send(coach, 'delete', `/api/v1/athletes/${athleteId}/guardians/${g1.body.data.id}`, {
      reason: 'Ошибочно указан',
    }).expect(204);
    const card = await coach.agent.get(`/api/v1/athletes/${athleteId}`).expect(200);
    expect(card.body.data.guardians).toEqual([]);
    const row = await t.admin.guardian.findUniqueOrThrow({ where: { id: g1.body.data.id } });
    expect(row.endReason).toBe('Ошибочно указан');
  });
});

describe('consents', () => {
  async function verifiedMother(
    athleteId: string,
    coach: Session,
  ): Promise<{ session: Session; guardianId: string }> {
    const g = await send(coach, 'post', `/api/v1/athletes/${athleteId}/guardians`, {
      person: MOTHER,
      relation: 'MOTHER',
    });
    await send(coach, 'post', `/api/v1/athletes/${athleteId}/guardians/${g.body.data.id}/verify`, {
      basis: 'PAPER_APPLICATION',
    }).expect(200);
    const u = await createUser(t);
    await t.admin.user.update({ where: { id: u.id }, data: { personId: g.body.data.personId } });
    return { session: await login(t, u.email), guardianId: g.body.data.id as string };
  }

  it('only the verified guardian gives electronic consents; revoking publishes consent.revoked', async () => {
    const { coach, athleteId } = await clubWithAthlete();
    const templates = await publishConsentTemplates(t);
    const list = await (
      await login(t, (await createUser(t)).email)
    ).agent
      .get('/api/v1/consent-templates')
      .expect(200);
    expect(list.body.data).toHaveLength(3);
    const anon = await t.http().get('/api/v1/consent-templates').query({ kind: 'HEALTH_DATA' }).expect(200);
    expect(anon.body.data).toHaveLength(1);

    const byCoach = await send(coach, 'post', `/api/v1/athletes/${athleteId}/consents`, {
      templateId: templates.PD_PROCESSING,
      method: 'ELECTRONIC',
    });
    expect(byCoach.status).toBe(403);
    const { session: mother } = await verifiedMother(athleteId, coach);
    for (const kind of ['PD_PROCESSING', 'PD_DISTRIBUTION', 'HEALTH_DATA']) {
      const r = await send(mother, 'post', `/api/v1/athletes/${athleteId}/consents`, {
        templateId: templates[kind],
        method: 'ELECTRONIC',
      });
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({
        kind,
        method: 'ELECTRONIC',
        givenBy: { relation: 'GUARDIAN' },
        active: true,
      });
    }
    const repeat = await send(mother, 'post', `/api/v1/athletes/${athleteId}/consents`, {
      templateId: templates.PD_PROCESSING,
      method: 'ELECTRONIC',
    });
    expect(repeat.body.error.code).toBe('ALREADY_EXISTS');
    // Версия карточки не менялась, а статус согласий — да: условный GET не должен вернуть 304 из кэша.
    const card = await coach.agent
      .get(`/api/v1/athletes/${athleteId}`)
      .set('if-none-match', '"v1"')
      .expect(200);
    expect(card.headers['cache-control']).toBe('no-store');
    expect(card.body.data.consentsStatus).toEqual({
      PD_PROCESSING: 'GIVEN',
      PD_DISTRIBUTION: 'GIVEN',
      HEALTH_DATA: 'GIVEN',
    });

    const consents = await coach.agent.get(`/api/v1/athletes/${athleteId}/consents`).expect(200);
    const distribution = consents.body.data.find((c: { kind: string }) => c.kind === 'PD_DISTRIBUTION');
    expect((await send(coach, 'post', `/api/v1/consents/${distribution.id}/revoke`, {})).status).toBe(403);
    const revoked = await send(mother, 'post', `/api/v1/consents/${distribution.id}/revoke`, {
      reason: 'Не хочу публикации',
    });
    expect(revoked.body.data.active).toBe(false);
    const after = await coach.agent.get(`/api/v1/athletes/${athleteId}`).expect(200);
    expect(after.body.data.consentsStatus.PD_DISTRIBUTION).toBe('MISSING');
    const event = await t.admin.outboxEvent.findFirst({ where: { type: 'consent.revoked' } });
    expect(event?.payload).toEqual({ consentId: distribution.id, athleteId, kind: 'PD_DISTRIBUTION' });
  });

  it('an unverified guardian cannot consent; a coach records a paper consent with a scan', async () => {
    const { coach, athleteId } = await clubWithAthlete();
    const templates = await publishConsentTemplates(t);
    const g = await send(coach, 'post', `/api/v1/athletes/${athleteId}/guardians`, {
      person: MOTHER,
      relation: 'MOTHER',
    });
    const u = await createUser(t);
    await t.admin.user.update({ where: { id: u.id }, data: { personId: g.body.data.personId } });
    const mother = await login(t, u.email);
    const early = await send(mother, 'post', `/api/v1/athletes/${athleteId}/consents`, {
      templateId: templates.PD_PROCESSING,
      method: 'ELECTRONIC',
    });
    expect(early.body.error).toMatchObject({
      code: 'TRANSITION_PRECONDITIONS_NOT_MET',
      details: { failed: ['guardian_not_verified'] },
    });

    const fileId = await upload(t, coach, 'DOCUMENT', PDF, 'application/pdf', 'согласие.pdf');
    const doc = await send(coach, 'post', '/api/v1/documents', {
      typeCode: 'CONSENT_SCAN',
      fileId,
      owner: { athleteId },
    });
    expect(doc.status).toBe(201);
    const withoutGuardian = await send(coach, 'post', `/api/v1/athletes/${athleteId}/consents`, {
      templateId: templates.PD_PROCESSING,
      method: 'PAPER_SCAN',
      documentId: doc.body.data.id,
    });
    expect(withoutGuardian.body.error.details.fields).toEqual([{ path: 'guardianId', code: 'required' }]);
    const unverified = await send(coach, 'post', `/api/v1/athletes/${athleteId}/consents`, {
      templateId: templates.PD_PROCESSING,
      method: 'PAPER_SCAN',
      documentId: doc.body.data.id,
      guardianId: g.body.data.id,
    });
    expect(unverified.body.error.code).toBe('TRANSITION_PRECONDITIONS_NOT_MET');
    await send(coach, 'post', `/api/v1/athletes/${athleteId}/guardians/${g.body.data.id}/verify`, {
      basis: 'DOCUMENT_SHOWN',
    }).expect(200);
    const paper = await send(coach, 'post', `/api/v1/athletes/${athleteId}/consents`, {
      templateId: templates.PD_PROCESSING,
      method: 'PAPER_SCAN',
      documentId: doc.body.data.id,
      guardianId: g.body.data.id,
    });
    expect(paper.status).toBe(201);
    expect(paper.body.data).toMatchObject({
      method: 'PAPER_SCAN',
      givenBy: { relation: 'GUARDIAN', personId: g.body.data.personId },
    });
  });

  it('templates are versioned and immutable after publication', async () => {
    const admin = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, {
      totp: true,
    });
    const body = 'Текст согласия на обработку персональных данных. Черновик для проверки юристом, учебный.';
    const v1 = await send(admin, 'post', '/api/v1/admin/consent-templates', {
      kind: 'PD_PROCESSING',
      locale: 'ru',
      operatorName: 'ИП Тест',
      bodyMarkdown: body,
    });
    expect(v1.body.data).toMatchObject({ version: 1, status: 'DRAFT' });
    expect((await t.http().get('/api/v1/consent-templates')).body.data).toEqual([]);
    await send(admin, 'patch', `/api/v1/admin/consent-templates/${v1.body.data.id}`, {
      operatorName: 'ИП Тест Тестович',
    }).expect(200);
    await send(admin, 'post', `/api/v1/admin/consent-templates/${v1.body.data.id}/publish`).expect(200);
    const edit = await send(admin, 'patch', `/api/v1/admin/consent-templates/${v1.body.data.id}`, {
      operatorName: 'Другой',
    });
    expect(edit.body.error.code).toBe('INVALID_TRANSITION');
    await expect(
      t.admin.consentTemplate.update({
        where: { id: v1.body.data.id },
        data: { bodyMarkdown: 'Подмена текста задним числом' },
      }),
    ).rejects.toThrow(/immutable/);
    const v2 = await send(admin, 'post', '/api/v1/admin/consent-templates', {
      kind: 'PD_PROCESSING',
      locale: 'ru',
      operatorName: 'ИП Тест',
      bodyMarkdown: `${body} Редакция 2.`,
    });
    expect(v2.body.data.version).toBe(2);
    await send(admin, 'post', `/api/v1/admin/consent-templates/${v2.body.data.id}/publish`).expect(200);
    const all = await admin.agent.get('/api/v1/admin/consent-templates').expect(200);
    expect(all.body.data.map((x: { version: number; status: string }) => `${x.version}:${x.status}`)).toEqual(
      ['2:PUBLISHED', '1:RETIRED'],
    );
    const coach = await login(t, (await createUser(t)).email);
    expect((await coach.agent.get('/api/v1/admin/consent-templates')).status).toBe(403);
  });
});
