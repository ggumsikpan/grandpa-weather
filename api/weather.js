// 기상청(단기·초단기·중기·특보) + 에어코리아를 모아서 앱이 쓰기 쉬운 모양으로 돌려주는 중계 함수
// 인증키는 Vercel 환경변수 DATA_GO_KR_KEY 에만 보관 (코드/저장소에 넣지 않음)
'use strict';

const KEY = process.env.DATA_GO_KR_KEY;
const KMA = 'https://apis.data.go.kr/1360000';
const AIR = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc';

/* ---------- 시간 (KST) ---------- */
const pad = (n) => String(n).padStart(2, '0');
function kstParts(ms) {
  const d = new Date(ms + 9 * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
const ymdOf = (p) => `${p.y}${pad(p.m)}${pad(p.d)}`;
const isoDate = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
function addDaysYmd(ymd, n) {
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) + n * 86400e3;
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/* ---------- 위경도 → 기상청 격자 ---------- */
function toGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const DEG = Math.PI / 180;
  const re = RE / GRID, s1 = SLAT1 * DEG, s2 = SLAT2 * DEG, olon = OLON * DEG, olat = OLAT * DEG;
  let sn = Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(s1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEG * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEG - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

/* ---------- 중기예보 구역 (가까운 도시 기준) ---------- */
const MID = [
  // [이름, 위도, 경도, 기온구역, 육상구역]
  ['서울', 37.57, 126.98, '11B10101', '11B00000'], ['인천', 37.46, 126.70, '11B20201', '11B00000'],
  ['수원', 37.26, 127.03, '11B20601', '11B00000'], ['파주', 37.76, 126.78, '11B20305', '11B00000'],
  ['춘천', 37.88, 127.73, '11D10301', '11D10000'], ['원주', 37.34, 127.92, '11D10401', '11D10000'],
  ['강릉', 37.75, 128.88, '11D20501', '11D20000'], ['대전', 36.35, 127.38, '11C20401', '11C20000'],
  ['서산', 36.78, 126.45, '11C20101', '11C20000'], ['청주', 36.64, 127.49, '11C10301', '11C10000'],
  ['전주', 35.82, 127.15, '11F10201', '11F10000'], ['광주', 35.16, 126.85, '11F20501', '11F20000'],
  ['목포', 34.81, 126.39, '21F20801', '11F20000'], ['여수', 34.76, 127.66, '11F20401', '11F20000'],
  ['대구', 35.87, 128.60, '11H10701', '11H10000'], ['안동', 36.57, 128.73, '11H10501', '11H10000'],
  ['포항', 36.02, 129.34, '11H10201', '11H10000'], ['부산', 35.18, 129.08, '11H20201', '11H20000'],
  ['울산', 35.54, 129.31, '11H20101', '11H20000'], ['창원', 35.23, 128.68, '11H20301', '11H20000'],
  ['제주', 33.50, 126.53, '11G00201', '11G00000'],
];
function midRegion(lat, lon) {
  let best = MID[0], bd = Infinity;
  for (const r of MID) { const d = (r[1] - lat) ** 2 + (r[2] - lon) ** 2; if (d < bd) { bd = d; best = r; } }
  return { ta: best[3], land: best[4] };
}

/* ---------- 호출 ---------- */
async function call(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { throw new Error('not json: ' + text.slice(0, 120)); }
    const code = j?.response?.header?.resultCode;
    if (code && code !== '00') throw new Error('api ' + code + ' ' + j.response.header.resultMsg);
    return j;
  } finally { clearTimeout(t); }
}
const items = (j) => {
  const it = j?.response?.body?.items;
  if (!it) return [];
  return Array.isArray(it) ? it : Array.isArray(it.item) ? it.item : it.item ? [it.item] : [];
};
const kmaUrl = (svc, op, q) => `${KMA}/${svc}/${op}?serviceKey=${encodeURIComponent(KEY)}&pageNo=1&dataType=JSON&` +
  Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/* ---------- 날씨 종류 ---------- */
function kindFrom(sky, pty, lgt) {
  pty = +pty || 0;
  if (lgt > 0) return ['thunder', '천둥 번개'];
  if (pty === 1) return ['rain', '비'];
  if (pty === 5) return ['rain', '빗방울'];
  if (pty === 2 || pty === 6) return ['sleet', '비 또는 눈'];
  if (pty === 3) return ['snow', '눈'];
  if (pty === 7) return ['snow', '눈날림'];
  if (pty === 4) return ['shower', '소나기'];
  sky = +sky;
  if (sky === 1) return ['clear', '맑음'];
  if (sky === 3) return ['partly', '구름 많음'];
  if (sky === 4) return ['overcast', '흐림'];
  return ['cloudy', '구름 조금'];
}
const SEVERITY = { clear: 0, partly: 1, cloudy: 1, overcast: 2, fog: 2, rain: 4, shower: 4, sleet: 5, snow: 5, thunder: 6 };
function kindFromText(t) {
  t = t || '';
  if (/소나기/.test(t)) return 'shower';
  if (/비\/눈|눈\/비/.test(t)) return 'sleet';
  if (/비/.test(t)) return 'rain';
  if (/눈/.test(t)) return 'snow';
  if (/흐/.test(t)) return 'overcast';
  if (/구름/.test(t)) return 'partly';
  if (/맑/.test(t)) return 'clear';
  return 'cloudy';
}
const niceText = (t) => (t || '').replace('구름많음', '구름 많음').replace('구름많고', '구름 많고').replace(/\s+/g, ' ').trim();

/* ---------- 미세먼지 등급 (환경부 기준) ---------- */
function dust(pm10, pm25) {
  const g10 = pm10 == null ? 0 : pm10 <= 30 ? 1 : pm10 <= 80 ? 2 : pm10 <= 150 ? 3 : 4;
  const g25 = pm25 == null ? 0 : pm25 <= 15 ? 1 : pm25 <= 35 ? 2 : pm25 <= 75 ? 3 : 4;
  const grade = Math.max(g10, g25);
  return { grade, word: ['', '좋음', '보통', '나쁨', '매우 나쁨'][grade] };
}
const num = (v) => (v === null || v === undefined || v === '' || v === '-' || isNaN(+v) ? null : +v);

/* ---------- 특보 ---------- */
function parseWarnings(t6, area, sub) {
  const out = [];
  if (!t6 || !area) return out;
  for (const raw of String(t6).split(/\r?\n/)) {
    const line = raw.replace(/^\s*o\s*/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    const regions = line.slice(idx + 1);
    const m = regions.match(new RegExp(area + '(?:\\s*\\(([^)]*)\\))?'));
    if (!m) continue;
    const detail = m[1];
    let applies = true;
    if (detail) {
      const hasSub = sub && detail.includes(sub);
      applies = /제외/.test(detail) ? !hasSub : !!hasSub;
    }
    if (applies && name) out.push({ name, text: `${area} ${name} 발효 중` });
  }
  return out;
}

/* ---------- 메인 ---------- */
module.exports = async (req, res) => {
  const q = req.query || {};
  const lat = num(q.lat) ?? 37.4638, lon = num(q.lon) ?? 126.6505;
  // station 자체가 없으면 미추홀구 측정소, 빈 값이면 미세먼지 생략(앱이 다른 자료로 채움)
  const stations = String(q.station === undefined ? '숭의,주안' : q.station).split(',').map((s) => s.trim()).filter(Boolean);
  const area = q.area || '인천', sub = q.sub || '';

  if (!KEY) { res.status(500).json({ error: 'no key' }); return; }

  const nowMs = Date.now();
  const P = kstParts(nowMs);
  const today = ymdOf(P);
  const yesterday = addDaysYmd(today, -1);
  const minutes = P.h * 60 + P.mi;
  const { nx, ny } = toGrid(lat, lon);

  // 초단기실황: 매시 정각, 약 40분 뒤 제공
  let nH = P.h, nD = today;
  if (P.mi < 45) { nH -= 1; if (nH < 0) { nH = 23; nD = yesterday; } }
  // 초단기예보: 매시 30분, 약 45분 뒤 제공
  let fH = P.h, fD = today;
  if (P.mi < 50) { fH -= 1; if (fH < 0) { fH = 23; fD = yesterday; } }
  // 단기예보: 02,05,...,23시 발표, 10분 뒤 제공
  const bases = [2, 5, 8, 11, 14, 17, 20, 23];
  let vD = today, vH = null;
  for (const b of bases) if (b * 60 + 15 <= minutes) vH = b;
  if (vH === null) { vH = 23; vD = yesterday; }
  // 오늘 최저/최고용: 오늘 02시 발표 (02:15 전이면 어제 23시)
  const eD = minutes >= 135 ? today : yesterday, eH = minutes >= 135 ? 2 : 23;
  // 중기: 06시/18시 발표
  let tmFc;
  if (minutes >= 18 * 60 + 15) tmFc = today + '1800';
  else if (minutes >= 6 * 60 + 15) tmFc = today + '0600';
  else tmFc = yesterday + '1800';
  const mid = midRegion(lat, lon);

  const VS = 'VilageFcstInfoService_2.0';
  const jobs = {
    ncst: call(kmaUrl(VS, 'getUltraSrtNcst', { numOfRows: 60, base_date: nD, base_time: pad(nH) + '00', nx, ny })),
    ufc: call(kmaUrl(VS, 'getUltraSrtFcst', { numOfRows: 100, base_date: fD, base_time: pad(fH) + '30', nx, ny })),
    vil: call(kmaUrl(VS, 'getVilageFcst', { numOfRows: 1500, base_date: vD, base_time: pad(vH) + '00', nx, ny })),
    early: (eD === vD && eH === vH) ? Promise.resolve(null)
      : call(kmaUrl(VS, 'getVilageFcst', { numOfRows: 400, base_date: eD, base_time: pad(eH) + '00', nx, ny })),
    midLand: call(kmaUrl('MidFcstInfoService', 'getMidLandFcst', { numOfRows: 10, regId: mid.land, tmFc })),
    midTa: call(kmaUrl('MidFcstInfoService', 'getMidTa', { numOfRows: 10, regId: mid.ta, tmFc })),
    pwn: call(kmaUrl('WthrWrnInfoService', 'getPwnStatus', { numOfRows: 10 })),
    air: (async () => {
      for (const st of stations) {
        const j = await call(`${AIR}/getMsrstnAcctoRltmMesureDnsty?serviceKey=${encodeURIComponent(KEY)}&returnType=json&numOfRows=6&pageNo=1&dataTerm=DAILY&ver=1.3&stationName=${encodeURIComponent(st)}`);
        const row = items(j).find((r) => num(r.pm10Value) != null || num(r.pm25Value) != null);
        if (row) return { row, st };
      }
      return null;
    })(),
  };
  const keys = Object.keys(jobs);
  const settled = await Promise.allSettled(Object.values(jobs));
  const R = {}, errors = {};
  settled.forEach((s, i) => { if (s.status === 'fulfilled') R[keys[i]] = s.value; else errors[keys[i]] = String(s.reason && s.reason.message || s.reason); });

  if (!R.vil) { res.status(502).json({ error: 'vilage failed', errors }); return; }

  /* 단기예보 → 시간별 표 */
  const grid = {}; // 'YYYYMMDDHHmm' -> {TMP,SKY,PTY,POP}
  const tmn = {}, tmx = {};
  const eat = (list) => {
    for (const it of list) {
      const k = it.fcstDate + it.fcstTime;
      (grid[k] ||= {})[it.category] = it.fcstValue;
      if (it.category === 'TMN') tmn[it.fcstDate] = num(it.fcstValue);
      if (it.category === 'TMX') tmx[it.fcstDate] = num(it.fcstValue);
    }
  };
  // 이른 발표본의 오늘 최저/최고 먼저, 최신 발표본으로 덮어씀
  if (R.early) {
    for (const it of items(R.early)) {
      if (it.fcstDate !== today) continue;
      if (it.category === 'TMN') tmn[today] = num(it.fcstValue);
      if (it.category === 'TMX') tmx[today] = num(it.fcstValue);
    }
  }
  const earlyMin = tmn[today], earlyMax = tmx[today];
  eat(items(R.vil));
  if (earlyMin != null) tmn[today] = earlyMin;
  if (earlyMax != null) tmx[today] = earlyMax;

  // 초단기예보로 앞 6시간 덮어쓰기
  const ufcGrid = {};
  for (const it of items(R.ufc)) (ufcGrid[it.fcstDate + it.fcstTime] ||= {})[it.category] = it.fcstValue;
  for (const [k, v] of Object.entries(ufcGrid)) {
    const g = (grid[k] ||= {});
    if (v.T1H != null) g.TMP = v.T1H;
    if (v.SKY != null) g.SKY = v.SKY;
    if (v.PTY != null) g.PTY = v.PTY;
    if (v.LGT != null) g.LGT = v.LGT;
  }

  const nowKey = today + pad(P.h) + '00';
  const hourly = Object.keys(grid).filter((k) => k > nowKey && grid[k].TMP != null).sort().map((k) => {
    const g = grid[k];
    const [kind, text] = kindFrom(g.SKY, g.PTY, num(g.LGT));
    const h = +k.slice(8, 10);
    return { time: `${isoDate(k.slice(0, 8))}T${k.slice(8, 10)}:00`, temp: num(g.TMP), kind, text, pop: num(g.POP) ?? 0, isDay: h >= 6 && h < 19 };
  });

  /* 지금 */
  const nc = {};
  for (const it of items(R.ncst)) nc[it.category] = num(it.obsrValue);
  const firstU = Object.keys(ufcGrid).sort()[0];
  const firstVil = Object.keys(grid).filter((k) => k >= nowKey).sort()[0];
  const skyNow = (firstU && ufcGrid[firstU].SKY) || (firstVil && grid[firstVil].SKY);
  const lgtNow = firstU ? num(ufcGrid[firstU].LGT) : 0;
  const [nkind, ntext] = kindFrom(skyNow, nc.PTY, lgtNow);
  const tNow = nc.T1H ?? (firstVil ? num(grid[firstVil].TMP) : null);
  let feels = null;
  if (tNow != null && nc.WSD != null && tNow <= 10 && nc.WSD * 3.6 >= 4.8) {
    const v = Math.pow(nc.WSD * 3.6, 0.16);
    feels = Math.round((13.12 + 0.6215 * tNow - 11.37 * v + 0.3965 * tNow * v) * 10) / 10;
  }
  const now = { temp: tNow, feels, humidity: nc.REH, wind: nc.WSD, kind: nkind, text: ntext, isDay: P.h >= 6 && P.h < 19 };

  /* 날짜별 */
  const daily = [];
  const shortDates = [...new Set(Object.keys(grid).map((k) => k.slice(0, 8)))].filter((d) => d >= today).sort();
  const midL = items(R.midLand)[0] || {}, midT = items(R.midTa)[0] || {};
  const tmFcDate = tmFc.slice(0, 8);
  for (let i = 0; i < 8; i++) {
    const d = addDaysYmd(today, i);
    let entry = null;
    if (shortDates.includes(d)) {
      const ks = Object.keys(grid).filter((k) => k.startsWith(d)).sort();
      const temps = ks.map((k) => num(grid[k].TMP)).filter((x) => x != null);
      const hasFull = tmn[d] != null && tmx[d] != null;
      if (hasFull || (i === 0 && temps.length)) {
        let worst = null, pop = 0;
        const skyCount = {};
        for (const k of ks) {
          const h = +k.slice(8, 10);
          if (i === 0 && k <= nowKey) continue;
          if (h < 5) continue; // 새벽(0~4시)은 빼고 깨어 있는 시간 기준
          pop = Math.max(pop, num(grid[k].POP) ?? 0);
          const [kd] = kindFrom(grid[k].SKY, grid[k].PTY, num(grid[k].LGT));
          if (SEVERITY[kd] >= 4) { if (!worst || SEVERITY[kd] > SEVERITY[worst]) worst = kd; }
          else skyCount[kd] = (skyCount[kd] || 0) + 1;
        }
        let kind = worst || Object.entries(skyCount).sort((a, b) => b[1] - a[1] || SEVERITY[b[0]] - SEVERITY[a[0]])[0]?.[0];
        if (!kind && i === 0) kind = nkind;
        const TEXT = { clear: '맑음', partly: '구름 많음', cloudy: '구름 조금', overcast: '흐림', rain: '비', shower: '소나기', sleet: '비 또는 눈', snow: '눈', thunder: '천둥 번개', fog: '안개' };
        entry = {
          date: isoDate(d),
          min: tmn[d] ?? (temps.length ? Math.min(...temps) : null),
          max: tmx[d] ?? (temps.length ? Math.max(...temps) : null),
          kind: kind || 'cloudy', text: TEXT[kind || 'cloudy'], pop,
        };
      }
    }
    if (!entry) {
      // 중기예보: n = 발표일로부터 며칠째
      const n = Math.round((Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) - Date.UTC(+tmFcDate.slice(0, 4), +tmFcDate.slice(4, 6) - 1, +tmFcDate.slice(6, 8))) / 86400e3);
      const am = midL[`wf${n}Am`] ?? midL[`wf${n}`], pm = midL[`wf${n}Pm`] ?? midL[`wf${n}`];
      const min = num(midT[`taMin${n}`]), max = num(midT[`taMax${n}`]);
      if (am == null && pm == null && min == null) continue;
      const ka = kindFromText(am), kp = kindFromText(pm);
      const pick = SEVERITY[ka] > SEVERITY[kp] ? am : pm;
      const pop = Math.max(num(midL[`rnSt${n}Am`]) ?? 0, num(midL[`rnSt${n}Pm`]) ?? 0, num(midL[`rnSt${n}`]) ?? 0);
      entry = { date: isoDate(d), min, max, kind: kindFromText(pick), text: niceText(pick), pop };
    }
    daily.push(entry);
  }

  /* 미세먼지 */
  let air = null;
  if (R.air) {
    const pm10 = num(R.air.row.pm10Value), pm25 = num(R.air.row.pm25Value);
    const g = dust(pm10, pm25);
    air = { pm10, pm25, grade: g.grade, word: g.word, station: R.air.st, time: R.air.row.dataTime };
  }

  /* 특보 */
  const pwn = items(R.pwn)[0];
  const warnings = pwn ? parseWarnings(pwn.t6, area, sub) : [];

  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');
  res.status(200).json({
    source: 'kma', fetchedAt: nowMs, grid: { nx, ny }, midRegion: mid,
    now, hourly, daily, air, warnings,
    partialErrors: Object.keys(errors).length ? errors : undefined,
  });
};
