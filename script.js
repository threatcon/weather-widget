// Robust optimized script.js — Type = module
// Changes applied: DPR cap, antialias disabled, controlled RAF (IntersectionObserver pause/resume),
// debounced resize, reduced geometry detail, shared geometries/materials, reduced raindrops,
// pre-created overlay surprise toggle (no DOM create/remove in RAF), limited raycast targets,
// safe weather fetch with retries and hourly refresh.
// Only change from your repo: enhanced timezone-aware 4-day forecast selection (inside renderUI).
import * as THREE from "https://esm.sh/three@0.158.0";
import { OrbitControls } from "https://esm.sh/three@0.158.0/examples/jsm/controls/OrbitControls.js";

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
const EL = Object.fromEntries(Object.entries(SELECTORS).map(([k, v]) => [k, document.getElementById(v)]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithRetries(url, opts = {}, tries = 3, backoff = 400) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`fetch attempt ${i + 1} failed for ${url}`, err);
      if (i < tries - 1) await sleep(backoff * (i + 1));
      else throw err;
    }
  }
}

/* ---------- small utilities ---------- */
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
function formatTimeISOToLocal(isoStr) {
  try { return new Date(isoStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  catch { return isoStr; }
}
function formatDurationSeconds(sec) { const h = Math.floor(sec/3600); const m = Math.floor((sec%3600)/60); return `${h} h ${m} m`; }

/* ---------- date/time ---------- */
function updateDateTime() {
  const now = new Date();
  const optionsDate = { weekday: 'long' };
  const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false };
  setText(EL.dateTime, `${now.toLocaleDateString(undefined, optionsDate)}, ${now.toLocaleTimeString([], optionsTime)}`);
}
updateDateTime();
setInterval(updateDateTime, 60_000);

/* ---------- 3D cloud scene (optimized) ---------- */
(function initCloudScene() {
  const container = EL.cloudContainer;
  if (!container) { console.error("cloud-container not found"); return; }

  // Pre-created surprise overlay inside container (must exist in HTML). If absent, we'll create a lightweight element outside RAF.
  let surprise = container.querySelector('#cloudSurprise');
  if (!surprise) {
    surprise = document.createElement('div');
    surprise.id = 'cloudSurprise';
    surprise.style.position = 'absolute';
    surprise.style.inset = '0';
    surprise.style.display = 'flex';
    surprise.style.alignItems = 'center';
    surprise.style.justifyContent = 'center';
    surprise.style.pointerEvents = 'none';
    surprise.style.zIndex = '60';
    surprise.style.opacity = '0';
    surprise.style.transition = 'opacity .45s ease';
    surprise.innerHTML = `<div style="font-size:36px;filter:drop-shadow(0 6px 10px rgba(0,0,0,0.6))">🎉</div>`;
    container.appendChild(surprise);
  }

  // Size helper
  function getRect() { const r = container.getBoundingClientRect(); return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }; }

  // Cap DPR and disable antialias
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const scene = new THREE.Scene();
  const rect = getRect();
  const camera = new THREE.PerspectiveCamera(60, rect.width / rect.height, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(rect.width, rect.height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.pointerEvents = 'auto';
  container.appendChild(renderer.domElement);

  camera.position.set(0, 0.5, 4.5);
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.6);
  directionalLight.position.set(2,3,2);
  scene.add(directionalLight);
  const pointLight = new THREE.PointLight(0xaabbee, 0.6, 15);
  pointLight.position.set(-1,1,3);
  scene.add(pointLight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.8;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI/3;
  controls.maxPolarAngle = Math.PI/1.8;
  controls.target.set(0,0,0);

  // Shared materials/geometries for performance
  const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f8ff, transparent: true, opacity: 0.85, roughness: 0.6, metalness: 0.0 });
  const baseSphereGeom = new THREE.SphereGeometry(1.0, 12, 12);

  function createCloudGroup(x, y, z, scale) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.set(scale, scale, scale);
    const parts = [
      { r: 0.8, p: new THREE.Vector3(0,0,0) },
      { r: 0.6, p: new THREE.Vector3(0.7,0.2,0.1) },
      { r: 0.55, p: new THREE.Vector3(-0.6,0.1,-0.2) },
      { r: 0.7, p: new THREE.Vector3(0.1,0.4,-0.3) },
      { r: 0.5, p: new THREE.Vector3(0.3,-0.3,0.2) },
      { r: 0.6, p: new THREE.Vector3(-0.4,-0.2,0.3) },
      { r: 0.45, p: new THREE.Vector3(0.8,-0.1,-0.2) },
      { r: 0.5, p: new THREE.Vector3(-0.7,0.3,0.3) }
    ];
    parts.forEach(p => {
      const m = new THREE.Mesh(baseSphereGeom, cloudMaterial);
      m.position.copy(p.p);
      m.scale.setScalar(p.r);
      m.raycast = () => {};
      g.add(m);
    });

    const bboxGeom = new THREE.BoxGeometry(3.0, 1.8, 2.4);
    const bboxMat = new THREE.MeshBasicMaterial({ visible: false });
    const bbox = new THREE.Mesh(bboxGeom, bboxMat);
    bbox.position.set(0, 0, 0);
    g.add(bbox);

    g.userData = { collider: bbox, isRaining: false, rainColor: Math.random() > 0.5 ? 0x87CEFA : 0xB0E0E6, originalPosition: g.position.clone(), bobOffset: Math.random() * Math.PI * 2, bobSpeed: 0.0005 + Math.random() * 0.0003, bobAmount: 0.12 + Math.random() * 0.08 };
    return g;
  }

  const cloudGroup = new THREE.Group();
  scene.add(cloudGroup);
  const cloud1 = createCloudGroup(-0.7, 0.2, 0, 1.0);
  const cloud2 = createCloudGroup(0.7, -0.1, 0.3, 0.9);
  cloudGroup.add(cloud1, cloud2);
  cloudGroup.position.y = -0.2;

  // Shared raindrop geometry/material, fewer drops
  const dropGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.18, 6);
  const dropMat1 = new THREE.MeshBasicMaterial({ color: 0x87CEFA, transparent: true, opacity: 0.72 });
  const dropMat2 = new THREE.MeshBasicMaterial({ color: 0xB0E0E6, transparent: true, opacity: 0.72 });

  function createRainForCloud(cloud, count = 12) {
    const rainGroup = new THREE.Group();
    cloud.add(rainGroup);
    const arr = [];
    const mat = cloud.userData.rainColor === 0x87CEFA ? dropMat1 : dropMat2;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(dropGeom, mat);
      m.position.set((Math.random() - 0.5) * 1.6, -0.8 - Math.random() * 1.2, (Math.random() - 0.5) * 1.6);
      m.userData = { speed: 0.06 + Math.random() * 0.05 };
      arr.push(m);
      rainGroup.add(m);
    }
    rainGroup.visible = false;
    return arr;
  }

  const raindrops1 = createRainForCloud(cloud1, 10);
  const raindrops2 = createRainForCloud(cloud2, 10);

  // Raycaster only against colliders
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onCanvasClick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const colliders = [cloud1.userData.collider, cloud2.userData.collider].filter(Boolean);
    const intersects = raycaster.intersectObjects(colliders, true);
    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const picked = hit.parent;
      if (!picked) return;
      const newState = !(cloud1.userData.isRaining && cloud2.userData.isRaining);
      cloud1.userData.isRaining = newState;
      cloud1.children.forEach(c => { if (c.type === 'Group') c.visible = newState; });
      cloud2.userData.isRaining = newState;
      cloud2.children.forEach(c => { if (c.type === 'Group') c.visible = newState; });

      const originalScale = picked.scale.clone();
      picked.scale.multiplyScalar(1.12);
      setTimeout(() => { picked.scale.copy(originalScale); }, 140);

      if (surprise) { surprise.style.opacity = '1'; setTimeout(() => { if (surprise) surprise.style.opacity = '0'; }, 900); }
    }
  }
  renderer.domElement.addEventListener('click', onCanvasClick);

  const tooltip = EL.cloudTooltip;
  setTimeout(() => { if (tooltip) tooltip.classList.add('opacity-100'); setTimeout(() => { if (tooltip) tooltip.classList.remove('opacity-100'); }, 3500); }, 1500);

  // Controlled RAF loop with IntersectionObserver to pause when offscreen
  let reqId = null; let running = false; let lastTime = performance.now();
  function animateFrame(time) {
    if (!running) { reqId = null; return; }
    const t = time || performance.now();
    const dt = Math.min(60, t - lastTime) / 1000;
    lastTime = t;

    //cloudGroup.rotation.y += 0.002;
    [cloud1, cloud2].forEach((cloud) => {
      if (!cloud) return;
      //cloud.position.y = cloud.userData.originalPosition.y + Math.sin(t * cloud.userData.bobSpeed + cloud.userData.bobOffset) * cloud.userData.bobAmount;
      if (cloud.userData.isRaining) {
        const cur = (cloud === cloud1) ? raindrops1 : raindrops2;
        cur.forEach(r => {
          r.position.y -= r.userData.speed * dt * 60;
          if (r.position.y < -2.8) {
            r.position.y = -0.8;
            r.position.x = (Math.random() - 0.5) * 1.6 * cloud.scale.x;
            r.position.z = (Math.random() - 0.5) * 1.6 * cloud.scale.z;
          }
        });
      }
    });

    controls.update();
    renderer.render(scene, camera);
    reqId = requestAnimationFrame(animateFrame);
  }
  //function startLoop() { if (reqId) return; running = true; lastTime = performance.now(); reqId = requestAnimationFrame(animateFrame); }
  //function stopLoop() { running = false; if (reqId) { cancelAnimationFrame(reqId); reqId = null; } }

 // const io = new IntersectionObserver((entries) => {
 //   const e = entries[0];
 //   if (!e || !e.isIntersecting) stopLoop();
 //   else startLoop();
 // }, { threshold: 0.05 });
