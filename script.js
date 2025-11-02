// script.js — ES module (weather + config + boot)
import { initClouds } from './clouds.js';

/* ---------- helpers ---------- */
const SELECTORS = {
  dateTime: 'dateTime', location: 'location', temperature: 'temperature', weatherIcon: 'weatherIcon',
  precipitationChance: 'precipitationChance', humidity: 'humidity', windSpeed: 'windSpeed',
  sunriseTime: 'sunriseTime', sunsetTime: 'sunsetTime', dayLength: 'dayLength',
  forecastContainer: 'forecastContainer', cloudContainer: 'cloud-container', cloudTooltip: 'cloud-tooltip'
};
const EL = Object.fromEntries(Object.entries(SELECTORS).map(([k,v]) => [k, document.getElementById(v)]));

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchWithRetries(url, opts = {}, tries = 3, backoff = 400) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`fetch attempt ${i+1} failed for ${url}`, err);
      if (i < tries - 1) await sleep(backoff * (i + 1));
      else throw err;
    }
  }
}

/* ---------- utilities ---------- */
function setText(el, text) { if (el) el.textContent = text; }
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
function formatTimeISOToLocal(isoStr) { try { return new Date(isoStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return isoStr; } }
function formatDurationSeconds(sec) { const h = Math.floor(sec/3600); const m = Math.floor((sec%3600)/60); return `${h} h ${m} m`; }

/* ---------- date/time UI ---------- */
function updateDateTime() {
  const now = new Date();
  const optionsDate = { weekday: 'long' };
  const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false };
  setText(EL.dateTime, `${now.toLocaleDateString(undefined, optionsDate)}, ${now.toLocaleTimeString([], optionsTime)}`);
}
updateDateTime();
setInterval(updateDateTime, 60_000);

/* ===== Location override UI + helpers ===== */
const LOCATION_KEY = 'weather_widget_location_v1';
function getSavedLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data.lat === 'number' && typeof data.lon === 'number') return data;
    return null;
  } catch (e) { console.warn('getSavedLocation error', e); return null; }
}
function setSavedLocation(obj) {
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(obj));
    window.dispatchEvent(new CustomEvent('weather:location-changed', { detail: obj }));
    return true;
  } catch (e) { console.warn('setSavedLocation error', e); return false; }
}
function clearSavedLocation() {
  try {
    localStorage.removeItem(LOCATION_KEY);
    window.dispatchEvent(new CustomEvent('weather:location-cleared'));
    return true;
  } catch (e) { console.warn('clearSavedLocation error', e); return false; }
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
    console.warn('geocodePlace failed', err);
    return null;
  }
}
function getBrowserGeolocation(timeoutMs = 7000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    let done = false;
    const onSuccess = (pos) => { if (done) return; done = true; resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: null }); };
    const onErr = (err) => { if (done) return; done = true; console.warn('geolocation error', err); resolve(null); };
    navigator.geolocation.getCurrentPosition(onSuccess, onErr, { timeout: timeoutMs, maximumAge: 60000 });
    setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs + 300);
  });
}

/* Slide panel wiring (replaces previous modal init) */
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

