// script.js — drop-in replacement: reduce flicker and correct 4-day forecast alignment.

/* -------------- Helpers for safe DOM writes -------------- */
function setTextIfChanged(el, value) {
  if (!el) return;
  const s = value == null ? '' : String(value);
  if (el.textContent === s) return;
  el.textContent = s;
}

function batchWrite(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else fn();
}

/* -------------- Element refs (adjust IDs to match your markup) -------------- */
const EL = {
  dateTime: document.getElementById('dateTime'),
  temperature: document.getElementById('temperature'),
  weatherIcon: document.getElementById('weatherIcon'),
  location: document.getElementById('location'),
  precip: document.getElementById('precipitationChance'),
  humidity: document.getElementById('humidity'),
  wind: document.getElementById('windSpeed'),
  sunriseTime: document.getElementById('sunriseTime'),
  sunsetTime: document.getElementById('sunsetTime'),
  dayLength: document.getElementById('dayLength'),
  forecastContainer: document.getElementById('forecastContainer')
};

/* -------------- Date/time throttled updater -------------- */
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

/* -------------- Fetch helper with minimal retries -------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchWithRetries(url, opts = {}, tries = 3, backoff = 300) {
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

/* -------------- Simple weather-to-icon mapping -------------- */
function weatherCodeToIcon(code, isDay = true) {
  if (code === 0) return isDay ? '☀️' : '🌙';
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

/* -------------- Utilities -------------- */
function formatTimeISOToLocal(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}
function formatDayLabel(dateObj, isToday) {
  if (isToday) return 'Today';
  return dateObj.toLocaleDateString(undefined, { weekday: 'short' });
}

/* -------------- Forecast builder (fixed alignment) -------------- */
function buildForecastCardsInto(container, dailyData) {
  // dailyData expected to have: time: ['YYYY-MM-DD', ...], temperature_2m_max, temperature_2m_min, weathercode
  if (!container || !dailyData || !Array.isArray(dailyData.time)) return;

  // compute local YYYY-MM-DD for today
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const times = dailyData.time || [];
  // find index matching local today
  let startIdx = times.findIndex(d => d === todayStr);

  // fallback heuristics: sometimes API returns array starting yesterday
  if (startIdx === -1 && times.length >= 2) {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
    if (times[0] === yStr && times[1] === todayStr) startIdx = 1;
  }
  if (startIdx === -1) startIdx = 0;

  const maxCards = 4;
  const needRebuild = !container._built || container._startIdx !== startIdx || container._len !== times.length;
  if (!needRebuild) return;

  // rebuild
  container._built = true;
  container._startIdx = startIdx;
  container._len = times.length;

  // clear
  while (container.firstChild) container.removeChild(container.firstChild);

  for (let i = 0; i < maxCards; i++) {
    const idx = startIdx + i;
    if (!times[idx]) break;
    const dayIso = times[idx];
    // ensure safe parse as local date by appending T00:00:00
    const dObj = new Date(`${dayIso}T00:00:00`);
    const isToday = (idx === startIdx);
    const label = formatDayLabel(dObj, isToday);
    const hi = (dailyData.temperature_2m_max && dailyData.temperature_2m_max[idx] != null) ? Math.round(dailyData.temperature_2m_max[idx]) : '—';
    const lo = (dailyData.temperature_2m_min && dailyData.temperature_2m_min[idx] != null) ? Math.round(dailyData.temperature_2m_min[idx]) : '—';
    const code = (dailyData.weathercode && dailyData.weathercode[idx] != null) ? dailyData.weathercode[idx] : null;

    const card = document.createElement('div');
    card.className = 'forecast-day';
    card.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:10px;padding:8px;width:76px;text-align:center;margin-right:6px;';
    card.innerHTML = `
      <div style="font-size:11px;font-weight:600;margin-bottom:6px;opacity:.9">${label}</div>
      <div style="font-size:20px;margin:6px 0">${weatherCodeToIcon(code,true)}</div>
      <div style="font-size:13px;font-weight:600;background:linear-gradient(90deg,#fff,#cbd5e1);-webkit-background-clip:text;background-clip:text;color:transparent">${hi}°</div>
      <div style="font-size:12px;opacity:.75">${lo}°</div>
    `;
    // click behavior: update current temp/icon (optional)
    card.addEventListener('click', () => {
      batchWrite(() => {
        setTextIfChanged(EL.temperature, `${hi}°F`);
        setTextIfChanged(EL.weatherIcon, weatherCodeToIcon(code, true));
      });
    });

    container.appendChild(card);
  }
}

/* -------------- Main render function -------------- */
async function renderUIFromAPI(apiResponse, locationLabel) {
  try {
    // extract current and hourly/daily
    const current = apiResponse.current_weather || null;
    // determine nearest hour index for hourly arrays if present
    let idx = 0;
    if (Array.isArray(apiResponse.hourly?.time) && apiResponse.hourly.time.length) {
      const times = apiResponse.hourly.time.map(t => new Date(t));
      const now = new Date();
      const findIdx = times.findIndex(t => t >= now);
      idx = findIdx === -1 ? times.length - 1 : findIdx;
      if (idx < 0) idx = 0;
    }

    const tempDisplay = (current && typeof current.temperature !== 'undefined') ? `${Math.round(current.temperature)}°F`
                        : (apiResponse.hourly?.temperature_2m?.[idx] != null ? `${Math.round(apiResponse.hourly.temperature_2m[idx])}°F` : '—');

    const code = (current && typeof current.weathercode !== 'undefined') ? current.weathercode
                  : (apiResponse.hourly?.weathercode?.[idx] != null ? apiResponse.hourly.weathercode[idx] : 0);
    const isDay = current ? (current.is_day === 1) : true;

    batchWrite(() => {
      setTextIfChanged(EL.temperature, tempDisplay);
      setTextIfChanged(EL.weatherIcon, weatherCodeToIcon(code, isDay));
      setTextIfChanged(EL.location, locationLabel || 'Unknown');

      const precipVal = apiResponse.hourly?.precipitation_probability?.[idx];
      setTextIfChanged(EL.precip, precipVal != null ? `Precip ${Math.round(precipVal)}%` : 'Precip —');

      const humVal = apiResponse.hourly?.relativehumidity_2m?.[idx];
      setTextIfChanged(EL.humidity, humVal != null ? `Humidity: ${Math.round(humVal)}%` : 'Humidity: —');

      const windVal = current?.windspeed != null ? `${Math.round(current.windspeed)} mph` : (apiResponse.hourly?.windspeed_10m?.[idx] != null ? `${Math.round(apiResponse.hourly.windspeed_10m[idx])} mph` : '—');
      setTextIfChanged(EL.wind, `Wind: ${windVal}`);

      if (apiResponse.daily?.sunrise && apiResponse.daily?.sunset) {
        setTextIfChanged(EL.sunriseTime, formatTimeISOToLocal(apiResponse.daily.sunrise[0]));
        setTextIfChanged(EL.sunsetTime, formatTimeISOToLocal(apiResponse.daily.sunset[0]));
        const durSec = Math.max(0, Math.round((new Date(apiResponse.daily.sunset[0]) - new Date(apiResponse.daily.sunrise[0])) / 1000));
        const h = Math.floor(durSec/3600), m = Math.floor((durSec%3600)/60);
        setTextIfChanged(EL.dayLength, `${h} h ${m} m`);
      }
    });

    // build forecast cards with corrected alignment
    if (EL.forecastContainer && apiResponse.daily) {
      buildForecastCardsInto(EL.forecastContainer, apiResponse.daily);
    }
  } catch (err) {
    console.error('renderUIFromAPI error', err);
  }
}

/* -------------- Entry: detect location & fetch weather -------------- */
/* You likely have your own location detection; keep your existing logic.
   Below is a simple flow: detect saved location in localStorage or fallback to New York. */

function getSavedLocation() {
  try {
    const raw = localStorage.getItem('weather_widget_location');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

async function detectLocationFallback() {
  const saved = getSavedLocation();
  if (saved && typeof saved.lat === 'number' && typeof saved.lon === 'number') return saved;
  // fallback: New York coords (or you can call an IP geolocation)
  return { lat: 40.7128, lon: -74.0060, label: 'New York, USA' };
}

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: 'temperature_2m,precipitation_probability,relativehumidity_2m,windspeed_10m,weathercode',
    daily: 'weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset',
    current_weather: 'true',
    timezone: 'auto',
    temperature_unit: 'fahrenheit',
    windspeed_unit: 'mph'
  });
  const url = `${OPEN_METEO_BASE}?${params.toString()}`;
  return await fetchWithRetries(url, {}, 3, 300);
}

async function initWidget() {
  try {
    const loc = await detectLocationFallback();
    setTextIfChanged(EL.location, loc.label || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`);

    const data = await fetchWeather(loc.lat, loc.lon).catch(e => {
      console.error('fetchWeather error', e);
      return null;
    });
    if (data) await renderUIFromAPI(data, loc.label);

    // refresh once per hour (you can adjust); uses same loc
    setInterval(async () => {
      const d = await fetchWeather(loc.lat, loc.lon).catch(e => { console.error(e); return null; });
      if (d) renderUIFromAPI(d, loc.label);
    }, 60 * 60 * 1000);
  } catch (err) {
    console.error('initWidget error', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initWidget().catch(e => console.error(e)));
} else {
  initWidget().catch(e => console.error(e));
}
