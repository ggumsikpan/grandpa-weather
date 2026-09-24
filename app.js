/* 큰글씨 날씨·지도 - 광고 없는 할아버지용 날씨 앱 */
'use strict';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const DEFAULT_LOC = { lat: 37.5665, lon: 126.978, name: '서울 중구', mode: 'fixed' };

/* ---------- 날씨 코드 → 한글/그림 ---------- */
const WMO = {
  0: ['맑음', '☀️', '🌙'], 1: ['대체로 맑음', '🌤️', '🌙'], 2: ['구름 조금', '⛅', '☁️'], 3: ['흐림', '☁️'],
  45: ['안개', '🌫️'], 48: ['안개', '🌫️'],
  51: ['약한 이슬비', '🌦️'], 53: ['이슬비', '🌦️'], 55: ['이슬비', '🌧️'], 56: ['어는 비', '🌧️'], 57: ['어는 비', '🌧️'],
  61: ['약한 비', '🌦️'], 63: ['비', '🌧️'], 65: ['강한 비', '🌧️'], 66: ['어는 비', '🌧️'], 67: ['어는 비', '🌧️'],
  71: ['약한 눈', '🌨️'], 73: ['눈', '🌨️'], 75: ['많은 눈', '❄️'], 77: ['싸락눈', '🌨️'],
  80: ['소나기', '🌦️'], 81: ['소나기', '🌧️'], 82: ['강한 소나기', '⛈️'], 85: ['눈', '🌨️'], 86: ['많은 눈', '❄️'],
  95: ['천둥 번개', '⛈️'], 96: ['천둥 번개', '⛈️'], 99: ['천둥 번개', '⛈️'],
};
function wx(code, isDay = 1) {
  const w = WMO[code] || ['정보 없음', '❔'];
  return { text: w[0], icon: !isDay && w[2] ? w[2] : w[1] };
}
const isRainy = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const isSnowy = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;

/* ---------- 글자/시간 도우미 ---------- */
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const r = (n) => Math.round(n);
function hourLabel(h) {
  if (h === 0) return '밤 12시';
  if (h < 6) return `새벽 ${h}시`;
  if (h < 12) return `오전 ${h}시`;
  if (h === 12) return '낮 12시';
  if (h < 18) return `오후 ${h - 12}시`;
  if (h < 21) return `저녁 ${h - 12}시`;
  return `밤 ${h - 12}시`;
}
function windWord(ms) {
  if (ms < 4) return '약함';
  if (ms < 9) return '조금 강함';
  if (ms < 14) return '강함';
  return '매우 강함';
}
function dustGrade(pm10, pm25) {
  // 환경부 기준
  const g10 = pm10 == null ? 0 : pm10 <= 30 ? 1 : pm10 <= 80 ? 2 : pm10 <= 150 ? 3 : 4;
  const g25 = pm25 == null ? 0 : pm25 <= 15 ? 1 : pm25 <= 35 ? 2 : pm25 <= 75 ? 3 : 4;
  const g = Math.max(g10, g25);
  return { g, word: ['--', '좋음', '보통', '나쁨', '매우 나쁨'][g] };
}
function timeText(ts) {
  const d = new Date(ts);
  return `${hourLabel(d.getHours()).replace(/시$/, '')}시 ${String(d.getMinutes()).padStart(2, '0')}분`;
}

/* ---------- 네트워크 ---------- */
async function getJSON(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}
function forecastURL(lat, lon) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m,precipitation' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max' +
    '&timezone=Asia%2FSeoul&forecast_days=7&wind_speed_unit=ms';
}
function airURL(lat, lon) {
  return 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat + '&longitude=' + lon +
    '&current=pm10,pm2_5&timezone=Asia%2FSeoul';
}

