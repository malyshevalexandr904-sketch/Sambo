// Нагрузочный тест живых данных (Phase 8b, план §5; PROJECT_ANALYSIS, 7.12): зрители табло держат соединения
// Socket.IO с каналами `public:mat` всех ковров, «планшеты» ковров шлют оценки через REST по расписанию.
//
// Задержка «команда → сообщение зрителю» без синхронизации часов: событие k ковра m отправляется в момент
// T0 + m·PERIOD/MATS + k·PERIOD (планшет ждёт этот момент), а сумма баллов на табло после него — S0 + k + 1;
// зритель по сумме баллов знает, когда событие было отправлено. Опоздание отправки планшета меряется отдельно
// (tablet_send_lag) — оно входит в задержку, поэтому должно быть малым.
//
// Протокол Engine.IO 4 / Socket.IO 5 — вручную поверх k6/websockets (много соединений на один VU):
// «0» — открытие, «40/live,{}» — вход в пространство имён, «42/live,<id>[...]» — событие с подтверждением,
// «43/live,<id>[...]» — подтверждение, «2»/«3» — ping/pong.
//
// Параметры (переменные окружения): STAND — описание стенда (apps/api: pnpm run load:stand), API — адрес api,
// VIEWERS — число зрителей, SOCKETS_PER_VU, PERIOD_MS — интервал событий одного ковра, CONNECT_S — окно
// подключения зрителей до начала событий, MEASURE_S — длительность потока событий, SAMPLE_EVERY — задержку
// меряет каждый N-й зритель (остальные считают сообщения и пропуски).
import http from 'k6/http';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { setTimeout } from 'k6/timers';
import { WebSocket } from 'k6/experimental/websockets';

const STAND = JSON.parse(open(__ENV.STAND));
const API = __ENV.API || 'http://127.0.0.1:4001';
const WS = API.replace(/^http/, 'ws');
const VIEWERS = Number(__ENV.VIEWERS ?? 10000);
const PER_VU = Number(__ENV.SOCKETS_PER_VU ?? 100);
const PERIOD_MS = Number(__ENV.PERIOD_MS ?? 2000);
const CONNECT_S = Number(__ENV.CONNECT_S ?? 60);
const MEASURE_S = Number(__ENV.MEASURE_S ?? 120);
const SAMPLE_EVERY = Number(__ENV.SAMPLE_EVERY ?? 10);
const MATS = STAND.mats.length;
const VIEWER_VUS = Math.ceil(VIEWERS / PER_VU);
const TOTAL_S = CONNECT_S + MEASURE_S;

const liveLatency = new Trend('live_latency', true);
const tabletLag = new Trend('tablet_send_lag', true);
const commandDuration = new Trend('command_duration', true);
const liveMessages = new Counter('live_messages');
const liveGaps = new Counter('live_gaps');
const expected = new Counter('live_expected');
const connected = new Counter('ws_connected');
const connectFailed = new Counter('ws_connect_failed');
const subscribeFailed = new Counter('ws_subscribe_failed');
const dropped = new Counter('ws_dropped');
const commandOk = new Rate('command_ok');

export const options = {
  setupTimeout: '120s',
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    ...(VIEWERS > 0
      ? {
          viewers: {
            executor: 'per-vu-iterations',
            vus: VIEWER_VUS,
            iterations: 1,
            maxDuration: `${TOTAL_S + 120}s`,
            exec: 'viewer',
          },
        }
      : {}),
    tablets: {
      executor: 'per-vu-iterations',
      vus: MATS,
      iterations: 1,
      maxDuration: `${TOTAL_S + 120}s`,
      exec: 'tablet',
    },
  },
};

/** UUID v4 для ключа идемпотентности команды. */
function uuid4() {
  const h = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16));
  h[12] = '4';
  h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function login(email) {
  const csrf = http.get(`${API}/api/v1/auth/csrf`).json('data.csrfToken');
  const res = http.post(`${API}/api/v1/auth/login`, JSON.stringify({ email, password: STAND.password }), {
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'x-auth-mode': 'bearer' },
  });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${res.body}`);
  return res.json('data.tokens.accessToken');
}

export function setup() {
  const mats = STAND.mats.map((m) => {
    const token = login(m.refereeEmail);
    const match = http.get(`${API}/api/v1/matches/${m.matchId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const state = match.json('data.state');
    return {
      number: m.number,
      matchId: m.matchId,
      token,
      seq: match.json('data.seq'),
      total0: state.red.points + state.blue.points,
      // Первая оценка — отстающей стороне: разница баллов не растёт от прогона к прогону.
      firstBlue: state.red.points > state.blue.points,
    };
  });
  return { t0: Date.now() + CONNECT_S * 1000, mats };
}

