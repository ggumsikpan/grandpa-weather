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

(async () => {
  await handler({ query: HOME }, res);
  const b = res.body;
  if (res.code !== 200 || !b || !b.now || typeof b.now.temp !== 'number' || !b.daily || !b.daily.length) {
    console.error('실패', res.code, JSON.stringify(b).slice(0, 500));
    process.exit(1);
  }
  const out = path.join(__dirname, '..', 'data', 'weather.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(b));
  console.log('저장', out, '기온', b.now.temp, '시간별', b.hourly.length, '일별', b.daily.length,
    '미세먼지', b.air && b.air.word, '특보', b.warnings.length, b.partialErrors ? '일부 오류: ' + JSON.stringify(b.partialErrors) : '');
})().catch((e) => { console.error(e); process.exit(1); });
