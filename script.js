// script.js — ES module
import { initClouds } from './clouds.js';

/* ---------- small helpers ---------- */
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

/* ---------- Weather logic ---------- */
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const IP_PROVIDERS = [
  { url: 'https://ipapi.co/json/', mapper: j => j && j.latitude && j.longitude ? { lat: Number(j.latitude), lon: Number(j.longitude), label: [j.city, j.region, j.country_name].filter(Boolean).join(', ') } : null },
  { url: 'https://ipwho.is/', mapper: j => j && j.success !== false && j.latitude && j.longitude ? { lat: Number(j.latitude), lon: Number(j.longitude), label: [j.city, j.region, j.country].filter(Boolean).join(', ') } : null }
];

async function getIpLocation() {
  for (const p of IP_PROVIDERS) {
    try {
      const json = await fetchWithRetries(p.url, {}, 2, 300);
      const mapped = p.mapper(json);
      if (mapped) { console.log('ip provider succeeded', p.url, mapped); return mapped; }
    } catch (e) {
      console.warn('IP provider failed', p.url, e);
    }
  }
  console.warn('All IP providers failed; falling back to defaults');
  return null;
}

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

    // forecast (first 4 days)
    const fc = EL.forecastContainer;
    if (!fc) return;
    while (fc.firstChild) fc.removeChild(fc.firstChild);
    if (data.daily?.time) {
      const days = data.daily.time;
      const max = Math.min(days.length, 4);
      for (let i = 0; i < max; i++) {
        const dIso = data.daily.time[i];
        const d = new Date(dIso);
        const label = i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' });
        const hi = Math.round(data.daily.temperature_2m_max[i]);
        const lo = Math.round(data.daily.temperature_2m_min[i]);
        const codeDay = data.daily.weathercode[i];
        const card = document.createElement('div');
        card.className = 'forecast-day bg-white/5 backdrop-blur-sm rounded-xl p-3 w-20 text-center border border-white/10 shadow-sm hover:bg-white/10 transition-all duration-200 cursor-pointer transform hover:-translate-y-1 animate-fadeInUp';
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

async function initWeather() {
  try {
    setText(EL.location, 'Loading...');
    const ip = await getIpLocation();
    const defaultCoords = { lat: 40.7128, lon: -74.0060, label: 'New York, USA' };
    const used = ip || defaultCoords;
    const data = await fetchWeatherFor(used.lat, used.lon).catch(e => { console.error('fetchWeatherFor failed', e); return null; });
    if (!data) { setText(EL.location, 'Weather unavailable'); return; }
    await renderUI(data, used.label);
  } catch (err) {
    console.error('initWeather outer error', err);
    setText(EL.location, 'Weather unavailable');
  }
}

/* ---------- init: clouds + weather ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  // initialize clouds (safe if already initialized)
  try {
    const cloudContainer = EL.cloudContainer;
    if (cloudContainer && typeof initClouds === 'function') {
      initClouds(cloudContainer);
    } else if (cloudContainer) {
      // dynamic import fallback if direct import failed for any reason
      try {
        const mod = await import('./clouds.js');
        if (mod && mod.initClouds) mod.initClouds(cloudContainer);
      } catch (_) { /* ignore */ }
    }
  } catch (e) { console.warn('cloud init error', e); }

  // fetch weather initially and every hour
  initWeather().catch(e => console.error(e));
  setInterval(() => { initWeather().catch(e => console.error('periodic weather error', e)); }, 60 * 60 * 1000);
});
