import * as THREE from 'three';

const SKID_CAPACITY = 1600;
const SMOKE_CAPACITY = 260;
const DUST_CAPACITY = 180;
const SPARK_CAPACITY = 160;
const NITRO_CAPACITY = 140;

interface PoolParticle {
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
}

export class DriftEffectsPool {
  private skidMesh: THREE.InstancedMesh;
  private skidHead = 0;

  private smokeMesh: THREE.InstancedMesh;
  private smokeParticles: PoolParticle[] = [];
  private smokeHead = 0;

  private dustMesh: THREE.InstancedMesh;
  private dustParticles: PoolParticle[] = [];
  private dustHead = 0;

  private sparkMesh: THREE.InstancedMesh;
  private sparkParticles: PoolParticle[] = [];
  private sparkHead = 0;

  private nitroMesh: THREE.InstancedMesh;
  private nitroParticles: PoolParticle[] = [];
  private nitroHead = 0;

  private extraEffectsEnabled = true;
  private dummy = new THREE.Object3D();
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene) {
    // 1. Skid marks pool
    const skidGeo = new THREE.PlaneGeometry(0.95, 0.34);
    skidGeo.rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, SKID_CAPACITY);
    this.skidMesh.frustumCulled = false;
    for (let i = 0; i < SKID_CAPACITY; i++) this.skidMesh.setMatrixAt(i, this.zeroMatrix);
    this.skidMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.skidMesh);

    // 2. Tyre smoke pool
    const smokeGeo = new THREE.IcosahedronGeometry(0.42, 1);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    });
    this.smokeMesh = this.initPool(scene, smokeGeo, smokeMat, SMOKE_CAPACITY, this.smokeParticles);

    // 3. Off-track grass & dirt dust pool
    const dustGeo = new THREE.IcosahedronGeometry(0.36, 0);
    const dustMat = new THREE.MeshStandardMaterial({
      color: 0xa16207,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.dustMesh = this.initPool(scene, dustGeo, dustMat, DUST_CAPACITY, this.dustParticles);

    // 4. Hard collision sparks pool
    const sparkGeo = new THREE.BoxGeometry(0.28, 0.08, 0.08);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.95,
    });
    this.sparkMesh = this.initPool(scene, sparkGeo, sparkMat, SPARK_CAPACITY, this.sparkParticles);

    // 5. Nitro exhaust trail pool
    const nitroGeo = new THREE.BoxGeometry(0.95, 0.14, 0.14);
    const nitroMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.nitroMesh = this.initPool(scene, nitroGeo, nitroMat, NITRO_CAPACITY, this.nitroParticles);
  }

  private initPool(
    scene: THREE.Scene,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    capacity: number,
    arr: PoolParticle[]
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      arr.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        maxAge: 0.6,
        baseScale: 0.5,
      });
      mesh.setMatrixAt(i, this.zeroMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  setExtraEffectsEnabled(enabled: boolean): void {
    this.extraEffectsEnabled = enabled;
    if (!enabled) {
      this.clearDynamicParticles(this.sparkMesh, this.sparkParticles);
      this.clearDynamicParticles(this.nitroMesh, this.nitroParticles);
    }
  }

  emitSkid(carX: number, carZ: number, heading: number, intensity: number): void {
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const rx = -fz;
    const rz = fx;
    const yaw = -heading;
    const rearX = carX - fx * 1.32;
    const rearZ = carZ - fz * 1.32;
    const scaleX = 0.8 + intensity * 0.55;

    for (const side of [-0.88, 0.88]) {
      this.dummy.position.set(rearX + rx * side, 0.035, rearZ + rz * side);
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(scaleX, 1, 1);
      this.dummy.updateMatrix();
      this.skidMesh.setMatrixAt(this.skidHead, this.dummy.matrix);
      this.skidHead = (this.skidHead + 1) % SKID_CAPACITY;
    }
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  emitSmoke(carX: number, carZ: number, heading: number, intensity: number): void {
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const rx = -fz;
    const rz = fx;
    const rearX = carX - fx * 1.45;
    const rearZ = carZ - fz * 1.45;

    for (const side of [-0.85, 0.85]) {
      const p = this.smokeParticles[this.smokeHead];
      p.active = true;
      p.x = rearX + rx * side + (Math.random() - 0.5) * 0.3;
      p.y = 0.24 + Math.random() * 0.15;
      p.z = rearZ + rz * side + (Math.random() - 0.5) * 0.3;
      p.vx = (Math.random() - 0.5) * 1.6 - fx * 1.4;
      p.vy = 1.4 + Math.random() * 1.2 + intensity * 0.8;
      p.vz = (Math.random() - 0.5) * 1.6 - fz * 1.4;
      p.age = 0;
      p.maxAge = 0.55 + Math.random() * 0.35;
      p.baseScale = 0.45 + intensity * 0.55;
      this.smokeHead = (this.smokeHead + 1) % SMOKE_CAPACITY;
    }
  }

  emitDust(carX: number, carZ: number, heading: number, intensity: number): void {
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const rx = -fz;
    const rz = fx;
    for (const side of [-0.85, 0.85]) {
      const p = this.dustParticles[this.dustHead];
      p.active = true;
      p.x = carX - fx * 1.5 + rx * side;
      p.y = 0.22;
      p.z = carZ - fz * 1.5 + rz * side;
      p.vx = (Math.random() - 0.5) * 2.2 - fx * 2.0;
      p.vy = 1.6 + Math.random() * 1.4;
      p.vz = (Math.random() - 0.5) * 2.2 - fz * 2.0;
      p.age = 0;
      p.maxAge = 0.45 + Math.random() * 0.25;
      p.baseScale = 0.45 + intensity * 0.5;
      this.dustHead = (this.dustHead + 1) % DUST_CAPACITY;
    }
  }

  emitSparks(x: number, z: number, intensity: number): void {
    if (!this.extraEffectsEnabled) return;
    const count = Math.min(18, Math.round(6 + intensity * 12));
    for (let i = 0; i < count; i++) {
      const p = this.sparkParticles[this.sparkHead];
      const ang = Math.random() * Math.PI * 2;
      const spd = 6 + Math.random() * 12 * (0.5 + intensity);
      p.active = true;
      p.x = x;
      p.y = 0.5 + Math.random() * 0.35;
      p.z = z;
      p.vx = Math.cos(ang) * spd;
      p.vy = 3.0 + Math.random() * 5.0;
      p.vz = Math.sin(ang) * spd;
      p.age = 0;
      p.maxAge = 0.28 + Math.random() * 0.22;
      p.baseScale = 0.8 + Math.random() * 0.7;
      this.sparkHead = (this.sparkHead + 1) % SPARK_CAPACITY;
    }
  }

  emitNitroTrail(carX: number, carZ: number, heading: number): void {
    if (!this.extraEffectsEnabled) return;
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const rx = -fz;
    const rz = fx;
    for (const side of [-0.42, 0.42]) {
      const p = this.nitroParticles[this.nitroHead];
      p.active = true;
      p.x = carX - fx * 2.25 + rx * side;
      p.y = 0.34;
      p.z = carZ - fz * 2.25 + rz * side;
      p.vx = -fx * 4.5;
      p.vy = 0;
      p.vz = -fz * 4.5;
      p.age = 0;
      p.maxAge = 0.24;
      p.baseScale = 1.0;
      this.nitroHead = (this.nitroHead + 1) % NITRO_CAPACITY;
    }
  }

  private updatePool(
    dt: number,
    mesh: THREE.InstancedMesh,
    particles: PoolParticle[],
    gravity: number,
    growRate: number,
    alignVelocity: boolean
  ): void {
    let anyChange = false;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!p.active) continue;
      anyChange = true;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        mesh.setMatrixAt(i, this.zeroMatrix);
        continue;
      }
      p.vy -= gravity * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.05, p.y + p.vy * dt);
      p.z += p.vz * dt;
      p.vx *= 0.96;
      p.vz *= 0.96;

      const t = p.age / p.maxAge;
      const scale = p.baseScale * (1 + t * growRate) * (1 - t * 0.45);
      this.dummy.position.set(p.x, p.y, p.z);
      if (alignVelocity) {
        this.dummy.rotation.set(0, -Math.atan2(p.vz, p.vx), 0);
      } else {
        this.dummy.rotation.set(t * 2, t * 1.5, 0);
      }
      this.dummy.scale.setScalar(Math.max(0.01, scale));
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (anyChange) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.updatePool(dt, this.smokeMesh, this.smokeParticles, -0.4, 2.2, false);
    this.updatePool(dt, this.dustMesh, this.dustParticles, 2.2, 1.8, false);
    this.updatePool(dt, this.sparkMesh, this.sparkParticles, 14.0, -0.4, true);
    this.updatePool(dt, this.nitroMesh, this.nitroParticles, 0, -0.5, true);
  }

  private clearDynamicParticles(mesh: THREE.InstancedMesh, particles: PoolParticle[]): void {
    for (let i = 0; i < particles.length; i++) {
      particles[i].active = false;
      mesh.setMatrixAt(i, this.zeroMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < SKID_CAPACITY; i++) {
      this.skidMesh.setMatrixAt(i, this.zeroMatrix);
    }
    this.skidHead = 0;
    this.skidMesh.instanceMatrix.needsUpdate = true;

    this.clearDynamicParticles(this.smokeMesh, this.smokeParticles);
    this.clearDynamicParticles(this.dustMesh, this.dustParticles);
    this.clearDynamicParticles(this.sparkMesh, this.sparkParticles);
    this.clearDynamicParticles(this.nitroMesh, this.nitroParticles);
  }
}
