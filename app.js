/* 큰글씨 날씨·지도 - 광고 없는 할아버지용 날씨 앱 */
'use strict';

/* ================= 설정 ================= */
// 기상청 자료: GitHub Actions가 1시간마다 만드는 파일 (우리 동네 전용)
const API_URL = 'data/weather.json';
const KMA_MAX_AGE = 3 * 3600e3; // 3시간보다 오래됐으면 임시 자료(Open-Meteo) 사용
const HOME_DEFAULT = { lat: 37.4638, lon: 126.6505, name: '인천 미추홀구', station: '숭의,주안', area: '인천', sub: '미추홀' };

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let HOME = { ...HOME_DEFAULT, ...store.get('home', {}) };
let last = store.get('last2', null); // { data, homeKey, time }
const homeKey = () => `${(+HOME.lat).toFixed(3)},${(+HOME.lon).toFixed(3)}`;

/* ================= 날씨 종류 → 그림 ================= */
function icon(kind, isDay = true) {
  switch (kind) {
    case 'clear': return isDay ? '☀️' : '🌙';
    case 'partly': return isDay ? '⛅' : '☁️';
    case 'cloudy': case 'overcast': return '☁️';
    case 'rain': return '🌧️';
    case 'shower': return '🌦️';
    case 'snow': case 'sleet': return '🌨️';
    case 'thunder': return '⛈️';
    case 'fog': return '🌫️';
    default: return '🌡️';
  }
}
const isWetKind = (k) => k === 'rain' || k === 'shower' || k === 'thunder' || k === 'sleet';
const isSnowKind = (k) => k === 'snow' || k === 'sleet';