function shortCity(s) {
  return (s || '').replace(/(특별시|광역시|특별자치시)$/, '').replace(/특별자치도$/, '도');
}
function nameFromAddress(a) {
  if (!a) return '';
  const metro = a.city && /(특별시|광역시|특별자치시)$/.test(a.city);
  const parts = [];
  if (metro) parts.push(shortCity(a.city));
  else if (a.city) parts.push(a.city);
  else if (a.county) parts.push(a.county);
  else if (a.province || a.state) parts.push(a.province || a.state);
  const mid = a.borough || a.city_district || (metro ? a.county : '') || (a.city && a.county && !metro ? '' : '');
  if (mid) parts.push(mid);
  const dong = a.quarter || a.suburb || a.town || a.village || a.neighbourhood || a.hamlet;
  if (dong && !parts.includes(dong)) parts.push(dong);
  return parts.filter(Boolean).slice(0, 3).join(' ');
}
async function reverseName(lat, lon) {
  try {
    const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&accept-language=ko`, 8000);
    const n = nameFromAddress(j.address);
    if (n) return n;
  } catch {}
  try {
    const j = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ko`, 8000);
    const n = [shortCity(j.city || j.principalSubdivision), j.locality].filter(Boolean).join(' ');
    if (n) return n;
  } catch {}
  return '선택한 곳';
}
async function searchPlaces(q) {
  let out = [];
  try {
    const j = await getJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=kr&accept-language=ko&q=' + encodeURIComponent(q), 10000);
    out = j.map((p) => {
      const title = p.name || (p.display_name || '').split(',')[0];
      const a = p.address || {};
      let sub = nameFromAddress(a);
      if (!sub || sub === title) sub = shortCity(a.province || a.state || a.city || '');
      if (sub === title) sub = '';
      return { lat: +p.lat, lon: +p.lon, title, sub };
    });
  } catch {}
  if (!out.length) {
    try {
      const j = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=8&language=ko&countryCode=KR&name=' + encodeURIComponent(q), 10000);
      out = (j.results || []).map((p) => ({
        lat: p.latitude, lon: p.longitude, title: p.name,
        sub: [p.admin1, p.admin2, p.admin3].filter(Boolean).join(' '),
      }));
    } catch {}
  }
  // 같은 이름이 가까이 여러 개 나오면(버스정류장, 출구 등) 하나만 남김
  const kept = [];
  for (const p of out) {
    const dup = kept.some((k) => k.title === p.title &&
      (k.sub === p.sub || (Math.abs(k.lat - p.lat) < 0.01 && Math.abs(k.lon - p.lon) < 0.01)));
    if (!dup) kept.push(p);
  }
  return kept.slice(0, 6);
}
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no-geo'));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }),
      rej, { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 });
  });
}

/* ---------- 상태 ---------- */
let loc = store.get('loc', null);
let last = store.get('last', null); // { data, air, loc, time }

function showMsg(t) { const m = $('#msg'); if (!t) { m.hidden = true; return; } m.textContent = t; m.hidden = false; }
function setPlace(name) { $('#place').textContent = '📍 ' + (name || '이 동네'); }

/* ---------- 날씨 불러오기 ---------- */
let loading = false;
async function loadWeather(l) {
  if (loading) return;
  loading = true;
  $('#updated').textContent = '날씨 확인 중…';
  try {
    const [data, air] = await Promise.all([
      getJSON(forecastURL(l.lat, l.lon)),
      getJSON(airURL(l.lat, l.lon)).catch(() => null),
    ]);
    last = { data, air, loc: l, time: Date.now() };
    store.set('last', last);
    showMsg('');
    render(last);
  } catch (e) {
    if (last) render(last);
    showMsg('인터넷 연결이 약해서 새 날씨를 못 가져왔어요. 잠시 후 🔄 새로 확인을 눌러 주세요.');
    $('#updated').textContent = last ? '마지막 확인: ' + timeText(last.time) : '';
  } finally { loading = false; }
}

