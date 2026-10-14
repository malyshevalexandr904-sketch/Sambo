// Ресурсы процессов во время нагрузочного теста (Linux, /proc): CPU (% одного ядра) и память (RSS, МБ) каждые
// 2 с. Группы: api (PID из аргумента), postgres, redis, k6 (по имени процесса). Вывод — CSV в stdout.
// Запуск: node loadtest/sample.mjs <pid api> > resources.csv (остановить — Ctrl+C или kill).
import { readdirSync, readFileSync } from 'node:fs';

const API_PID = Number(process.argv[2]);
const TICK = 100; // USER_HZ
const PAGE = 4096;

function stat(pid) {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const comm = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'));
    const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return { comm, ticks: Number(f[11]) + Number(f[12]), rss: Number(f[21]) * PAGE };
  } catch {
    return null;
  }
}

function group(pid, comm) {
  if (pid === API_PID) return 'api';
  if (comm.startsWith('postgres')) return 'postgres';
  if (comm.startsWith('redis')) return 'redis';
  if (comm === 'k6') return 'k6';
  return null;
}

function snapshot() {
  const out = new Map();
  for (const name of readdirSync('/proc')) {
    const pid = Number(name);
    if (!pid) continue;
    const s = stat(pid);
    if (!s) continue;
    const g = group(pid, s.comm);
    if (g) out.set(pid, { g, ...s });
  }
  return out;
}

const GROUPS = ['api', 'postgres', 'redis', 'k6'];
console.log(['time', ...GROUPS.flatMap((g) => [`${g}_cpu`, `${g}_rss_mb`])].join(','));
let prev = snapshot();
let prevAt = Date.now();
setInterval(() => {
  const now = snapshot();
  const at = Date.now();
  const secs = (at - prevAt) / 1000;
  const cpu = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  const rss = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (const [pid, s] of now) {
    const before = prev.get(pid);
    cpu[s.g] += ((s.ticks - (before?.ticks ?? s.ticks)) / TICK / secs) * 100;
    rss[s.g] += s.rss;
  }
  console.log(
    [
      new Date(at).toISOString(),
      ...GROUPS.flatMap((g) => [cpu[g].toFixed(0), (rss[g] / 2 ** 20).toFixed(0)]),
    ].join(','),
  );
  prev = now;
  prevAt = at;
}, 2000);