/* ================= 글자 도우미 ================= */
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const r = (n) => (n == null || isNaN(n) ? null : Math.round(n));
const deg = (n) => (r(n) == null ? '--°' : r(n) + '°');
function hourLabel(h) {
  if (h === 0) return '밤 12시';
  if (h < 6) return `새벽 ${h}시`;
  if (h < 12) return `오전 ${h}시`;
  if (h === 12) return '낮 12시';
  if (h < 18) return `오후 ${h - 12}시`;
  if (h < 21) return `저녁 ${h - 12}시`;
  return `밤 ${h - 12}시`;
}
function timeText(ts) {
  const d = new Date(ts);
  return `${hourLabel(d.getHours()).replace(/시$/, '')}시 ${d.getMinutes()}분`;
}
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateLine(d = new Date()) { return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`; }
function rainWord(pop, kind) {
  if (isSnowKind(kind)) return '눈 소식';
  if (isWetKind(kind) || pop >= 60) return '☔ 비 와요';
  if (pop >= 30) return '☂ 비 올 수도';
  return '';
}
function dustGradeFromValues(pm10, pm25) {
  const g10 = pm10 == null ? 0 : pm10 <= 30 ? 1 : pm10 <= 80 ? 2 : pm10 <= 150 ? 3 : 4;
  const g25 = pm25 == null ? 0 : pm25 <= 15 ? 1 : pm25 <= 35 ? 2 : pm25 <= 75 ? 3 : 4;
  return Math.max(g10, g25);
}
const DUST_WORD = ['--', '좋음', '보통', '나쁨', '매우 나쁨'];

/* ================= 네트워크 ================= */
async function getJSON(url, ms = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}
function apiURL() {
  // 시험용: ?api=같은_사이트_주소 로 바꿔 볼 수 있음 (다른 사이트 주소는 무시)
  let base = API_URL;
  const ov = new URLSearchParams(location.search).get('api');
  if (ov) { try { const u = new URL(ov, location.href); if (u.origin === location.origin) base = u.pathname; } catch {} }
  const q = new URLSearchParams({ lat: HOME.lat, lon: HOME.lon, station: HOME.station || '', area: HOME.area || '', sub: HOME.sub || '' });
  return base + '?' + q.toString();
}
function validData(d) {
  return d && d.now && typeof d.now.temp === 'number' && Array.isArray(d.daily) && d.daily.length > 0 && Array.isArray(d.hourly);
}
// 기상청 파일은 기본 동네(미추홀구)용이라, 보호자가 다른 동네로 바꾸면 쓰지 않음
const nearDefaultHome = () => Math.abs(HOME.lat - HOME_DEFAULT.lat) < 0.03 && Math.abs(HOME.lon - HOME_DEFAULT.lon) < 0.03;
// 지난 시간 예보는 빼기
function trimPast(data) {
  const d = new Date();
  const key = `${todayStr(d)}T${String(d.getHours()).padStart(2, '0')}`;
  if (Array.isArray(data.hourly)) data.hourly = data.hourly.filter((x) => String(x.time).slice(0, 13) > key);
  return data;
}

/* ---- Open-Meteo (기상청이 안 될 때 임시) ---- */
const WMO = {
  0: ['clear', '맑음'], 1: ['clear', '대체로 맑음'], 2: ['partly', '구름 조금'], 3: ['cloudy', '흐림'],
  45: ['fog', '안개'], 48: ['fog', '안개'],
  51: ['rain', '이슬비'], 53: ['rain', '이슬비'], 55: ['rain', '이슬비'], 56: ['sleet', '어는 비'], 57: ['sleet', '어는 비'],
  61: ['rain', '약한 비'], 63: ['rain', '비'], 65: ['rain', '강한 비'], 66: ['sleet', '어는 비'], 67: ['sleet', '어는 비'],
  71: ['snow', '약한 눈'], 73: ['snow', '눈'], 75: ['snow', '많은 눈'], 77: ['snow', '싸락눈'],
  80: ['shower', '소나기'], 81: ['shower', '소나기'], 82: ['shower', '강한 소나기'], 85: ['snow', '눈'], 86: ['snow', '많은 눈'],
  95: ['thunder', '천둥 번개'], 96: ['thunder', '천둥 번개'], 99: ['thunder', '천둥 번개'],
};
const wmo = (c) => { const w = WMO[c] || ['cloudy', '흐림']; return { kind: w[0], text: w[1] }; };
async function airOpenMeteo(lat, lon) {
  try {
    const a = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5&timezone=Asia%2FSeoul`);
    const pm10 = a.current?.pm10, pm25 = a.current?.pm2_5;
    const g = dustGradeFromValues(pm10, pm25);
    return g ? { pm10: r(pm10), pm25: r(pm25), grade: g, word: DUST_WORD[g], station: null, time: a.current?.time } : null;
  } catch { return null; }
}
async function fromOpenMeteo(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=Asia%2FSeoul&forecast_days=7&wind_speed_unit=ms';
  const [f, air] = await Promise.all([getJSON(url, 12000), airOpenMeteo(lat, lon)]);
  const c = f.current, h = f.hourly, d = f.daily;
  const curKey = c.time.slice(0, 13);
  let i0 = h.time.findIndex((t) => t.slice(0, 13) > curKey);
  if (i0 < 0) i0 = 0;
  const hourly = [];
  for (let i = i0; i < h.time.length && hourly.length < 48; i++) {
    const w = wmo(h.weather_code[i]);
    hourly.push({ time: h.time[i], temp: h.temperature_2m[i], kind: w.kind, text: w.text, pop: h.precipitation_probability[i] ?? 0, isDay: !!h.is_day[i] });
  }
  const wn = wmo(c.weather_code);
  return {
    source: 'open-meteo', fetchedAt: Date.now(),
    now: { temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, kind: wn.kind, text: wn.text, isDay: !!c.is_day },
    hourly,
    daily: d.time.map((t, i) => { const w = wmo(d.weather_code[i]); return { date: t, min: d.temperature_2m_min[i], max: d.temperature_2m_max[i], kind: w.kind, text: w.text, pop: d.precipitation_probability_max[i] ?? 0 }; }),
    air,
    warnings: [],
  };
}

