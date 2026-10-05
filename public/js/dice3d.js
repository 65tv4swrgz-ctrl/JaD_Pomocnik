// 3D házeč kostek: three.js (vykreslení) + cannon-es (fyzika tuhých těles).
// Načítá se líně až při prvním hodu; knihovny service worker drží pro offline.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

// ---------------------------------------------------------------------------
// Měřítko: 1 jednotka ≈ 1,6 cm (kostka K6 má hranu ~1,6 cm). Gravitace je skutečná.
const UNIT_M = 0.016;
const GRAVITY = 9.82 / UNIT_M; // ≈ 614 j/s²
const HALF_SHORT = 7; // polovina kratší strany okna v jednotkách (≈ 11 cm – kostka vůči iPadu zhruba ve skutečné velikosti)
const STEP = 1 / 240;
// Časy jsou fyzikální; na displeji trvají 1/timeScale krát déle (při 0,5× dvojnásobek).
const MAX_ROLL_S = 2; // nejdéle čekáme na uklidnění jednoho „kola“ (normálně ~0,6 s; déle = kostka se chvěje zaklíněná)
const HARD_MAX_S = 3.5; // celková délka hodu včetně ťuknutí do nakloněných kostek (≈ 7 s na displeji)

// Hod a materiály. Kostka vyletí z ruky po oblouku (~10–13 cm vysoko), dopadne, poskočí a dokutálí se.
const TUNE = {
  // Skutečný hod se uklidní za ~0,7 s (zemská gravitace, kostka 1,8 cm) – na displeji to působí jako mrsknutí.
  // Proto zpomalený záběr 0,5×: trajektorie, odrazy i překulení jsou fyzikálně stejné, jen se přehrávají pomaleji.
  timeScale: 0.5,
  floor: { friction: 0.2, restitution: 0.34 },
  wall: { friction: 0.1, restitution: 0.5 },
  dice: { friction: 0.2, restitution: 0.35 },
  linearDamping: 0.02,
  angularDamping: 0.1,
  spawnY: [6, 8],
  hSpeed: [24, 36], // ≈ 0,4–0,6 m/s vodorovně
  vUp: [8, 14], // ≈ 0,13–0,22 m/s nahoru – oblouk
  spin: [24, 34], // rad/s
};

// ---------------------------------------------------------------------------
// Geometrie mnohostěnů

const PHI = (1 + Math.sqrt(5)) / 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Stěny z normál: ke každé normále vrcholy s maximálním průmětem, seřazené proti směru hodin (zvenku). */
function facesFromNormals(verts, normals) {
  return normals.map((n0) => {
    const n = n0.clone().normalize();
    const dots = verts.map((v) => v.dot(n));
    const max = Math.max(...dots);
    const idx = dots.map((d, i) => [d, i]).filter(([d]) => d > max - 1e-6).map(([, i]) => i);
    return orderFace(verts, idx, n);
  });
}

function orderFace(verts, idx, n) {
  const c = idx.reduce((s, i) => s.add(verts[i]), V(0, 0, 0)).multiplyScalar(1 / idx.length);
  const u = verts[idx[0]].clone().sub(c).normalize();
  const w = n.clone().cross(u);
  return idx
    .map((i) => {
      const d = verts[i].clone().sub(c);
      return [Math.atan2(d.dot(w), d.dot(u)), i];
    })
    .sort((a, b) => a[0] - b[0])
    .map(([, i]) => i);
}

function faceNormal(verts, f) {
  const a = verts[f[0]], b = verts[f[1]], c = verts[f[2]];
  return b.clone().sub(a).cross(c.clone().sub(a)).normalize();
}

/** Pojistka: stěny musí být číslované proti směru hodin při pohledu zvenku (normála ven). */
function fixWinding(verts, faces) {
  return faces.map((f) => {
    const c = f.reduce((s, i) => s.add(verts[i]), V(0, 0, 0)).multiplyScalar(1 / f.length);
    return faceNormal(verts, f).dot(c) < 0 ? [...f].reverse() : f;
  });
}