function render({ data, air, loc: l, time }) {
  const c = data.current, d = data.daily, h = data.hourly;
  setPlace(l.name);
  const w = wx(c.weather_code, c.is_day);
  $('#nowIcon').textContent = w.icon;
  $('#nowTemp').textContent = r(c.temperature_2m) + '°';
  $('#nowDesc').textContent = w.text;
  $('#nowSub').textContent = `체감 ${r(c.apparent_temperature)}도 · 바람 ${windWord(c.wind_speed_10m)} · 습도 ${r(c.relative_humidity_2m)}%`;

  $('#tMax').textContent = r(d.temperature_2m_max[0]) + '°';
  $('#tMin').textContent = r(d.temperature_2m_min[0]) + '°';
  $('#tRain').textContent = (d.precipitation_probability_max[0] ?? 0) + '%';
  const dust = dustGrade(air?.current?.pm10, air?.current?.pm2_5);
  const td = $('#tDust');
  td.textContent = dust.word;
  td.className = 't-val dust-' + dust.g;

  // 시간별: 지금 이후 3시간 간격 6개
  const curKey = c.time.slice(0, 13);
  let i0 = h.time.findIndex((t) => t.slice(0, 13) > curKey);
  if (i0 < 0) i0 = 0;
  const todayDate = d.time[0];
  const hours = [];
  for (let k = 0; k < 6; k++) {
    const i = i0 + k * 3;
    if (i >= h.time.length) break;
    const hh = +h.time[i].slice(11, 13);
    const tomorrow = h.time[i].slice(0, 10) !== todayDate;
    const ww = wx(h.weather_code[i], h.is_day[i]);
    const p = h.precipitation_probability[i] ?? 0;
    hours.push(`<li><div class="when"><b>${hourLabel(hh)}</b><small>${tomorrow ? '내일 · ' : ''}${ww.text}</small></div>
      <div class="ic">${ww.icon}</div>
      <div class="right"><div class="temp">${r(h.temperature_2m[i])}°</div><div class="rain ${p < 30 ? 'none' : ''}">비 ${p}%</div></div></li>`);
  }
  $('#hours').innerHTML = hours.join('');

  // 주간
  const days = d.time.map((t, i) => {
    const dt = new Date(t + 'T12:00:00+09:00');
    const name = i === 0 ? '오늘' : i === 1 ? '내일' : i === 2 ? '모레' : DOW[dt.getDay()] + '요일';
    const ww = wx(d.weather_code[i]);
    const p = d.precipitation_probability_max[i] ?? 0;
    return `<li class="${i === 0 ? 'today' : ''}"><div class="when"><b>${name}</b><small>${dt.getMonth() + 1}/${dt.getDate()} · ${ww.text}</small></div>
      <div class="ic">${ww.icon}</div>
      <div class="right"><div class="temp"><span class="cold">${r(d.temperature_2m_min[i])}°</span>/<span class="hot">${r(d.temperature_2m_max[i])}°</span></div><div class="rain ${p < 30 ? 'none' : ''}">비 ${p}%</div></div></li>`;
  });
  $('#days').innerHTML = days.join('');

  // 한마디 조언
  const tips = makeAdvice(data, dust);
  const adv = $('#advice');
  adv.innerHTML = tips.map((t) => `<div>${t}</div>`).join('');
  adv.hidden = !tips.length;

  $('#updated').textContent = timeText(time) + ' 확인';
}

