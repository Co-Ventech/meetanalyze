// End-to-end smoke test for auth + meetings API.
// Usage: node scripts/smoke-meetings.mjs [baseUrl]   (default http://localhost:5000)
// Registers two throwaway users, posts a sample caption transcript, and checks ownership rules.
// Note: calls the AssemblyAI LLM Gateway once (uses ASSEMBLYAI_API_KEY credits).

const BASE = (process.argv[2] || 'http://localhost:5000').replace(/\/+$/, '') + '/api/v1';

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) process.exitCode = 1;
};

const newUser = async (name) => {
  const email = `smoke+${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const reg = await call('/auth/register', { method: 'POST', body: { name, email, password } });
  check(`register ${name}`, reg.status === 201 && !reg.data?.data?.password, `HTTP ${reg.status}`);
  const login = await call('/auth/login', { method: 'POST', body: { email, password } });
  check(`login ${name}`, login.status === 200 && !!login.data?.data?.accessToken, `HTTP ${login.status}`);
  const bad = await call('/auth/login', { method: 'POST', body: { email, password: 'wrong-password' } });
  check(`wrong password rejected for ${name}`, bad.status === 401, `HTTP ${bad.status}`);
  return login.data?.data?.accessToken;
};

const t0 = Date.now() - 10 * 60 * 1000;
const turn = (i, speaker, isSelf, text, durS) => ({
  id: `cap_${i}`, speaker, isSelf, text,
  timestamp: new Date(t0 + i * 30000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  startMs: t0 + i * 30000, endMs: t0 + i * 30000 + durS * 1000,
});
const transcript = [
  turn(0, 'Sara Khan', true, 'Hi David, thanks for making time today. Before I show anything, could you tell me how your team handles customer onboarding right now?', 9),
  turn(1, 'David Lee', false, 'Sure. We do it mostly by hand with spreadsheets. It takes about two weeks per customer and things fall through the cracks.', 10),
  turn(2, 'Sara Khan', true, 'Two weeks is a lot. What happens when something falls through the cracks? Who notices first?', 6),
  turn(3, 'David Lee', false, 'Usually the customer, which is the problem. We lost two accounts last quarter partly because of slow onboarding.', 8),
  turn(4, 'Sara Khan', true, 'That is exactly what our onboarding workflows fix. Teams like yours usually get onboarding down to three or four days with automated checklists and reminders.', 11),
  turn(5, 'David Lee', false, 'Sounds good, but honestly the price on your website looked high for a team our size.', 6),
  turn(6, 'Sara Khan', true, 'Understood. If it saves even one account a quarter, it pays for itself. Would a two-week pilot with your onboarding team help you decide?', 9),
  turn(7, 'David Lee', false, 'Yes, a pilot would work. Send me the details and I will loop in my operations manager.', 6),
];

const a = await newUser('Smoke Tester A');
const b = await newUser('Smoke Tester B');

const unauth = await call('/meetings');
check('list without token is 401', unauth.status === 401, `HTTP ${unauth.status}`);

const created = await call('/meetings', {
  method: 'POST', token: a,
  body: { meetCode: 'abc-defg-hij', title: 'Smoke test: onboarding discovery call', startedAt: new Date(t0).toISOString(), endedAt: new Date(t0 + 260000).toISOString(), participants: ['Sara Khan', 'David Lee'], transcript },
});
check('create meeting + analysis', created.status === 201, `HTTP ${created.status} ${created.data?.message || ''}`);
const id = created.data?.data?.id;

const detail = await call(`/meetings/${id}`, { token: a });
const ins = detail.data?.data?.insight;
check('owner can read meeting', detail.status === 200, `HTTP ${detail.status}`);
check('insight has outcome, score, summary', !!ins?.outcome && typeof ins?.overallScore === 'number' && !!ins?.summary,
  `outcome=${ins?.outcome} score=${ins?.overallScore} model=${detail.data?.data?.model}`);
check('scorecard has 10 categories', ins?.scorecard?.length === 10, `got ${ins?.scorecard?.length}`);
check('speaker stats computed', detail.data?.data?.speakerStats?.length === 2,
  JSON.stringify(detail.data?.data?.speakerStats?.map((s) => [s.speaker, s.talkShare])));

const list = await call('/meetings', { token: a });
check('owner list contains meeting', list.data?.data?.some((m) => m.id === id));

const other = await call(`/meetings/${id}`, { token: b });
check('other user gets 404', other.status === 404, `HTTP ${other.status}`);
const otherList = await call('/meetings', { token: b });
check('other user list is empty', otherList.data?.data?.length === 0);

console.log(`\nMeeting id: ${id}`);