function signs3(fn) {
  const out = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) out.push(fn(a, b, c));
  return out;
}

const icosaVerts = () => [
  ...[-1, 1].flatMap((a) => [-1, 1].map((b) => V(0, a, b * PHI))),
  ...[-1, 1].flatMap((a) => [-1, 1].map((b) => V(a, b * PHI, 0))),
  ...[-1, 1].flatMap((a) => [-1, 1].map((b) => V(a * PHI, 0, b))),
];
// Dvanáctistěn duální k dvacetistěnu výše: jeho vrcholy leží ve směru středů stěn dvacetistěnu a naopak.
const dodecaVerts = () => [
  ...signs3((a, b, c) => V(a, b, c)),
  ...[-1, 1].flatMap((a) => [-1, 1].map((b) => V(a / PHI, 0, b * PHI))),
  ...[-1, 1].flatMap((a) => [-1, 1].map((b) => V(0, a * PHI, b / PHI))),
  ...[-1, 1].flatMap((a) => [-1, 1].map((b) => V(a * PHI, b / PHI, 0))),
];

/** Pětiboký trapezoedr (K10). Výška pólů je spočtená tak, aby deltoidy byly přesně rovinné. */
function d10Shape() {
  const e = 0.105;
  const c = Math.cos(Math.PI / 5);
  const h = (e * (1 + c)) / (1 - c);
  const verts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    verts.push(V(Math.cos(a), i % 2 === 0 ? e : -e, Math.sin(a)));
  }
  const T = verts.push(V(0, h, 0)) - 1;
  const B = verts.push(V(0, -h, 0)) - 1;
  const faces = [];
  for (let k = 0; k < 5; k++) {
    const i = 2 * k;
    faces.push([T, i, (i + 1) % 10, (i + 2) % 10]);
    faces.push([B, (i + 1) % 10, (i + 2) % 10, (i + 3) % 10]);
  }
  return { verts, faces };
}

function rawShape(type) {
  switch (type) {
    case 'd4': {
      const verts = [V(1, 1, 1), V(1, -1, -1), V(-1, 1, -1), V(-1, -1, 1)];
      // stěna i leží naproti vrcholu i
      return { verts, faces: facesFromNormals(verts, verts.map((v) => v.clone().negate())) };
    }
    case 'd6': {
      const verts = signs3((a, b, c) => V(a, b, c));
      const normals = [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)];
      return { verts, faces: facesFromNormals(verts, normals) };
    }
    case 'd8': {
      const verts = [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)];
      return { verts, faces: facesFromNormals(verts, signs3((a, b, c) => V(a, b, c))) };
    }
    case 'd10':
      return d10Shape();
    case 'd12': {
      const verts = dodecaVerts();
      return { verts, faces: facesFromNormals(verts, icosaVerts()) };
    }
    case 'd20': {
      const verts = icosaVerts();
      return { verts, faces: facesFromNormals(verts, dodecaVerts()) };
    }
  }
  throw new Error('Neznámá kostka ' + type);
}

// Velikost (poloměr opsané koule) – přibližně jako skutečné kostky.
const SIZE = { d4: 1.25, d6: 1.0, d8: 1.05, d10: 1.05, d12: 1.1, d20: 1.15 };

/** Hodnoty stěn: protilehlé stěny dávají součet n+1 (K10: 0–9 se součtem 9), jako u skutečných kostek. */
function assignValues(type, normals) {
  const n = normals.length;
  if (type === 'd4') return [1, 2, 3, 4];
  const lo = type === 'd10' ? 0 : 1;
  const hi = type === 'd10' ? 9 : n;
  const vals = new Array(n).fill(null);
  let next = lo;
  for (let i = 0; i < n; i++) {
    if (vals[i] !== null) continue;
    // protilehlá stěna = nejvíc opačná normála
    let opp = -1;
    let best = 2;
    for (let j = 0; j < n; j++) {
      if (j === i || vals[j] !== null) continue;
      const d = normals[i].dot(normals[j]);
      if (d < best) {
        best = d;
        opp = j;
      }
    }
    vals[i] = next;
    vals[opp] = lo + hi - next;
    next++;
  }
  return vals;
}