function makeAdvice(data, dust) {
  const c = data.current, d = data.daily, h = data.hourly;
  const tips = [];
  const curKey = c.time.slice(0, 13);
  const i0 = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) >= curKey));
  const next12 = h.precipitation_probability.slice(i0, i0 + 12).map((x) => x ?? 0);
  const codes12 = h.weather_code.slice(i0, i0 + 12);
  const maxP = Math.max(0, ...next12);
  const snow = isSnowy(c.weather_code) || codes12.some(isSnowy);
  const rainNow = isRainy(c.weather_code) || c.precipitation > 0;

  if (snow) tips.push('❄️ 눈 소식이 있어요. 길이 미끄러우니 조심하세요.');
  else if (rainNow || maxP >= 60) tips.push('☔ 비 소식이 있어요. 우산 꼭 챙기세요.');
  else if (maxP >= 30) tips.push('🌂 비가 올 수도 있어요. 작은 우산 챙기세요.');

  const tmax = d.temperature_2m_max[0], tmin = d.temperature_2m_min[0];
  if (tmax >= 33) tips.push('🥵 무척 더워요. 한낮 외출은 피하시고 물 자주 드세요.');
  else if (tmax >= 30) tips.push('☀️ 더운 날이에요. 모자 쓰시고 물 챙기세요.');
  if (tmin <= -5) tips.push('🥶 아주 추워요. 두꺼운 외투, 모자, 장갑 꼭 챙기세요.');
  else if (tmin <= 5) tips.push('🧥 쌀쌀해요. 따뜻한 외투 입으세요.');
  else if (tmax - tmin >= 10) tips.push('🧥 아침저녁으로 쌀쌀해요. 겉옷 챙기세요.');

  if (dust.g >= 3) tips.push('😷 미세먼지가 나빠요. 마스크 쓰세요.');
  if (!tips.length) tips.push('😊 오늘은 외출하기 괜찮은 날씨예요.');
  return tips.slice(0, 3);
}

/* ---------- 위치 ---------- */
async function useMyLocation(userClicked) {
  setPlace('내 위치 찾는 중…');
  try {
    const p = await getPosition();
    loc = { ...p, mode: 'gps', name: (last && last.loc && last.loc.mode === 'gps' && near(last.loc, p)) ? last.loc.name : '' };
    if (!loc.name) setPlace('내 위치');
    store.set('loc', loc);
    const namePromise = reverseName(p.lat, p.lon).then((n) => { loc.name = n; store.set('loc', loc); setPlace(n); if (last) { last.loc = loc; store.set('last', last); } });
    await loadWeather(loc);
    await namePromise;
  } catch (e) {
    const fallback = (loc && loc.lat) ? loc : DEFAULT_LOC;
    if (!loc) { loc = DEFAULT_LOC; store.set('loc', loc); }
    showMsg(userClicked
      ? '위치를 찾지 못했어요. 휴대폰 설정에서 위치(GPS)를 켜 주시거나, 🔎 다른 동네를 눌러 동네를 골라 주세요.'
      : `지금 위치를 몰라서 "${fallback.name}" 날씨를 보여 드려요. 🔎 다른 동네로 바꿀 수 있어요.`);
    await loadWeather(fallback);
  }
}
function near(a, b) { return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01; }

function setFixedPlace(p) {
  loc = { lat: +(+p.lat).toFixed(4), lon: +(+p.lon).toFixed(4), name: p.name, mode: 'fixed' };
  store.set('loc', loc);
  showMsg('');
  setPlace(loc.name);
  loadWeather(loc);
}

