// clouds.js — same structure but ensure stable canvas placement and DPR cap to avoid reflows.
// Drop-in replacement (keeps visuals but avoids frequent resizes & caps DPR/FPS).

import * as THREE from "https://esm.sh/three@0.158.0";
import { OrbitControls } from "https://esm.sh/three@0.158.0/examples/jsm/controls/OrbitControls.js";

export function initClouds(containerEl) {
  try {
    if (!containerEl) throw new Error('initClouds: container element required');
    if (containerEl.__cloudsInitialized) return containerEl;
    containerEl.__cloudsInitialized = true;

    if (getComputedStyle(containerEl).position === 'static') containerEl.style.position = 'relative';

    let surprise = containerEl.querySelector('#cloudSurprise');
    if (!surprise) {
      surprise = document.createElement('div');
      surprise.id = 'cloudSurprise';
      Object.assign(surprise.style, {
        position: 'absolute', inset: '0', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none', zIndex: '60', opacity: '0',
        transition: 'opacity .45s ease'
      });
      surprise.innerHTML = `<div style="font-size:36px;filter:drop-shadow(0 6px 10px rgba(0,0,0,0.6))">🎉</div>`;
      containerEl.appendChild(surprise);
    }

    const getRect = () => {
      const r = containerEl.getBoundingClientRect();
      return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
    };

    // DPR cap and FPS cap to reduce GPU/paint churn
    const DPR_CAP = 1.0;
    const TARGET_FPS = 20;
    const FRAME_MS = 1000 / TARGET_FPS;
    const dpr = Math.min(DPR_CAP, Math.max(1, window.devicePixelRatio || 1));

    const rect = getRect();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, rect.width / rect.height, 0.1, 1000);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(dpr);
    renderer.setSize(rect.width, rect.height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.pointerEvents = 'auto';
    containerEl.appendChild(renderer.domElement);

    camera.position.set(0, 0.5, 4.5);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9); scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2); directionalLight.position.set(2,3,2); scene.add(directionalLight);
    const pointLight = new THREE.PointLight(0xaabbee, 0.5, 15); pointLight.position.set(-1,1,3); scene.add(pointLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.rotateSpeed = 0.6;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI/3;
    controls.maxPolarAngle = Math.PI/1.9;
    controls.target.set(0,0,0);

    const cloudMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0f8ff,
      transparent: true,
      opacity: 0.82,
      roughness: 0.68,
      metalness: 0.0
    });
    const baseSphereGeom = new THREE.SphereGeometry(1.0, 10, 10);

    function createCloudGroup(x, y, z, scale) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.scale.set(scale, scale, scale);

      const parts = [
        { r: 0.8, p: new THREE.Vector3(0,0,0) },
        { r: 0.55, p: new THREE.Vector3(0.6,0.18,0.08) },
        { r: 0.5, p: new THREE.Vector3(-0.5,0.08,-0.18) },
        { r: 0.65, p: new THREE.Vector3(0.1,0.35,-0.25) },
        { r: 0.45, p: new THREE.Vector3(0.3,-0.28,0.18) }
      ];

      parts.forEach(p => {
        const m = new THREE.Mesh(baseSphereGeom, cloudMaterial);
        m.position.copy(p.p);
        m.scale.setScalar(p.r);
        m.raycast = () => {};
        g.add(m);
      });

      const bboxGeom = new THREE.BoxGeometry(2.6, 1.4, 2.0);
      const bboxMat = new THREE.MeshBasicMaterial({ visible: false });
      const bbox = new THREE.Mesh(bboxGeom, bboxMat);
      bbox.position.set(0, 0, 0);
      g.add(bbox);

      g.userData = {
        collider: bbox,
        isRaining: false,
        rainColor: Math.random() > 0.5 ? 0x87CEFA : 0xB0E0E6,
        originalPosition: g.position.clone(),
        bobOffset: Math.random() * Math.PI * 2,
        bobSpeed: 0.0004 + Math.random() * 0.00025,
        bobAmount: 0.08 + Math.random() * 0.06
      };
      return g;
    }

    const cloudGroup = new THREE.Group(); scene.add(cloudGroup);
    const cloud1 = createCloudGroup(-0.7, 0.2, 0, 1.0);
    const cloud2 = createCloudGroup(0.7, -0.08, 0.25, 0.9);
    cloudGroup.add(cloud1, cloud2);
    cloudGroup.position.y = -0.18;

    const dropGeom = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6);
    const dropMat1 = new THREE.MeshBasicMaterial({ color: 0x87CEFA, transparent: true, opacity: 0.72 });
    const dropMat2 = new THREE.MeshBasicMaterial({ color: 0xB0E0E6, transparent: true, opacity: 0.72 });

    function createRainForCloud(cloud, count = 6) {
      const rainGroup = new THREE.Group();
      cloud.add(rainGroup);
      const arr = [];
      const mat = cloud.userData.rainColor === 0x87CEFA ? dropMat1 : dropMat2;
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(dropGeom, mat);
        m.position.set((Math.random() - 0.5) * 1.2, -0.6 - Math.random() * 0.9, (Math.random() - 0.5) * 1.2);
        m.userData = { speed: 0.045 + Math.random() * 0.04 };
        arr.push(m);
        rainGroup.add(m);
      }
      rainGroup.visible = false;
      return arr;
    }

    const raindrops1 = createRainForCloud(cloud1, 6);
    const raindrops2 = createRainForCloud(cloud2, 6);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    function onCanvasClick(ev) {
      const rect2 = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect2.left) / rect2.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect2.top) / rect2.height) * 2 + 1;
      const colliders = [cloud1.userData.collider, cloud2.userData.collider].filter(Boolean);
      const intersects = raycaster.intersectObjects(colliders, true);
      if (intersects.length > 0) {
        const newState = !(cloud1.userData.isRaining && cloud2.userData.isRaining);
        cloud1.userData.isRaining = newState;
        cloud2.userData.isRaining = newState;
        cloud1.children.forEach(c => { if (c.type === 'Group') c.visible = newState; });
        cloud2.children.forEach(c => { if (c.type === 'Group') c.visible = newState; });

        const picked = intersects[0].object.parent || intersects[0].object;
        const origScale = picked.scale.clone();
        picked.scale.multiplyScalar(1.08);
        setTimeout(() => { picked.scale.copy(origScale); }, 120);

        if (surprise) {
          surprise.style.opacity = '1';
          setTimeout(() => { if (surprise) surprise.style.opacity = '0'; }, 800);
        }
      }
    }
    renderer.domElement.addEventListener('click', onCanvasClick);

    const tooltip = containerEl.querySelector('#cloud-tooltip');
    setTimeout(() => {
      if (tooltip) tooltip.classList.add('opacity-100');
      setTimeout(() => { if (tooltip) tooltip.classList.remove('opacity-100'); }, 3200);
    }, 1200);

    // RAF loop with FPS cap
    let reqId = null;
    let running = false;
    let lastTime = performance.now();
    let accum = 0;

    let allowMotion = false;
    containerEl.addEventListener('pointerenter', () => { allowMotion = true; startLoop(); }, { passive: true });
    containerEl.addEventListener('pointerleave', () => { allowMotion = false; }, { passive: true });

    let lastInteractionTime = 0;
    renderer.domElement.addEventListener('pointerdown', () => { lastInteractionTime = performance.now(); }, { passive: true });

    function animateFrame(now) {
      if (!running) { reqId = null; return; }
      const t = now || performance.now();
      let dtMs = t - lastTime;
      if (dtMs > 300) dtMs = FRAME_MS;
      lastTime = t;
      accum += dtMs;

      if (accum >= FRAME_MS) {
        const logicalDt = accum / 1000;
        accum = 0;

        if (allowMotion) cloudGroup.rotation.y += 0.0012 * (logicalDt * TARGET_FPS / TARGET_FPS);

        [cloud1, cloud2].forEach((cloud) => {
          cloud.position.y = cloud.userData.originalPosition.y + Math.sin(t * cloud.userData.bobSpeed + cloud.userData.bobOffset) * cloud.userData.bobAmount * (allowMotion ? 1 : 0.35);
          if (cloud.userData.isRaining) {
            const cur = (cloud === cloud1) ? raindrops1 : raindrops2;
            cur.forEach(r => {
              r.position.y -= r.userData.speed * logicalDt * TARGET_FPS;
              if (r.position.y < -1.8) {
                r.position.y = -0.6;
                r.position.x = (Math.random() - 0.5) * 1.2 * cloud.scale.x;
                r.position.z = (Math.random() - 0.5) * 1.2 * cloud.scale.z;
              }
            });
          }
        });

        if (performance.now() - lastInteractionTime < 1200) controls.update();
        renderer.render(scene, camera);
      }
      reqId = requestAnimationFrame(animateFrame);
    }

    function startLoop() {
      if (reqId) return;
      running = true;
      lastTime = performance.now();
      accum = 0;
      reqId = requestAnimationFrame(animateFrame);
    }
    function stopLoop() {
      running = false;
      if (reqId) { cancelAnimationFrame(reqId); reqId = null; }
    }

    // Debounced resize: update renderer only when size actually changes
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
          renderer.setPixelRatio(Math.min(DPR_CAP, window.devicePixelRatio || 1));
          renderer.setSize(w, h, false);
        }
      }, 140);
    }
    window.addEventListener('resize', onResizeDebounced);

    const io = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (!e || !e.isIntersecting) stopLoop();
      else startLoop();
    }, { threshold: 0.05 });
    io.observe(containerEl);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopLoop();
      else {
        const rNow = containerEl.getBoundingClientRect();
        if (rNow.width > 0 && rNow.height > 0) startLoop();
      }
    });

    startLoop();

    containerEl.__teardownClouds = () => {
      io.disconnect();
      stopLoop();
      renderer.domElement.removeEventListener('click', onCanvasClick);
      window.removeEventListener('resize', onResizeDebounced);
      if (renderer.domElement.parentNode === containerEl) containerEl.removeChild(renderer.domElement);
      if (surprise && surprise.parentNode === containerEl) containerEl.removeChild(surprise);
      containerEl.__cloudsInitialized = false;
    };

    return containerEl;
  } catch (err) {
    console.error('initClouds error', err);
    return null;
  }
}
