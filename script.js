// script.js — Weather widget with throttled UI writes and non-flickering updates.
// Drop-in replacement: keeps functionality but reduces DOM writes and batches updates.

import { initClouds } from './clouds.js';

/* ---------- quick helpers ---------- */
const SELECTORS = {
  dateTime: 'dateTime',
  location: 'location',
  temperature: 'temperature',
  weatherIcon: 'weatherIcon',
  precipitationChance: 'precipitationChance',
  humidity: 'humidity',
  windSpeed: 'windSpeed',
  sunriseTime: 'sunriseTime',
  sunsetTime: 'sunsetTime',
  dayLength: 'dayLength',
  forecastContainer: 'forecastContainer',
  cloudContainer: 'cloud-container',
  cloudTooltip: 'cloud-tooltip'
};
const EL = Object.fromEntries(Object.entries(SELECTORS).map(([k,v]) => [k, document.getElementById(v)]));

// Minimal safe setter to avoid unnecessary DOM writes
function setTextIfChanged(el, value) {
  if (!el) return;
  const s = value == null ? '' : String(value);
  if (el.textContent === s) return;
  el.textContent = s;
}

// Batch writes via rAF
function batchWrite(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else fn();
}

/* ---------- date/time (throttled) ---------- */
let lastMinuteKey = null;
function updateDateTimeThrottled() {
  const now = new Date();
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  if (minuteKey === lastMinuteKey) return;
  lastMinuteKey = minuteKey;
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long' });
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  batchWrite(() => setTextIfChanged(EL.dateTime, `${dateStr}, ${timeStr}`));
}
setInterval(updateDateTimeThrottled, 1000);
updateDateTimeThrottled();