/* ================= 날씨 불러오기 ================= */
let loading = false;
async function loadWeather() {
  if (loading) return;
  loading = true;
  $('#updated').textContent = '날씨 확인 중…';
  let data = null;
  if (nearDefaultHome()) {
    try {
      const d = await getJSON(apiURL(), 10000);
      if (validData(d) && Date.now() - (d.fetchedAt || 0) < KMA_MAX_AGE) data = trimPast(d);
    } catch {}
  }
  if (data && !data.air) data.air = await airOpenMeteo(HOME.lat, HOME.lon);
  if (!data) {
    try { data = await fromOpenMeteo(HOME.lat, HOME.lon); } catch {}
  }
  if (data) {
    if (!Array.isArray(data.warnings)) data.warnings = [];
    last = { data, homeKey: homeKey(), time: Date.now() };
    store.set('last2', last);
    render(last);
  } else {
    if (last) render(last);
    $('#updated').textContent = last ? `인터넷이 약해요. ${timeText(last.time)} 날씨예요` : '인터넷 연결을 확인해 주세요';
  }
  loading = false;
}

/* ================= 화면 그리기 ================= */
function pickDays(data) {
  const t = todayStr();
  let i = data.daily.findIndex((x) => x.date === t);
  if (i < 0) i = 0;
  return { today: data.daily[i], tomorrow: data.daily[i + 1] || null, idx: i };
}
function umbrella(data) {
  const next12 = (data.hourly || []).slice(0, 12);
  const { today } = pickDays(data);
  const pops = next12.map((x) => x.pop ?? 0);
  const maxPop = pops.length ? Math.max(...pops) : (today?.pop ?? 0);
  const snow = isSnowKind(data.now.kind) || next12.some((x) => isSnowKind(x.kind));
  const wetNow = isWetKind(data.now.kind);
  if (snow) return { word: '눈 와요, 미끄럼 조심', yes: true };
  if (wetNow || maxPop >= 60) return { word: '꼭 챙기세요', yes: true };
  if (maxPop >= 30) return { word: '챙기시면 좋아요', yes: true };
  return { word: '필요 없어요', yes: false };
}
function advice(data) {
  const { today } = pickDays(data);
  const tmax = today?.max, tmin = today?.min;
  const g = data.air?.grade || 0;
  if (tmax != null && tmax >= 33) return '🥵 무척 더워요. 한낮 외출은 피하세요.';
  if (tmin != null && tmin <= -5) return '🥶 아주 추워요. 두껍게 입으세요.';
  if (g >= 3) return '😷 미세먼지 나빠요. 마스크 쓰세요.';
  if (tmax != null && tmax >= 30) return '☀️ 더워요. 물 자주 드세요.';
  if (tmin != null && tmin <= 5) return '🧥 쌀쌀해요. 외투 입으세요.';
  if (tmax != null && tmin != null && tmax - tmin >= 10) return '🧥 아침저녁 쌀쌀해요. 겉옷 챙기세요.';
  return '😊 외출하기 괜찮은 날씨예요.';
}

