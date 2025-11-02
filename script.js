/* script.js — Updated weatherLogic IIFE
   - Keeps your original IP -> Open‑Meteo flow and UI structure
   - Fixes the 4-day forecast alignment by computing "today" in the API timezone
   - Adds a debug console.log showing daily.time, API timezone, computed todayStr, and chosen startIdx
   - Minimal changes: only the forecast-building part and small helper additions
*/

(function weatherLogic() {
  const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
  const IP_PROVIDERS = [
    { url: 'https://ipapi.co/json/', mapper: j => j && j.latitude && j.longitude ? { lat: Number(j.latitude), lon: Number(j.longitude), label: [j.city, j.region, j.country_name].filter(Boolean).join(', ') } : null },
    { url: 'https://ipwho.is/', mapper: j => j && j.success !== false && j.latitude && j.longitude ? { lat: Number(j.latitude), lon: Number(j.longitude), label: [j.city, j.region, j.country].filter(Boolean).join(', ') } : null }
  ];

  /* ---------- Minimal safe helpers (use your existing ones if present) ---------- */
  function safeSetText(el, v) {
    if (!el) return;
    const s = v == null ? '' : String(v);
    if (el.textContent === s) return;
    el.textContent = s;
  }
  // prefer any existing setText in your codebase
  const setTextFn = (typeof setText === 'function') ? setText : safeSetText;

  /* ---------- timezone helpers ---------- */
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

  /* ---------- Fetch retry helper (reuse if present) ---------- */
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

  /* ---------- Existing UI element refs expected by your code ---------- */
  const EL = {
    temperature: document.getElementById('temperature'),
    weatherIcon: document.getElementById('weatherIcon'),
    location: document.getElementById('location'),
    windSpeed: document.getElementById('windSpeed'),
    precipitationChance: document.getElementById('precipitationChance'),
    humidity: document.getElementById('humidity'),
    sunriseTime: document.getElementById('sunriseTime'),
    sunsetTime: document.getElementById('sunsetTime'),
    dayLength: document.getElementById('dayLength'),
    forecastContainer: document.getElementById('forecastContainer')
  };

  /* ---------- weatherCodeToIcon (reuse your mapping if present) ---------- */
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

  /* ---------- IP location resolution ---------- */
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
    console.warn('All IP providers failed; falling back to default coords');
    return null;
  }

  /* ---------- Open-Meteo fetch ---------- */
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

  /* ---------- renderUI with timezone-aware forecast alignment ---------- */
  async function renderUI(data, locationLabel) {
    try {
      const current = data.current_weather ?? null;

      // nearest hourly index
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

      // temperature & icon
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
      setTextFn(EL.temperature, tempDisplay);
      setTextFn(EL.weatherIcon, weatherCodeToIcon(code, isDay));
      setTextFn(EL.location, locationLabel || 'Unknown location');

      const wind = current?.windspeed != null ? `${Math.round(current.windspeed)} mph` : '—';
      setTextFn(EL.windSpeed, `Wind: ${wind}`);

      if (data.hourly && data.hourly.time) {
        const idx = nearestHourlyIndex;
        const precip = data.hourly.precipitation_probability?.[idx];
        setTextFn(EL.precipitationChance, precip != null ? `Precip ${Math.round(precip)}%` : 'Precip —');
        const hum = data.hourly.relativehumidity_2m?.[idx];
        setTextFn(EL.humidity, hum != null ? `Humidity: ${Math.round(hum)}%` : 'Humidity: —');
      } else {
        setTextFn(EL.precipitationChance, 'Precip —');
        setTextFn(EL.humidity, 'Humidity: —');
      }

      if (data.daily?.sunrise && data.daily?.sunset) {
        const sunrise = data.daily.sunrise[0];
        const sunset = data.daily.sunset[0];
        setTextFn(EL.sunriseTime, formatTimeISOToLocal(sunrise, data.timezone));
        setTextFn(EL.sunsetTime, formatTimeISOToLocal(sunset, data.timezone));
        setTextFn(EL.dayLength, formatDurationSeconds(Math.max(0, Math.round((new Date(sunset) - new Date(sunrise))/1000))));
      }

      // ---------------- timezone-aware forecast building ----------------
      const fc = EL.forecastContainer;
      if (!fc) return;

      // debug: show API daily times & timezone
      console.log('DEBUG daily.time:', data.daily?.time?.slice(0, 8), 'api timezone:', data.timezone, 'utc_offset_seconds:', data.utc_offset_seconds);

      // compute today in API timezone (preferred) or via utc_offset_seconds fallback
      const now = new Date();
      const apiTz = data.timezone || null;
      const utcOffset = (typeof data.utc_offset_seconds === 'number') ? data.utc_offset_seconds
                      : (typeof data.utc_offset_seconds === 'string' && data.utc_offset_seconds ? Number(data.utc_offset_seconds) : null);

      let todayStr = null;
      if (apiTz) todayStr = yyyyMmDdInZone(now, apiTz);
      if (!todayStr && utcOffset != null) todayStr = yyyyMmDdWithOffset(now, utcOffset);
      if (!todayStr) {
        const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
        todayStr = `${y}-${m}-${d}`;
      }

      const times = data.daily?.time || [];
      // find start index matching todayStr
      let startIdx = times.findIndex(t => t === todayStr);

      // heuristic: if not found but times[0] is yesterday and times[1] is today, shift
      if (startIdx === -1 && times.length >= 2) {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        let yStr = null;
        if (apiTz) yStr = yyyyMmDdInZone(yesterday, apiTz);
        else if (utcOffset != null) yStr = yyyyMmDdWithOffset(yesterday, utcOffset);
        else {
          const yy = yesterday.getFullYear(), mm = String(yesterday.getMonth() + 1).padStart(2,'0'), dd = String(yesterday.getDate()).padStart(2,'0');
          yStr = `${yy}-${mm}-${dd}`;
        }
        if (times[0] === yStr && times[1] === todayStr) startIdx = 1;
      }

      // another attempt: convert each candidate to api tz and compare
      if (startIdx === -1) {
        for (let i = 0; i < times.length; i++) {
          const candidateIso = `${times[i]}T00:00:00`;
          try {
            let candidateStr = null;
            if (apiTz) candidateStr = yyyyMmDdInZone(new Date(candidateIso), apiTz);
            else if (utcOffset != null) candidateStr = yyyyMmDdWithOffset(new Date(candidateIso), utcOffset);
            else {
              const dt = new Date(candidateIso);
              const yy = dt.getFullYear(), mm = String(dt.getMonth()+1).padStart(2,'0'), dd = String(dt.getDate()).padStart(2,'0');
              candidateStr = `${yy}-${mm}-${dd}`;
            }
            if (candidateStr === todayStr) { startIdx = i; break; }
          } catch (e) { /* ignore and continue */ }
        }
      }

      if (startIdx === -1) startIdx = 0;
      console.log('DEBUG computed todayStr:', todayStr, '=> startIdx:', startIdx);

      // rebuild only when needed
      const needRebuild = !fc._built || fc._startIdx !== startIdx || fc._len !== times.length;
      if (!needRebuild) return;

      fc._built = true;
      fc._startIdx = startIdx;
      fc._len = times.length;

      // clear previous
      while (fc.firstChild) fc.removeChild(fc.firstChild);

      // build 4 forecast cards starting at startIdx
      const maxCards = 4;
      for (let i = 0; i < maxCards; i++) {
        const idx = startIdx + i;
        if (!times[idx]) break;
        const dIso = times[idx]; // 'YYYY-MM-DD'
        const dObj = new Date(`${dIso}T00:00:00`);
        const label = (i === 0) ? 'Today' : (apiTz ? new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: apiTz }).format(dObj) : dObj.toLocaleDateString(undefined, { weekday: 'short' }));
        const hi = data.daily?.temperature_2m_max?.[idx] != null ? Math.round(data.daily.temperature_2m_max[idx]) : '—';
        const lo = data.daily?.temperature_2m_min?.[idx] != null ? Math.round(data.daily.temperature_2m_min[idx]) : '—';
        const codeDay = data.daily?.weathercode?.[idx] != null ? data.daily.weathercode[idx] : null;

        const card = document.createElement('div');
        card.className = 'forecast-day bg-white/5 backdrop-blur-sm rounded-xl p-3 w-20 text-center border border-white/10 shadow-sm hover:bg-white/10 transition-all duration-200 cursor-pointer transform hover:-translate-y-1 animate-fadeInUp';
        card.innerHTML = `<div class="day-name text-xs font-medium mb-1 opacity-80">${label}</div>
                          <div class="forecast-icon text-2xl my-1 drop-shadow-md">${weatherCodeToIcon(codeDay,true)}</div>
                          <div class="high-temp text-sm font-semibold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-300">${hi}°</div>
                          <div class="low-temp text-xs opacity-70">${lo}°</div>`;
        card.addEventListener('click', () => {
          setTextFn(EL.temperature, `${hi}°F`);
          setTextFn(EL.weatherIcon, weatherCodeToIcon(codeDay, true));
          card.classList.add('scale-105');
          setTimeout(() => card.classList.remove('scale-105'), 220);
        });
        fc.appendChild(card);
      }
    } catch (err) {
      console.error('renderUI error', err);
    }
  }

  /* ---------- helpers used earlier in your code (if missing) ---------- */
  function formatTimeISOToLocal(iso, tz) {
    try {
      if (tz) return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return iso;
    }
  }
  function formatDurationSeconds(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h} h ${m} m`;
  }

  /* ---------- init / loop ---------- */
  async function initWeather() {
    try {
      setTextFn(EL.location, 'Loading...');
      const ip = await getIpLocation();
      const defaultCoords = { lat: 40.7128, lon: -74.0060, label: 'New York, USA' };
      const used = ip || defaultCoords;
      const data = await fetchWeatherFor(used.lat, used.lon).catch(e => { console.error('fetchWeatherFor failed', e); return null; });
      if (!data) { setTextFn(EL.location, 'Weather unavailable'); return; }
      await renderUI(data, used.label);
    } catch (err) {
      console.error('initWeather outer error', err);
      setTextFn(EL.location, 'Weather unavailable');
    }
  }

  // initial + periodic
  initWeather().catch(e => console.error(e));
  setInterval(() => { initWeather().catch(e => console.error('periodic weather error', e)); }, 60 * 60 * 1000);

  // keep local getIpLocation (exists above)
})();