const shapeCache = new Map();
function shape(type) {
  if (shapeCache.has(type)) return shapeCache.get(type);
  const raw = rawShape(type);
  const r = Math.max(...raw.verts.map((v) => v.length()));
  const verts = raw.verts.map((v) => v.clone().multiplyScalar(SIZE[type] / r));
  const faces = fixWinding(verts, raw.faces);
  const normals = faces.map((f) => faceNormal(verts, f));
  // Čitelnost: sklon menší než 45 % úhlu mezi sousedními stěnami (nejvýš 20°) → horní stěna je jednoznačná.
  let maxDot = -1;
  normals.forEach((a, i) => normals.forEach((b, j) => i !== j && (maxDot = Math.max(maxDot, a.dot(b)))));
  const adj = Math.acos(Math.min(1, maxDot));
  const readLimit = Math.cos(Math.min(THREE.MathUtils.degToRad(20), 0.45 * adj));
  const s = { type, verts, faces, normals, values: assignValues(type, normals), readLimit };
  shapeCache.set(type, s);
  return s;
}

// ---------------------------------------------------------------------------
// Vzhled

const STYLE = {
  d4: { bg: '#b8433b', fg: '#fff' },
  d6: { bg: '#ece2c6', fg: '#1d1d1d' },
  d8: { bg: '#2f6db3', fg: '#fff' },
  d10: { bg: '#2f8a4c', fg: '#fff' },
  d12: { bg: '#7a4bb3', fg: '#fff' },
  d20: { bg: '#c9922e', fg: '#141414' },
  tens: { bg: '#3b3f46', fg: '#fff' },
};

const TEX = 256;

/** 2D souřadnice vrcholů stěny v rovině stěny → UV (střed 0.5, 0.5). */
function faceUVs(verts, f, n, type) {
  const c = f.reduce((s, i) => s.add(verts[i]), V(0, 0, 0)).multiplyScalar(1 / f.length);
  const u = verts[f[0]].clone().sub(c).normalize();
  const w = n.clone().cross(u);
  const pts = f.map((i) => {
    const d = verts[i].clone().sub(c);
    return [d.dot(u), d.dot(w)];
  });
  // Natočení: trojúhelník špičkou nahoru, mnohoúhelník hranou dolů, deltoid K10 pólem nahoru (číslo v ose).
  let rot = f.length === 3 ? Math.PI / 2 - Math.atan2(pts[0][1], pts[0][0]) : Math.PI / f.length + Math.PI / 2;
  if (type === 'd10') {
    const k = f.findIndex((i) => i >= 10);
    rot = Math.PI / 2 - Math.atan2(pts[k][1], pts[k][0]);
  }
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const rp = pts.map(([x, y]) => [x * cs - y * sn, x * sn + y * cs]);
  const m = Math.max(...rp.map(([x, y]) => Math.hypot(x, y)));
  return rp.map(([x, y]) => [0.5 + (x / m) * 0.48, 0.5 + (y / m) * 0.48]);
}

function labelText(type, v, tens) {
  if (tens) return v === 0 ? '00' : String(v * 10);
  return String(v);
}

function drawNumber(ctx, text, x, y, size, rot, fg) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.fillText(text, 0, 0);
  // 6 a 9 se na kostkách podtrhávají, ať se nepletou
  if (text === '6' || text === '9') ctx.fillRect(-size * 0.22, size * 0.42, size * 0.44, size * 0.08);
  ctx.restore();
}