function render({ data, time }) {
  trimPast(data);
  const now = data.now;
  $('#today').textContent = dateLine();
  $('#place').textContent = '📍 ' + HOME.name;

  // 특보
  const warn = $('#warn');
  if (data.warnings && data.warnings.length) {
    warn.innerHTML = '';
    data.warnings.slice(0, 2).forEach((w) => { const div = document.createElement('div'); div.textContent = `⚠ ${w.name} 발효 중`; warn.appendChild(div); });
    warn.hidden = false;
  } else warn.hidden = true;

  $('#nowIcon').textContent = icon(now.kind, now.isDay !== false);
  $('#nowTemp').textContent = deg(now.temp);
  $('#nowDesc').textContent = now.text || '';

  const { today, tomorrow } = pickDays(data);
  $('#tMin').textContent = deg(today?.min);
  $('#tMax').textContent = deg(today?.max);

  const u = umbrella(data);
  const um = $('#umbrella');
  um.textContent = (u.yes ? '☂ ' : '') + u.word;
  um.className = 'r-val' + (u.yes ? ' umb-yes' : '');

  const g = data.air?.grade || 0;
  const dust = $('#dust');
  dust.textContent = g ? (data.air.word || DUST_WORD[g]) : '정보 없음';
  dust.className = 'r-val dust-' + g;

  $('#advice').textContent = advice(data);
  // 특보가 떠 있으면 빨간 띠가 조언 역할을 하니 한 줄 조언은 숨겨서 한 화면에 맞춤
  $('#advice').hidden = !!(data.warnings && data.warnings.length);

  if (tomorrow) {
    $('#tmIcon').textContent = icon(tomorrow.kind);
    $('#tmText').textContent = tomorrow.text || '';
    const rw = rainWord(tomorrow.pop ?? 0, tomorrow.kind);
    $('#tmSub').textContent = `${deg(tomorrow.min)} ~ ${deg(tomorrow.max)}` + (rw ? ` · ${rw.replace(/^\S+\s/, '')}` : ' · 비 소식 없음');
  }

  // 첫 화면: 시간별 4칸 (3시간 간격, 앞으로 12시간)
  const slots = [0, 3, 6, 9].map((k) => data.hourly[k]).filter(Boolean);
  const wetOf = (x) => isSnowKind(x.kind) ? '❄ 눈' : (isWetKind(x.kind) || (x.pop ?? 0) >= 60) ? '☂ 비' : (x.pop ?? 0) >= 30 ? '☂ 조금' : '';
  const anyWet = slots.some((x) => wetOf(x)); // 비 소식이 없으면 ☂ 줄 자체를 빼서 화면을 아낌
  $('#hours').innerHTML = slots.map((x) => {
    const hh = +x.time.slice(11, 13);
    return `<div class="hr"><div class="hr-t">${hourLabel(hh)}</div>
      <div class="hr-ic">${icon(x.kind, x.isDay !== undefined ? x.isDay : (hh >= 6 && hh < 19))}</div>
      <div class="hr-temp">${deg(x.temp)}</div>${anyWet ? `<div class="hr-rain">${wetOf(x) || '&nbsp;'}</div>` : ''}</div>`;
  }).join('');

  // 더 보기: 이번 주
  const { idx } = pickDays(data);
  $('#days').innerHTML = data.daily.slice(idx, idx + 7).map((x, i) => {
    const dt = new Date(x.date + 'T12:00:00');
    const name = i === 0 ? '오늘' : i === 1 ? '내일' : i === 2 ? '모레' : DOW[dt.getDay()] + '요일';
    const rw = rainWord(x.pop ?? 0, x.kind);
    return `<li class="${i === 0 ? 'today' : ''}"><div class="when"><b>${name} <small>${dt.getMonth() + 1}/${dt.getDate()}</small></b><span>${x.text || ''}</span></div>
      <div class="ic">${icon(x.kind)}</div>
      <div class="right"><div class="temp"><span class="cold">${deg(x.min)}</span>~<span class="hot">${deg(x.max)}</span></div>${rw ? `<div class="rainw">${rw}</div>` : ''}</div></li>`;
  }).join('');

  $('#updated').textContent = timeText(time) + ' 확인';
  $('#setSource').textContent = data.source === 'kma' ? '기상청 · 에어코리아' : 'Open-Meteo (기상청 연결 안 됨, 임시)';
}

