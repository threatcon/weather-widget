// script.js — Drop-in replacement (full file).
// - Throttles/minimizes DOM writes to avoid flicker
// - Uses Open-Meteo timezone (data.timezone) or utc_offset_seconds to align daily.time
// - Includes console.debug logs to help diagnose date alignment
//
// Expected HTML IDs:
// dateTime, temperature, weatherIcon, location, precipitationChance, humidity, windSpeed,
// sunriseTime, sunsetTime, dayLength, forecastContainer
//
// Replace your current script.js with this file.

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

  /* ---------- Date/time throttled updater (minute-level) ---------- */
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

  /* ---------- Fetch with simple retries ---------- */
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

  /* ---------- Weather icon mapping ---------- */
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

  /* ---------- Timezone-aware helpers ---------- */
  function yyyyMmDdInZone(date, timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
      const y = parts.find(p => p.type === 'year').value;
      const m = parts.find(p => p.type === 'month').value;
      const d = parts.find(p => p.type === 'day').value;
      return `${y}-${m}-${d}`;
    } catch (e) {
      return null;
    }
  }
  function yyyyMmDdWithOffset(now, utc_offset_seconds) {
    try {
      const shifted = new Date(now.getTime() + (utc_offset_seconds || 0) * 1000);
      const y = shifted.getUTCFullYear();
      const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
      const d = String(shifted.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    } catch (e) {
      return null;
    }
  }

  /* ---------- Forecast builder (timezone aware, robust) ---------- */
  function buildForecastCards(container, dailyData, apiTz, utcOffsetSeconds) {
    if (!container || !dailyData || !Array.isArray(dailyData.time)) return;

    // Debug output for inspection
    console.debug('DEBUG daily.time sample:', dailyData.time.slice(0, 8));
    console.debug('DEBUG api timezone:', apiTz, 'utc_offset_seconds:', utcOffsetSeconds);

    const times = dailyData.time;
    const now = new Date();

    // Compute today string in API timezone or via utc offset; fallback to browser local
    let todayStr = null;
    if (apiTz) todayStr = yyyyMmDdInZone(now, apiTz);
    if (!todayStr && (typeof utcOffsetSeconds === 'number')) todayStr = yyyyMmDdWithOffset(now, utcOffsetSeconds);
    if (!todayStr) {
      const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
      todayStr = `${y}-${m}-${d}`;
    }

    // Determine start index matching todayStr
    let startIdx = times.findIndex(t => t === todayStr);

    // Heuristics for common shifts
    if (startIdx === -1 && times.length >= 2) {
      // If first is yesterday and second is today, shift by 1
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      let yStr = null;
      if (apiTz) yStr = yyyyMmDdInZone(yesterday, apiTz);
      else if (typeof utcOffsetSeconds === 'number') yStr = yyyyMmDdWithOffset(yesterday, utcOffsetSeconds);
      else {
        const yy = yesterday.getFullYear(), mm = String(yesterday.getMonth() + 1).padStart(2, '0'), dd = String(yesterday.getDate()).padStart(2, '0');
        yStr = `${yy}-${mm}-${dd}`;
      }
      if (times[0] === yStr && times[1] === todayStr) startIdx = 1;
    }

    // Another attempt: convert each times[i] into the API timezone local date and compare
    if (startIdx === -1) {
      for (let i = 0; i < times.length; i++) {
        const candidateIso = `${times[i]}T00:00:00`;
        try {
          let candidateStr = null;
          if (apiTz) candidateStr = yyyyMmDdInZone(new Date(candidateIso), apiTz);
          else if (typeof utcOffsetSeconds === 'number') {
            // compute candidate date with offset relative to UTC midnight
            const dt = new Date(candidateIso);
            candidateStr = yyyyMmDdWithOffset(dt, utcOffsetSeconds);
          } else {
            const dt = new Date(candidateIso);
            const yy = dt.getFullYear(), mm = String(dt.getMonth() + 1).padStart(2,'0'), dd = String(dt.getDate()).padStart(2,'0');
            candidateStr = `${yy}-${mm}-${dd}`;
          }
          if (candidateStr === todayStr) { startIdx = i; break; }
        } catch (e) { /* ignore */ }
      }
    }

    // Final fallback
    if (startIdx === -1) startIdx = 0;

    console.debug('DEBUG computed todayStr:', todayStr, '=> startIdx:', startIdx);

    const needRebuild = !container._built || container._startIdx !== startIdx || container._len !== times.length;
    if (!needRebuild) return;

    container._built = true;
    container._startIdx = startIdx;
    container._len = times.length;

    // Clear container
    while (container.firstChild) container.removeChild(container.firstChild);

    const maxCards = 4;
    for (let i = 0; i < maxCards; i++) {
      const idx = startIdx + i;
      if (!times[idx]) break;
      const dayIso = times[idx]; // YYYY-MM-DD
      const dObj = new Date(`${dayIso}T00:00:00`);
      const isToday = (idx === startIdx);
      const label = isToday
        ? 'Today'
        : (apiTz ? new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: apiTz }).format(dObj)
                 : new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(dObj));

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

  /* ---------- Render UI from API response ---------- */
  function renderUI(data, locationLabel) {
    if (!data) return;
    try {
      const current = data.current_weather ?? null;

      // find nearest hourly index
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

      // Build forecast cards (timezone-aware)
      if (EL.forecastContainer && data.daily) {
        // pass both timezone and utc offset if present
        const utcOffset = (typeof data.utc_offset_seconds === 'number') ? data.utc_offset_seconds
                        : (typeof data.utc_offset_seconds === 'string' && data.utc_offset_seconds ? Number(data.utc_offset_seconds) : null);
        buildForecastCards(EL.forecastContainer, data.daily, data.timezone, utcOffset);
      }
    } catch (err) {
      console.error('renderUI error', err);
    }
  }

  function formatTimeISOToLocal(iso, tz) {
    try {
      if (tz) return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return iso;
    }
  }

  /* ---------- Simple location detection + fetch ---------- */
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
    // fallback to New York
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

  /* ---------- Init ---------- */
  async function initWidget() {
    try {
      const loc = await detectLocationFallback();
      setTextIfChanged(EL.location, loc.label || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`);

      const data = await fetchWeather(loc.lat, loc.lon).catch(e => { console.error('fetchWeather error', e); return null; });
      if (data) renderUI(data, loc.label);

      // refresh once per hour
      setInterval(async () => {
        const d = await fetchWeather(loc.lat, loc.lon).catch(e => { console.error(e); return null; });
        if (d) renderUI(d, loc.label);
      }, 60 * 60 * 1000);
    } catch (e) {
      console.error('initWidget error', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initWidget().catch(e => console.error(e)));
  } else {
    initWidget().catch(e => console.error(e));
  }

  // expose helpers for debugging in console
  window.__weatherWidgetDebug = { buildForecastCards, renderUI };
})();