function faceTexture(s, fi, uvs, style, tens) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, TEX, TEX);
  const toPx = ([u, v]) => [u * TEX, (1 - v) * TEX];

  if (s.type === 'd4') {
    // K4: u každého rohu číslo, které padne, když je tento roh nahoře (= hodnota protilehlé stěny).
    const [cx, cy] = [TEX / 2, TEX / 2];
    s.faces[fi].forEach((vi, k) => {
      const [px, py] = toPx(uvs[k]);
      const x = cx + (px - cx) * 0.58;
      const y = cy + (py - cy) * 0.58;
      drawNumber(ctx, String(s.values[vi]), x, y, TEX * 0.2, Math.atan2(px - cx, -(py - cy)), style.fg);
    });
  } else {
    const size = { d6: 0.5, d8: 0.36, d10: 0.34, d12: 0.36, d20: 0.3 }[s.type] * TEX * (tens ? 0.85 : 1);
    const y = s.type === 'd10' ? TEX * 0.56 : TEX / 2;
    drawNumber(ctx, labelText(s.type, s.values[fi], tens), TEX / 2, y, size, 0, style.fg);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const meshCache = new Map();
/** Geometrie se skupinou na každou stěnu + materiál s číslem pro každou stěnu. */
function meshAssets(type, tens) {
  const key = type + (tens ? ':tens' : '');
  if (meshCache.has(key)) return meshCache.get(key);
  const s = shape(type);
  const style = tens ? STYLE.tens : STYLE[type];
  const pos = [];
  const uv = [];
  const geo = new THREE.BufferGeometry();
  const materials = [];
  let start = 0;
  s.faces.forEach((f, fi) => {
    const uvs = faceUVs(s.verts, f, s.normals[fi], type);
    for (let k = 1; k < f.length - 1; k++) {
      for (const j of [0, k, k + 1]) {
        const p = s.verts[f[j]];
        pos.push(p.x, p.y, p.z);
        uv.push(...uvs[j]);
      }
    }
    const count = (f.length - 2) * 3;
    geo.addGroup(start, count, fi);
    start += count;
    materials.push(
      new THREE.MeshStandardMaterial({ map: faceTexture(s, fi, uvs, style, tens), roughness: 0.42, metalness: 0.05, flatShading: true })
    );
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const out = { geo, materials };
  meshCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Scéna

let ctx3 = null; // { overlay, renderer, scene, camera, world, walls, light, dice:[], raf, onDone }

function build() {
  const overlay = document.createElement('div');
  overlay.className = 'dice-overlay';
  overlay.innerHTML = `<canvas class="dice-canvas"></canvas>
    <div class="dice-total" aria-live="polite" hidden></div>
    <button class="btn dice-reroll" type="button" hidden>Hodit znovu</button>`;
  document.body.appendChild(overlay);
  const canvas = overlay.querySelector('canvas');

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 400);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.1));
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(-12, 40, 18);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0005;
  scene.add(light);
  scene.add(light.target);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0), allowSleep: true });
  world.solver.iterations = 20;
  const diceMat = new CANNON.Material('dice');
  const floorMat = new CANNON.Material('floor');
  const wallMat = new CANNON.Material('wall');
  // Dřevěný stůl / plastová kostka; stěny okna pružnější a hladší.
  world.addContactMaterial(new CANNON.ContactMaterial(floorMat, diceMat, TUNE.floor));
  world.addContactMaterial(new CANNON.ContactMaterial(wallMat, diceMat, TUNE.wall));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, TUNE.dice));

  const floorBody = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Plane() });
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floorBody);

  const walls = [0, 1, 2, 3].map(() => {
    const b = new CANNON.Body({ mass: 0, material: wallMat, shape: new CANNON.Plane() });
    world.addBody(b);
    return b;
  });

  ctx3 = { overlay, renderer, scene, camera, world, walls, light, diceMat, dice: [], raf: 0, half: { w: 10, h: 10 } };
  // Po hodu: „Hodit znovu“, nebo klepnutí kamkoli jinam hod zavře.
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('.dice-reroll')) {
      if (ctx3.onReroll) ctx3.onReroll();
      return;
    }
    if (ctx3.state === 'done') close();
  });
  window.addEventListener('resize', layout);
  layout();
}

