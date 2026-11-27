import * as THREE from 'three';
import {
  createAsphaltTexture,
  createCarRoofDecalTexture,
  createCheckerTexture,
  createContactShadowTexture,
  createCrowdTexture,
  createGantryBannerTexture,
  createGrassTexture,
  createKerbTexture,
  createNameplateTexture,
  createSignTexture,
} from './textures';
import { BARRIER_HALF_WIDTH, CircuitTrack, KERB_WIDTH, ROAD_HALF_WIDTH } from './track';
import { CarSpec } from './types';

export interface CarRig {
  root: THREE.Group;
  chassis: THREE.Group;
  canopy: THREE.Mesh;
  nameplate: THREE.Sprite;
  playerOutline: THREE.Mesh | null;
  flameL: THREE.Mesh;
  flameR: THREE.Mesh;
  steeringWheel: THREE.Group;
  frontLeftPivot: THREE.Group;
  frontRightPivot: THREE.Group;
  wheelSpinGroups: THREE.Group[];
  tailMat: THREE.MeshStandardMaterial;
}

export interface GantryRig {
  group: THREE.Group;
  lightMats: THREE.MeshStandardMaterial[];
}

export interface CircuitVisuals {
  gantry: GantryRig;
  racingLineMesh: THREE.Mesh;
  crowdDecks: THREE.Mesh[];
}

function buildCarSilhouetteGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-2.12, 0.24);
  shape.lineTo(2.14, 0.22);
  shape.lineTo(2.16, 0.44);
  shape.lineTo(1.88, 0.64);
  shape.lineTo(0.85, 0.78);
  shape.lineTo(0.28, 1.15);
  shape.lineTo(-0.72, 1.14);
  shape.lineTo(-1.62, 0.84);
  shape.lineTo(-2.12, 0.80);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.66,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 2,
    steps: 1,
  });
  geo.translate(0, 0, -0.83);
  geo.computeVertexNormals();
  return geo;
}

let sharedBodyGeo: THREE.BufferGeometry | null = null;
let sharedTireGeo: THREE.CylinderGeometry | null = null;
let sharedRimGeo: THREE.CylinderGeometry | null = null;
let sharedSpokeGeo: THREE.BoxGeometry | null = null;
let sharedShadowMat: THREE.MeshBasicMaterial | null = null;
let sharedFlameGeo: THREE.ConeGeometry | null = null;