/* ================= 소리로 듣기 ================= */
function speechText() {
  const { data } = last;
  const now = data.now;
  const { today, tomorrow } = pickDays(data);
  const parts = [];
  (data.warnings || []).slice(0, 2).forEach((w) => parts.push(`${w.name}가 내려졌습니다.`));
  parts.push(`오늘은 ${dateLine()}입니다.`);
  parts.push(`${HOME.name} 지금 ${r(now.temp)}도, ${now.text}.`);
  if (today && today.min != null && today.max != null) parts.push(`오늘 최저 ${r(today.min)}도, 최고 ${r(today.max)}도.`);
  else if (today && today.max != null) parts.push(`오늘 최고 ${r(today.max)}도.`);
  const u = umbrella(data);
  parts.push(u.word.startsWith('눈') ? '눈이 와요. 미끄럼 조심하세요.' : `우산은 ${u.word}.`);
  if (data.air?.grade) parts.push(`미세먼지 ${data.air.word || DUST_WORD[data.air.grade]}.`);
  if (tomorrow) parts.push(`내일은 ${tomorrow.text}${tomorrow.max != null ? `, 최고 ${r(tomorrow.max)}도` : ''}.`);
  return parts.join(' ');
}
function speak() {
  const btn = $('#btnSpeak');
  if (!('speechSynthesis' in window)) { alert('이 휴대폰에서는 소리 듣기가 안 돼요.'); return; }
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.textContent = '🔊 소리로 듣기'; return; }
  if (!last) return;
  const u = new SpeechSynthesisUtterance(speechText());
  u.lang = 'ko-KR'; u.rate = 0.8;
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.replace('_', '-').startsWith('ko'));
  if (v) u.voice = v;
  u.onend = u.onerror = () => { btn.textContent = '🔊 소리로 듣기'; };
  btn.textContent = '⏹ 그만 듣기';
  speechSynthesis.speak(u);
}

/* ================= 뒤로가기 (갤럭시) ================= */
// 열린 층: 'map', 'settings', 'search' 순서대로 쌓임. 뒤로가기 = 맨 위 하나 닫기
const layers = [];
function openLayer(name) {
  layers.push(name);
  history.pushState({ layer: name, depth: layers.length }, '');
  showLayer(name, true);
}
function closeTopLayer() { if (layers.length) history.back(); }
window.addEventListener('popstate', () => {
  const depth = history.state && history.state.depth ? history.state.depth : 0;
  while (layers.length > depth) showLayer(layers.pop(), false);
});
function showLayer(name, on) {
  if (name === 'map') {
    $('#view-weather').classList.toggle('active', !on);
    $('#view-map').classList.toggle('active', on);
    $('#tabWeather').classList.toggle('active', !on);
    $('#tabMap').classList.toggle('active', on);
    if (on) initMap(); else window.scrollTo(0, 0);
  } else if (name === 'settings') {
    $('#settings').hidden = !on;
    if (on) fillSettings();
  } else if (name === 'search') {
    $('#search').hidden = !on;
    if (on) setTimeout(() => $('#searchInput').focus(), 80);
    else $('#searchInput').blur();
  }
}

/* ================= 탭 ================= */
$('#tabMap').onclick = () => { if (!layers.includes('map')) openLayer('map'); };
$('#tabWeather').onclick = () => { if (layers.includes('map')) closeTopLayer(); };

/* ================= 더 보기 ================= */
$('#btnMore').onclick = () => {
  const box = $('#moreBox');
  box.hidden = !box.hidden;
  $('#btnMore').textContent = box.hidden ? '이번 주 날씨 더 보기 ▼' : '접기 ▲';
  $('#btnMore').setAttribute('aria-expanded', String(!box.hidden));
};

/* ================= 지도 ================= */
let map, pin, meDot;
function initMap() {
  if (map) { setTimeout(() => map.invalidateSize(), 60); return; }
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([HOME.lat, HOME.lon], 15);
  // 지도 그림을 두 배로 키워서 글씨가 크게 보이게 함
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    tileSize: 512, zoomOffset: -1, maxZoom: 19, minZoom: 7, attribution: '© OpenStreetMap',
  }).addTo(map);
  // 지도를 눌러도 아무 일도 안 일어남 (일부러 클릭 기능 없음)
  locateOnMap(false);
}
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no-geo'));
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), rej,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60 * 1000 });
  });
}
async function locateOnMap(userClicked) {
  try {
    const p = await getPosition();
    if (meDot) meDot.setLatLng([p.lat, p.lon]);
    else meDot = L.circleMarker([p.lat, p.lon], { radius: 13, color: '#fff', weight: 4, fillColor: '#1e5bd8', fillOpacity: 1, interactive: false }).addTo(map);
    map.setView([p.lat, p.lon], userClicked ? Math.max(map.getZoom(), 16) : 16);
  } catch {
    if (userClicked) alert('위치를 찾지 못했어요. 휴대폰 위쪽을 내려서 "위치"를 켜 주세요.');
  }
}
$('#zIn').onclick = () => map && map.zoomIn();
$('#zOut').onclick = () => map && map.zoomOut();
$('#mapMe').onclick = () => map && locateOnMap(true);
function showPin(p) {
  if (pin) map.removeLayer(pin);
  pin = L.marker([p.lat, p.lon], { interactive: false }).addTo(map);
  pin.bindTooltip(p.title, { permanent: true, direction: 'top', offset: [0, -40], className: 'pin-label' }).openTooltip();
  map.setView([p.lat, p.lon], 17);
}