/** Kamera kolmo shora; stěny přesně na okrajích okna (s rezervou na velikost kostky). */
function layout() {
  if (!ctx3) return;
  const { renderer, camera, walls, light } = ctx3;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  const halfW = aspect >= 1 ? HALF_SHORT * aspect : HALF_SHORT;
  const halfH = aspect >= 1 ? HALF_SHORT : HALF_SHORT / aspect;
  camera.aspect = aspect;
  const camY = halfH / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, camY, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.far = camY * 2;
  camera.updateProjectionMatrix();
  // Kostky mají výšku ~2 j. – kvůli perspektivě stěny trochu přitáhneme, ať je celá kostka vidět.
  const k = (camY - 2.4) / camY;
  const ww = halfW * k - 0.3;
  const wh = halfH * k - 0.3;
  const set = (b, x, z, ry) => {
    b.position.set(x, 0, z);
    b.quaternion.setFromEuler(0, ry, 0);
  };
  // Normála roviny v cannonu je +Z lokálně → natočit dovnitř.
  set(walls[0], -ww, 0, Math.PI / 2); // levá, normála +X
  set(walls[1], ww, 0, -Math.PI / 2); // pravá, normála −X
  set(walls[2], 0, -wh, 0); // horní, normála +Z
  set(walls[3], 0, wh, Math.PI); // dolní, normála −Z
  const sc = light.shadow.camera;
  sc.left = -halfW - 2;
  sc.right = halfW + 2;
  sc.top = halfH + 2;
  sc.bottom = -halfH - 2;
  sc.far = 120;
  sc.updateProjectionMatrix();
  ctx3.half = { w: ww, h: wh };
  renderer.render(ctx3.scene, camera);
}

function clearDice() {
  for (const d of ctx3.dice) {
    ctx3.world.removeBody(d.body);
    ctx3.scene.remove(d.mesh);
  }
  ctx3.dice = [];
}

function createDie(type, tens) {
  const s = shape(type);
  const { geo, materials } = meshAssets(type, tens);
  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  ctx3.scene.add(mesh);
  const poly = new CANNON.ConvexPolyhedron({
    vertices: s.verts.map((v) => new CANNON.Vec3(v.x, v.y, v.z)),
    faces: s.faces.map((f) => [...f]),
  });
  // Hmotnost úměrná objemu (plast ~1,2 g/cm³); na výsledek nemá vliv, ale srážky kostek působí věrněji.
  const body = new CANNON.Body({
    mass: 0.1 * SIZE[type] ** 3,
    material: ctx3.diceMat,
    shape: poly,
    linearDamping: TUNE.linearDamping,
    angularDamping: TUNE.angularDamping,
    allowSleep: true,
    sleepSpeedLimit: 1.2,
    sleepTimeLimit: 0.35,
  });
  ctx3.world.addBody(body);
  return { type, tens, shape: s, mesh, body };
}

const rnd = (a, b) => a + Math.random() * (b - a);

/** Vyhození od spodního okraje (od hráče) směrem do stolu, náhodná rotace. */
function throwDice(dice) {
  const { w, h } = ctx3.half;
  const n = dice.length;
  const perRow = Math.max(1, Math.min(n, Math.floor((w * 2 - 2) / 2.6)));
  dice.forEach((d, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const cols = Math.min(perRow, n - row * perRow);
    const b = d.body;
    b.position.set((col - (cols - 1) / 2) * 2.6 + rnd(-0.3, 0.3), rnd(...TUNE.spawnY) + row * 2.6, h - 1.6 - rnd(0, 0.6));
    b.quaternion.setFromEuler(rnd(0, Math.PI * 2), rnd(0, Math.PI * 2), rnd(0, Math.PI * 2));
    const speed = rnd(...TUNE.hSpeed);
    const ang = rnd(-0.4, 0.4);
    b.velocity.set(Math.sin(ang) * speed, rnd(...TUNE.vUp), -Math.cos(ang) * speed);
    // Rotace kolem náhodné osy (z ruky kostka „sjede“ přes prsty).
    const ax = new CANNON.Vec3(rnd(-1, 1), rnd(-0.3, 0.3), rnd(-1, 1));
    ax.normalize();
    ax.scale(rnd(...TUNE.spin), ax);
    b.angularVelocity.copy(ax);
    b.wakeUp();
  });
}