/* ---------- 소리로 듣기 ---------- */
function speak() {
  if (!('speechSynthesis' in window)) { alert('이 휴대폰에서는 소리 듣기가 안 돼요.'); return; }
  const btn = $('#btnSpeak');
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.textContent = '🔊 소리로 듣기'; return; }
  if (!last) return;
  const { data, air, loc: l } = last;
  const c = data.current, d = data.daily;
  const dust = dustGrade(air?.current?.pm10, air?.current?.pm2_5);
  let s = `지금 ${l.name || '이 동네'} 날씨는 ${wx(c.weather_code, c.is_day).text}, 기온은 ${r(c.temperature_2m)}도 입니다. ` +
    `오늘 최고 ${r(d.temperature_2m_max[0])}도, 최저 ${r(d.temperature_2m_min[0])}도. ` +
    `비 올 확률은 ${d.precipitation_probability_max[0] ?? 0}퍼센트 입니다. `;
  if (dust.g) s += `미세먼지는 ${dust.word}. `;
  s += `내일은 ${wx(d.weather_code[1]).text}, 최고 ${r(d.temperature_2m_max[1])}도 입니다. `;
  s += makeAdvice(data, dust).map((t) => t.replace(/^\S+\s/, '')).join(' ');
  const u = new SpeechSynthesisUtterance(s);
  u.lang = 'ko-KR'; u.rate = 0.9;
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith('ko'));
  if (v) u.voice = v;
  u.onend = u.onerror = () => { btn.textContent = '🔊 소리로 듣기'; };
  btn.textContent = '⏹ 그만 듣기';
  speechSynthesis.speak(u);
}

/* ---------- 글씨 크기 ---------- */
const SIZES = [20, 24, 28];
let sizeIdx = store.get('size', 1);
function applySize() { document.documentElement.style.setProperty('--fs', SIZES[sizeIdx] + 'px'); }
$('#btnFont').onclick = () => { sizeIdx = (sizeIdx + 1) % SIZES.length; store.set('size', sizeIdx); applySize(); };
applySize();

/* ---------- 탭 ---------- */
function showTab(which) {
  const isMap = which === 'map';
  $('#view-weather').classList.toggle('active', !isMap);
  $('#view-map').classList.toggle('active', isMap);
  $('#tabWeather').classList.toggle('active', !isMap);
  $('#tabMap').classList.toggle('active', isMap);
  if (isMap) initMap(); else window.scrollTo(0, 0);
}
$('#tabWeather').onclick = () => showTab('weather');
$('#tabMap').onclick = () => showTab('map');