/* ---------- fetch helper with retries ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchWithRetries(url, opts = {}, tries = 3, backoff = 400) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i < tries - 1) await sleep(backoff * (i + 1));
      else throw err;
    }
  }
}

/* ---------- geolocation / config ---------- */
const LOCATION_KEY = 'weather_widget_location_v1';
function getSavedLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data.lat === 'number' && typeof data.lon === 'number') return data;
    return null;
  } catch (e) { return null; }
}
function setSavedLocation(obj) {
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(obj));
    window.dispatchEvent(new CustomEvent('weather:location-changed', { detail: obj }));
    return true;
  } catch (e) { return false; }
}
function clearSavedLocation() {
  try {
    localStorage.removeItem(LOCATION_KEY);
    window.dispatchEvent(new CustomEvent('weather:location-cleared'));
    return true;
  } catch (e) { return false; }
}
async function geocodePlace(place) {
  if (!place || !place.trim()) return null;
  const q = encodeURIComponent(place.trim());
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${q}&limit=4&accept-language=en`;
  try {
    const json = await fetchWithRetries(url, { headers: { 'Accept': 'application/json' } }, 2, 400);
    if (!Array.isArray(json) || json.length === 0) return null;
    let pick = json[0];
    for (const r of json) {
      if (r.type && ['city','town','village','county','administrative','state'].includes(r.type)) { pick = r; break; }
    }
    return { lat: Number(pick.lat), lon: Number(pick.lon), label: pick.display_name || place };
  } catch (err) {
    return null;
  }
}
function getBrowserGeolocation(timeoutMs = 7000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    let done = false;
    const onSuccess = (pos) => { if (done) return; done = true; resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: null }); };
    const onErr = () => { if (done) return; done = true; resolve(null); };
    navigator.geolocation.getCurrentPosition(onSuccess, onErr, { timeout: timeoutMs, maximumAge: 60000 });
    setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs + 300);
  });
}

/* ---------- init config UI (slide panel) ---------- */
function initLocationConfigUI() {
  const btn = document.getElementById('weather-config-btn');
  const panel = document.getElementById('weather-config-panel');
  const closeBtn = document.getElementById('weather-config-close');
  const input = document.getElementById('weather-config-input');
  const saveBtn = document.getElementById('weather-config-save');
  const clearBtn = document.getElementById('weather-config-clear');
  const geoBtn = document.getElementById('weather-config-geo');
  const msg = document.getElementById('weather-config-msg');

  if (!btn || !panel || !closeBtn || !input || !saveBtn || !clearBtn || !geoBtn || !msg) return;

  function openPanel() {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    const saved = getSavedLocation();
    input.value = saved && saved.label ? saved.label : '';
    msg.textContent = saved ? `Using saved: ${saved.label || `${saved.lat.toFixed(3)},${saved.lon.toFixed(3)}`}` : '';
    setTimeout(() => input.focus(), 190);
  }
  function closePanel() {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  });

  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });

  panel.addEventListener('click', (ev) => {
    if (ev.target === panel) closePanel();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && panel.classList.contains('open')) closePanel();
  });

  saveBtn.addEventListener('click', async () => {
    const place = input.value.trim();
    if (!place) {
      msg.textContent = 'Please enter a place.';
      return;
    }
    msg.textContent = 'Resolving location…';
    saveBtn.disabled = true;
    try {
      const resolved = await geocodePlace(place);
      if (!resolved) {
        msg.textContent = 'Place not found. Try a nearby city or ZIP.';
        return;
      }
      setSavedLocation({ lat: resolved.lat, lon: resolved.lon, label: resolved.label || place });
      msg.textContent = `Saved: ${resolved.label || place}`;
      window.dispatchEvent(new CustomEvent('weather:config-saved', { detail: { lat: resolved.lat, lon: resolved.lon, label: resolved.label } }));
      setTimeout(closePanel, 450);
    } finally {
      saveBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', () => {
    clearSavedLocation();
    msg.textContent = 'Cleared saved location; widget will use IP/geolocation next refresh.';
    window.dispatchEvent(new CustomEvent('weather:config-cleared'));
    setTimeout(closePanel, 450);
  });

  geoBtn.addEventListener('click', async () => {
    msg.textContent = 'Requesting browser location…';
    geoBtn.disabled = true;
    try {
      const g = await getBrowserGeolocation();
      if (!g) {
        msg.textContent = 'Browser location unavailable or denied.';
        return;
      }
      setSavedLocation({ lat: g.lat, lon: g.lon, label: g.label || 'Device location' });
      msg.textContent = 'Saved device location.';
      window.dispatchEvent(new CustomEvent('weather:config-saved', { detail: { lat: g.lat, lon: g.lon, label: g.label } }));
      setTimeout(closePanel, 450);
    } finally {
      geoBtn.disabled = false;
    }
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLocationConfigUI);
} else {
  initLocationConfigUI();
}

/* ---------- location detection ---------- */
const IP_PROVIDERS = [
  { url: 'https://freegeoip.app/json/', mapper: j => j && j.latitude && j.longitude ? { lat: Number(j.latitude), lon: Number(j.longitude), label: [j.city, j.region_name || j.region, j.country_name].filter(Boolean).join(', ') } : null },
  { url: 'https://ipapi.co/json/', mapper: j => j && (j.latitude || j.lat) && (j.longitude || j.lon) ? { lat: Number(j.latitude || j.lat), lon: Number(j.longitude || j.lon), label: [j.city, j.region, j.country_name].filter(Boolean).join(', ') } : null },
  { url: 'https://ipwho.is/', mapper: j => j && j.success !== false && j.latitude && j.longitude ? { lat: Number(j.latitude), lon: Number(j.longitude), label: [j.city, j.region, j.country].filter(Boolean).join(', ') } : null }
];
async function tryIpProviders() {
  for (const p of IP_PROVIDERS) {
    try {
      const json = await fetchWithRetries(p.url, {}, 2, 300);
      const mapped = p.mapper(json);
      if (mapped) return mapped;
    } catch (e) { /* ignore and continue */ }
  }
  return null;
}
function tryNavigatorGeolocation(timeoutMs = 7000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    let done = false;
    const onSuccess = (pos) => { if (done) return; done = true; resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: null }); };
    const onErr = () => { if (done) return; done = true; resolve(null); };
    navigator.geolocation.getCurrentPosition(onSuccess, onErr, { timeout: timeoutMs, maximumAge: 60000 });
    setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs + 300);
  });
}
async function detectLocation() {
  const saved = getSavedLocation();
  if (saved) return saved;
  const ip = await tryIpProviders().catch(() => null);
  if (ip) return ip;
  const geo = await tryNavigatorGeolocation().catch(() => null);
  if (geo) return geo;
  return { lat: 40.7128, lon: -74.0060, label: 'New York, USA' };
}

/* ---------- weather fetch ---------- */
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
async function fetchWeatherFor(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: 'precipitation_probability,relativehumidity_2m,temperature_2m,windspeed_10m,weathercode',
    daily: 'weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset',
    current_weather: 'true', timezone: 'auto',
    temperature_unit: 'fahrenheit', windspeed_unit: 'mph'
  });
  const url = `${OPEN_METEO}?${params.toString()}`;
  return await fetchWithRetries(url, {}, 3, 400);
}

/* ---------- UI render (uses setTextIfChanged + batchWrite) ---------- */
function weatherCodeToIcon(code, isDay) {
  if ([0].includes(code)) return isDay ? '☀️' : '🌙';
  if ([1,2].includes(code)) return '⛅';
  if ([3].includes(code)) return '☁️';
  if ([45,48].includes(code)) return '🌫️';
  if ([51,53,55,56,57].includes(code)) return '🌦️';
  if ([61,63,65,66,67].includes(code)) return '🌧️';
  if ([71,73,75,77,85,86].includes(code)) return '🌨️';
  if ([80,81,82].includes(code)) return '🌧️';
  if ([95,96,99].includes(code)) return '⛈️';
  return '⛅';
}

function formatTimeISOToLocal(isoStr) {
  try { return new Date(isoStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  catch { return isoStr; }
}
function formatDurationSeconds(sec) {
  const h = Math.floor(sec/3600); const m = Math.floor((sec%3600)/60); return `${h} h ${m} m`;
}

async function renderUI(data, locationLabel) {
  try {
    const current = data.current_weather ?? null;
    const timesArr = (data.hourly?.time || []).map(t => new Date(t));
    let nearestHourlyIndex = 0;
    if (timesArr.length) {
      const now = new Date();
      let idx = timesArr.findIndex(t => t >= now);
      if (idx === -1) idx = timesArr.length - 1;
      nearestHourlyIndex = idx;
    }

    let tempDisplay = '—';
    let code = 0, isDay = true;
    if (current && typeof current.temperature !== 'undefined') {
      tempDisplay = `${Math.round(current.temperature)}°F`;
      code = current.weathercode;
      isDay = current.is_day === 1;
    } else if (data.hourly?.temperature_2m) {
      const t = Math.round(data.hourly.temperature_2m[nearestHourlyIndex]);
      tempDisplay = `${t}°F`;
      code = data.hourly.weathercode ? data.hourly.weathercode[nearestHourlyIndex] : code;
    }

    // batch writes
    batchWrite(() => {
      setTextIfChanged(EL.temperature, tempDisplay);
      setTextIfChanged(EL.weatherIcon, weatherCodeToIcon(code, isDay));
      setTextIfChanged(EL.location, locationLabel || 'Unknown location');

      const wind = current?.windspeed != null ? `${Math.round(current.windspeed)} mph` : '—';
      setTextIfChanged(EL.windSpeed, `Wind: ${wind}`);

      const idx = nearestHourlyIndex;
      const precip = data.hourly?.precipitation_probability?.[idx];
      setTextIfChanged(EL.precipitationChance, precip != null ? `Precip ${Math.round(precip)}%` : 'Precip —');
      const hum = data.hourly?.relativehumidity_2m?.[idx];
      setTextIfChanged(EL.humidity, hum != null ? `Humidity: ${Math.round(hum)}%` : 'Humidity: —');

      if (data.daily?.sunrise && data.daily?.sunset) {
        const sunrise = data.daily.sunrise[0];
        const sunset = data.daily.sunset[0];
        setTextIfChanged(EL.sunriseTime, formatTimeISOToLocal(sunrise));
        setTextIfChanged(EL.sunsetTime, formatTimeISOToLocal(sunset));
        setTextIfChanged(EL.dayLength, formatDurationSeconds(Math.max(0, Math.round((new Date(sunset) - new Date(sunrise))/1000))));
      }

      // forecast cards: rebuild only when needed (simple approach: clear and re-add)
// ---------- replace existing forecast-building code with this ----------
const fc = EL.forecastContainer;
if (fc) {
  // compute local YYYY-MM-DD for "today" (use local calendar date)
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const dailyTimes = data.daily?.time || [];
  // find index where daily time equals local today; fallback to 0
  let startIdx = dailyTimes.findIndex(d => d === todayStr);
  if (startIdx === -1) {
    // sometimes API returns only future days or different alignment; try a safer match:
    // if first element equals today-1 and second equals today, pick 1
    if (dailyTimes.length > 1) {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const yStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
      if (dailyTimes[0] === yStr && dailyTimes[1] === todayStr) startIdx = 1;
      else startIdx = 0;
    } else {
      startIdx = 0;
    }
  }

  // rebuild only when needed
  const needRebuild = !fc._built || (data.daily?.time?.length !== fc._builtCount) || fc._startIdx !== startIdx;
  if (needRebuild) {
    fc._built = true;
    fc._builtCount = data.daily?.time?.length || 0;
    fc._startIdx = startIdx;
    while (fc.firstChild) fc.removeChild(fc.firstChild);

    const maxCards = 4;
    for (let i = 0; i < maxCards; i++) {
      const idx = startIdx + i;
      if (!data.daily || idx >= (data.daily.time || []).length) break;
      const dIso = data.daily.time[idx];
      const d = new Date(dIso + 'T00:00:00'); // safe parse
      const label = (idx === startIdx) ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' });
      const hi = Math.round(data.daily.temperature_2m_max[idx]);
      const lo = Math.round(data.daily.temperature_2m_min[idx]);
      const codeDay = data.daily.weathercode[idx];

      const card = document.createElement('div');
      card.className = 'forecast-day bg-white/5 backdrop-blur-sm rounded-xl p-3 w-20 text-center border border-white/10 shadow-sm hover:bg-white/10 transition-all duration-200 cursor-pointer transform hover:-translate-y-1';
      card.innerHTML = `<div class="day-name text-xs font-medium mb-1 opacity-80">${label}</div>
                        <div class="forecast-icon text-2xl my-1 drop-shadow-md">${weatherCodeToIcon(codeDay,true)}</div>
                        <div class="high-temp text-sm font-semibold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-300">${hi}°</div>
                        <div class="low-temp text-xs opacity-70">${lo}°</div>`;
      card.addEventListener('click', () => {
        setTextIfChanged(EL.temperature, `${hi}°F`);
        setTextIfChanged(EL.weatherIcon, weatherCodeToIcon(codeDay, true));
        card.classList.add('scale-105');
        setTimeout(() => card.classList.remove('scale-105'), 220);
      });
      fc.appendChild(card);
    }
  }
}
      }
    });
  } catch (err) {
    console.error('renderUI error', err);
  }
}

/* ---------- init weather + clouds ---------- */
async function initAll() {
  // init clouds (safe)
  try {
    const cloudContainer = EL.cloudContainer;
    if (cloudContainer) {
      try { initClouds(cloudContainer); } catch (e) {
        try { const mod = await import('./clouds.js'); if (mod && mod.initClouds) mod.initClouds(cloudContainer); } catch (err) { console.warn('clouds dynamic import failed', err); }
      }
    }
  } catch (e) { console.warn('cloud init error', e); }

  setTextIfChanged(EL.location, 'Detecting location...');
  const loc = await detectLocation();
  if (!loc) setTextIfChanged(EL.location, 'Location unknown');
  else setTextIfChanged(EL.location, loc.label || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`);

  async function refresh(used) {
    try {
      const data = await fetchWeatherFor(used.lat, used.lon).catch(e => { console.error('fetchWeatherFor failed', e); return null; });
      if (!data) { setTextIfChanged(EL.location, 'Weather unavailable'); return; }
      await renderUI(data, used.label);
    } catch (err) { console.error('refresh error', err); }
  }

  const used = loc || { lat: 40.7128, lon: -74.0060, label: 'New York, USA' };
  await refresh(used);

  window.addEventListener('weather:config-saved', (e) => {
    const d = e.detail; if (!d) return;
    setTextIfChanged(EL.location, d.label || `${d.lat.toFixed(3)},${d.lon.toFixed(3)}`);
    fetchWeatherFor(d.lat, d.lon).then(data => { if (data) renderUI(data, d.label); }).catch(console.error);
  });
  window.addEventListener('weather:config-cleared', async () => {
    const newLoc = await detectLocation();
    setTextIfChanged(EL.location, newLoc.label || `${newLoc.lat.toFixed(3)},${newLoc.lon.toFixed(3)}`);
    fetchWeatherFor(newLoc.lat, newLoc.lon).then(data => { if (data) renderUI(data, newLoc.label); }).catch(console.error);
  });

  // periodic refresh (every hour)
  setInterval(() => { refresh(used).catch(e => console.error('periodic weather error', e)); }, 60 * 60 * 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initAll().catch(e => console.error(e)));
} else {
  initAll().catch(e => console.error(e));
}