/** Hodnota kostky: stěna nejvíc nahoru (K4: stěna dole). Vrací i „jak rovně“ leží. */
function readDie(d) {
  const q = new THREE.Quaternion(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
  let best = -2;
  let worst = 2;
  let bi = 0;
  let wi = 0;
  d.shape.normals.forEach((n, i) => {
    const y = n.clone().applyQuaternion(q).y;
    if (y > best) {
      best = y;
      bi = i;
    }
    if (y < worst) {
      worst = y;
      wi = i;
    }
  });
  if (d.type === 'd4') return { value: d.shape.values[wi], flat: -worst };
  return { value: d.shape.values[bi], flat: best };
}

function sync() {
  for (const d of ctx3.dice) {
    d.mesh.position.copy(d.body.position);
    d.mesh.quaternion.copy(d.body.quaternion);
  }
}

// ---------------------------------------------------------------------------
// Veřejné API

/**
 * Hod. spec: [{ type: 'd4'|'d6'|'d8'|'d10'|'d12'|'d20'|'d100', count }]. Výsledek se zobrazí na obrazovce.
 */
export function roll(spec, { onReroll } = {}) {
  if (!ctx3) build();
  cancelAnimationFrame(ctx3.raf);
  clearDice();
  ctx3.overlay.classList.add('is-open');
  hideTotal();
  ctx3.state = 'rolling';
  ctx3.onReroll = onReroll;
  layout();

  // K100 = dvě K10 (desítky + jednotky).
  const groups = [];
  for (const { type, count } of spec) {
    for (let i = 0; i < count; i++) {
      if (type === 'd100') {
        const tens = createDie('d10', true);
        const ones = createDie('d10', false);
        ctx3.dice.push(tens, ones);
        groups.push({ type, dice: [tens, ones] });
      } else {
        const d = createDie(type, false);
        ctx3.dice.push(d);
        groups.push({ type, dice: [d] });
      }
    }
  }
  if (!ctx3.dice.length) return;
  throwDice(ctx3.dice);
  ctx3.sim = { acc: 0, elapsed: 0, nudges: 0, groups };

  let last = performance.now();
  const frame = (now) => {
    const done = advance(Math.min(0.05, (now - last) / 1000) * TUNE.timeScale);
    last = now;
    sync();
    ctx3.renderer.render(ctx3.scene, ctx3.camera);
    if (done) finish(groups);
    else ctx3.raf = requestAnimationFrame(frame);
  };
  ctx3.raf = requestAnimationFrame(frame);
}

/** Posune fyziku o dt sekund (pevným krokem). Vrací true, když jsou všechny kostky v klidu a čitelné. */
function advance(dt) {
  const sim = ctx3.sim;
  sim.acc += dt;
  while (sim.acc >= STEP) {
    ctx3.world.step(STEP);
    sim.acc -= STEP;
  }
  sim.elapsed += dt;
  sim.total = (sim.total ?? 0) + dt;
  if (sim.total > HARD_MAX_S) return true; // pojistka: hod nikdy netrvá déle
  // Klid = všechny kostky spí, nebo jsou aspoň 0,25 s prakticky nehybné (drobné chvění u opřených kostek).
  const still = ctx3.dice.every(
    (d) => d.body.sleepState === CANNON.Body.SLEEPING || (d.body.velocity.length() < 1 && d.body.angularVelocity.length() < 0.4)
  );
  sim.calm = still ? (sim.calm ?? 0) + dt : 0;
  const settled = ctx3.dice.every((d) => d.body.sleepState === CANNON.Body.SLEEPING) || sim.calm > 0.25;
  if (!settled && sim.elapsed <= MAX_ROLL_S) return false;
  sim.calm = 0;
  // Kostka opřená o hranu (o stěnu nebo jinou kostku) – jako u stolu do ní lehce ťukneme.
  const cocked = ctx3.dice.filter((d) => readDie(d).flat < d.shape.readLimit);
  if (cocked.length && sim.nudges < 4 && sim.total < HARD_MAX_S - 0.9) {
    sim.nudges++;
    sim.elapsed = 0; // nové „kolo“ uklidnění
    for (const d of cocked) {
      // Postrčení od toho, o co se kostka opírá (nejbližší kostka nebo stěna), jinak by se o to opřela znovu.
      const p = d.body.position;
      const { w, h } = ctx3.half;
      let ax = 0, az = 0;
      for (const o of ctx3.dice) {
        if (o === d) continue;
        const dx = p.x - o.body.position.x;
        const dz = p.z - o.body.position.z;
        const dist = Math.hypot(dx, dz) || 0.01;
        if (dist < 3.2) {
          ax += dx / dist / dist;
          az += dz / dist / dist;
        }
      }
      for (const [dist, nx, nz] of [[p.x + w, 1, 0], [w - p.x, -1, 0], [p.z + h, 0, 1], [h - p.z, 0, -1]]) {
        if (dist < 2) {
          ax += nx / Math.max(dist, 0.3);
          az += nz / Math.max(dist, 0.3);
        }
      }
      if (!ax && !az) {
        ax = rnd(-1, 1);
        az = rnd(-1, 1);
      }
      const len = Math.hypot(ax, az);
      const push = rnd(6, 10);
      d.body.wakeUp();
      d.body.velocity.set((ax / len) * push, rnd(9, 14), (az / len) * push);
      d.body.angularVelocity.set(rnd(-14, 14), rnd(-14, 14), rnd(-14, 14));
    }
    return false;
  }
  return true;
}

function finish(groups) {
  ctx3.state = 'done';
  let total = 0;
  for (const g of groups) {
    if (g.type === 'd100') {
      const t = readDie(g.dice[0]).value;
      const o = readDie(g.dice[1]).value;
      total += t * 10 + o || 100; // 00 + 0 = 100
    } else if (g.type === 'd10') {
      total += readDie(g.dice[0]).value || 10; // 0 = 10
    } else {
      total += readDie(g.dice[0]).value;
    }
  }
  ctx3.total = total;
  showTotal(total);
}

/** Velké zářící číslo: krátce naběhne od nuly, pak se jemně rozzáří. */
function showTotal(total) {
  const el = ctx3.overlay.querySelector('.dice-total');
  const btn = ctx3.overlay.querySelector('.dice-reroll');
  el.textContent = '0';
  el.hidden = false;
  el.classList.remove('is-in');
  void el.offsetWidth;
  el.classList.add('is-in');
  btn.hidden = false;

  const dur = 650;
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(total * eased));
    if (p < 1 && ctx3.state === 'done') ctx3.countRaf = requestAnimationFrame(tick);
  };
  ctx3.countRaf = requestAnimationFrame(tick);
  // Kdyby prohlížeč animační snímky neposílal (karta na pozadí), číslo se doplní i tak.
  setTimeout(() => ctx3 && ctx3.state === 'done' && (el.textContent = String(total)), dur + 100);
}

