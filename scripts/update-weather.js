// GitHub Actions에서 1시간마다 실행: 기상청·에어코리아 자료를 받아 data/weather.json 으로 저장
// 실패하면 기존 파일을 그대로 두고 오류로 끝냄 (앱은 오래된 자료면 알아서 임시 자료를 씀)
'use strict';
const fs = require('fs');
const path = require('path');
const handler = require('../api/weather.js');

const HOME = { lat: '37.4638', lon: '126.6505', station: '숭의,주안', area: '인천', sub: '미추홀' };

const res = {
  code: 0, body: null,
  setHeader() {},
  status(c) { this.code = c; return this; },
  json(o) { this.body = o; },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out0 = path.join(__dirname, '..', 'data', 'weather.json');

// 기존 자료가 얼마나 오래됐는지 (시간 단위)
function staleHours() {
  try {
    const prev = JSON.parse(fs.readFileSync(out0, 'utf8'));
    return (Date.now() - Number(prev.fetchedAt)) / 3600e3;
  } catch { return 999; }
}

(async () => {
  let b = null;
  for (let i = 0; i < 3; i++) {
    res.code = 0; res.body = null;
    try { await handler({ query: HOME }, res); } catch (e) { console.error('호출 오류', String(e && e.message || e)); }
    b = res.body;
    const ok = res.code === 200 && b && b.now && typeof b.now.temp === 'number' && b.daily && b.daily.length;
    if (ok) break;
    console.error('실패', i + 1, res.code, JSON.stringify(b).slice(0, 300));
    b = null;
    if (i < 2) await sleep(20000);
  }
  if (!b) {
    const h = staleHours();
    // 공공데이터 서버가 잠깐 죽은 것이면 기존 자료를 그대로 두고 조용히 넘어간다.
    // 24시간 넘게 못 받으면 진짜 고장이므로 실패로 끝내 알림이 가게 한다.
    if (h < 24) { console.warn('공공데이터 일시 오류 — 기존 자료 유지 (' + h.toFixed(1) + '시간 전 자료)'); return; }
    console.error('24시간 넘게 자료를 못 받았습니다 (' + h.toFixed(1) + '시간)');
    process.exit(1);
  }
  const out = path.join(__dirname, '..', 'data', 'weather.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(b));
  console.log('저장', out, '기온', b.now.temp, '시간별', b.hourly.length, '일별', b.daily.length,
    '미세먼지', b.air && b.air.word, '특보', b.warnings.length, b.partialErrors ? '일부 오류: ' + JSON.stringify(b.partialErrors) : '');
})().catch((e) => { console.error(e); process.exit(1); });
