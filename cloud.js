// clouds.js — ES module
import * as THREE from "https://esm.sh/three@0.158.0";
import { OrbitControls } from "https://esm.sh/three@0.158.0/examples/jsm/controls/OrbitControls.js";

export function initClouds(containerEl) {
  try {
    if (!containerEl) throw new Error('initClouds: container element required');
    if (containerEl.__cloudsInitialized) return containerEl; // idempotent
    containerEl.__cloudsInitialized = true;

    // overlay surprise (if not present, create a lightweight one)
    let surprise = containerEl.querySelector('#cloudSurprise');
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
      containerEl.appendChild(surprise);
    }

    const getRect = () => {
      const r = containerEl.getBoundingClientRect();
      return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
    };

    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
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

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0); scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.6); directionalLight.position.set(2,3,2); scene.add(directionalLight);
    const pointLight = new THREE.PointLight(0xaabbee, 0.6, 15); pointLight.position.set(-1,1,3); scene.add(pointLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07; controls.rotateSpeed = 0.8;
    controls.enableZoom = false; controls.enablePan = false;
    controls.minPolarAngle = Math.PI/3; controls.maxPolarAngle = Math.PI/1.8;
    controls.target.set(0,0,0);

    // Shared materials/geometries
    const cloudMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0f8ff,
      transparent: true,
      opacity: 0.85,
      roughness: 0.6,
      metalness: 0.0
    });
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
        m.raycast = () => {}; // inner parts non-raycastable
        g.add(m);
      });

      const bboxGeom = new THREE.BoxGeometry(3.0, 1.8, 2.4);
      const bboxMat = new THREE.MeshBasicMaterial({ visible: false });
      const bbox = new THREE.Mesh(bboxGeom, bboxMat);
      bbox.position.set(0,0,0);
      g.add(bbox);

      g.userData = {
        collider: bbox,
        isRaining: false,
        rainColor: Math.random() > 0.5 ? 0x87CEFA : 0xB0E0E6,
        originalPosition: g.position.clone(),
        bobOffset: Math.random() * Math.PI * 2,
        bobSpeed: 0.0005 + Math.random() * 0.0003,
        bobAmount: 0.12 + Math.random() * 0.08
      };
      return g;
    }

    const cloudGroup = new THREE.Group(); scene.add(cloudGroup);
    const cloud1 = createCloudGroup(-0.7, 0.2, 0, 1.0);
    const cloud2 = createCloudGroup(0.7, -0.1, 0.3, 0.9);
    cloudGroup.add(cloud1, cloud2);
    cloudGroup.position.y = -0.2;

    // Shared raindrop geometry/material, fewer drops
    const dropGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.18, 6);
    const dropMat1 = new THREE.MeshBasicMaterial({ color: 0x87CEFA, transparent: true, opacity: 0.72 });
    const dropMat2 = new THREE.MeshBasicMaterial({ color: 0xB0E0E6, transparent: true, opacity: 0.72 });

    function createRainForCloud(cloud, count = 10) {
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
      const rect2 = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect2.left) / rect2.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect2.top) / rect2.height) * 2 + 1;
      const colliders = [cloud1.userData.collider, cloud2.userData.collider].filter(Boolean);
      const intersects = raycaster.intersectObjects(colliders, true);
      if (intersects.length > 0) {
        const hit = intersects[0].object;
        const picked = hit.parent;
        if (!picked) return;
        const newState = !(cloud1.userData.isRaining && cloud2.userData.isRaining);
        cloud1.userData.isRaining = newState;
        cloud2.userData.isRaining = newState;
        // show rain groups
        cloud1.children.forEach(c => { if (c.type === 'Group') c.visible = newState; });
        cloud2.children.forEach(c => { if (c.type === 'Group') c.visible = newState; });

        // pulse picked group
        const originalScale = picked.scale.clone();
        picked.scale.multiplyScalar(1.12);
        setTimeout(() => { picked.scale.copy(originalScale); }, 140);

        // show CSS surprise overlay (no DOM create/remove in RAF)
        if (surprise) {
          surprise.style.opacity = '1';
          setTimeout(() => { if (surprise) surprise.style.opacity = '0'; }, 900);
        }
      }
    }
    renderer.domElement.addEventListener('click', onCanvasClick);

    const tooltip = containerEl.querySelector('#cloud-tooltip');
    setTimeout(() => {
      if (tooltip) tooltip.classList.add('opacity-100');
      setTimeout(() => { if (tooltip) tooltip.classList.remove('opacity-100'); }, 3500);
    }, 1500);

    // Controlled RAF + IntersectionObserver
    let reqId = null;
    let running = false;
    let lastTime = performance.now();

    function animateFrame(time) {
      if (!running) { reqId = null; return; }
      const t = time || performance.now();
      const dt = Math.min(60, t - lastTime) / 1000;
      lastTime = t;

      cloudGroup.rotation.y += 0.002;

      [cloud1, cloud2].forEach((cloud) => {
        if (!cloud) return;
        cloud.position.y = cloud.userData.originalPosition.y + Math.sin(t * cloud.userData.bobSpeed + cloud.userData.bobOffset) * cloud.userData.bobAmount;
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

    function startLoop() {
      if (reqId) return;
      running = true;
      lastTime = performance.now();
      reqId = requestAnimationFrame(animateFrame);
    }
    function stopLoop() {
      running = false;
      if (reqId) { cancelAnimationFrame(reqId); reqId = null; }
    }

    const io = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (!e || !e.isIntersecting) stopLoop();
      else startLoop();
    }, { threshold: 0.05 });
    io.observe(containerEl);

    // Debounced resize
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

    // start
    startLoop();

    // teardown helper
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