/* ---------- 지도 ---------- */
let map, pin, meDot, sheetPlace;
function initMap() {
  if (map) { setTimeout(() => map.invalidateSize(), 50); return; }
  const start = loc || DEFAULT_LOC;
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([start.lat, start.lon], 15);
  // 지도 그림을 두 배로 키워 붙여서 글자가 크게 보이게 함 (→ ?map=normal 이면 원래 크기)
  const big = !/map=normal/.test(location.search);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', big
    ? { tileSize: 512, zoomOffset: -1, maxZoom: 19, minZoom: 7, attribution: '© OpenStreetMap' }
    : { maxZoom: 19, minZoom: 6, attribution: '© OpenStreetMap' }).addTo(map);
  map.on('click', (e) => pickOnMap(e.latlng.lat, e.latlng.lng));
  if (loc && loc.mode === 'gps') showMeDot(loc);
}
function showMeDot(p) {
  if (meDot) meDot.setLatLng([p.lat, p.lon]);
  else meDot = L.circleMarker([p.lat, p.lon], { radius: 12, color: '#fff', weight: 4, fillColor: '#1e5bd8', fillOpacity: 1 }).addTo(map);
}
async function pickOnMap(lat, lon, knownName) {
  if (pin) pin.setLatLng([lat, lon]); else pin = L.marker([lat, lon]).addTo(map);
  sheetPlace = { lat, lon, name: knownName || '' };
  $('#sheet').hidden = false;
  $('#sheetName').textContent = knownName || '이곳 이름 찾는 중…';
  $('#sheetWx').textContent = '날씨 확인 중…';
  const namePr = knownName ? Promise.resolve(knownName) : reverseName(lat, lon);
  namePr.then((n) => { if (sheetPlace && sheetPlace.lat === lat) { sheetPlace.name = n; $('#sheetName').textContent = '📍 ' + n; } });
  try {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code,is_day&timezone=Asia%2FSeoul`);
    if (sheetPlace && sheetPlace.lat === lat) {
      const w = wx(j.current.weather_code, j.current.is_day);
      $('#sheetWx').textContent = `${w.icon} 지금 ${r(j.current.temperature_2m)}° ${w.text}`;
    }
  } catch { $('#sheetWx').textContent = '날씨를 못 가져왔어요'; }
}
$('#sheetClose').onclick = () => { $('#sheet').hidden = true; if (pin) { map.removeLayer(pin); pin = null; } };
$('#sheetGo').onclick = () => {
  if (!sheetPlace) return;
  setFixedPlace({ ...sheetPlace, name: sheetPlace.name || '선택한 곳' });
  $('#sheet').hidden = true;
  showTab('weather');
};
$('#zIn').onclick = () => map && map.zoomIn();
$('#zOut').onclick = () => map && map.zoomOut();
$('#mapMe').onclick = async () => {
  try {
    const p = await getPosition();
    showMeDot(p);
    map.flyTo([p.lat, p.lon], 16);
  } catch { alert('위치를 찾지 못했어요. 휴대폰의 위치(GPS)를 켜 주세요.'); }
};

/* ---------- 검색 ---------- */
let searchFor = 'weather';
function openSearch(forWhat) {
  searchFor = forWhat;
  $('#searchTitle').textContent = forWhat === 'map' ? '지도에서 장소 찾기' : '날씨 볼 동네 찾기';
  $('#searchResults').innerHTML = '';
  $('#searchHint').innerHTML = '동네 이름이나 건물 이름을 쓰고 <b>찾기</b>를 누르세요.';
  $('#search').hidden = false;
  setTimeout(() => $('#searchInput').focus(), 50);
}
$('#searchClose').onclick = () => { $('#search').hidden = true; };
$('#btnOtherPlace').onclick = () => openSearch('weather');
$('#btnMapSearch').onclick = () => openSearch('map');
$('#searchForm').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (!q) return;
  $('#searchInput').blur();
  $('#searchHint').textContent = '찾는 중…';
  $('#searchResults').innerHTML = '';
  const list = await searchPlaces(q);
  if (!list.length) { $('#searchHint').textContent = '찾는 곳이 없어요. 다른 이름으로 다시 써 보세요. (예: "양평군", "서울역")'; return; }
  $('#searchHint').textContent = '아래에서 맞는 곳을 누르세요.';
  const ul = $('#searchResults');
  list.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<b></b><span></span>`;
    li.querySelector('b').textContent = p.title;
    li.querySelector('span').textContent = p.sub || '';
    li.onclick = () => {
      $('#search').hidden = true;
      const nm = p.sub && !p.sub.includes(p.title) && p.title.length < 12 ? `${p.sub.split(' ').slice(0, 2).join(' ')} ${p.title}`.trim() : (p.sub || p.title);
      if (searchFor === 'map') {
        map.flyTo([p.lat, p.lon], 16);
        pickOnMap(p.lat, p.lon, p.title);
      } else {
        setFixedPlace({ lat: p.lat, lon: p.lon, name: nm || p.title });
      }
    };
    ul.appendChild(li);
  });
};

/* ---------- 버튼 ---------- */
$('#btnMyLoc').onclick = () => { showMsg(''); useMyLocation(true); };
$('#btnRefresh').onclick = () => (loc ? (loc.mode === 'gps' ? useMyLocation(true) : loadWeather(loc)) : useMyLocation(true));
$('#btnSpeak').onclick = speak;

/* ---------- 설치 ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('#btnInstall').hidden = false; });
$('#btnInstall').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null; $('#btnInstall').hidden = true;
};
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- 시작 ---------- */
(function start() {
  if (last) render(last);
  if (loc && loc.mode === 'fixed') loadWeather(loc);
  else useMyLocation(false);
  // 다시 켰을 때 15분 넘었으면 새로 확인
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!last || Date.now() - last.time > 15 * 60 * 1000)) {
      if (loc && loc.mode === 'fixed') loadWeather(loc); else useMyLocation(false);
    }
  });
})();