/* ================= 장소 검색 ================= */
function shortCity(s) { return (s || '').replace(/(특별시|광역시|특별자치시)$/, '').replace(/특별자치도$/, '도'); }
function nameFromAddress(a) {
  if (!a) return '';
  const metro = a.city && /(특별시|광역시|특별자치시)$/.test(a.city);
  const parts = [];
  if (metro) parts.push(shortCity(a.city));
  else if (a.city) parts.push(a.city);
  else if (a.county) parts.push(a.county);
  else if (a.province || a.state) parts.push(a.province || a.state);
  const mid = a.borough || a.city_district || (metro ? a.county : '');
  if (mid) parts.push(mid);
  const dong = a.quarter || a.suburb || a.town || a.village || a.neighbourhood;
  if (dong && !parts.includes(dong)) parts.push(dong);
  return parts.filter(Boolean).slice(0, 3).join(' ');
}
async function searchPlaces(q) {
  let out = [];
  const vb = [HOME.lon - 0.25, HOME.lat + 0.25, HOME.lon + 0.25, HOME.lat - 0.25].join(',');
  try {
    const j = await getJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=10&countrycodes=kr&accept-language=ko&bounded=0&viewbox=' + vb + '&q=' + encodeURIComponent(q), 10000);
    out = j.map((p) => {
      const title = p.name || (p.display_name || '').split(',')[0];
      const a = p.address || {};
      let sub = nameFromAddress(a);
      if (!sub || sub === title) sub = shortCity(a.province || a.state || a.city || '');
      if (sub === title) sub = '';
      return { lat: +p.lat, lon: +p.lon, title, sub, a };
    });
  } catch {}
  if (!out.length) {
    try {
      const j = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=8&language=ko&countryCode=KR&name=' + encodeURIComponent(q), 10000);
      out = (j.results || []).map((p) => ({ lat: p.latitude, lon: p.longitude, title: p.name, sub: [p.admin1, p.admin2, p.admin3].filter(Boolean).join(' '), a: { city: p.admin1, borough: p.admin2 } }));
    } catch {}
  }
  // 같은 곳이 여러 번 나오면(출구, 영어 이름, 버스정류장 등) 하나만 남김
  const base = (t) => (t || '').replace(/\s*\(.*?\)\s*/g, '').trim();
  const kept = [];
  for (const p of out) {
    const near = (k) => Math.abs(k.lat - p.lat) < 0.01 && Math.abs(k.lon - p.lon) < 0.01;
    const dup = kept.some((k) => base(k.title) === base(p.title) && (k.sub === p.sub || near(k)));
    if (!dup) kept.push({ ...p, title: base(p.title) || p.title });
  }
  return kept.slice(0, 6);
}

