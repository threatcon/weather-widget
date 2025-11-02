// script.js — Full drop-in widget script with robust location detection.
// - Preference order: localStorage saved location -> navigator.geolocation -> multiple IP providers
// - Timezone-aware forecast alignment and throttled DOM writes to avoid flicker
// - Replace your existing script.js with this file (keeps same HTML ID expectations)
//
// Expected HTML IDs: dateTime, temperature, weatherIcon, location, precipitationChance, humidity,
// windSpeed, sunriseTime, sunsetTime, dayLength, forecastContainer

(() => {
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

  /* ---------- Fetch helper with retries ---------- */
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

  /* ---------- Timezone helpers ---------- */
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

  function formatTimeISOToLocal(iso, tz) {
    try {
      if (tz) return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return iso;
    }
  }

  /* ---------- Forecast builder (timezone aware, robust) ---------- */
  function buildForecastCards(container, dailyData, apiTz, utcOffsetSeconds) {
    if (!container || !dailyData || !Array.isArray(dailyData.time)) return;

    console.debug('daily.time sample:', dailyData.time.slice(0, 8), 'apiTz:', apiTz, 'utc_offset_seconds:', utcOffsetSeconds);

    const times = dailyData.time;
    const now = new Date();

    // Compute today in API timezone (or fallback)
    let todayStr = null;
    if (apiTz) todayStr = yyyyMmDdInZone(now, apiTz);
    if (!todayStr && typeof utcOffsetSeconds === 'number') todayStr = yyyyMmDdWithOffset(now, utcOffsetSeconds);
    if (!todayStr) {
      const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
      todayStr = `${y}-${m}-${d}`;
    }

    // find index where daily.time equals todayStr
    let startIdx = times.findIndex(t => t === todayStr);

    // heuristic: if array starts with yesterday and second is today, shift by 1
    if (startIdx === -1 && times.length >= 2) {
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

    // try candidate conversion match
    if (startIdx === -1) {
      for (let i = 0; i < times.length; i++) {
        const candidateIso = `${times[i]}T00:00:00`;
        try {
          let candidateStr = null;
          if (apiTz) candidateStr = yyyyMmDdInZone(new Date(candidateIso), apiTz);
          else if (typeof utcOffsetSeconds === 'number') candidateStr = yyyyMmDdWithOffset(new Date(candidateIso), utcOffsetSeconds);
          else {
            const dt = new Date(candidateIso);
            const yy = dt.getFullYear(), mm = String(dt.getMonth() + 1).padStart(2,'0'), dd = String(dt.getDate()).padStart(2,'0');
            candidateStr = `${yy}-${mm}-${dd}`;
          }
          if (candidateStr === todayStr) { startIdx = i; break; }
        } catch (e) { /* ignore */ }
      }
    }

    if (startIdx === -1) startIdx = 0;

    console.debug('computed todayStr:', todayStr, '=> startIdx:', startIdx);

    const needRebuild = !container._built || container._startIdx !== startIdx || container._len !== times.length;
    if (!needRebuild) return;

    container._built = true;
    container._startIdx = startIdx;
    container._len = times.length;

    while (container.firstChild) container.removeChild(container.firstChild);

    const maxCards = 4;
    for (let i = 0; i < maxCards; i++) {
      const idx = startIdx + i;
      if (!times[idx]) break;
      const dayIso = times[idx];
      const dObj = new Date(`${dayIso}T00:00:00`);
      const isToday = (idx === startIdx);
      const label = isToday
        ? 'Today'
        : (apiTz ? new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: apiTz }).format(dObj) : new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(dObj));

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

  /* ---------- Location detection (robust) ---------- */
  async function detectLocation() {
    // 1) saved in localStorage
    try {
      const raw = localStorage.getItem('weather_widget_location');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj.lat === 'number' && typeof obj.lon === 'number') {
          return { lat: obj.lat, lon: obj.lon, label: obj.label || `${obj.lat}, ${obj.lon}`, timezone: obj.timezone || null };
        }
      }
    } catch (e) { /* ignore */ }

    // 2) navigator.geolocation (permission-based)
    const tryNavigator = () => new Promise(resolve => {
      if (!('geolocation' in navigator)) return resolve(null);
      let done = false;
      const onSuccess = pos => { if (done) return; done = true; resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: null, timezone: null }); };
      const onError = () => { if (done) return; done = true; resolve(null); };
      navigator.geolocation.getCurrentPosition(onSuccess, onError, { timeout: 7000, maximumAge: 60000 });
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 9000);
    });

    try {
      const nav = await tryNavigator();
      if (nav) return nav;
    } catch (e) { /* ignore */ }

    // 3) IP providers (try a list)
    const providers = [
      {
        url: 'https://ipapi.co/json/',
        mapper: j => (j && (j.latitude || j.lat) && (j.longitude || j.lon)) ? { lat: Number(j.latitude || j.lat), lon: Number(j.longitude || j.lon), label: [j.city, j.region, j.country_name].filter(Boolean).join(', '), timezone: j.timezone || null } : null
      },
      {
        url: 'https://ipwho.is/',
        mapper: j => (j && j.success !== false && j.latitude && j.longitude) ? { lat: Number(j.latitude), lon: Number(j.longitude), label: [j.city, j.region, j.country].filter(Boolean).join(', '), timezone: j.timezone || null } : null
      },
      {
        url: 'https://ipinfo.io/json',
        mapper: j => (j && j.loc) ? (() => { const [lat, lon] = String(j.loc).split(',').map(Number); return { lat, lon, label: [j.city, j.region, j.country].filter(Boolean).join(', '), timezone: j.timezone || null }; })() : null
      },
      {
        url: 'https://geoip.vuiz.net/geoip',
        mapper: j => (j && j.lat && j.lon) ? { lat: Number(j.lat), lon: Number(j.lon), label: [j.city, j.region, j.country].filter(Boolean).join(', '), timezone: j.timezone || null } : null
      }
    ];

    for (const p of providers) {
      try {
        const json = await fetchWithRetries(p.url, { headers: { 'Accept': 'application/json' } }, 2, 300).catch(() => null);
        if (!json) continue;
        const mapped = p.mapper(json);
        if (mapped) {
          console.debug('detectLocation provider success:', p.url, mapped);
          return mapped;
        }
      } catch (e) {
        // ignore provider error
      }
    }

    // 4) fallback hard-coded
    return { lat: 40.7128, lon: -74.0060, label: 'New York, USA', timezone: null };
  }

  /* ---------- Weather fetch & render ---------- */
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

  function renderUI(data, locationLabel) {
    if (!data) return;
    try {
      const current = data.current_weather ?? null;

      // hourly index nearest to now
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

      // build forecast cards (timezone-aware)
      if (EL.forecastContainer && data.daily) {
        const utcOffset = (typeof data.utc_offset_seconds === 'number') ? data.utc_offset_seconds
                        : (typeof data.utc_offset_seconds === 'string' && data.utc_offset_seconds ? Number(data.utc_offset_seconds) : null);
        buildForecastCards(EL.forecastContainer, data.daily, data.timezone, utcOffset);
      }
    } catch (err) {
      console.error('renderUI error', err);
    }
  }

  /* ---------- Initialization flow ---------- */
  async function initWidget() {
    try {
      const loc = await detectLocation();
      setTextIfChanged(EL.location, loc.label || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`);

      const data = await fetchWeather(loc.lat, loc.lon).catch(e => { console.error('fetchWeather error', e); return null; });
      if (data) renderUI(data, loc.label);

      // re-run when user sets a saved location or config events in your app may fire
      window.addEventListener('weather:config-saved', async (e) => {
        const d = e.detail;
        if (!d) return;
        const used = { lat: d.lat, lon: d.lon, label: d.label || `${d.lat}, ${d.lon}` };
        setTextIfChanged(EL.location, used.label);
        const fresh = await fetchWeather(used.lat, used.lon).catch(() => null);
        if (fresh) renderUI(fresh, used.label);
      });

      // periodic refresh (hourly)
      setInterval(async () => {
        try {
          const d = await fetchWeather(loc.lat, loc.lon);
          if (d) renderUI(d, loc.label);
        } catch (e) { console.error('periodic refresh error', e); }
      }, 60 * 60 * 1000);
    } catch (err) {
      console.error('initWidget error', err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initWidget);
  else initWidget();

  // expose internals for debugging
  window.__weatherWidget = { detectLocation, buildForecastCards, renderUI };
})();