export function buildCarRig(spec: CarSpec, maxAniso: number, isSoftwareGl: boolean): CarRig {
  if (!sharedBodyGeo) sharedBodyGeo = buildCarSilhouetteGeometry();
  if (!sharedTireGeo) {
    sharedTireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 20);
    sharedTireGeo.rotateX(Math.PI / 2);
  }
  if (!sharedRimGeo) {
    sharedRimGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.29, 14);
    sharedRimGeo.rotateX(Math.PI / 2);
  }
  if (!sharedSpokeGeo) {
    sharedSpokeGeo = new THREE.BoxGeometry(0.41, 0.055, 0.30);
  }
  if (!sharedShadowMat) {
    sharedShadowMat = new THREE.MeshBasicMaterial({
      map: createContactShadowTexture(),
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
  }
  if (!sharedFlameGeo) {
    sharedFlameGeo = new THREE.ConeGeometry(0.14, 0.85, 10);
    sharedFlameGeo.rotateZ(Math.PI / 2);
    sharedFlameGeo.translate(-0.42, 0, 0);
  }

  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  // Contact shadow disc
  const shadowDisc = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 5.2), sharedShadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.rotation.z = Math.PI / 2;
  shadowDisc.position.y = 0.018;
  root.add(shadowDisc);

  // Player cyan identification outline ring
  let playerOutline: THREE.Mesh | null = null;
  if (spec.isPlayer) {
    const ringGeo = new THREE.RingGeometry(1.62, 1.88, 36);
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.scale(1.42, 1, 0.72);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    playerOutline = new THREE.Mesh(ringGeo, ringMat);
    playerOutline.position.y = 0.032;
    root.add(playerOutline);
  }

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: spec.colorNum,
    roughness: 0.24,
    metalness: 0.42,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });

  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.8,
    metalness: 0.15,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: spec.accentNum,
    roughness: 0.32,
    metalness: 0.35,
  });

  const canopyMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    roughness: 0.08,
    metalness: 0.2,
    transparent: true,
    opacity: isSoftwareGl ? 0.72 : 0.78,
  });

  // 1. Sculpted Main Body
  const bodyMesh = new THREE.Mesh(sharedBodyGeo, paintMat);
  bodyMesh.castShadow = !isSoftwareGl;
  bodyMesh.receiveShadow = true;
  chassis.add(bodyMesh);

  // 2. Matte Carbon Front Splitter, Side Skirts & Rear Diffuser
  const underbody = new THREE.Mesh(new THREE.BoxGeometry(4.42, 0.11, 1.94), carbonMat);
  underbody.position.set(0.02, 0.23, 0);
  chassis.add(underbody);

  const frontLip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 1.96), carbonMat);
  frontLip.position.set(2.16, 0.21, 0);
  chassis.add(frontLip);

  // 3. Unique Livery Stripe & Roof Number/Symbol Decal
  const hoodStripe = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.03, 0.56), accentMat);
  hoodStripe.position.set(1.42, 0.70, 0);
  hoodStripe.rotation.z = -0.14;
  chassis.add(hoodStripe);

  const sideBandGeo = new THREE.BoxGeometry(2.3, 0.18, 1.84);
  const sideBand = new THREE.Mesh(sideBandGeo, accentMat);
  sideBand.position.set(-0.2, 0.52, 0);
  chassis.add(sideBand);

  const roofDecalTex = createCarRoofDecalTexture(spec, maxAniso);
  const roofDecalMat = new THREE.MeshStandardMaterial({
    map: roofDecalTex,
    roughness: 0.35,
    metalness: 0.1,
  });
  const roofDecal = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.15), roofDecalMat);
  roofDecal.rotation.x = -Math.PI / 2;
  roofDecal.rotation.z = -Math.PI / 2;
  roofDecal.position.set(-0.22, 1.245, 0);
  chassis.add(roofDecal);

  // Rear plate number badge
  const rearDecal = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.42), roofDecalMat);
  rearDecal.rotation.y = -Math.PI / 2;
  rearDecal.position.set(-2.16, 0.46, 0);
  chassis.add(rearDecal);

  // 4. Cockpit Canopy
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.38, 1.38), canopyMat);
  canopy.position.set(-0.18, 1.01, 0);
  chassis.add(canopy);

  // 5. Cockpit Interior
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 1.32), carbonMat);
  dash.position.set(0.42, 0.82, 0);
  chassis.add(dash);

  const pillarGeo = new THREE.BoxGeometry(0.65, 0.055, 0.055);
  const pillarL = new THREE.Mesh(pillarGeo, carbonMat);
  pillarL.position.set(0.45, 1.01, -0.66);
  pillarL.rotation.z = -0.58;
  chassis.add(pillarL);
  const pillarR = new THREE.Mesh(pillarGeo, carbonMat);
  pillarR.position.set(0.45, 1.01, 0.66);
  pillarR.rotation.z = -0.58;
  chassis.add(pillarR);

  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(0.24, 0.87, 0);
  steeringWheel.rotation.z = -0.32;
  const swRing = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.022, 8, 20), carbonMat);
  swRing.rotation.y = Math.PI / 2;
  steeringWheel.add(swRing);
  const swBar = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, 0.26), accentMat);
  steeringWheel.add(swBar);
  chassis.add(steeringWheel);

  // 6. Rear GT Wing
  const wingGroup = new THREE.Group();
  const pylonGeo = new THREE.BoxGeometry(0.18, 0.34, 0.05);
  const pylonL = new THREE.Mesh(pylonGeo, carbonMat);
  pylonL.position.set(-1.95, 0.98, -0.45);
  const pylonR = new THREE.Mesh(pylonGeo, carbonMat);
  pylonR.position.set(-1.95, 0.98, 0.45);
  const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 1.92), paintMat);
  wingBlade.position.set(-2.02, 1.15, 0);
  wingBlade.rotation.z = 0.12;
  wingBlade.castShadow = !isSoftwareGl;
  const endplateGeo = new THREE.BoxGeometry(0.40, 0.22, 0.04);
  const endL = new THREE.Mesh(endplateGeo, carbonMat);
  endL.position.set(-2.02, 1.13, -0.96);
  const endR = new THREE.Mesh(endplateGeo, carbonMat);
  endR.position.set(-2.02, 1.13, 0.96);
  wingGroup.add(pylonL, pylonR, wingBlade, endL, endR);
  chassis.add(wingGroup);

  // 7. Headlights, Taillights & Nitro Exhaust Flames
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfef3c7,
    emissiveIntensity: 1.6,
    roughness: 0.15,
  });
  const headGeo = new THREE.BoxGeometry(0.08, 0.11, 0.32);
  const headL = new THREE.Mesh(headGeo, headMat);
  headL.position.set(2.14, 0.45, -0.60);
  const headR = new THREE.Mesh(headGeo, headMat);
  headR.position.set(2.14, 0.45, 0.60);
  chassis.add(headL, headR);

  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    emissive: 0xef4444,
    emissiveIntensity: 0.6,
    roughness: 0.2,
  });
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 1.56), tailMat);
  tailBar.position.set(-2.14, 0.64, 0);
  chassis.add(tailBar);

  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.92,
  });
  const flameL = new THREE.Mesh(sharedFlameGeo, flameMat);
  flameL.position.set(-2.15, 0.30, -0.42);
  flameL.visible = false;
  const flameR = new THREE.Mesh(sharedFlameGeo, flameMat);
  flameR.position.set(-2.15, 0.30, 0.42);
  flameR.visible = false;
  chassis.add(flameL, flameR);

  // 8. 4 Wheels
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.9,
    metalness: 0.05,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.88,
  });

  const makeWheel = (x: number, z: number): { pivot: THREE.Group; spin: THREE.Group } => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(sharedTireGeo!, tireMat);
    tire.castShadow = !isSoftwareGl;
    const rim = new THREE.Mesh(sharedRimGeo!, rimMat);
    const spoke1 = new THREE.Mesh(sharedSpokeGeo!, rimMat);
    const spoke2 = new THREE.Mesh(sharedSpokeGeo!, rimMat);
    spoke2.rotation.z = Math.PI / 2;
    spin.add(tire, rim, spoke1, spoke2);
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin };
  };

  const fl = makeWheel(1.36, -0.88);
  const fr = makeWheel(1.36, 0.88);
  const rl = makeWheel(-1.34, -0.88);
  const rr = makeWheel(-1.34, 0.88);

  // 9. Floating Nameplate Sprite above car
  const plateTex = createNameplateTexture(spec);
  const plateMat = new THREE.SpriteMaterial({ map: plateTex, transparent: true, depthTest: true });
  const nameplate = new THREE.Sprite(plateMat);
  nameplate.position.set(0, 1.86, 0);
  nameplate.scale.set(2.15, 0.56, 1);
  root.add(nameplate);

  return {
    root,
    chassis,
    canopy,
    nameplate,
    playerOutline,
    flameL,
    flameR,
    steeringWheel,
    frontLeftPivot: fl.pivot,
    frontRightPivot: fr.pivot,
    wheelSpinGroups: [fl.spin, fr.spin, rl.spin, rr.spin],
    tailMat,
  };
}