function hideTotal() {
  cancelAnimationFrame(ctx3.countRaf);
  ctx3.overlay.querySelector('.dice-total').hidden = true;
  ctx3.overlay.querySelector('.dice-reroll').hidden = true;
}

export function close() {
  if (!ctx3) return;
  cancelAnimationFrame(ctx3.raf);
  clearDice();
  hideTotal();
  ctx3.state = 'idle';
  ctx3.overlay.classList.remove('is-open');
}

export const isOpen = () => !!ctx3 && ctx3.overlay.classList.contains('is-open');

/** Pro kontrolu geometrie a fyziky (testy v konzoli). */
export const _shape = shape;

/** Ladění parametrů hodu (scéna se při dalším hodu postaví znovu). */
export function _tune(patch) {
  for (const [k, v] of Object.entries(patch)) TUNE[k] = typeof v === 'object' && !Array.isArray(v) ? { ...TUNE[k], ...v } : v;
  if (ctx3) {
    cancelAnimationFrame(ctx3.raf);
    ctx3.overlay.remove();
    ctx3 = null;
  }
  return { ...TUNE };
}

/** Průběh rozběhnutého hodu (fyzikální čas): let, odskoky, překulení, dráha, doba do klidu, prudkost zastavení. */
export function _trace() {
  cancelAnimationFrame(ctx3.raf);
  const st = ctx3.dice.map((d) => ({ firstHit: null, bounces: 0, prevVy: 0, dist: 0, rot: 0, still: null, lastX: d.body.position.x, lastZ: d.body.position.z, decel: [] }));
  let t = 0;
  while (t < 8) {
    ctx3.world.step(STEP);
    t += STEP;
    ctx3.dice.forEach((d, i) => {
      const s = st[i];
      const b = d.body;
      const vy = b.velocity.y;
      if (s.prevVy < -3 && vy > 0.5) {
        s.bounces++;
        if (s.firstHit === null) s.firstHit = t;
      }
      s.prevVy = vy;
      s.dist += Math.hypot(b.position.x - s.lastX, b.position.z - s.lastZ);
      s.lastX = b.position.x;
      s.lastZ = b.position.z;
      s.rot += b.angularVelocity.length() * STEP;
      const speed = b.velocity.length();
      if (s.still === null && speed < 1 && b.angularVelocity.length() < 0.5) s.still = t;
      else if (speed >= 1) s.still = null;
      s.decel.push(speed);
    });
    if (st.every((s) => s.still !== null && t - s.still > 0.3)) break;
  }
  return st.map((s, i) => {
    // Prudkost zastavení: za jak dlouho kostka spadne z 30 % své rychlosti po posledním dopadu na nulu.
    const sp = s.decel;
    const stopAt = s.still ?? t;
    const idx = Math.max(0, Math.round(stopAt / STEP) - 1);
    let j = idx;
    const ref = Math.max(...sp.slice(Math.max(0, idx - Math.round(0.6 / STEP)), idx + 1));
    while (j > 0 && sp[j] < ref * 0.3) j--;
    return {
      type: ctx3.dice[i].type,
      let_s: s.firstHit === null ? null : +s.firstHit.toFixed(2),
      odskoky: s.bounces,
      překulení: +(s.rot / (Math.PI / 2)).toFixed(1),
      dráha_cm: Math.round(s.dist * UNIT_M * 100),
      klid_s: +(s.still ?? t).toFixed(2),
      dobrzdění_s: +((idx - j) * STEP).toFixed(2),
    };
  });
}