//  io.observe(container);

  // Debounced resize handler
  let resizeTimer = null;
  function onResizeDebounced() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const r = getRect();
      const w = r.width, h = r.height;
      const cur = renderer.getSize(new THREE.Vector2());
      if (cur.x !== w || cur.y !== h) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
        renderer.setSize(w, h, false);
      }
    }, 120);
  }
  window.addEventListener('resize', onResizeDebounced);

  // Start RAF (observer manages pause/resume)
  //startLoop();

  // Teardown helper
 // container.__teardownClouds = () => {
 //   io.disconnect(); stopLoop(); renderer.domElement.removeEventListener('click', onCanvasClick);
 //   window.removeEventListener('resize', onResizeDebounced);
 //   if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
//    if (surprise && surprise.parentNode === container) container.removeChild(surprise);
//  };
//})();

/* ---------- Weather via IP -> Open-Meteo (imperial) with robust handling ---------- */
(function weatherLogic() {
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
    console.warn('All IP providers failed; falling back to default coords');
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

      // ---------------- timezone-aware forecast building (ENHANCED) ----------------
      const fc = EL.forecastContainer;
      if (!fc) return;

      // compute "today" in API timezone (preferred) or via utc_offset_seconds fallback
      // helper: YYYY-MM-DD in IANA timezone
      function yyyyMmDdInZone(date, timeZone) {
        try {
          const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
          const y = parts.find(p => p.type === 'year').value;
          const m = parts.find(p => p.type === 'month').value;
          const d = parts.find(p => p.type === 'day').value;
          return `${y}-${m}-${d}`;
        } catch (e) { return null; }
      }
      // helper: YYYY-MM-DD by applying utc offset seconds
      function yyyyMmDdWithOffset(date, utc_offset_seconds) {
        try {
          const shifted = new Date(date.getTime() + (utc_offset_seconds || 0) * 1000);
          const y = shifted.getUTCFullYear();
          const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
          const d = String(shifted.getUTCDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        } catch (e) { return null; }
      }

      console.log('DEBUG daily.time:', data.daily?.time?.slice(0,8), 'api timezone:', data.timezone, 'utc_offset_seconds:', data.utc_offset_seconds);

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
      let startIdx = times.findIndex(t => t === todayStr);

      // common heuristic: if API returned yesterday first and today second, shift to index 1
      if (startIdx === -1 && times.length >= 2) {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        let yStr = null;
        if (apiTz) yStr = yyyyMmDdInZone(yesterday, apiTz);
        else if (utcOffset != null) yStr = yyyyMmDdWithOffset(yesterday, utcOffset);
        else { const yy = yesterday.getFullYear(), mm = String(yesterday.getMonth()+1).padStart(2,'0'), dd = String(yesterday.getDate()).padStart(2,'0'); yStr = `${yy}-${mm}-${dd}`; }
        if (times[0] === yStr && times[1] === todayStr) startIdx = 1;
      }

      // final attempt: compare each candidate converted to API tz
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
          } catch (e) { /* ignore */ }
        }
      }

      if (startIdx === -1) startIdx = 0;
      console.log('DEBUG computed todayStr:', todayStr, '=> startIdx:', startIdx);

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
          setText(EL.temperature, `${hi}°F`);
          setText(EL.weatherIcon, weatherCodeToIcon(codeDay, true));
          card.classList.add('scale-105');
          setTimeout(() => card.classList.remove('scale-105'), 220);
        });
        fc.appendChild(card);
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

  // initial + periodic
  initWeather().catch(e => console.error(e));
  setInterval(() => { initWeather().catch(e => console.error('periodic weather error', e)); }, 60 * 60 * 1000);

  // getIpLocation moved to top-level inside weatherLogic (reuse earlier helper)
  async function getIpLocation() {
    for (const p of IP_PROVIDERS) {
      try {
        const json = await fetchWithRetries(p.url, {}, 2, 300);
        const mapped = p.mapper(json);
        if (mapped) { return mapped; }
      } catch (e) { /* ignore */ }
    }
    return null;
  }
})();