function buildClosedRibbonGeometry(
  track: CircuitTrack,
  dLeft: number,
  dRight: number,
  y: number,
  vRepeatLength: number
): THREE.BufferGeometry {
  const n = track.count;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const normals = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const s = track.samples[i % n];
    const distS = (i / n) * track.totalLength;
    const v = distS / vRepeatLength;

    const lx = s.x + s.nx * dLeft;
    const lz = s.z + s.nz * dLeft;
    const rx = s.x + s.nx * dRight;
    const rz = s.z + s.nz * dRight;

    const vIdx = i * 2;
    positions[vIdx * 3 + 0] = lx;
    positions[vIdx * 3 + 1] = y;
    positions[vIdx * 3 + 2] = lz;

    positions[(vIdx + 1) * 3 + 0] = rx;
    positions[(vIdx + 1) * 3 + 1] = y;
    positions[(vIdx + 1) * 3 + 2] = rz;

    normals[vIdx * 3 + 1] = 1;
    normals[(vIdx + 1) * 3 + 1] = 1;

    uvs[vIdx * 2 + 0] = 0;
    uvs[vIdx * 2 + 1] = v;
    uvs[(vIdx + 1) * 2 + 0] = 1;
    uvs[(vIdx + 1) * 2 + 1] = v;

    if (i < n) {
      const a = vIdx;
      const b = vIdx + 1;
      const c = vIdx + 2;
      const d = vIdx + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildDynamicRacingLineMesh(track: CircuitTrack): THREE.Mesh {
  const n = track.count;
  const halfW = 0.65;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const colors = new Float32Array((n + 1) * 2 * 3);
  const indices: number[] = [];

  const cGreen = new THREE.Color(0x22c55e);
  const cYellow = new THREE.Color(0xfacc15);
  const cRed = new THREE.Color(0xef4444);
  const tmpColor = new THREE.Color();

  for (let i = 0; i <= n; i++) {
    const s = track.samples[i % n];
    const cx = s.x + s.nx * s.racingOffset;
    const cz = s.z + s.nz * s.racingOffset;

    const b = s.brakeIntensity;
    if (b < 0.45) {
      tmpColor.copy(cGreen).lerp(cYellow, b / 0.45);
    } else {
      tmpColor.copy(cYellow).lerp(cRed, (b - 0.45) / 0.55);
    }

    const vIdx = i * 2;
    positions[vIdx * 3 + 0] = cx - s.nx * halfW;
    positions[vIdx * 3 + 1] = 0.030;
    positions[vIdx * 3 + 2] = cz - s.nz * halfW;

    positions[(vIdx + 1) * 3 + 0] = cx + s.nx * halfW;
    positions[(vIdx + 1) * 3 + 1] = 0.030;
    positions[(vIdx + 1) * 3 + 2] = cz + s.nz * halfW;

    colors[vIdx * 3 + 0] = tmpColor.r;
    colors[vIdx * 3 + 1] = tmpColor.g;
    colors[vIdx * 3 + 2] = tmpColor.b;
    colors[(vIdx + 1) * 3 + 0] = tmpColor.r;
    colors[(vIdx + 1) * 3 + 1] = tmpColor.g;
    colors[(vIdx + 1) * 3 + 2] = tmpColor.b;

    if (i < n) {
      const a = vIdx;
      const bb = vIdx + 1;
      const c = vIdx + 2;
      const d = vIdx + 3;
      indices.push(a, bb, c, bb, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  return new THREE.Mesh(geo, mat);
}

function buildBarrierWallGeometry(
  track: CircuitTrack,
  dOffset: number,
  yBottom: number,
  yTop: number,
  faceInwardSign: number
): THREE.BufferGeometry {
  const n = track.count;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const s = track.samples[i % n];
    const distS = (i / n) * track.totalLength;
    const wx = s.x + s.nx * dOffset;
    const wz = s.z + s.nz * dOffset;

    const vIdx = i * 2;
    positions[vIdx * 3 + 0] = wx;
    positions[vIdx * 3 + 1] = yBottom;
    positions[vIdx * 3 + 2] = wz;

    positions[(vIdx + 1) * 3 + 0] = wx;
    positions[(vIdx + 1) * 3 + 1] = yTop;
    positions[(vIdx + 1) * 3 + 2] = wz;

    uvs[vIdx * 2 + 0] = distS / 6;
    uvs[vIdx * 2 + 1] = 0;
    uvs[(vIdx + 1) * 2 + 0] = distS / 6;
    uvs[(vIdx + 1) * 2 + 1] = 1;

    if (i < n) {
      const a = vIdx;
      const b = vIdx + 1;
      const c = vIdx + 2;
      const d = vIdx + 3;
      if (faceInwardSign > 0) {
        indices.push(a, b, c, b, d, c);
      } else {
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildStartGantry(track: CircuitTrack, maxAniso: number, isSoftwareGl: boolean): GantryRig {
  const s0 = track.sampleAtS(0);
  const group = new THREE.Group();
  group.position.set(s0.x, 0, s0.z);
  group.rotation.y = -Math.atan2(s0.tz, s0.tx);

  const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.78 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6, metalness: 0.3 });

  const halfSpan = BARRIER_HALF_WIDTH + 0.9;
  const height = 6.8;

  const pillarGeo = new THREE.BoxGeometry(0.95, height, 0.95);
  const leftPillar = new THREE.Mesh(pillarGeo, steelMat);
  leftPillar.position.set(0, height / 2, -halfSpan);
  leftPillar.castShadow = !isSoftwareGl;

  const rightPillar = new THREE.Mesh(pillarGeo, steelMat);
  rightPillar.position.set(0, height / 2, halfSpan);
  rightPillar.castShadow = !isSoftwareGl;

  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.55, halfSpan * 2 + 1.2), steelMat);
  beam.position.set(0, height - 0.5, 0);
  beam.castShadow = !isSoftwareGl;

  const bannerTex = createGantryBannerTexture(maxAniso);
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.4, metalness: 0.1 });
  const bannerGeo = new THREE.PlaneGeometry(halfSpan * 1.85, 1.45);
  const bannerFront = new THREE.Mesh(bannerGeo, bannerMat);
  bannerFront.position.set(-0.72, height - 0.5, 0);
  bannerFront.rotation.y = -Math.PI / 2;

  const bannerBack = new THREE.Mesh(bannerGeo, bannerMat);
  bannerBack.position.set(0.72, height - 0.5, 0);
  bannerBack.rotation.y = Math.PI / 2;

  const lightHousing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 4.6), darkMat);
  lightHousing.position.set(-0.85, height - 1.55, 0);

  const lightMats: THREE.MeshStandardMaterial[] = [];
  const podGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.16, 16);
  podGeo.rotateZ(Math.PI / 2);

  for (let i = 0; i < 5; i++) {
    const lMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.2,
    });
    lightMats.push(lMat);
    const pod = new THREE.Mesh(podGeo, lMat);
    pod.position.set(-1.12, height - 1.55, (i - 2) * 0.88);
    group.add(pod);
  }

  // Timing Display Tower beside start gantry
  const towerBody = new THREE.Mesh(new THREE.BoxGeometry(2.2, 9.5, 2.2), darkMat);
  towerBody.position.set(1.5, 4.75, halfSpan + 2.8);
  towerBody.castShadow = !isSoftwareGl;
  const towerAccent = new THREE.Mesh(
    new THREE.BoxGeometry(2.3, 0.6, 2.3),
    new THREE.MeshBasicMaterial({ color: 0x06b6d4 })
  );
  towerAccent.position.set(1.5, 8.8, halfSpan + 2.8);
  group.add(towerBody, towerAccent);

  group.add(leftPillar, rightPillar, beam, bannerFront, bannerBack, lightHousing);
  return { group, lightMats };
}