/** Планшет ковра: оценки по очереди сторонам (разница не больше балла — схватка не заканчивается). */
export function tablet(data) {
  const i = exec.scenario.iterationInTest;
  const m = data.mats[i];
  const offset = (i * PERIOD_MS) / MATS;
  let seq = m.seq;
  for (let k = 0; ; k++) {
    const at = data.t0 + offset + k * PERIOD_MS;
    if (at > data.t0 + MEASURE_S * 1000) break;
    const wait = at - Date.now();
    if (wait > 0) sleep(wait / 1000);
    tabletLag.add(Date.now() - at);
    const res = http.post(
      `${API}/api/v1/matches/${m.matchId}/events`,
      JSON.stringify({
        type: 'SCORE',
        side: (k % 2 === 0) !== m.firstBlue ? 'RED' : 'BLUE',
        actionCode: 'THROW_1',
        matchClockMs: 30000,
        deviceTime: new Date().toISOString(),
        expectedSeq: seq,
      }),
      {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${m.token}`,
          'idempotency-key': uuid4(),
        },
        tags: { name: 'match_event' },
      },
    );
    commandDuration.add(res.timings.duration);
    commandOk.add(res.status === 201);
    if (res.status !== 201) {
      console.warn(`mat ${m.number}: event ${k} → ${res.status} ${res.body}`);
      break;
    }
    seq = res.json('data.seq');
    expected.add(1);
  }
}

/** Зрители: PER_VU соединений одного VU, каждое — табло своего ковра. */
export function viewer(data) {
  const vu = exec.scenario.iterationInTest;
  const totals = new Map(
    data.mats.map((m) => [m.number, { total0: m.total0, offset: ((m.number - 1) * PERIOD_MS) / MATS }]),
  );
  const start = Date.now();
  // Подключения растянуты на первую половину окна подключения.
  const spread = (CONNECT_S * 1000) / 2;
  for (let s = 0; s < PER_VU; s++) {
    const n = vu * PER_VU + s;
    if (n >= VIEWERS) break;
    const delay = (n / VIEWERS) * spread - (Date.now() - start);
    setTimeout(() => open1(n), Math.max(0, delay));
  }

  function open1(n) {
    const mat = data.mats[n % MATS];
    const channel = `public:mat:${STAND.slug}:${mat.number}`;
    const measure = n % SAMPLE_EVERY === 0;
    const info = totals.get(mat.number);
    // Отдельный «адрес клиента» (api за прокси, TRUST_PROXY): лимит соединений на IP — на каждого зрителя свой.
    const ip = `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
    const ws = new WebSocket(`${WS}/ws/?EIO=4&transport=websocket`, null, {
      headers: { 'X-Forwarded-For': ip },
    });
    let lastSeq = null;
    let closing = false;
    let opened = false;
    // Счётчики соединения копятся локально и попадают в метрики при закрытии: метрика на каждое сообщение
    // нагружает сам k6 сильнее, чем api.
    let messages = 0;
    let gaps = 0;
    ws.onopen = () => {
      opened = true;
      connected.add(1);
    };
    ws.onerror = () => {
      if (!opened) connectFailed.add(1);
    };
    ws.onclose = () => {
      if (messages) liveMessages.add(messages);
      if (gaps) liveGaps.add(gaps);
      if (!closing && opened) dropped.add(1);
    };
    ws.onmessage = (e) => {
      const d = e.data;
      if (d === '2') return ws.send('3');
      if (d.startsWith('42/live,')) {
        // Номер сообщения — без разбора JSON; полностью разбирает только измеряющий зритель.
        const at = d.indexOf('"seq":');
        const seq = at < 0 ? NaN : parseInt(d.slice(at + 6, at + 20), 10);
        if (lastSeq !== null && seq > lastSeq + 1) gaps += seq - lastSeq - 1;
        if (seq > 0) lastSeq = seq;
        const now = Date.now();
        if (now < data.t0) return undefined;
        messages += 1;
        if (!measure) return undefined;
        const [name, msg] = JSON.parse(d.slice('42/live,'.length));
        const score = name === 'message' && msg.payload && msg.payload.current && msg.payload.current.score;
        if (!score) return undefined;
        const k = score.red.points + score.blue.points - info.total0 - 1;
        if (k >= 0) liveLatency.add(now - (data.t0 + info.offset + k * PERIOD_MS));
        return undefined;
      }
      if (d[0] === '0') return ws.send('40/live,{}');
      if (d.startsWith('40/live,')) return ws.send(`42/live,1["subscribe",{"channel":"${channel}"}]`);
      if (d.startsWith('44/live,')) {
        connectFailed.add(1);
        return undefined;
      }
      if (d.startsWith('43/live,1')) {
        const ack = JSON.parse(d.slice('43/live,1'.length))[0];
        if (!ack.ok) subscribeFailed.add(1);
        else lastSeq = ack.seq;
      }
      return undefined;
    };
    const end = data.t0 + MEASURE_S * 1000 + 10000;
    setTimeout(
      () => {
        closing = true;
        ws.close();
      },
      Math.max(0, end - Date.now()),
    );
  }
}
