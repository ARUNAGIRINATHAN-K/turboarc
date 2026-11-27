import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CAR_SPECS, CarSpec, CarState } from './physics';
import { SeededRNG } from './rng';
import { CIRCUIT } from './track';

export type CameraMode = 'chase' | 'cockpit';

interface CarVisual {
  root: THREE.Group;
  body: THREE.Group;
  frontLeftKnuckle: THREE.Group;
  frontRightKnuckle: THREE.Group;
  wheels: THREE.Group[];
  brakeMat: THREE.MeshStandardMaterial;
  steeringWheel: THREE.Group;
  cockpitHood: THREE.Object3D;
  nameplate: THREE.Sprite;
  flames: THREE.Mesh[];
  playerOutline?: THREE.Mesh;
}

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
  baseScale: number;
  rotSpeed: number;
}

const _tmpMat4 = new THREE.Matrix4();
const _tmpPos = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpScale = new THREE.Vector3();
const _tmpEuler = new THREE.Euler();
const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _colorA = new THREE.Color();
const _colorB = new THREE.Color();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createAsphaltTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#292d34';
  ctx.fillRect(0, 0, 512, 512);

  const rng = new SeededRNG(9001);
  for (let i = 0; i < 16000; i++) {
    const x = rng.next() * 512;
    const y = rng.next() * 512;
    const v = 34 + Math.floor(rng.next() * 34);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    ctx.fillRect(x, y, 2, 2);
  }

  const groove = ctx.createLinearGradient(0, 0, 512, 0);
  groove.addColorStop(0, 'rgba(0,0,0,0.18)');
  groove.addColorStop(0.15, 'rgba(0,0,0,0.0)');
  groove.addColorStop(0.5, 'rgba(0,0,0,0.12)');
  groove.addColorStop(0.85, 'rgba(0,0,0,0.0)');
  groove.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = groove;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(14, 0, 10, 512);
  ctx.fillRect(488, 0, 10, 512);

  ctx.fillStyle = 'rgba(226,232,240,0.34)';
  ctx.fillRect(253, 40, 6, 176);
  ctx.fillRect(253, 296, 6, 176);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createGrassTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#386b35';
  ctx.fillRect(0, 0, 512, 512);

  const rng = new SeededRNG(4242);
  for (let i = 0; i < 14000; i++) {
    const x = rng.next() * 512;
    const y = rng.next() * 512;
    const g = 86 + Math.floor(rng.next() * 44);
    const r = Math.floor(g * 0.55);
    const b = Math.floor(g * 0.43);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, 3, 3);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let y = 0; y < 512; y += 64) {
    ctx.fillRect(0, y, 512, 32);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createCheckeredTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const size = 16;
  for (let y = 0; y < 64; y += size) {
    for (let x = 0; x < 256; x += size) {
      const dark = ((x / size + y / size) % 2) === 0;
      ctx.fillStyle = dark ? '#111827' : '#f8fafc';
      ctx.fillRect(x, y, size, size);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createSignTexture(title: string, bg: string, fg: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 128);

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 18, 128);
  ctx.fillRect(238, 0, 18, 128);

  ctx.strokeStyle = fg;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 244, 116);

  ctx.fillStyle = fg;
  let fontSize = 56;
  ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
  while (fontSize > 22 && ctx.measureText(title).width > 202) {
    fontSize -= 4;
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 128, 66, 204);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createLiveryPanelTexture(spec: CarSpec): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = spec.color;
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = spec.accent;
  if (spec.roofPattern === 'chevron') {
    ctx.beginPath();
    ctx.moveTo(28, 220);
    ctx.lineTo(128, 150);
    ctx.lineTo(228, 220);
    ctx.lineTo(228, 185);
    ctx.lineTo(128, 115);
    ctx.lineTo(28, 185);
    ctx.closePath();
    ctx.fill();
  } else if (spec.roofPattern === 'stripes') {
    ctx.fillRect(70, 0, 32, 256);
    ctx.fillRect(154, 0, 32, 256);
  } else if (spec.roofPattern === 'twin') {
    ctx.fillRect(92, 0, 26, 256);
    ctx.fillRect(138, 0, 26, 256);
  } else if (spec.roofPattern === 'cross') {
    ctx.fillRect(108, 0, 40, 256);
    ctx.fillRect(0, 108, 256, 40);
  } else if (spec.roofPattern === 'diamond') {
    ctx.beginPath();
    ctx.moveTo(128, 24);
    ctx.lineTo(224, 128);
    ctx.lineTo(128, 232);
    ctx.lineTo(32, 128);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(128, 16);
    ctx.lineTo(220, 230);
    ctx.lineTo(128, 185);
    ctx.lineTo(36, 230);
    ctx.closePath();
    ctx.fill();
  }

  // Large high-contrast racing number plaque
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(54, 64, 148, 128, 14);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 84px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.number, 128, 130);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createNameplateTexture(spec: CarSpec): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(10, 14, 22, 0.86)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 48, 10);
  ctx.fill();

  ctx.strokeStyle = spec.color;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Color swatch + number + symbol + name
  ctx.fillStyle = spec.color;
  ctx.fillRect(16, 16, 12, 32);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 23px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${spec.number} ${spec.symbol} ${spec.name}`, 36, 33);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSkyDome(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#1e4e8c');
  grad.addColorStop(0.38, '#5394d4');
  grad.addColorStop(0.56, '#b8d9f2');
  grad.addColorStop(0.66, '#f6e2c4');
  grad.addColorStop(1.0, '#7c9a6d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.SphereGeometry(1200, 24, 16);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -10;
  return dome;
}

export class RacingRenderer3D {
  readonly isSoftwareGl: boolean;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly container: HTMLElement;

  cameraMode: CameraMode = 'chase';
  racingLineEnabled = true;
  cameraShakeEnabled = true;
  fxEnabled = true;

  private carVisuals: CarVisual[] = [];
  private gantryLights: THREE.MeshStandardMaterial[] = [];
  private racingLineMesh!: THREE.Mesh;
  private crowdMeshes: Array<{ mesh: THREE.Mesh; baseY: number; phase: number }> = [];
  private contactShadowTex: THREE.CanvasTexture;

  // Pooled particle systems
  private smokeMesh: THREE.InstancedMesh;
  private smokePool: PooledParticle[] = [];
  private smokeCursor = 0;

  private dustMesh: THREE.InstancedMesh;
  private dustPool: PooledParticle[] = [];
  private dustCursor = 0;

  private sparkMesh: THREE.InstancedMesh;
  private sparkPool: PooledParticle[] = [];
  private sparkCursor = 0;

  private streakMesh: THREE.InstancedMesh;
  private streakPool: PooledParticle[] = [];
  private streakCursor = 0;

  private confettiMesh: THREE.InstancedMesh;
  private confettiPool: PooledParticle[] = [];
  private confettiTriggered = false;

  private skidMesh: THREE.InstancedMesh;
  private skidCursor = 0;
  private prevRearWheelPos: Array<{ lx: number; lz: number; rx: number; rz: number; valid: boolean }> = [];

  private camPosInitialized = false;
  private currentLookAt = new THREE.Vector3();
  private cameraTrauma = 0;
  private titleOrbitAngle = 0;
  private animClock = 0;
  private frameId = 0;
  private disposed = false;

  private disposables: Array<{ dispose(): void }> = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#c8dff2');
    this.scene.fog = new THREE.FogExp2('#c8dff2', 0.0014);

    const aspect = (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight || 1);
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.2, 1600);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.disposables.push(envTex);
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight('#9ed0ff', '#3a5724', 0.95);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fff1d0', 2.2);
    sun.position.set(180, 220, 120);
    if (!this.isSoftwareGl) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 20;
      sun.shadow.camera.far = 700;
      sun.shadow.camera.left = -280;
      sun.shadow.camera.right = 280;
      sun.shadow.camera.top = 280;
      sun.shadow.camera.bottom = -280;
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.02;
    }
    this.scene.add(sun);

    this.scene.add(createSkyDome());
    this.contactShadowTex = createContactShadowTexture();
    this.disposables.push(this.contactShadowTex);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.buildTerrain(maxAniso);
    this.buildCircuitGeometry(maxAniso);
    this.buildDynamicRacingLine();
    this.buildTrackSignageAndCheckpoints();
    this.buildStartGantry(maxAniso);
    this.buildGrandstands();
    this.buildTreesAndLandmarks();
    this.buildCars();

    // 1. Tyre Smoke Pool
    const smokeGeo = new THREE.SphereGeometry(0.45, 8, 6);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.95,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.smokeMesh = this.initPool(smokeGeo, smokeMat, 220, this.smokePool);

    // 2. Grass / Dust Pool
    const dustGeo = new THREE.DodecahedronGeometry(0.32, 0);
    const dustMat = new THREE.MeshStandardMaterial({
      color: '#9ca36f',
      roughness: 0.95,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    this.dustMesh = this.initPool(dustGeo, dustMat, 120, this.dustPool);

    // 3. Collision Sparks Pool
    const sparkGeo = new THREE.BoxGeometry(0.14, 0.14, 0.42);
    const sparkMat = new THREE.MeshBasicMaterial({ color: '#fbbf24' });
    this.sparkMesh = this.initPool(sparkGeo, sparkMat, 140, this.sparkPool);

    // 4. Nitro Boost Speed Streaks Pool
    const streakGeo = new THREE.BoxGeometry(0.08, 0.08, 1.4);
    const streakMat = new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    this.streakMesh = this.initPool(streakGeo, streakMat, 100, this.streakPool);

    // 5. Podium Confetti Pool
    const confGeo = new THREE.PlaneGeometry(0.35, 0.2);
    const confMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    this.confettiMesh = this.initPool(confGeo, confMat, 180, this.confettiPool);
    const confColors = ['#06b6d4', '#ef4444', '#facc15', '#84cc16', '#a855f7', '#f97316'];
    const cTmp = new THREE.Color();
    for (let i = 0; i < 180; i++) {
      cTmp.set(confColors[i % confColors.length]);
      this.confettiMesh.setColorAt(i, cTmp);
    }

    // 6. Persistent Skid Marks Pool
    const skidGeo = new THREE.PlaneGeometry(0.38, 1.35);
    skidGeo.rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({
      color: '#111317',
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, 640);
    this.skidMesh.frustumCulled = false;
    for (let i = 0; i < 640; i++) {
      _tmpMat4.makeScale(0, 0, 0);
      this.skidMesh.setMatrixAt(i, _tmpMat4);
    }
    this.scene.add(this.skidMesh);
    this.disposables.push(skidGeo, skidMat);

    for (let i = 0; i < 6; i++) {
      this.prevRearWheelPos.push({ lx: 0, lz: 0, rx: 0, rz: 0, valid: false });
    }

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  private initPool(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    count: number,
    pool: PooledParticle[]
  ): THREE.InstancedMesh {
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      pool.push({
        active: false,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        maxAge: 0.7,
        baseScale: 1,
        rotSpeed: 0,
      });
      _tmpMat4.makeScale(0, 0, 0);
      inst.setMatrixAt(i, _tmpMat4);
    }
    this.scene.add(inst);
    this.disposables.push(geo, mat);
    return inst;
  }

  private buildTerrain(maxAniso: number): void {
    const grassTex = createGrassTexture(maxAniso);
    const groundGeo = new THREE.PlaneGeometry(1800, 1800, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      map: grassTex,
      color: '#ffffff',
      roughness: 0.92,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(200, -0.08, 20);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const hillGeo = new THREE.ConeGeometry(1, 1, 16);
    const hillMat = new THREE.MeshStandardMaterial({ color: '#3b6438', roughness: 0.95, metalness: 0.0 });
    const hillCoords: ReadonlyArray<[number, number, number, number]> = [
      [-280, -340, 160, 42],
      [620, -290, 190, 55],
      [680, 260, 210, 60],
      [-240, 380, 175, 48],
      [210, 460, 160, 38],
      [190, -410, 185, 50],
    ];
    for (const [hx, hz, rad, h] of hillCoords) {
      const m = new THREE.Mesh(hillGeo, hillMat);
      m.position.set(hx, h * 0.45 - 0.5, hz);
      m.scale.set(rad, h, rad);
      this.scene.add(m);
    }

    const samples = CIRCUIT.samples;
    const n = samples.length;
    const shoulderW = CIRCUIT.barrierHalfWidth + 1.8;
    const shPos = new Float32Array((n + 1) * 2 * 3);
    const shIdx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = samples[i % n];
      const base = i * 6;
      shPos[base] = s.x - s.rx * shoulderW;
      shPos[base + 1] = -0.035;
      shPos[base + 2] = s.z - s.rz * shoulderW;
      shPos[base + 3] = s.x + s.rx * shoulderW;
      shPos[base + 4] = -0.035;
      shPos[base + 5] = s.z + s.rz * shoulderW;
      if (i < n) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        shIdx.push(a, b, c, b, d, c);
      }
    }
    const shGeo = new THREE.BufferGeometry();
    shGeo.setAttribute('position', new THREE.BufferAttribute(shPos, 3));
    shGeo.setIndex(shIdx);
    shGeo.computeVertexNormals();
    const shMat = new THREE.MeshStandardMaterial({ color: '#6b6560', roughness: 0.95, metalness: 0.0 });
    const shMesh = new THREE.Mesh(shGeo, shMat);
    shMesh.receiveShadow = true;
    this.scene.add(shMesh);

    this.disposables.push(grassTex, groundGeo, groundMat, hillGeo, hillMat, shGeo, shMat);
  }

  private buildCircuitGeometry(maxAniso: number): void {
    const samples = CIRCUIT.samples;
    const n = samples.length;
    const roadW = CIRCUIT.roadHalfWidth;

    const pos = new Float32Array((n + 1) * 2 * 3);
    const uv = new Float32Array((n + 1) * 2 * 2);
    const indices: number[] = [];
    let accV = 0;

    for (let i = 0; i <= n; i++) {
      const s = samples[i % n];
      if (i > 0) {
        const prev = samples[(i - 1) % n];
        accV += Math.hypot(s.x - prev.x, s.z - prev.z) / 14;
      }
      const pBase = i * 6;
      pos[pBase] = s.x - s.rx * roadW;
      pos[pBase + 1] = 0.0;
      pos[pBase + 2] = s.z - s.rz * roadW;
      pos[pBase + 3] = s.x + s.rx * roadW;
      pos[pBase + 4] = 0.0;
      pos[pBase + 5] = s.z + s.rz * roadW;

      const uBase = i * 4;
      uv[uBase] = 0;
      uv[uBase + 1] = accV;
      uv[uBase + 2] = 1;
      uv[uBase + 3] = accV;

      if (i < n) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    roadGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    roadGeo.setIndex(indices);
    roadGeo.computeVertexNormals();

    const asphaltTex = createAsphaltTexture(maxAniso);
    const roadMat = new THREE.MeshStandardMaterial({
      map: asphaltTex,
      color: '#ffffff',
      roughness: 0.85,
      metalness: 0.05,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);

    // Red & White Corner Kerbs
    const kerbGeo = new THREE.BoxGeometry(CIRCUIT.kerbWidth, 0.07, 2.55);
    const kerbMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, metalness: 0.05 });
    const kerbMatrices: Array<{ mat: THREE.Matrix4; red: boolean }> = [];
    const kerbColorRed = new THREE.Color('#dc2626');
    const kerbColorWhite = new THREE.Color('#f8fafc');

    for (let i = 0; i < n; i++) {
      const s = samples[i];
      if (Math.abs(s.curvature) > 0.0038) {
        const yaw = Math.atan2(s.tx, s.tz);
        _tmpEuler.set(0, yaw, 0);
        _tmpQuat.setFromEuler(_tmpEuler);
        _tmpScale.set(1, 1, 1);

        for (const side of [-1, 1]) {
          const offset = side * (roadW + CIRCUIT.kerbWidth * 0.45);
          _tmpPos.set(s.x + s.rx * offset, 0.025, s.z + s.rz * offset);
          const m = new THREE.Matrix4().compose(_tmpPos, _tmpQuat, _tmpScale);
          kerbMatrices.push({ mat: m, red: i % 2 === 0 });
        }
      }
    }

    if (kerbMatrices.length > 0) {
      const kerbInst = new THREE.InstancedMesh(kerbGeo, kerbMat, kerbMatrices.length);
      kerbInst.receiveShadow = true;
      for (let i = 0; i < kerbMatrices.length; i++) {
        kerbInst.setMatrixAt(i, kerbMatrices[i].mat);
        kerbInst.setColorAt(i, kerbMatrices[i].red ? kerbColorRed : kerbColorWhite);
      }
      kerbInst.computeBoundingSphere();
      this.scene.add(kerbInst);
    }

    // Armco Barriers
    const barrierGeo = this.buildBarrierRibbon(samples, CIRCUIT.barrierHalfWidth);
    const barrierMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      roughness: 0.35,
      metalness: 0.75,
      side: THREE.DoubleSide,
    });
    const barrierMesh = new THREE.Mesh(barrierGeo, barrierMat);
    barrierMesh.castShadow = !this.isSoftwareGl;
    barrierMesh.receiveShadow = true;
    this.scene.add(barrierMesh);

    const railStripeGeo = this.buildBarrierStripe(samples, CIRCUIT.barrierHalfWidth);
    const railStripeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.48,
      metalness: 0.25,
      side: THREE.DoubleSide,
    });
    const railStripeMesh = new THREE.Mesh(railStripeGeo, railStripeMat);
    this.scene.add(railStripeMesh);

    const postGeo = new THREE.BoxGeometry(0.16, 1.05, 0.16);
    const postMat = new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.55, metalness: 0.7 });
    const postMatrices: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i += 4) {
      const s = samples[i];
      const yaw = Math.atan2(s.tx, s.tz);
      _tmpEuler.set(0, yaw, 0);
      _tmpQuat.setFromEuler(_tmpEuler);
      _tmpScale.set(1, 1, 1);
      for (const side of [-1, 1]) {
        const dist = CIRCUIT.barrierHalfWidth + 0.18;
        _tmpPos.set(s.x + s.rx * side * dist, 0.52, s.z + s.rz * side * dist);
        postMatrices.push(new THREE.Matrix4().compose(_tmpPos, _tmpQuat, _tmpScale));
      }
    }
    const postInst = new THREE.InstancedMesh(postGeo, postMat, postMatrices.length);
    for (let i = 0; i < postMatrices.length; i++) postInst.setMatrixAt(i, postMatrices[i]);
    postInst.computeBoundingSphere();
    this.scene.add(postInst);

    const chevGeo = new THREE.BoxGeometry(0.15, 0.9, 2.2);
    const chevMat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.45, metalness: 0.15 });
    const chevMats: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i += 5) {
      const s = samples[i];
      if (Math.abs(s.curvature) > 0.011) {
        const outerSide = s.curvature > 0 ? -1 : 1;
        const yaw = Math.atan2(s.tx, s.tz);
        _tmpEuler.set(0, yaw, 0);
        _tmpQuat.setFromEuler(_tmpEuler);
        _tmpScale.set(1, 1, 1);
        _tmpPos.set(
          s.x + s.rx * outerSide * (CIRCUIT.barrierHalfWidth + 0.25),
          1.45,
          s.z + s.rz * outerSide * (CIRCUIT.barrierHalfWidth + 0.25)
        );
        chevMats.push(new THREE.Matrix4().compose(_tmpPos, _tmpQuat, _tmpScale));
      }
    }
    if (chevMats.length > 0) {
      const chevInst = new THREE.InstancedMesh(chevGeo, chevMat, chevMats.length);
      for (let i = 0; i < chevMats.length; i++) chevInst.setMatrixAt(i, chevMats[i]);
      chevInst.computeBoundingSphere();
      this.scene.add(chevInst);
    }

    this.disposables.push(
      asphaltTex,
      roadGeo,
      roadMat,
      kerbGeo,
      kerbMat,
      barrierGeo,
      barrierMat,
      railStripeGeo,
      railStripeMat,
      postGeo,
      postMat,
      chevGeo,
      chevMat
    );
  }

  /**
   * Build the dynamic Green -> Yellow -> Red racing guide ribbon directly on the asphalt.
   */
  private buildDynamicRacingLine(): void {
    const samples = CIRCUIT.samples;
    const n = samples.length;
    const halfGuideW = 0.65;

    const pos = new Float32Array((n + 1) * 2 * 3);
    const cols = new Float32Array((n + 1) * 2 * 3);
    const indices: number[] = [];

    const cGreen = new THREE.Color('#22c55e');
    const cYellow = new THREE.Color('#eab308');
    const cRed = new THREE.Color('#ef4444');

    for (let i = 0; i <= n; i++) {
      const s = samples[i % n];
      const cx = s.x + s.rx * s.racingOffset;
      const cz = s.z + s.rz * s.racingOffset;

      const pBase = i * 6;
      pos[pBase] = cx - s.rx * halfGuideW;
      pos[pBase + 1] = 0.028;
      pos[pBase + 2] = cz - s.rz * halfGuideW;
      pos[pBase + 3] = cx + s.rx * halfGuideW;
      pos[pBase + 4] = 0.028;
      pos[pBase + 5] = cz + s.rz * halfGuideW;

      const b = s.brakingZone;
      if (b < 0.45) {
        _colorA.copy(cGreen).lerp(cYellow, b / 0.45);
      } else {
        _colorA.copy(cYellow).lerp(cRed, (b - 0.45) / 0.55);
      }

      cols[pBase] = _colorA.r;
      cols[pBase + 1] = _colorA.g;
      cols[pBase + 2] = _colorA.b;
      cols[pBase + 3] = _colorA.r;
      cols[pBase + 4] = _colorA.g;
      cols[pBase + 5] = _colorA.b;

      if (i < n) {
        const a = i * 2;
        const bIdx = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, bIdx, c, bIdx, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.racingLineMesh = new THREE.Mesh(geo, mat);
    this.racingLineMesh.visible = this.racingLineEnabled;
    this.scene.add(this.racingLineMesh);
    this.disposables.push(geo, mat);
  }

  /**
   * Build 150m/100m/50m braking boards, numbered corner signs (T1..T6),
   * sector checkpoint markers, and trackside sponsor billboards.
   */
  private buildTrackSignageAndCheckpoints(): void {
    const postGeo = new THREE.BoxGeometry(0.14, 2.2, 0.14);
    const postMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.6, metalness: 0.6 });
    const boardGeo = new THREE.PlaneGeometry(2.6, 1.3);
    const adGeo = new THREE.PlaneGeometry(7.2, 2.1);

    const placeSign = (sPos: number, side: number, tex: THREE.CanvasTexture, isLargeAd: boolean) => {
      const smp = CIRCUIT.sampleAtS(sPos);
      const yaw = Math.atan2(smp.tx, smp.tz);
      const dist = CIRCUIT.barrierHalfWidth + (isLargeAd ? 1.8 : 0.9);
      const grp = new THREE.Group();
      grp.position.set(smp.x + smp.rx * side * dist, 0, smp.z + smp.rz * side * dist);
      // Face oncoming drivers (-tangent)
      grp.rotation.y = yaw + Math.PI;

      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.45,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      this.disposables.push(tex, mat);

      if (isLargeAd) {
        const pL = new THREE.Mesh(postGeo, postMat);
        pL.position.set(-2.6, 1.4, 0);
        const pR = new THREE.Mesh(postGeo, postMat);
        pR.position.set(2.6, 1.4, 0);
        const face = new THREE.Mesh(adGeo, mat);
        face.position.set(0, 2.35, 0);
        grp.add(pL, pR, face);
      } else {
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set(0, 1.1, 0);
        const face = new THREE.Mesh(boardGeo, mat);
        face.position.set(0, 2.15, 0);
        grp.add(p, face);
      }
      this.scene.add(grp);
    };

    // Corner apex signs + 150m/100m/50m braking boards
    for (const c of CIRCUIT.corners) {
      placeSign(c.apexS, c.side, createSignTexture(c.label, '#0f172a', '#f8fafc', '#06b6d4'), false);
      if (c.hasDistanceBoards) {
        placeSign(CIRCUIT.wrapS(c.apexS - 150), c.side, createSignTexture('150m', '#f8fafc', '#111827', '#22c55e'), false);
        placeSign(CIRCUIT.wrapS(c.apexS - 100), c.side, createSignTexture('100m', '#facc15', '#111827', '#111827'), false);
        placeSign(CIRCUIT.wrapS(c.apexS - 50), c.side, createSignTexture('50m', '#ef4444', '#ffffff', '#111827'), false);
      }
    }

    // Trackside Sponsor Billboards
    const ads: ReadonlyArray<[number, number, string, string, string, string]> = [
      [80, -1, 'APEX GP', '#0f172a', '#f8fafc', '#06b6d4'],
      [340, 1, 'TURBO X', '#1e1b4b', '#fde047', '#f97316'],
      [610, -1, 'VECTOR', '#18181b', '#ffffff', '#ef4444'],
      [960, 1, 'NITRO +', '#064e3b', '#ecfdf5', '#84cc16'],
      [1260, -1, 'CHRONO', '#111827', '#f8fafc', '#a855f7'],
    ];
    for (const [sPos, side, label, bg, fg, acc] of ads) {
      placeSign(sPos, side, createSignTexture(label, bg, fg, acc), true);
    }

    // Sector 1 & Sector 2 Checkpoint Timing Pylons
    const secMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      emissive: '#06b6d4',
      emissiveIntensity: 0.75,
      roughness: 0.3,
    });
    const secPylonGeo = new THREE.BoxGeometry(0.55, 4.6, 0.55);
    const secLineGeo = new THREE.PlaneGeometry(CIRCUIT.roadHalfWidth * 2, 0.65);
    secLineGeo.rotateX(-Math.PI / 2);
    const secLineMat = new THREE.MeshBasicMaterial({
      color: '#06b6d4',
      transparent: true,
      opacity: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });

    for (let i = 0; i < 2; i++) {
      const sPos = CIRCUIT.sectorLengths[i];
      const smp = CIRCUIT.sampleAtS(sPos);
      const yaw = Math.atan2(smp.tx, smp.tz);

      const line = new THREE.Mesh(secLineGeo, secLineMat);
      line.position.set(smp.x, 0.024, smp.z);
      line.rotation.y = yaw;
      this.scene.add(line);

      for (const side of [-1, 1]) {
        const pylon = new THREE.Mesh(secPylonGeo, secMat);
        pylon.position.set(
          smp.x + smp.rx * side * (CIRCUIT.barrierHalfWidth + 0.55),
          2.3,
          smp.z + smp.rz * side * (CIRCUIT.barrierHalfWidth + 0.55)
        );
        this.scene.add(pylon);
      }
    }

    this.disposables.push(postGeo, postMat, boardGeo, adGeo, secMat, secPylonGeo, secLineGeo, secLineMat);
  }

  private buildBarrierRibbon(samples: typeof CIRCUIT.samples, offsetDist: number): THREE.BufferGeometry {
    const n = samples.length;
    const verts: number[] = [];
    const idx: number[] = [];
    let vCount = 0;

    for (const side of [-1, 1]) {
      const startV = vCount;
      for (let i = 0; i <= n; i++) {
        const s = samples[i % n];
        const bx = s.x + s.rx * side * offsetDist;
        const bz = s.z + s.rz * side * offsetDist;
        verts.push(bx, 0.25, bz);
        verts.push(bx, 0.92, bz);
        if (i < n) {
          const a = startV + i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          idx.push(a, b, c, b, d, c);
        }
        vCount += 2;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  private buildBarrierStripe(samples: typeof CIRCUIT.samples, offsetDist: number): THREE.BufferGeometry {
    const n = samples.length;
    const verts: number[] = [];
    const colors: number[] = [];
    const idx: number[] = [];
    let vCount = 0;

    for (const side of [-1, 1]) {
      const startV = vCount;
      for (let i = 0; i <= n; i++) {
        const s = samples[i % n];
        const bx = s.x + s.rx * side * (offsetDist - side * 0.04);
        const bz = s.z + s.rz * side * (offsetDist - side * 0.04);
        const isRed = Math.floor(i / 2) % 2 === 0;
        const r = isRed ? 0.88 : 0.96;
        const g = isRed ? 0.16 : 0.97;
        const b = isRed ? 0.16 : 0.98;

        verts.push(bx, 0.92, bz);
        verts.push(bx, 1.08, bz);
        colors.push(r, g, b, r, g, b);

        if (i < n) {
          const a = startV + i * 2;
          const bb = a + 1;
          const c = a + 2;
          const d = a + 3;
          idx.push(a, bb, c, bb, d, c);
        }
        vCount += 2;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  private buildStartGantry(maxAniso: number): void {
    const s0 = CIRCUIT.sampleAtS(0);
    const yaw = Math.atan2(s0.tx, s0.tz);

    const checkTex = createCheckeredTexture(maxAniso);
    checkTex.repeat.set(4, 1);
    const lineGeo = new THREE.PlaneGeometry(CIRCUIT.roadHalfWidth * 2, 3.0);
    lineGeo.rotateX(-Math.PI / 2);
    const lineMat = new THREE.MeshStandardMaterial({
      map: checkTex,
      color: '#ffffff',
      roughness: 0.78,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const lineMesh = new THREE.Mesh(lineGeo, lineMat);
    lineMesh.position.set(s0.x, 0.02, s0.z);
    lineMesh.rotation.y = yaw;
    lineMesh.receiveShadow = true;
    this.scene.add(lineMesh);

    const boxMat = new THREE.MeshBasicMaterial({
      color: '#f8fafc',
      transparent: true,
      opacity: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const barSideGeo = new THREE.PlaneGeometry(0.18, 3.6);
    barSideGeo.rotateX(-Math.PI / 2);
    const barFrontGeo = new THREE.PlaneGeometry(2.6, 0.22);
    barFrontGeo.rotateX(-Math.PI / 2);

    for (let slot = 0; slot < 6; slot++) {
      const row = Math.floor(slot / 2);
      const col = slot % 2;
      const sBack = 14 + row * 10.5 + col * 3.0;
      const lat = col === 0 ? -3.4 : 3.4;
      const smp = CIRCUIT.sampleAtS(CIRCUIT.totalLength - sBack);
      const gx = smp.x + smp.rx * lat;
      const gz = smp.z + smp.rz * lat;
      const gyaw = Math.atan2(smp.tx, smp.tz);

      const gridGrp = new THREE.Group();
      gridGrp.position.set(gx, 0.02, gz);
      gridGrp.rotation.y = gyaw;

      const front = new THREE.Mesh(barFrontGeo, boxMat);
      front.position.set(0, 0, 2.3);
      const left = new THREE.Mesh(barSideGeo, boxMat);
      left.position.set(-1.25, 0, 0.6);
      const right = new THREE.Mesh(barSideGeo, boxMat);
      right.position.set(1.25, 0, 0.6);
      gridGrp.add(front, left, right);
      this.scene.add(gridGrp);
    }

    // Pit Paddock Garage Structures alongside the Start/Finish straight (+right side)
    const pitGeo = new THREE.BoxGeometry(8, 5.2, 54);
    const pitMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.55, metalness: 0.35 });
    const pitTrimMat = new THREE.MeshStandardMaterial({ color: '#06b6d4', roughness: 0.35, metalness: 0.4 });
    const pitSmp = CIRCUIT.sampleAtS(CIRCUIT.totalLength - 26);
    const pitGroup = new THREE.Group();
    pitGroup.position.set(
      pitSmp.x + pitSmp.rx * (CIRCUIT.barrierHalfWidth + 8.5),
      0,
      pitSmp.z + pitSmp.rz * (CIRCUIT.barrierHalfWidth + 8.5)
    );
    pitGroup.rotation.y = Math.atan2(pitSmp.tx, pitSmp.tz);
    const pitBuilding = new THREE.Mesh(pitGeo, pitMat);
    pitBuilding.position.set(0, 2.6, 0);
    pitBuilding.castShadow = !this.isSoftwareGl;
    const pitFascia = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.55, 54.4), pitTrimMat);
    pitFascia.position.set(0, 5.1, 0);
    pitGroup.add(pitBuilding, pitFascia);
    this.scene.add(pitGroup);

    // Overhead Start/Finish Steel Gantry Bridge
    const gantry = new THREE.Group();
    gantry.position.set(s0.x, 0, s0.z);
    gantry.rotation.y = yaw;

    const steelMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.4, metalness: 0.75 });
    const trimMat = new THREE.MeshStandardMaterial({ color: '#06b6d4', roughness: 0.35, metalness: 0.4 });
    const pillarGeo = new THREE.BoxGeometry(0.9, 7.6, 0.9);
    const spanW = CIRCUIT.barrierHalfWidth * 2 + 1.6;

    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, steelMat);
      pillar.position.set(side * (CIRCUIT.barrierHalfWidth + 0.6), 3.8, 0);
      pillar.castShadow = !this.isSoftwareGl;
      gantry.add(pillar);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 1.5), trimMat);
      foot.position.set(side * (CIRCUIT.barrierHalfWidth + 0.6), 0.3, 0);
      gantry.add(foot);
    }

    const beamGeo = new THREE.BoxGeometry(spanW, 1.45, 1.2);
    const beam = new THREE.Mesh(beamGeo, steelMat);
    beam.position.set(0, 7.2, 0);
    beam.castShadow = !this.isSoftwareGl;
    gantry.add(beam);

    const bannerGeo = new THREE.PlaneGeometry(16, 1.25);
    const bannerMat = new THREE.MeshStandardMaterial({ map: checkTex, color: '#ffffff', roughness: 0.5 });
    const bannerFront = new THREE.Mesh(bannerGeo, bannerMat);
    bannerFront.position.set(0, 7.2, -0.62);
    bannerFront.rotation.y = Math.PI;
    const bannerBack = new THREE.Mesh(bannerGeo, bannerMat);
    bannerBack.position.set(0, 7.2, 0.62);
    gantry.add(bannerFront, bannerBack);

    // Timing board sign on gantry
    const timingTex = createSignTexture('START / FINISH', '#090d14', '#22c55e', '#06b6d4');
    const timingMat = new THREE.MeshBasicMaterial({ map: timingTex });
    const timingSign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.75), timingMat);
    timingSign.position.set(0, 8.85, -0.62);
    timingSign.rotation.y = Math.PI;
    gantry.add(timingSign);

    const podHousing = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.9, 0.35), steelMat);
    podHousing.position.set(0, 6.0, -0.65);
    gantry.add(podHousing);

    const lightGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.22, 16);
    lightGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const lMat = new THREE.MeshStandardMaterial({
        color: '#220909',
        emissive: '#ef4444',
        emissiveIntensity: 0.15,
        roughness: 0.2,
      });
      this.gantryLights.push(lMat);
      const bulb = new THREE.Mesh(lightGeo, lMat);
      bulb.position.set((i - 1) * 1.55, 6.0, -0.82);
      gantry.add(bulb);
    }

    this.scene.add(gantry);
    this.disposables.push(
      checkTex,
      lineGeo,
      lineMat,
      boxMat,
      barSideGeo,
      barFrontGeo,
      pitGeo,
      pitMat,
      pitTrimMat,
      steelMat,
      trimMat,
      pillarGeo,
      beamGeo,
      bannerGeo,
      bannerMat,
      timingTex,
      timingMat,
      lightGeo
    );
  }

  private buildGrandstands(): void {
    const concreteMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.85, metalness: 0.05 });
    const steelMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.45, metalness: 0.7 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.4, metalness: 0.2 });
    const seatPalette = ['#06b6d4', '#ef4444', '#facc15', '#84cc16', '#a855f7'];

    const placements: ReadonlyArray<{ s: number; side: number; len: number }> = [
      { s: CIRCUIT.totalLength - 35, side: -1, len: 48 },
      { s: 55, side: 1, len: 42 },
      { s: 730, side: 1, len: 36 },
    ];

    for (const p of placements) {
      const smp = CIRCUIT.sampleAtS(p.s);
      const yaw = Math.atan2(smp.tx, smp.tz);
      const dist = CIRCUIT.barrierHalfWidth + 9.5;

      const stand = new THREE.Group();
      stand.position.set(smp.x + smp.rx * p.side * dist, 0, smp.z + smp.rz * p.side * dist);
      stand.rotation.y = yaw + (p.side > 0 ? Math.PI : 0);

      const base = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, p.len), concreteMat);
      base.position.set(0, 0.6, 0);
      stand.add(base);

      for (let tier = 0; tier < 5; tier++) {
        const tierMesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, p.len - 1.2), concreteMat);
        tierMesh.position.set(-3.4 + tier * 1.65, 1.5 + tier * 0.9, 0);
        tierMesh.castShadow = !this.isSoftwareGl;
        tierMesh.receiveShadow = true;
        stand.add(tierMesh);

        // Animated cheering spectator blocks
        const specMat = new THREE.MeshStandardMaterial({
          color: seatPalette[tier % seatPalette.length],
          roughness: 0.75,
        });
        for (let seg = -2; seg <= 2; seg++) {
          const specBlock = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.62, (p.len - 5) / 5.5), specMat);
          const baseY = 2.15 + tier * 0.9;
          specBlock.position.set(-3.4 + tier * 1.65, baseY, seg * ((p.len - 4) / 5));
          stand.add(specBlock);
          this.crowdMeshes.push({ mesh: specBlock, baseY, phase: tier * 0.9 + seg * 1.3 });
        }
        this.disposables.push(specMat);
      }

      for (const zOff of [-p.len * 0.42, 0, p.len * 0.42]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 9.2, 0.45), steelMat);
        post.position.set(4.2, 4.6, zOff);
        stand.add(post);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.35, p.len + 1.5), roofMat);
      roof.position.set(0.2, 9.1, 0);
      roof.rotation.z = 0.08;
      roof.castShadow = !this.isSoftwareGl;
      stand.add(roof);

      this.scene.add(stand);
    }

    this.disposables.push(concreteMat, steelMat, roofMat);
  }

  private buildTreesAndLandmarks(): void {
    const rng = new SeededRNG(777);
    const treePositions: Array<{ x: number; z: number; scale: number; tint: number }> = [];

    const minX = CIRCUIT.minX - 160;
    const maxX = CIRCUIT.maxX + 160;
    const minZ = CIRCUIT.minZ - 160;
    const maxZ = CIRCUIT.maxZ + 160;

    for (let attempt = 0; attempt < 1100 && treePositions.length < 210; attempt++) {
      const tx = rng.range(minX, maxX);
      const tz = rng.range(minZ, maxZ);

      let minDistSq = Infinity;
      for (let i = 0; i < CIRCUIT.samples.length; i += 2) {
        const s = CIRCUIT.samples[i];
        const dx = tx - s.x;
        const dz = tz - s.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistSq) minDistSq = dSq;
      }

      if (minDistSq > 26 * 26 && minDistSq < 155 * 155) {
        let tooClose = false;
        for (const existing of treePositions) {
          const dx = tx - existing.x;
          const dz = tz - existing.z;
          if (dx * dx + dz * dz < 64) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          treePositions.push({
            x: tx,
            z: tz,
            scale: rng.range(0.85, 1.25),
            tint: rng.range(0, 1),
          });
        }
      }
    }

    if (treePositions.length > 0) {
      const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 2.8, 7);
      trunkGeo.translate(0, 1.4, 0);
      const trunkMat = new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.9 });

      const lowConeGeo = new THREE.ConeGeometry(2.5, 4.4, 8);
      lowConeGeo.translate(0, 4.3, 0);
      const highConeGeo = new THREE.ConeGeometry(1.75, 3.6, 8);
      highConeGeo.translate(0, 6.7, 0);
      const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.86 });

      const count = treePositions.length;
      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
      const lowInst = new THREE.InstancedMesh(lowConeGeo, leafMat, count);
      const highInst = new THREE.InstancedMesh(highConeGeo, leafMat, count);
      lowInst.castShadow = !this.isSoftwareGl;
      highInst.castShadow = !this.isSoftwareGl;

      const cA = new THREE.Color('#2d6a3e');
      const cB = new THREE.Color('#4d7c3f');
      const cTmp = new THREE.Color();

      for (let i = 0; i < count; i++) {
        const t = treePositions[i];
        _tmpEuler.set(0, rng.range(0, Math.PI * 2), 0);
        _tmpQuat.setFromEuler(_tmpEuler);
        _tmpPos.set(t.x, -0.05, t.z);
        _tmpScale.set(t.scale, t.scale, t.scale);
        _tmpMat4.compose(_tmpPos, _tmpQuat, _tmpScale);

        trunkInst.setMatrixAt(i, _tmpMat4);
        lowInst.setMatrixAt(i, _tmpMat4);
        highInst.setMatrixAt(i, _tmpMat4);

        cTmp.copy(cA).lerp(cB, t.tint);
        lowInst.setColorAt(i, cTmp);
        cTmp.multiplyScalar(1.08);
        highInst.setColorAt(i, cTmp);
      }

      trunkInst.computeBoundingSphere();
      lowInst.computeBoundingSphere();
      highInst.computeBoundingSphere();
      this.scene.add(trunkInst, lowInst, highInst);
      this.disposables.push(trunkGeo, trunkMat, lowConeGeo, highConeGeo, leafMat);
    }

    // Trackside Floodlight Towers along back straight & hairpin to distinguish sections
    const towerPoleGeo = new THREE.CylinderGeometry(0.18, 0.28, 12, 8);
    const towerHeadGeo = new THREE.BoxGeometry(2.2, 0.9, 0.6);
    const towerMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.5, metalness: 0.6 });
    const towerGlowMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#fef9c3',
      emissiveIntensity: 1.5,
    });
    for (const sPos of [480, 620, 760, 920, 1140]) {
      const smp = CIRCUIT.sampleAtS(sPos);
      const yaw = Math.atan2(smp.tx, smp.tz);
      const dist = CIRCUIT.barrierHalfWidth + 4.5;
      const tower = new THREE.Group();
      tower.position.set(smp.x - smp.rx * dist, 0, smp.z - smp.rz * dist);
      tower.rotation.y = yaw;
      const pole = new THREE.Mesh(towerPoleGeo, towerMat);
      pole.position.set(0, 6, 0);
      const head = new THREE.Mesh(towerHeadGeo, towerGlowMat);
      head.position.set(0.6, 12, 0);
      tower.add(pole, head);
      this.scene.add(tower);
    }
    this.disposables.push(towerPoleGeo, towerHeadGeo, towerMat, towerGlowMat);
  }

  private buildCars(): void {
    const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: '#17191c', roughness: 0.85, metalness: 0.05 });

    const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.29, 10);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.25, metalness: 0.88 });
    const spokeGeo = new THREE.BoxGeometry(0.30, 0.045, 0.36);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: '#0f172a',
      roughness: 0.12,
      metalness: 0.75,
      clearcoat: 1.0,
    });
    const carbonMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.7, metalness: 0.2 });
    const headLightMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#fef9c3',
      emissiveIntensity: 1.4,
      roughness: 0.15,
    });

    const bodyShape = new THREE.Shape();
    bodyShape.moveTo(-2.15, 0.22);
    bodyShape.lineTo(2.15, 0.22);
    bodyShape.lineTo(2.18, 0.45);
    bodyShape.lineTo(1.75, 0.68);
    bodyShape.lineTo(0.85, 0.78);
    bodyShape.lineTo(0.25, 1.18);
    bodyShape.lineTo(-0.75, 1.18);
    bodyShape.lineTo(-1.55, 0.82);
    bodyShape.lineTo(-2.12, 0.75);
    bodyShape.closePath();

    const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
      depth: 1.76,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.06,
      bevelSegments: 2,
    });
    bodyGeo.rotateY(-Math.PI / 2);
    bodyGeo.translate(0.88, 0, 0);

    const shadowGeo = new THREE.PlaneGeometry(2.5, 4.8);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.contactShadowTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });

    const flameGeo = new THREE.ConeGeometry(0.13, 0.75, 8);
    flameGeo.rotateX(-Math.PI / 2);
    const flameMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });

    const playerOutlineGeo = new THREE.RingGeometry(1.75, 1.98, 28);
    playerOutlineGeo.rotateX(-Math.PI / 2);
    const playerOutlineMat = new THREE.MeshBasicMaterial({
      color: '#06b6d4',
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.disposables.push(
      tireGeo,
      tireMat,
      rimGeo,
      rimMat,
      spokeGeo,
      glassMat,
      carbonMat,
      headLightMat,
      bodyGeo,
      shadowGeo,
      shadowMat,
      flameGeo,
      flameMat,
      playerOutlineGeo,
      playerOutlineMat
    );

    for (let id = 0; id < 6; id++) {
      const spec = CAR_SPECS[id];
      const root = new THREE.Group();
      const body = new THREE.Group();
      root.add(body);

      const paintMat = new THREE.MeshPhysicalMaterial({
        color: spec.color,
        roughness: 0.24,
        metalness: 0.42,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
      });
      const stripeMat = new THREE.MeshStandardMaterial({
        color: spec.accent,
        roughness: 0.3,
        metalness: 0.2,
      });
      const brakeMat = new THREE.MeshStandardMaterial({
        color: '#991b1b',
        emissive: '#ef4444',
        emissiveIntensity: 0.35,
        roughness: 0.2,
      });

      const liveryTex = createLiveryPanelTexture(spec);
      const liveryMat = new THREE.MeshStandardMaterial({
        map: liveryTex,
        roughness: 0.35,
        metalness: 0.2,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      this.disposables.push(paintMat, stripeMat, brakeMat, liveryTex, liveryMat);

      // 1. Main chassis hull
      const hull = new THREE.Mesh(bodyGeo, paintMat);
      hull.castShadow = !this.isSoftwareGl;
      hull.receiveShadow = true;
      body.add(hull);

      // 2. Hood & Roof Livery with distinctive pattern & large readable number
      const hoodPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.15), liveryMat);
      hoodPanel.position.set(0, 0.76, 1.38);
      hoodPanel.rotation.x = -Math.PI / 2 + 0.13;
      const roofPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 1.02), liveryMat);
      roofPanel.position.set(0, 1.255, -0.25);
      roofPanel.rotation.x = -Math.PI / 2;
      body.add(hoodPanel, roofPanel);

      // Side door number decals
      const sideNumGeo = new THREE.PlaneGeometry(0.95, 0.5);
      const sideLeft = new THREE.Mesh(sideNumGeo, liveryMat);
      sideLeft.position.set(0.95, 0.56, 0.0);
      sideLeft.rotation.y = Math.PI / 2;
      const sideRight = new THREE.Mesh(sideNumGeo, liveryMat);
      sideRight.position.set(-0.95, 0.56, 0.0);
      sideRight.rotation.y = -Math.PI / 2;
      body.add(sideLeft, sideRight);

      // 3. Tinted cockpit canopy
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.42, 1.75), glassMat);
      canopy.position.set(0, 0.96, -0.18);
      body.add(canopy);

      // 4. Front splitter & side skirts
      const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.08, 4.38), carbonMat);
      splitter.position.set(0, 0.21, 0);
      body.add(splitter);

      // 5. Rear GT wing spoiler
      for (const sx of [-0.58, 0.58]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.22), carbonMat);
        strut.position.set(sx, 0.95, -1.9);
        body.add(strut);
      }
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.07, 0.38), paintMat);
      wing.position.set(0, 1.15, -1.94);
      wing.castShadow = !this.isSoftwareGl;
      body.add(wing);

      // 6. Headlights, dynamic brake lights & exhaust flames
      const flames: THREE.Mesh[] = [];
      for (const sx of [-0.66, 0.66]) {
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.08), headLightMat);
        hl.position.set(sx, 0.48, 2.16);
        const tl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.13, 0.08), brakeMat);
        tl.position.set(sx, 0.56, -2.14);
        body.add(hl, tl);
      }
      for (const ex of [-0.42, 0.42]) {
        const flame = new THREE.Mesh(flameGeo, flameMat);
        flame.position.set(ex, 0.34, -2.52);
        flame.visible = false;
        body.add(flame);
        flames.push(flame);
      }

      // 7. Cockpit interior cowl & steering wheel
      const steeringWheel = new THREE.Group();
      steeringWheel.position.set(0, 0.89, 0.48);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 16), carbonMat);
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.03), stripeMat);
      steeringWheel.add(rim, hub);
      steeringWheel.visible = id === 0;
      const dashCowl = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.18, 0.42), carbonMat);
      dashCowl.position.set(0, 0.83, 0.66);
      dashCowl.visible = id === 0;
      body.add(steeringWheel, dashCowl);

      // Contact shadow disc grounded at y = 0.015
      const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
      shadowDisc.position.set(0, 0.015, 0);
      root.add(shadowDisc);

      // Player visible cyan identification ring on the track
      let playerOutline: THREE.Mesh | undefined;
      if (id === 0) {
        playerOutline = new THREE.Mesh(playerOutlineGeo, playerOutlineMat);
        playerOutline.position.set(0, 0.045, 0);
        playerOutline.scale.set(0.85, 1.0, 1.45);
        root.add(playerOutline);
      }

      // Floating nameplate sprite above vehicle (compact so sightlines stay clear)
      const npTex = createNameplateTexture(spec);
      const npMat = new THREE.SpriteMaterial({ map: npTex, transparent: true, depthTest: true });
      const nameplate = new THREE.Sprite(npMat);
      if (id === 0) {
        nameplate.position.set(0, 2.95, 0);
        nameplate.scale.set(2.2, 0.55, 1);
      } else {
        nameplate.position.set(0, 1.95, 0);
        nameplate.scale.set(2.75, 0.68, 1);
      }
      root.add(nameplate);
      this.disposables.push(npTex, npMat);

      // 8. 4 Wheel assemblies
      const makeWheel = (): THREE.Group => {
        const w = new THREE.Group();
        const tire = new THREE.Mesh(tireGeo, tireMat);
        tire.castShadow = !this.isSoftwareGl;
        const alloy = new THREE.Mesh(rimGeo, rimMat);
        const spoke1 = new THREE.Mesh(spokeGeo, carbonMat);
        const spoke2 = new THREE.Mesh(spokeGeo, carbonMat);
        spoke2.rotation.x = Math.PI / 2;
        w.add(tire, alloy, spoke1, spoke2);
        return w;
      };

      const flKnuckle = new THREE.Group();
      flKnuckle.position.set(0.92, 0.36, 1.32);
      const flWheel = makeWheel();
      flKnuckle.add(flWheel);

      const frKnuckle = new THREE.Group();
      frKnuckle.position.set(-0.92, 0.36, 1.32);
      const frWheel = makeWheel();
      frKnuckle.add(frWheel);

      const rlWheel = makeWheel();
      rlWheel.position.set(0.92, 0.36, -1.32);

      const rrWheel = makeWheel();
      rrWheel.position.set(-0.92, 0.36, -1.32);

      root.add(flKnuckle, frKnuckle, rlWheel, rrWheel);
      this.scene.add(root);

      this.carVisuals.push({
        root,
        body,
        frontLeftKnuckle: flKnuckle,
        frontRightKnuckle: frKnuckle,
        wheels: [flWheel, frWheel, rlWheel, rrWheel],
        brakeMat,
        steeringWheel,
        cockpitHood: canopy,
        nameplate,
        flames,
        playerOutline,
      });
    }
  }

  private emitFromPool(
    pool: PooledParticle[],
    cursorRef: { val: number },
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxAge: number,
    baseScale: number,
    rotSpeed = 0
  ): void {
    const p = pool[cursorRef.val];
    cursorRef.val = (cursorRef.val + 1) % pool.length;
    p.active = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.age = 0;
    p.maxAge = maxAge;
    p.baseScale = baseScale;
    p.rotSpeed = rotSpeed;
  }

  private stepPool(
    pool: PooledParticle[],
    mesh: THREE.InstancedMesh,
    dt: number,
    gravity: number,
    growRate: number
  ): void {
    let dirty = false;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p.active) continue;
      dirty = true;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        _tmpMat4.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, _tmpMat4);
        continue;
      }
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.age / p.maxAge;
      const sc = p.baseScale * (1 + t * growRate) * (1 - t * 0.65);
      _tmpPos.set(p.x, p.y, p.z);
      _tmpEuler.set(p.age * p.rotSpeed, p.age * p.rotSpeed * 1.3, 0);
      _tmpQuat.setFromEuler(_tmpEuler);
      _tmpScale.set(sc, sc, sc);
      _tmpMat4.compose(_tmpPos, _tmpQuat, _tmpScale);
      mesh.setMatrixAt(i, _tmpMat4);
    }
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  private addSkidSegment(x1: number, z1: number, x2: number, z2: number): void {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.15 || len > 5.0) return;

    const yaw = Math.atan2(dx, dz);
    _tmpPos.set((x1 + x2) * 0.5, 0.032, (z1 + z2) * 0.5);
    _tmpEuler.set(0, yaw, 0);
    _tmpQuat.setFromEuler(_tmpEuler);
    _tmpScale.set(1, 1, len / 1.35);
    _tmpMat4.compose(_tmpPos, _tmpQuat, _tmpScale);

    this.skidMesh.setMatrixAt(this.skidCursor, _tmpMat4);
    this.skidCursor = (this.skidCursor + 1) % 640;
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  setRacingLineVisible(visible: boolean): void {
    this.racingLineEnabled = visible;
    if (this.racingLineMesh) {
      this.racingLineMesh.visible = visible;
    }
  }

  triggerPodiumConfetti(): void {
    if (this.confettiTriggered || !this.fxEnabled) return;
    this.confettiTriggered = true;
    const s0 = CIRCUIT.sampleAtS(0);
    for (let i = 0; i < 180; i++) {
      const p = this.confettiPool[i];
      p.active = true;
      p.x = s0.x + (Math.random() - 0.5) * 22;
      p.y = 6 + Math.random() * 7;
      p.z = s0.z + (Math.random() - 0.5) * 18;
      p.vx = (Math.random() - 0.5) * 7;
      p.vy = 2 + Math.random() * 5;
      p.vz = (Math.random() - 0.5) * 7;
      p.age = 0;
      p.maxAge = 3.5 + Math.random() * 1.5;
      p.baseScale = 1.0 + Math.random() * 0.7;
      p.rotSpeed = 3.0 + Math.random() * 4.0;
    }
  }

  syncAndRender(
    cars: ReadonlyArray<CarState>,
    dt: number,
    mode: 'title' | 'playing' | 'paused' | 'gameover'
  ): void {
    this.animClock += dt;

    // Animate cheering grandstand crowd subtly
    for (let i = 0; i < this.crowdMeshes.length; i++) {
      const c = this.crowdMeshes[i];
      c.mesh.position.y = c.baseY + Math.sin(this.animClock * 5.2 + c.phase) * 0.14;
    }

    const smokeCur = { val: this.smokeCursor };
    const dustCur = { val: this.dustCursor };
    const sparkCur = { val: this.sparkCursor };
    const streakCur = { val: this.streakCursor };

    // 1. Update all 6 car visuals
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const vis = this.carVisuals[i];
      vis.root.position.set(car.x, 0, car.z);
      vis.root.rotation.y = car.yaw;

      vis.body.rotation.z = car.bodyRoll;
      vis.body.rotation.x = car.bodyPitch;

      vis.frontLeftKnuckle.rotation.y = -car.steerAngle;
      vis.frontRightKnuckle.rotation.y = -car.steerAngle;
      vis.steeringWheel.rotation.z = car.steerAngle * 1.8;

      for (const w of vis.wheels) {
        w.rotation.x = car.wheelSpin;
      }

      vis.brakeMat.emissiveIntensity = car.braking ? 3.2 : 0.45;

      const isCockpitPlayer = i === 0 && this.cameraMode === 'cockpit' && mode === 'playing';
      vis.cockpitHood.visible = !isCockpitPlayer;
      vis.nameplate.visible = mode !== 'title' && !isCockpitPlayer;
      if (vis.playerOutline) {
        vis.playerOutline.visible = !isCockpitPlayer;
      }

      // Exhaust flames during nitro boost
      for (const fl of vis.flames) {
        fl.visible = car.boosting && mode === 'playing';
        if (fl.visible) {
          const pulse = 0.85 + Math.random() * 0.65;
          fl.scale.set(1, 1, pulse);
        }
      }

      // Camera shake trauma & collision sparks
      if (car.lastImpactIntensity > 0.08) {
        if (i === 0 && this.cameraShakeEnabled) {
          this.cameraTrauma = Math.min(1, this.cameraTrauma + car.lastImpactIntensity * 0.72);
        }
        if (this.fxEnabled && mode === 'playing') {
          const count = Math.min(12, Math.floor(car.lastImpactIntensity * 14));
          for (let k = 0; k < count; k++) {
            this.emitFromPool(
              this.sparkPool,
              sparkCur,
              car.x + (Math.random() - 0.5) * 1.6,
              0.55 + Math.random() * 0.4,
              car.z + (Math.random() - 0.5) * 1.6,
              (Math.random() - 0.5) * 14,
              3 + Math.random() * 6,
              (Math.random() - 0.5) * 14,
              0.38,
              0.9,
              8
            );
          }
        }
      }

      const fx = Math.sin(car.yaw);
      const fz = Math.cos(car.yaw);
      const rx = -fz;
      const rz = fx;
      const rlx = car.x - fx * 1.32 - rx * 0.92;
      const rlz = car.z - fz * 1.32 - rz * 0.92;
      const rrx = car.x - fx * 1.32 + rx * 0.92;
      const rrz = car.z - fz * 1.32 + rz * 0.92;

      const prevW = this.prevRearWheelPos[i];
      if (mode === 'playing') {
        // Skid marks & Tyre smoke during drift
        if (car.isDrifting || car.driftIntensity > 0.25) {
          if (prevW.valid) {
            this.addSkidSegment(prevW.lx, prevW.lz, rlx, rlz);
            this.addSkidSegment(prevW.rx, prevW.rz, rrx, rrz);
          }
          if (this.fxEnabled && Math.random() < 0.75) {
            this.emitFromPool(
              this.smokePool,
              smokeCur,
              rlx,
              0.22,
              rlz,
              car.vx * 0.14 + (Math.random() - 0.5) * 1.4,
              1.1 + Math.random() * 1.1,
              car.vz * 0.14 + (Math.random() - 0.5) * 1.4,
              0.65,
              0.55 + car.driftIntensity * 0.6
            );
            this.emitFromPool(
              this.smokePool,
              smokeCur,
              rrx,
              0.22,
              rrz,
              car.vx * 0.14 + (Math.random() - 0.5) * 1.4,
              1.1 + Math.random() * 1.1,
              car.vz * 0.14 + (Math.random() - 0.5) * 1.4,
              0.65,
              0.55 + car.driftIntensity * 0.6
            );
          }
        }

        // Grass & dust particles when driving off-track
        if (this.fxEnabled && car.offTrack && car.speedKmh > 25 && Math.random() < 0.8) {
          this.emitFromPool(
            this.dustPool,
            dustCur,
            rlx,
            0.25,
            rlz,
            -fx * 3 + (Math.random() - 0.5) * 2.5,
            1.4 + Math.random() * 1.5,
            -fz * 3 + (Math.random() - 0.5) * 2.5,
            0.55,
            0.7,
            4
          );
          this.emitFromPool(
            this.dustPool,
            dustCur,
            rrx,
            0.25,
            rrz,
            -fx * 3 + (Math.random() - 0.5) * 2.5,
            1.4 + Math.random() * 1.5,
            -fz * 3 + (Math.random() - 0.5) * 2.5,
            0.55,
            0.7,
            4
          );
        }

        // Boost speed streak trails
        if (this.fxEnabled && car.boosting && Math.random() < 0.85) {
          this.emitFromPool(
            this.streakPool,
            streakCur,
            car.x - fx * 2.4 + (Math.random() - 0.5) * 1.4,
            0.45 + Math.random() * 0.45,
            car.z - fz * 2.4 + (Math.random() - 0.5) * 1.4,
            -fx * 10,
            0.2,
            -fz * 10,
            0.22,
            0.9
          );
        }
      }

      prevW.lx = rlx;
      prevW.lz = rlz;
      prevW.rx = rrx;
      prevW.rz = rrz;
      prevW.valid = mode === 'playing';
    }

    this.smokeCursor = smokeCur.val;
    this.dustCursor = dustCur.val;
    this.sparkCursor = sparkCur.val;
    this.streakCursor = streakCur.val;

    this.stepPool(this.smokePool, this.smokeMesh, dt, 0.2, 2.0);
    this.stepPool(this.dustPool, this.dustMesh, dt, -3.2, 1.1);
    this.stepPool(this.sparkPool, this.sparkMesh, dt, -14.0, 0.1);
    this.stepPool(this.streakPool, this.streakMesh, dt, 0, -0.4);
    this.stepPool(this.confettiPool, this.confettiMesh, dt, -3.5, 0.1);

    // 2. Update camera
    const player = cars[0];
    this.cameraTrauma = Math.max(0, this.cameraTrauma - 2.3 * dt);
    const shake = this.cameraShakeEnabled ? this.cameraTrauma * this.cameraTrauma : 0;

    if (mode === 'title') {
      this.titleOrbitAngle += dt * 0.22;
      const gx = player.x;
      const gz = player.z;
      const rad = 32;
      this.camera.position.set(
        gx + Math.sin(this.titleOrbitAngle) * rad,
        13.5 + Math.sin(this.titleOrbitAngle * 0.7) * 2.5,
        gz - Math.cos(this.titleOrbitAngle) * rad
      );
      this.camera.lookAt(gx, 1.5, gz + 16);
      this.camera.fov = 56;
      this.camera.updateProjectionMatrix();
      this.camPosInitialized = false;
    } else if (this.cameraMode === 'cockpit') {
      const fx = Math.sin(player.yaw);
      const fz = Math.cos(player.yaw);
      const rx = -fz;
      const rz = fx;
      this.camera.position.set(
        player.x + fx * 0.16 + (Math.random() - 0.5) * shake * 0.12,
        1.22 + (Math.random() - 0.5) * shake * 0.08,
        player.z + fz * 0.16 + (Math.random() - 0.5) * shake * 0.12
      );
      _camTargetLook.set(
        player.x + fx * 24 + rx * player.steerAngle * 2.5,
        0.92,
        player.z + fz * 24 + rz * player.steerAngle * 2.5
      );
      this.camera.lookAt(_camTargetLook);
      const boostFov = player.boosting ? 7.5 : 0;
      const targetFov = 72 + Math.min(12, (player.speedKmh / 250) * 12) + boostFov;
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 8 * dt);
      this.camera.updateProjectionMatrix();
      this.camPosInitialized = false;
    } else {
      const fx = Math.sin(player.yaw);
      const fz = Math.cos(player.yaw);
      const vLen = Math.hypot(player.vx, player.vz);
      const dirX = vLen > 6 ? fx * 0.72 + (player.vx / vLen) * 0.28 : fx;
      const dirZ = vLen > 6 ? fz * 0.72 + (player.vz / vLen) * 0.28 : fz;

      const boostPull = player.boosting ? 0.8 : 0;
      _camTargetPos.set(player.x - dirX * (8.6 + boostPull), 3.65, player.z - dirZ * (8.6 + boostPull));
      _camTargetLook.set(player.x + dirX * 9.0, 1.35, player.z + dirZ * 9.0);

      if (!this.camPosInitialized) {
        this.camera.position.copy(_camTargetPos);
        this.currentLookAt.copy(_camTargetLook);
        this.camPosInitialized = true;
      } else {
        const posAlpha = 1 - Math.exp(-11.0 * dt);
        const lookAlpha = 1 - Math.exp(-15.0 * dt);
        this.camera.position.lerp(_camTargetPos, posAlpha);
        this.currentLookAt.lerp(_camTargetLook, lookAlpha);
      }

      if (shake > 0.001) {
        this.camera.position.x += (Math.random() - 0.5) * shake * 0.55;
        this.camera.position.y += (Math.random() - 0.5) * shake * 0.35;
      }

      this.camera.lookAt(this.currentLookAt);
      const boostFov = player.boosting ? 8.5 : 0;
      const targetFov = 60 + Math.min(14, (player.speedKmh / 250) * 14) + boostFov;
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 6 * dt);
      this.camera.updateProjectionMatrix();
    }

    this.renderer.render(this.scene, this.camera);
  }

  updateGantryLights(phase: 'countdown' | 'racing' | 'finished', countdownVal: number): void {
    if (phase === 'countdown') {
      const litCount = 4 - countdownVal;
      for (let i = 0; i < 3; i++) {
        const mat = this.gantryLights[i];
        mat.emissive.setHex(0xef4444);
        mat.emissiveIntensity = i < litCount ? 3.5 : 0.15;
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const mat = this.gantryLights[i];
        mat.emissive.setHex(0x22c55e);
        mat.emissiveIntensity = 3.2;
      }
    }
  }

  clearSkidsAndSmoke(): void {
    this.confettiTriggered = false;
    const pools: Array<[PooledParticle[], THREE.InstancedMesh]> = [
      [this.smokePool, this.smokeMesh],
      [this.dustPool, this.dustMesh],
      [this.sparkPool, this.sparkMesh],
      [this.streakPool, this.streakMesh],
      [this.confettiPool, this.confettiMesh],
    ];
    for (const [pool, mesh] of pools) {
      for (let i = 0; i < pool.length; i++) {
        pool[i].active = false;
        _tmpMat4.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, _tmpMat4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    for (let i = 0; i < 640; i++) {
      _tmpMat4.makeScale(0, 0, 0);
      this.skidMesh.setMatrixAt(i, _tmpMat4);
    }
    this.skidMesh.instanceMatrix.needsUpdate = true;
    this.skidCursor = 0;
    for (const p of this.prevRearWheelPos) p.valid = false;
  }

  scheduleNextFrame(cb: () => void): void {
    if (this.disposed) return;
    if (!this.isSoftwareGl) {
      this.frameId = requestAnimationFrame(cb);
      return;
    }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