function buildGrandstand(
  width: number,
  maxAniso: number,
  isSoftwareGl: boolean,
  crowdDecks: THREE.Mesh[]
): THREE.Group {
  const g = new THREE.Group();
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85, metalness: 0.05 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.75 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.42, metalness: 0.25 });
  const crowdMat = new THREE.MeshStandardMaterial({
    map: createCrowdTexture(maxAniso),
    roughness: 0.75,
    metalness: 0.05,
  });

  const base = new THREE.Mesh(new THREE.BoxGeometry(width, 1.4, 11), concreteMat);
  base.position.set(0, 0.7, 0);
  base.castShadow = !isSoftwareGl;
  base.receiveShadow = true;
  g.add(base);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(width - 0.8, 0.8, 10.5), crowdMat);
  deck.position.set(0, 3.6, 0.2);
  deck.rotation.x = -0.44;
  deck.castShadow = !isSoftwareGl;
  g.add(deck);
  crowdDecks.push(deck);

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(width, 6.8, 0.6), concreteMat);
  backWall.position.set(0, 3.4, 5.2);
  g.add(backWall);

  const colGeo = new THREE.BoxGeometry(0.45, 8.6, 0.45);
  const colCount = Math.max(3, Math.floor(width / 10));
  for (let i = 0; i < colCount; i++) {
    const x = -width * 0.46 + (i / (colCount - 1)) * (width * 0.92);
    const col = new THREE.Mesh(colGeo, steelMat);
    col.position.set(x, 4.3, 4.9);
    g.add(col);
  }

  const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, 0.45, 11.8), roofMat);
  roof.position.set(0, 8.7, 0.2);
  roof.rotation.x = -0.12;
  roof.castShadow = !isSoftwareGl;
  g.add(roof);

  return g;
}

