// script.js — Full widget script (drop-in). Includes a debug console.log for daily.time and timezone,
// throttled/minimized DOM writes to avoid flicker, and timezone-aware 4-day forecast alignment.
//
// Replace your current script.js with this file. The file expects your existing HTML IDs:
// dateTime, temperature, weatherIcon, location, precipitationChance, humidity, windSpeed,
// sunriseTime, sunsetTime, dayLength, forecastContainer.
//
// NOTE: keep your index.html and styles.css as-is. If you previously initialized clouds separately,
// re-add that call after initialization if needed.

(function () {
  /* ---------- Small DOM helpers ---------- */
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

  /* ---------- Element refs ---------- */
  const EL = {
    dateTime: document.getElementById('dateTime'),
    temperature: document.getElementById('temperature'),
    weatherIcon: document.getElementById('weatherIcon'),
    location: document.getElementById('location'),
    precipitationChance: document.getElementById('precipitationChance'),
    humidity: document.getElementById('humidity'),
    windSpeed: document.getElementById('windSpeed'),
    sunriseTime: document.getElementById('sunriseTime'),
    sunsetTime: document.getElementById('sunsetTime'),
    dayLength: document.getElementById('dayLength'),
    forecastContainer: document.getElementById('forecastContainer')
  };

  /* ---------- Date/time throttled updater (writes only on minute change) ---------- */
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

  /* ---------- Simple fetch with retries ---------- */
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

  /* ---------- Weather helpers ---------- */
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

  function formatTimeISOToLocal(iso, tz) {
    try {
      // Use Intl if timezone provided; fallback to Date parse
      if (tz) return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return iso;
    }
  }

  /* ---------- Timezone-aware YYYY-MM-DD generator ---------- */
  function yyyyMmDdInZone(date, timeZone) {
    // Use 'en-CA' ensures YYYY-MM-DD format via parts
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = fmt.formatToParts(date);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    return `${y}-${m}-${d}`;
  }

  /* ---------- Forecast builder: timezone-aware and robust ---------- */
  function buildForecastCards(container, dailyData, apiTz) {
    if (!container || !dailyData || !Array.isArray(dailyData.time)) return;

    // Debug: output daily.time and timezone for inspection
    console.log('DEBUG daily.time sample:', dailyData.time.slice(0, 8), 'timezone:', apiTz);

    const times = dailyData.time;
    // compute today's YYYY-MM-DD in API timezone
    let tz = apiTz;
    if (!tz) {
      // fallback to browser timezone
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    const todayStr = yyyyMmDdInZone(new Date(), tz);

    // find start index where daily.time equals todayStr (in API tz)
    let startIdx = times.findIndex(t => t === todayStr);

    // fallback: if not found, check shifted sequences (common case where API returns yesterday first)
    if (startIdx === -1 && times.length >= 2) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yyyyMmDdInZone(yesterday, tz);
      if (times[0] === yStr && times[1] === todayStr) startIdx = 1;
    }

    // last resort: try matching substring with possible timezone shift or choose 0
    if (startIdx === -1) {
      // attempt to match by converting times[i] to date in api tz and compare
      for (let i = 0; i < times.length; i++) {
        const dIso = `${times[i]}T00:00:00`;
        try {
          const label = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(dIso));
          if (label === todayStr) { startIdx = i; break; }
        } catch (e) { /* ignore */ }
      }
    }
    if (startIdx === -1) startIdx = 0;

    const needRebuild = !container._built || container._startIdx !== startIdx || container._len !== times.length;
    if (!needRebuild) return;

    container._built = true;
    container._startIdx = startIdx;
    container._len = times.length;

    // clear existing nodes
    while (container.firstChild) container.removeChild(container.firstChild);

    // build up to 4 cards starting at startIdx
    const maxCards = 4;
    for (let i = 0; i < maxCards; i++) {
      const idx = startIdx + i;
      if (!times[idx]) break;
      const dayIso = times[idx]; // YYYY-MM-DD
      const dObj = new Date(`${dayIso}T00:00:00`);
      const isToday = (idx === startIdx);
      const label = isToday ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: tz }).format(dObj);
      const hi = (dailyData.temperature_2m_max && dailyData.temperature_2m_max[idx] != null) ? Math.round(dailyData.temperature_2m_max[idx]) : '—';
      const lo = (dailyData.temperature_2m_min && dailyData.temperature_2m_min[idx] != null) ? Math.round(dailyData.temperature_2m_min[idx]) : '—';
      const code = (dailyData.weathercode && dailyData.weathercode[idx] != null) ? dailyData.weathercode[idx] : null;

      const card = document.createElement('div');
      card.className = 'forecast-day';
      card.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:10px;padding:10px;width:84px;text-align:center;margin-right:8px;';
      card.innerHTML = `
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;opacity:.9">${label}</div>
        <div style="font-size:20px;margin:6px 0">${weatherCodeToIcon(code, true)}</div>
        <div style="font-size:13px;font-weight:600;background:linear-gradient(90deg,#fff,#cbd5e1);-webkit-background-clip:text;background-clip:text;color:transparent">${hi}°</div>
        <div style="font-size:12px;opacity:.75">${lo}°</div>
      `;
      card.addEventListener('click', () => {
        batchWrite(() => {
          setTextIfChanged(EL.temperature, `${hi}°F`);
          setTextIfChanged(EL.weatherIcon, weatherCodeToIcon(code, true));
        });
      });
      container.appendChild(card);
    }
  }

  /* ---------- Render function (data = API response) ---------- */
  async function renderUI(data, locationLabel) {
    try {
      if (!data) return;
      const current = data.current_weather ?? null;

      // determine index in hourly arrays nearest to now
      let hourlyIdx = 0;
      if (Array.isArray(data.hourly?.time) && data.hourly.time.length) {
        const now = new Date();
        const times = data.hourly.time.map(t => new Date(t));
        let idx = times.findIndex(t => t >= now);
        if (idx === -1) idx = times.length - 1;
        hourlyIdx = Math.max(0, idx);
      }

      const tempDisplay = (current && typeof current.temperature !== 'undefined')
        ? `${Math.round(current.temperature)}°F`
        : (data.hourly?.temperature_2m?.[hourlyIdx] != null ? `${Math.round(data.hourly.temperature_2m[hourlyIdx])}°F` : '—');

      const code = (current && typeof current.weathercode !== 'undefined')
        ? current.weathercode
        : (data.hourly?.weathercode?.[hourlyIdx] != null ? data.hourly.weathercode[hourlyIdx] : 0);
      const isDay = current ? (current.is_day === 1) : true;

      batchWrite(() => {
        setTextIfChanged(EL.temperature, tempDisplay);
        setTextIfChanged(EL.weatherIcon, weatherCodeToIcon(code, isDay));
        setTextIfChanged(EL.location, locationLabel || 'Unknown');

        const precipVal = data.hourly?.precipitation_probability?.[hourlyIdx];
        setTextIfChanged(EL.precipitationChance, precipVal != null ? `Precip ${Math.round(precipVal)}%` : 'Precip —');

        const humVal = data.hourly?.relativehumidity_2m?.[hourlyIdx];
        setTextIfChanged(EL.humidity, humVal != null ? `Humidity: ${Math.round(humVal)}%` : 'Humidity: —');

        const windVal = current?.windspeed != null ? `${Math.round(current.windspeed)} mph` :
          (data.hourly?.windspeed_10m?.[hourlyIdx] != null ? `${Math.round(data.hourly.windspeed_10m[hourlyIdx])} mph` : '—');
        setTextIfChanged(EL.windSpeed, `Wind: ${windVal}`);

        if (data.daily?.sunrise && data.daily?.sunset) {
          setTextIfChanged(EL.sunriseTime, formatTimeISOToLocal(data.daily.sunrise[0], data.timezone));
          setTextIfChanged(EL.sunsetTime, formatTimeISOToLocal(data.daily.sunset[0], data.timezone));
          const durSec = Math.max(0, Math.round((new Date(data.daily.sunset[0]) - new Date(data.daily.sunrise[0])) / 1000));
          const h = Math.floor(durSec / 3600), m = Math.floor((durSec % 3600) / 60);
          setTextIfChanged(EL.dayLength, `${h} h ${m} m`);
        }
      });

      // Build forecast using timezone-aware logic; includes console.log for debugging
      if (EL.forecastContainer && data.daily) {
        buildForecastCards(EL.forecastContainer, data.daily, data.timezone);
      }
    } catch (err) {
      console.error('renderUI error', err);
    }
  }

  /* ---------- Location detection / weather fetch (simplified) ---------- */
  function getSavedLocation() {
    try {
      const raw = localStorage.getItem('weather_widget_location');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  async function detectLocationFallback() {
    const saved = getSavedLocation();
    if (saved && typeof saved.lat === 'number' && typeof saved.lon === 'number') return saved;
    // fallback coords (NYC)
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
    return await fetchWithRetries(url, {}, 3, 400);
  }

  /* ---------- Initialization ---------- */
  async function initWidget() {
    try {
      const loc = await detectLocationFallback();
      setTextIfChanged(EL.location, loc.label || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`);

      const data = await fetchWeather(loc.lat, loc.lon).catch(e => {
        console.error('fetchWeather failed', e);
        return null;
      });
      if (data) await renderUI(data, loc.label);

      // periodic refresh once per hour
      setInterval(async () => {
        const d = await fetchWeather(loc.lat, loc.lon).catch(e => { console.error(e); return null; });
        if (d) renderUI(d, loc.label);
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

  // expose for debugging
  window.__weatherWidget = { renderUI, buildForecastCards };
})();