/* ---------- location detection (IP providers + navigator fallback) ---------- */
const IP_PROVIDERS = [
  { url: 'https://freegeoip.app/json/', mapper: j => j && j.latitude && j.longitude ? { lat: Number(j.latitude), lon: Number(j.longitude), label: [j.city, j.region_name || j.region, j.country_name].filter(Boolean).join(', ') } : null },
  { url: 'https://ipapi.co/json/', mapper: j => j && (j.latitude || j.lat) && (j.longitude || j.lon) ? { lat: Number(j.latitude || j.lat), lon: Number(j.longitude || j.lon), label: [j.city, j.region, j.country_name].filter(Boolean).join(', ') } : null },
  { url: 'https://ipwho.is/', mapper: j => j && j.success !== false && j.latitude && j.longitude ? { lat: Number(j.latitude), lon: Number(j.longitude), label: [j.city, j.region, j.country].filter(Boolean).join(', ') } : null }
];
async function tryIpProviders() {
  for (const p of IP_PROVIDERS) {
    try {
      console.log('trying IP provider', p.url);
      const json = await fetchWithRetries(p.url, {}, 2, 300);
      const mapped = p.mapper(json);
      if (mapped) {
        console.log('IP provider succeeded', p.url, mapped);
        return mapped;
      } else {
        console.warn('IP provider returned no mapping', p.url, json);
      }
    } catch (e) {
      console.warn('IP provider failed', p.url, e);
    }
  }
  return null;
}
function tryNavigatorGeolocation(timeoutMs = 7000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    let done = false;
    const onSuccess = (pos) => { if (done) return; done = true; resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: null }); };
    const onErr = (err) => { if (done) return; done = true; console.warn('navigator.geolocation error', err); resolve(null); };
    navigator.geolocation.getCurrentPosition(onSuccess, onErr, { timeout: timeoutMs, maximumAge: 60000 });
    setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs + 300);
  });
}
async function detectLocation() {
  const saved = getSavedLocation();
  if (saved) return saved;
  const ip = await tryIpProviders().catch(err => { console.warn('tryIpProviders threw', err); return null; });
  if (ip) return ip;
  const geo = await tryNavigatorGeolocation().catch(() => null);
  if (geo) return geo;
  console.warn('All location methods failed; falling back to defaults');
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

/* ---------- render UI ---------- */
async function renderUI(data, locationLabel) {
  try {
    const current = data.current_weather ?? null;
    const nearestHourlyIndex = (() => {
      try {
        const now = new Date();
        const times = (data.hourly?.time || []).map(t => new Date(t));
        if (!times.length) return 0;
        let idx = times.findIndex(t => t >= now);
        if (idx === -1) idx = times.length - 1;
        return idx;
      } catch { return 0; }
    })();

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

    setText(EL.temperature, tempDisplay);
    setText(EL.weatherIcon, weatherCodeToIcon(code, isDay));
    setText(EL.location, locationLabel || 'Unknown location');

    const wind = current?.windspeed != null ? `${Math.round(current.windspeed)} mph` : '—';
    setText(EL.windSpeed, `Wind: ${wind}`);

    if (data.hourly && data.hourly.time) {
      const idx = nearestHourlyIndex;
      const precip = data.hourly.precipitation_probability?.[idx];
      setText(EL.precipitationChance, precip != null ? `Precip ${Math.round(precip)}%` : 'Precip —');
      const hum = data.hourly.relativehumidity_2m?.[idx];
      setText(EL.humidity, hum != null ? `Humidity: ${Math.round(hum)}%` : 'Humidity: —');
    } else {
      setText(EL.precipitationChance, 'Precip —');
      setText(EL.humidity, 'Humidity: —');
    }

    if (data.daily?.sunrise && data.daily?.sunset) {
      const sunrise = data.daily.sunrise[0];
      const sunset = data.daily.sunset[0];
      setText(EL.sunriseTime, formatTimeISOToLocal(sunrise));
      setText(EL.sunsetTime, formatTimeISOToLocal(sunset));
      setText(EL.dayLength, formatDurationSeconds(Math.max(0, Math.round((new Date(sunset) - new Date(sunrise))/1000))));
    }

    const fc = EL.forecastContainer;
    if (!fc) return;
    while (fc.firstChild) fc.removeChild(fc.firstChild);
    if (data.daily?.time) {
      const max = Math.min(data.daily.time.length, 4);
      for (let i = 0; i < max; i++) {
        const dIso = data.daily.time[i];
        const d = new Date(dIso);
        const label = i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' });
        const hi = Math.round(data.daily.temperature_2m_max[i]);
        const lo = Math.round(data.daily.temperature_2m_min[i]);
        const codeDay = data.daily.weathercode[i];
        const card = document.createElement('div');
        card.className = 'forecast-day bg-white/5 backdrop-blur-sm rounded-xl p-3 w-20 text-center border border-white/10 shadow-sm hover:bg-white/10 transition-all duration-200 cursor-pointer transform hover:-translate-y-1';
        card.innerHTML = `<div class="day-name text-xs font-medium mb-1 opacity-80">${label}</div>
                          <div class="forecast-icon text-2xl my-1 drop-shadow-md">${weatherCodeToIcon(codeDay,true)}</div>
                          <div class="high-temp text-sm font-semibold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-300">${hi}°</div>
                          <div class="low-temp text-xs opacity-70">${lo}°</div>`;
        card.addEventListener('click', () => {
          setText(EL.temperature, `${hi}°F`);
          setText(EL.weatherIcon, weatherCodeToIcon(codeDay, true));
          card.classList.add('scale-105');
          setTimeout(() => card.classList.remove('scale-105'), 220);
        });
        fc.appendChild(card);
      }
    }
  } catch (err) {
    console.error('renderUI error', err);
  }
}

/* ---------- init weather + clouds ---------- */
async function initAll() {
  try {
    const cloudContainer = EL.cloudContainer;
    if (cloudContainer) {
      try { initClouds(cloudContainer); } catch (e) {
        try { const mod = await import('./clouds.js'); if (mod && mod.initClouds) mod.initClouds(cloudContainer); } catch (err) { console.warn('clouds dynamic import failed', err); }
      }
    }
  } catch (e) { console.warn('cloud init error', e); }

  setText(EL.location, 'Detecting location...');
  const loc = await detectLocation();
  if (!loc) setText(EL.location, 'Location unknown');
  else setText(EL.location, loc.label || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`);

  async function refresh(used) {
    try {
      const data = await fetchWeatherFor(used.lat, used.lon).catch(e => { console.error('fetchWeatherFor failed', e); return null; });
      if (!data) { setText(EL.location, 'Weather unavailable'); return; }
      await renderUI(data, used.label);
    } catch (err) { console.error('refresh error', err); }
  }

  const used = loc || { lat: 40.7128, lon: -74.0060, label: 'New York, USA' };
  await refresh(used);

  window.addEventListener('weather:config-saved', (e) => {
    const d = e.detail; if (!d) return;
    setText(EL.location, d.label || `${d.lat.toFixed(3)},${d.lon.toFixed(3)}`);
    fetchWeatherFor(d.lat, d.lon).then(data => { if (data) renderUI(data, d.label); }).catch(console.error);
  });
  window.addEventListener('weather:config-cleared', async () => {
    const newLoc = await detectLocation();
    setText(EL.location, newLoc.label || `${newLoc.lat.toFixed(3)},${newLoc.lon.toFixed(3)}`);
    fetchWeatherFor(newLoc.lat, newLoc.lon).then(data => { if (data) renderUI(data, newLoc.label); }).catch(console.error);
  });

  setInterval(() => { refresh(used).catch(e => console.error('periodic weather error', e)); }, 60 * 60 * 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initAll().catch(e => console.error(e)));
} else {
  initAll().catch(e => console.error(e));
}