let searchFor = 'map';
function openSearch(forWhat) {
  searchFor = forWhat;
  $('#searchTitle').textContent = forWhat === 'map' ? '지도에서 장소 찾기' : '날씨 볼 동네 찾기';
  $('#searchInput').placeholder = forWhat === 'map' ? '예: 주안역, 인하대병원' : '예: 인천 미추홀구, 양평군';
  $('#searchInput').value = '';
  $('#searchResults').innerHTML = '';
  $('#searchHint').innerHTML = '이름을 쓰고 <b>찾기</b>를 누르세요.';
  openLayer('search');
}
$('#btnMapSearch').onclick = () => openSearch('map');
$('#searchClose').onclick = closeTopLayer;
$('#searchForm').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (!q) return;
  $('#searchInput').blur();
  $('#searchHint').textContent = '찾는 중…';
  $('#searchResults').innerHTML = '';
  const list = await searchPlaces(q);
  if (!list.length) { $('#searchHint').textContent = '찾는 곳이 없어요. 다른 이름으로 다시 써 보세요.'; return; }
  $('#searchHint').textContent = '아래에서 맞는 곳을 누르세요.';
  const ul = $('#searchResults');
  list.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = '<b></b><span></span>';
    li.querySelector('b').textContent = p.title;
    li.querySelector('span').textContent = p.sub || '';
    li.onclick = () => {
      closeTopLayer();
      if (searchFor === 'map') showPin(p);
      else setHomeFromPlace(p);
    };
    ul.appendChild(li);
  });
};

/* ================= 보호자 설정 ================= */
const SIZES = [20, 22, 26];
let sizeIdx = store.get('size2', 1);
function applySize() {
  document.documentElement.style.setProperty('--fs', SIZES[sizeIdx] + 'px');
  document.querySelectorAll('.size-choices .btn').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.size === sizeIdx)));
}
document.querySelectorAll('.size-choices .btn').forEach((b) => {
  b.onclick = () => { sizeIdx = +b.dataset.size; store.set('size2', sizeIdx); applySize(); };
});
applySize();

function fillSettings() {
  $('#setPlace').textContent = HOME.name;
  $('#stationInput').value = HOME.station || '';
  applySize();
}
$('#btnGuardian').onclick = () => openLayer('settings');
$('#settingsClose').onclick = closeTopLayer;
$('#btnChangeHome').onclick = () => openSearch('home');
$('#btnResetHome').onclick = () => {
  HOME = { ...HOME_DEFAULT };
  store.set('home', {});
  fillSettings();
  loadWeather();
};
$('#stationForm').onsubmit = (e) => {
  e.preventDefault();
  HOME.station = $('#stationInput').value.trim();
  saveHome();
  $('#stationInput').blur();
  loadWeather();
};
function saveHome() {
  const diff = {};
  for (const k of Object.keys(HOME)) if (HOME[k] !== HOME_DEFAULT[k]) diff[k] = HOME[k];
  store.set('home', diff);
}
function setHomeFromPlace(p) {
  const a = p.a || {};
  const far = Math.abs(p.lat - HOME.lat) > 0.15 || Math.abs(p.lon - HOME.lon) > 0.15;
  const name = nameFromAddress(a) || p.sub || p.title;
  HOME = {
    ...HOME,
    lat: +(+p.lat).toFixed(4), lon: +(+p.lon).toFixed(4),
    name: name.split(' ').slice(0, 2).join(' ') || p.title,
    area: shortCity(a.city && /(특별시|광역시|특별자치시)$/.test(a.city) ? a.city : (a.province || a.state || a.city || '')).replace(/도$/, '') || HOME.area,
    sub: (a.borough || a.county || a.city || '').replace(/(구|군|시)$/, ''),
    // 멀리 옮기면 예전 측정소는 맞지 않으니 비움 (보호자가 다시 적을 수 있음)
    station: far ? '' : HOME.station,
  };
  saveHome();
  fillSettings();
  last = null;
  loadWeather();
}

/* ================= 설치 ================= */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('#btnInstall').hidden = false; });
$('#btnInstall').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null; $('#btnInstall').hidden = true;
};
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

/* ================= 버튼 ================= */
$('#btnSpeak').onclick = speak;
$('#btnRefresh').onclick = () => loadWeather();

/* ================= 시작 ================= */
(function start() {
  $('#today').textContent = dateLine();
  $('#place').textContent = '📍 ' + HOME.name;
  if (last && last.homeKey === homeKey()) render(last);
  loadWeather();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      $('#today').textContent = dateLine();
      if (!last || Date.now() - last.time > 15 * 60 * 1000) loadWeather();
    }
  });
})();