function addTracksideBoard(
  scene: THREE.Scene,
  track: CircuitTrack,
  sPos: number,
  lateralD: number,
  w: number,
  h: number,
  yCenter: number,
  tex: THREE.CanvasTexture,
  faceTrack = true
): void {
  const sp = track.sampleAtS(sPos);
  const group = new THREE.Group();
  group.position.set(sp.x + sp.nx * lateralD, 0, sp.z + sp.nz * lateralD);
  const baseYaw = -Math.atan2(sp.tz, sp.tx);
  group.rotation.y = faceTrack ? baseYaw : baseYaw + Math.PI;

  const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.7 });
  const postGeo = new THREE.BoxGeometry(0.18, yCenter, 0.18);
  const pL = new THREE.Mesh(postGeo, postMat);
  pL.position.set(-w * 0.35, yCenter * 0.5, 0);
  const pR = new THREE.Mesh(postGeo, postMat);
  pR.position.set(w * 0.35, yCenter * 0.5, 0);

  const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.14), boardMat);
  board.position.set(0, yCenter, 0);

  group.add(pL, pR, board);
  scene.add(group);
}

export function buildCircuitEnvironment(
  scene: THREE.Scene,
  track: CircuitTrack,
  maxAniso: number,
  isSoftwareGl: boolean
): CircuitVisuals {
  // 1. Lush Terrain Meadow
  const grassTex = createGrassTexture(maxAniso);
  const groundMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(20, -0.04, 110);
  ground.receiveShadow = true;
  scene.add(ground);

  // 2. Runoff Shoulder Apron
  const runoffMat = new THREE.MeshStandardMaterial({
    color: 0x52525b,
    roughness: 0.88,
    metalness: 0.05,
  });
  const runoffMesh = new THREE.Mesh(
    buildClosedRibbonGeometry(track, -BARRIER_HALF_WIDTH - 0.3, BARRIER_HALF_WIDTH + 0.3, 0.0, 10),
    runoffMat
  );
  runoffMesh.receiveShadow = true;
  scene.add(runoffMesh);

  // 3. Asphalt Track Surface
  const asphaltTex = createAsphaltTexture(maxAniso);
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.05,
  });
  const roadMesh = new THREE.Mesh(
    buildClosedRibbonGeometry(track, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0.025, 14),
    asphaltMat
  );
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);

  // 4. Dynamic Racing Line (Green -> Yellow -> Red)
  const racingLineMesh = buildDynamicRacingLineMesh(track);
  scene.add(racingLineMesh);

  // 5. Red-and-White Kerbs
  const kerbTex = createKerbTexture(maxAniso);
  const kerbMat = new THREE.MeshStandardMaterial({
    map: kerbTex,
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.05,
  });
  const leftKerb = new THREE.Mesh(
    buildClosedRibbonGeometry(track, -(ROAD_HALF_WIDTH + KERB_WIDTH), -ROAD_HALF_WIDTH + 0.05, 0.045, 4.2),
    kerbMat
  );
  const rightKerb = new THREE.Mesh(
    buildClosedRibbonGeometry(track, ROAD_HALF_WIDTH - 0.05, ROAD_HALF_WIDTH + KERB_WIDTH, 0.045, 4.2),
    kerbMat
  );
  leftKerb.receiveShadow = true;
  rightKerb.receiveShadow = true;
  scene.add(leftKerb, rightKerb);

  // 6. Distinctive Start/Finish Checkered Line, Pit Lane Wall Strip & Grid Slots
  const s0 = track.sampleAtS(0);
  const checkerMat = new THREE.MeshStandardMaterial({
    map: createCheckerTexture(maxAniso),
    color: 0xffffff,
    roughness: 0.65,
  });
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 1.92, 3.6), checkerMat);
  startLine.rotation.x = -Math.PI / 2;
  startLine.rotation.z = -Math.atan2(s0.tz, s0.tx) + Math.PI / 2;
  startLine.position.set(s0.x, 0.038, s0.z);
  scene.add(startLine);

  // Pit wall red-cyan painted apron along start/finish straight
  const pitApronMat = new THREE.MeshStandardMaterial({ color: 0x0e7490, roughness: 0.6 });
  const pitApron = new THREE.Mesh(new THREE.PlaneGeometry(140, 2.2), pitApronMat);
  pitApron.rotation.x = -Math.PI / 2;
  pitApron.position.set(-15, 0.015, -10.1);
  scene.add(pitApron);

  const gridMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.78 });
  const gridSlots = [
    { backDist: 14, lateral: -3.1 },
    { backDist: 19, lateral: 3.1 },
    { backDist: 25, lateral: -3.1 },
    { backDist: 30, lateral: 3.1 },
    { backDist: 35, lateral: -3.1 },
    { backDist: 40, lateral: 3.1 },
  ];
  for (const gs of gridSlots) {
    const sp = track.sampleAtS(track.totalLength - gs.backDist);
    const box = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.25), gridMat);
    box.rotation.x = -Math.PI / 2;
    box.rotation.z = -Math.atan2(sp.tz, sp.tx) + Math.PI / 2;
    box.position.set(sp.x + sp.nx * gs.lateral, 0.036, sp.z + sp.nz * gs.lateral);
    scene.add(box);
  }

  // 7. Metallic Armco Barriers + Instanced Posts
  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0xd1d5db,
    roughness: 0.38,
    metalness: 0.72,
    side: THREE.DoubleSide,
  });
  const leftBarrier = new THREE.Mesh(
    buildBarrierWallGeometry(track, -BARRIER_HALF_WIDTH - 0.15, 0.12, 0.96, 1),
    barrierMat
  );
  const rightBarrier = new THREE.Mesh(
    buildBarrierWallGeometry(track, BARRIER_HALF_WIDTH + 0.15, 0.12, 0.96, -1),
    barrierMat
  );
  scene.add(leftBarrier, rightBarrier);

  const postStep = 4;
  const postCount = Math.floor(track.count / postStep) * 2;
  const postGeo = new THREE.BoxGeometry(0.18, 1.05, 0.18);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.6 });
  const postInst = new THREE.InstancedMesh(postGeo, postMat, postCount);
  const dummy = new THREE.Object3D();
  let pIdx = 0;
  for (let i = 0; i < track.count && pIdx + 1 < postCount; i += postStep) {
    const sp = track.samples[i];
    const yaw = -Math.atan2(sp.tz, sp.tx);
    for (const side of [-1, 1]) {
      const d = side * (BARRIER_HALF_WIDTH + 0.28);
      dummy.position.set(sp.x + sp.nx * d, 0.52, sp.z + sp.nz * d);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      postInst.setMatrixAt(pIdx++, dummy.matrix);
    }
  }
  postInst.count = pIdx;
  postInst.instanceMatrix.needsUpdate = true;
  postInst.computeBoundingSphere();
  scene.add(postInst);

  // Corner Warning Chevron Boards
  const chevronBoards: Array<{ idx: number; side: number }> = [];
  for (let i = 0; i < track.count; i += 6) {
    const k = track.samples[i].kappa;
    if (Math.abs(k) > 0.013) {
      chevronBoards.push({ idx: i, side: k > 0 ? -1 : 1 });
    }
  }
  if (chevronBoards.length > 0) {
    const chevGeo = new THREE.BoxGeometry(0.2, 0.9, 2.2);
    const chevMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.45 });
    const chevInst = new THREE.InstancedMesh(chevGeo, chevMat, chevronBoards.length);
    chevronBoards.forEach((b, idx) => {
      const sp = track.samples[b.idx];
      const d = b.side * (BARRIER_HALF_WIDTH + 0.5);
      dummy.position.set(sp.x + sp.nx * d, 1.35, sp.z + sp.nz * d);
      dummy.rotation.set(0, -Math.atan2(sp.tz, sp.tx) + Math.PI / 2, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      chevInst.setMatrixAt(idx, dummy.matrix);
    });
    chevInst.instanceMatrix.needsUpdate = true;
    chevInst.computeBoundingSphere();
    scene.add(chevInst);
  }

  // 8. Distance Braking Boards (150m, 100m, 50m) & Numbered Corner Markers (T1..T6)
  const board150 = createSignTexture('150m', 'BRAKE ZONE', '#0f172a', '#22c55e', '#ffffff', maxAniso);
  const board100 = createSignTexture('100m', 'BRAKE ZONE', '#0f172a', '#eab308', '#ffffff', maxAniso);
  const board50 = createSignTexture('50m', 'HARD BRAKE', '#0f172a', '#ef4444', '#ffffff', maxAniso);

  for (const cm of track.corners) {
    // Numbered corner marker outside the turn
    const outerSide = cm.turnDir > 0 ? -1 : 1;
    const cornerTex = createSignTexture(
      cm.label,
      cm.turnDir > 0 ? 'RIGHT TURN ->' : '<- LEFT TURN',
      '#1e293b',
      '#06b6d4',
      '#ffffff',
      maxAniso
    );
    const spCorner = track.sampleAtS(cm.apexS - 18);
    const signGroup = new THREE.Group();
    const dSign = outerSide * (BARRIER_HALF_WIDTH + 1.5);
    signGroup.position.set(spCorner.x + spCorner.nx * dSign, 0, spCorner.z + spCorner.nz * dSign);
    signGroup.rotation.y = -Math.atan2(spCorner.tz, spCorner.tx) + Math.PI / 2;
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 2.8, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x334155 })
    );
    pole.position.y = 1.4;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.5, 0.14),
      new THREE.MeshStandardMaterial({ map: cornerTex, roughness: 0.45 })
    );
    panel.position.y = 2.6;
    signGroup.add(pole, panel);
    scene.add(signGroup);

    // Braking distance boards before sharp corners (150m, 100m, 50m)
    if (cm.hasBrakingBoards) {
      const distConfigs = [
        { dist: 150, tex: board150 },
        { dist: 100, tex: board100 },
        { dist: 50, tex: board50 },
      ];
      for (const dc of distConfigs) {
        const spDist = track.sampleAtS(cm.apexS - dc.dist);
        const dPos = outerSide * (BARRIER_HALF_WIDTH + 1.1);
        const bg = new THREE.Group();
        bg.position.set(spDist.x + spDist.nx * dPos, 0, spDist.z + spDist.nz * dPos);
        bg.rotation.y = -Math.atan2(spDist.tz, spDist.tx) + Math.PI / 2;
        const p = new THREE.Mesh(
          new THREE.BoxGeometry(0.15, 2.0, 0.15),
          new THREE.MeshStandardMaterial({ color: 0x475569 })
        );
        p.position.y = 1.0;
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 1.2, 0.12),
          new THREE.MeshStandardMaterial({ map: dc.tex, roughness: 0.45 })
        );
        b.position.y = 2.1;
        bg.add(p, b);
        scene.add(bg);
      }
    }
  }

  // 9. Trackside Sponsor / Circuit Advertisements
  const ads = [
    { s: 75, d: 14.5, title: 'TURBOVEX 2.0', sub: 'ARCADE GP SERIES', bg: '#0f172a', acc: '#06b6d4' },
    { s: track.totalLength * 0.28, d: -14.5, title: 'NITRO X', sub: 'SHIFT TO BOOST', bg: '#1e1b4b', acc: '#38bdf8' },
    { s: track.totalLength * 0.46, d: 14.5, title: 'APEX GRIP', sub: 'DRIFT PRECISION', bg: '#18181b', acc: '#ef4444' },
    { s: track.totalLength * 0.74, d: -14.5, title: 'VELOCE GP', sub: 'WORLD CIRCUIT', bg: '#0f172a', acc: '#eab308' },
  ];
  for (const ad of ads) {
    const tex = createSignTexture(ad.title, ad.sub, ad.bg, ad.acc, '#ffffff', maxAniso);
    addTracksideBoard(scene, track, ad.s, ad.d, 10.5, 3.2, 3.2, tex, ad.d > 0);
  }

  // 10. Start/Finish Gantry
  const gantry = buildStartGantry(track, maxAniso, isSoftwareGl);
  scene.add(gantry.group);

  // 11. Grandstands with Animated Crowd
  const crowdDecks: THREE.Mesh[] = [];
  const gsPositions = [
    { s: track.totalLength - 35, d: -23, width: 48 },
    { s: 55, d: -23, width: 42 },
    { s: track.totalLength * 0.56, d: -24, width: 38 },
  ];
  for (const cfg of gsPositions) {
    const sp = track.sampleAtS(cfg.s);
    const gs = buildGrandstand(cfg.width, maxAniso, isSoftwareGl, crowdDecks);
    gs.position.set(sp.x + sp.nx * cfg.d, 0, sp.z + sp.nz * cfg.d);
    const tangentAngle = -Math.atan2(sp.tz, sp.tx);
    gs.rotation.y = tangentAngle + (cfg.d < 0 ? Math.PI : 0);
    scene.add(gs);
  }

  // 12. Tire Wall Stacks around Tight Hairpin to distinguish that section
  const hairpinCorner = track.corners.find((c) => c.label.includes('HAIRPIN'));
  if (hairpinCorner) {
    const tireGeo = new THREE.TorusGeometry(0.45, 0.22, 8, 14);
    tireGeo.rotateX(Math.PI / 2);
    const tireRedMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.85 });
    const tireWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.85 });
    for (let k = -24; k <= 24; k += 4) {
      const sp = track.sampleAtS(hairpinCorner.apexS + k);
      const outerSide = hairpinCorner.turnDir > 0 ? -1 : 1;
      const d = outerSide * (BARRIER_HALF_WIDTH + 1.2);
      for (let stack = 0; stack < 2; stack++) {
        const tm = new THREE.Mesh(tireGeo, (Math.abs(k / 4) + stack) % 2 === 0 ? tireRedMat : tireWhiteMat);
        tm.position.set(sp.x + sp.nx * d, 0.25 + stack * 0.42, sp.z + sp.nz * d);
        scene.add(tm);
      }
    }
  }

  // 13. Instanced Composite Trees around perimeter
  const maxTrees = 220;
  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.48, 3.4, 7);
  trunkGeo.translate(0, 1.7, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.92 });

  const crownLowGeo = new THREE.ConeGeometry(2.5, 4.4, 8);
  crownLowGeo.translate(0, 4.6, 0);
  const crownHighGeo = new THREE.ConeGeometry(1.85, 3.6, 8);
  crownHighGeo.translate(0, 6.8, 0);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, maxTrees);
  const crownLowInst = new THREE.InstancedMesh(crownLowGeo, foliageMat, maxTrees);
  const crownHighInst = new THREE.InstancedMesh(crownHighGeo, foliageMat, maxTrees);
  crownLowInst.castShadow = !isSoftwareGl;

  let tCount = 0;
  const foliagePalette = [
    new THREE.Color(0x166534),
    new THREE.Color(0x15803d),
    new THREE.Color(0x1e6b3a),
    new THREE.Color(0x2d6a4f),
  ];

  let hash = 1337;
  const nextRand = () => {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    return hash / 4294967296;
  };

  for (let attempt = 0; attempt < 1100 && tCount < maxTrees; attempt++) {
    const x = -250 + nextRand() * 540;
    const z = -65 + nextRand() * 365;

    let minD2 = Infinity;
    for (let i = 0; i < track.count; i += 2) {
      const sp = track.samples[i];
      const dx = x - sp.x;
      const dz = z - sp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD2) minD2 = d2;
    }

    if (minD2 < 24 * 24 || minD2 > 135 * 135) continue;
    if (z > -36 && z < -14 && x > -70 && x < 90) continue;

    const scale = 0.8 + nextRand() * 0.55;
    const yaw = nextRand() * Math.PI * 2;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(scale, scale * (0.9 + nextRand() * 0.25), scale);
    dummy.updateMatrix();

    trunkInst.setMatrixAt(tCount, dummy.matrix);
    crownLowInst.setMatrixAt(tCount, dummy.matrix);
    crownHighInst.setMatrixAt(tCount, dummy.matrix);

    const col = foliagePalette[tCount % foliagePalette.length];
    crownLowInst.setColorAt(tCount, col);
    crownHighInst.setColorAt(tCount, col.clone().offsetHSL(0.01, 0.04, 0.05));
    tCount++;
  }

  trunkInst.count = tCount;
  crownLowInst.count = tCount;
  crownHighInst.count = tCount;
  trunkInst.instanceMatrix.needsUpdate = true;
  crownLowInst.instanceMatrix.needsUpdate = true;
  crownHighInst.instanceMatrix.needsUpdate = true;
  if (crownLowInst.instanceColor) crownLowInst.instanceColor.needsUpdate = true;
  if (crownHighInst.instanceColor) crownHighInst.instanceColor.needsUpdate = true;
  trunkInst.computeBoundingSphere();
  crownLowInst.computeBoundingSphere();
  crownHighInst.computeBoundingSphere();

  scene.add(trunkInst, crownLowInst, crownHighInst);

  return { gantry, racingLineMesh, crowdDecks };
}