/** Krok fyziky o dané sekundy (bez vyhodnocení) a stav kostek – pro ladění usínání. */
export function _probe(seconds) {
  cancelAnimationFrame(ctx3.raf);
  for (let t = 0; t < seconds; t += STEP) ctx3.world.step(STEP);
  return ctx3.dice.map((d) => ({
    type: d.type,
    v: +d.body.velocity.length().toFixed(2),
    w: +d.body.angularVelocity.length().toFixed(2),
    sleep: d.body.sleepState,
    flat: +readDie(d).flat.toFixed(3),
    y: +d.body.position.y.toFixed(2),
  }));
}

/** Odsimuluje rozběhnutý hod bez animace; vrací čas do klidu, počet ťuknutí a jak rovně kostky leží. */
export function _settleNow() {
  let t = 0;
  while (!advance(1 / 60)) t += 1 / 60;
  sync();
  ctx3.renderer.render(ctx3.scene, ctx3.camera);
  const info = { seconds: +t.toFixed(2), nudges: ctx3.sim.nudges, dice: ctx3.dice.map((d) => ({ type: d.tens ? 'd10(desítky)' : d.type, ...readDie(d), y: +d.body.position.y.toFixed(2), x: +d.body.position.x.toFixed(1), z: +d.body.position.z.toFixed(1) })), half: ctx3.half };
  cancelAnimationFrame(ctx3.raf);
  finish(ctx3.sim.groups);
  return info;
}
