import * as THREE from 'three';
import { TrackConfig } from '../types/racing';
import {
  createAsphaltTexture,
  createDesertSandGroundTexture,
  createGravelPatchDecalTexture,
  createGroundRoughnessSheenMap,
  createSandstoneBandedTexture,
  createSoftCloudSpriteTexture,
  createSponsorBannerTexture,
  createStartFinishTexture,
  createTireSkidPatchTexture,
} from './proceduralTextures';

export const TRACK_LENGTH = 2400; // meters per lap
export const ROAD_HALF_WIDTH = 11.5; // 23m wide Grand Touring circuit

// Reusable module-scope math vectors to guarantee zero GC in render loop
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export interface TrackFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  bankAngle: number;
  curvature: number;
}

export interface BoostPadZone {
  trackDistance: number;
  lateralOffset: number;
  mesh: THREE.Mesh;
}

export interface BuiltTrack {
  group: THREE.Group;
  asphaltTexture: THREE.CanvasTexture;
  boostPads: BoostPadZone[];
  gantryLights: THREE.MeshStandardMaterial[];
  updateEnvironment: (elapsed: number, cameraPos: THREE.Vector3) => void;
  dispose: () => void;
}

/**
 * Evaluates the closed-loop 2400m Grand Touring circuit at distance `s` (in meters).
 * Combines a base oval with multi-harmonic sweeping S-curves, hairpin chicanes, and rolling hills.
 */
export function getTrackCenterPosition(s: number, target: THREE.Vector3): THREE.Vector3 {
  const normalized = ((s % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
  const theta = (normalized / TRACK_LENGTH) * Math.PI * 2;

  // Base circuit radii + harmonic corners (high-speed straight near theta=0, technical sector at theta=PI)
  const rX = 360 + 85 * Math.cos(2 * theta) - 42 * Math.sin(3 * theta);
  const rZ = 270 + 65 * Math.sin(2 * theta) + 38 * Math.cos(4 * theta);

  const x = Math.sin(theta) * rX;
  const z = -Math.cos(theta) * rZ;

  // Smooth rolling elevation (flat at y=0 around start/finish line near theta=0, strictly >= 0 so it never dips below ground)
  const hillMask = Math.pow(Math.sin(theta * 0.5), 2);
  const rawHill =
    0.52 + 0.31 * Math.sin(2 * theta - 0.4) + 0.17 * Math.cos(3 * theta);
  const y = hillMask * rawHill * 18.0;

  return target.set(x, y, z);
}

/**
 * Computes exact terrain/embankment surface Y at a given lateral distance from track center
 * so trackside props and decals sit flush on the shoulder slope or ground floor.
 */
function getEmbankmentSurfaceY(
  frame: TrackFrame,
  side: number,
  latDist: number,
  groundY: number = -18.0
): number {
  const edgeY =
    frame.position.y + side * frame.right.y * ROAD_HALF_WIDTH;
  const skirtOuterLat = ROAD_HALF_WIDTH + 18.0;
  if (latDist <= ROAD_HALF_WIDTH) {
    return edgeY;
  }
  if (latDist >= skirtOuterLat) {
    return groundY;
  }
  const t = (latDist - ROAD_HALF_WIDTH) / 18.0;
  return THREE.MathUtils.lerp(edgeY - 0.06, groundY, t);
}

/**
 * Computes position, forward tangent, lateral right vector, surface normal, and banking at distance `s`.
 * Zero heap allocations when passing pre-allocated `TrackFrame`.
 */
export function evaluateTrackFrame(s: number, outFrame: TrackFrame): void {
  const eps = 1.2;
  getTrackCenterPosition(s, outFrame.position);
  getTrackCenterPosition(s + eps, _p1);
  getTrackCenterPosition(s - eps, _p0);

  // Forward tangent
  outFrame.tangent.subVectors(_p1, _p0).normalize();

  // Approximate horizontal curvature for banking & AI speed modulation
  const dx1 = _p1.x - outFrame.position.x;
  const dz1 = _p1.z - outFrame.position.z;
  const dx0 = outFrame.position.x - _p0.x;
  const dz0 = outFrame.position.z - _p0.z;
  const crossY = dx0 * dz1 - dz0 * dx1;
  const curvature = THREE.MathUtils.clamp(crossY * 0.45, -0.22, 0.22);
  outFrame.curvature = curvature;
  outFrame.bankAngle = THREE.MathUtils.clamp(-curvature * 0.65, -0.14, 0.14);

  // Right vector perpendicular to tangent and world up, then banked slightly
  outFrame.right.crossVectors(outFrame.tangent, _up).normalize();
  outFrame.up.crossVectors(outFrame.right, outFrame.tangent).normalize();

  if (Math.abs(outFrame.bankAngle) > 0.0001) {
    outFrame.right.applyAxisAngle(outFrame.tangent, outFrame.bankAngle);
    outFrame.up.crossVectors(outFrame.right, outFrame.tangent).normalize();
  }
}

/**
 * Builds a distant mountain silhouette ring geometry with multi-height segments
 * so vUv.y cleanly interpolates from 0.0 (base) to 1.0 (jagged ridge crest) for rim lighting & haze.
 */
function createCanyonHorizonRingGeometry(
  radius: number,
  baseHeight: number,
  peakVariance: number,
  seedOffset: number
): THREE.BufferGeometry {
  const radialSegments = 160;
  const heightSegments = 4;
  const geo = new THREE.CylinderGeometry(
    radius,
    radius * 1.05,
    baseHeight,
    radialSegments,
    heightSegments,
    true
  );
  const pos = geo.attributes.position;
  const uvs = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const v = uvs.getY(i); // 0 at bottom to 1 at top crest
    const vx = pos.getX(i);
    const vz = pos.getZ(i);
    const angle = Math.atan2(vz, vx);

    // Jagged mountain ridge profile combining sharp peaks and stepped mesas
    const wave =
      Math.sin(angle * 6 + seedOffset) * 0.45 +
      Math.cos(angle * 13 - seedOffset * 1.7) * 0.32 +
      Math.sin(angle * 23 + seedOffset * 0.8) * 0.16 +
      Math.cos(angle * 37 - seedOffset * 2.3) * 0.07;
    const ridgeHeight = baseHeight * 0.55 + wave * peakVariance;
    const bottomY = -28;
    pos.setY(i, THREE.MathUtils.lerp(bottomY, ridgeHeight, v));
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildRacingTrack(
  config: TrackConfig,
  maxAnisotropy: number
): BuiltTrack {
  const group = new THREE.Group();
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];
  const texturesToDispose: THREE.Texture[] = [];

  const isMidnight = config.id === 'midnight';
  const isCanyon = config.id === 'canyon';

  // ============================================================================
  // 1. GRADIENT SUNSET SKY DOME, GLOWING HORIZON SUN & DRIFTING CLOUDS + STARS
  // ============================================================================
  const skyDomeGroup = new THREE.Group();
  group.add(skyDomeGroup);

  const sunDirection = new THREE.Vector3(-0.55, 0.13, -0.82).normalize();

  const skyGeo = new THREE.SphereGeometry(860, 36, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTopColor: {
        value: new THREE.Color(
          isCanyon ? '#120724' : isMidnight ? '#03050C' : '#0F243C'
        ),
      },
      uMidColor: {
        value: new THREE.Color(
          isCanyon ? '#7A1C54' : isMidnight ? '#0B1938' : '#254E70'
        ),
      },
      uHorizonColor: {
        value: new THREE.Color(
          isCanyon ? '#FF7B54' : isMidnight ? '#152C5B' : '#7DD3FC'
        ),
      },
      uLowerColor: {
        value: new THREE.Color(
          isCanyon ? '#4A1D28' : isMidnight ? '#060A14' : '#1E293B'
        ),
      },
      uSunDir: { value: sunDirection },
      uSunColor: {
        value: new THREE.Color(
          isCanyon ? '#FFF099' : isMidnight ? '#60A5FA' : '#FFFBEB'
        ),
      },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDir;
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uLowerColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uTime;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = dir.y;

        // Multi-stop sunset gradient: lower ground -> horizon orange/pink -> mid magenta -> deep purple zenith
        vec3 col = uHorizonColor;
        if (h >= 0.0) {
          float t1 = smoothstep(0.0, 0.24, h);
          float t2 = smoothstep(0.18, 0.72, h);
          col = mix(uHorizonColor, uMidColor, t1);
          col = mix(col, uTopColor, t2);
        } else {
          col = mix(uHorizonColor, uLowerColor, smoothstep(0.0, -0.25, h));
        }

        // Warm atmospheric solar glow & soft horizon bloom around low sun
        float sunAlignment = max(0.0, dot(dir, uSunDir));
        float sunHalo = pow(sunAlignment, 6.0) * 0.48 + pow(sunAlignment, 36.0) * 0.75;
        col += uSunColor * sunHalo;

        // Faint twinkling stars near top zenith
        if (h > 0.22) {
          vec2 starGrid = floor(dir.xz * 260.0);
          float r = hash(starGrid);
          if (r > 0.9945) {
            float twinkle = 0.55 + 0.45 * sin(uTime * 2.4 + r * 90.0);
            float zenithMask = smoothstep(0.22, 0.58, h);
            col += vec3(0.95, 0.9, 1.0) * twinkle * zenithMask * 0.85;
          }
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyDomeGroup.add(skyMesh);
  geometriesToDispose.push(skyGeo);
  materialsToDispose.push(skyMat);

  // Large Glowing Sun Disc + Soft Halo Rings Low on the Horizon
  const sunDist = 790;
  const sunPos = sunDirection.clone().multiplyScalar(sunDist);

  const sunDiscGeo = new THREE.CircleGeometry(isCanyon ? 52 : 34, 32);
  const sunDiscMat = new THREE.MeshBasicMaterial({
    color: isCanyon ? 0xfff3b0 : isMidnight ? 0x93c5fd : 0xffffff,
    fog: false,
    depthWrite: false,
  });
  const sunDiscMesh = new THREE.Mesh(sunDiscGeo, sunDiscMat);
  sunDiscMesh.position.copy(sunPos);
  sunDiscMesh.lookAt(0, 0, 0);
  skyDomeGroup.add(sunDiscMesh);
  geometriesToDispose.push(sunDiscGeo);
  materialsToDispose.push(sunDiscMat);

  const sunHaloGeo = new THREE.CircleGeometry(isCanyon ? 135 : 75, 32);
  const sunHaloMat = new THREE.MeshBasicMaterial({
    color: isCanyon ? 0xff7b54 : 0x38bdf8,
    transparent: true,
    opacity: isCanyon ? 0.34 : 0.18,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
  });
  const sunHaloMesh = new THREE.Mesh(sunHaloGeo, sunHaloMat);
  sunHaloMesh.position.copy(sunPos).multiplyScalar(0.995);
  sunHaloMesh.lookAt(0, 0, 0);
  skyDomeGroup.add(sunHaloMesh);
  geometriesToDispose.push(sunHaloGeo);
  materialsToDispose.push(sunHaloMat);

  // Soft, Semi-Transparent Noise-Textured Cloud Sprites (Omitted for Night Scenes)
  const cloudGroup = new THREE.Group();
  skyDomeGroup.add(cloudGroup);

  const dummy = new THREE.Object3D();
  const tempColor = new THREE.Color();

  if (!isMidnight) {
    const cloudSpriteTex = createSoftCloudSpriteTexture();
    texturesToDispose.push(cloudSpriteTex);

    const cloudCount = 26;
    for (let i = 0; i < cloudCount; i++) {
      const spriteMat = new THREE.SpriteMaterial({
        map: cloudSpriteTex,
        color: isCanyon
          ? i % 2 === 0
            ? 0xffcba4
            : 0xf9a8d4
          : 0xe2e8f0,
        transparent: true,
        opacity: isCanyon ? 0.52 : 0.44,
        depthWrite: false,
        fog: false,
      });
      materialsToDispose.push(spriteMat);

      const sprite = new THREE.Sprite(spriteMat);
      const angle = (i / cloudCount) * Math.PI * 2 + (i % 3) * 0.14;
      const rad = 520 + (i % 4) * 55;
      const y = 115 + (i % 5) * 24;
      sprite.position.set(Math.cos(angle) * rad, y, Math.sin(angle) * rad);

      const width = 135 + (i % 5) * 32;
      const height = width * 0.46;
      sprite.scale.set(width, height, 1);
      cloudGroup.add(sprite);
    }
  }

  // ============================================================================
  // 2. MOUNTAIN SILHOUETTES (3 LAYERS: FARTHER LAYERS LIGHTER WITH ATMOSPHERIC HAZE + MOONLIGHT RIM)
  // ============================================================================
  const hazeColor = new THREE.Color(
    isCanyon ? '#C0565B' : isMidnight ? '#1E3A6D' : '#4E7396'
  );
  const moonRimColor = new THREE.Color(
    isCanyon ? '#E2D4F0' : isMidnight ? '#BAE6FD' : '#E0F2FE'
  );
  const moonDir = new THREE.Vector3(0.48, 0.62, 0.62).normalize();

  // Farther layers have higher hazeFactor so they appear progressively lighter & hazier
  const horizonLayers = [
    {
      radius: 565,
      height: 88,
      variance: 36,
      baseColor: isCanyon ? '#260E22' : isMidnight ? '#060B16' : '#0E1A2B',
      hazeFactor: 0.14,
      rimStrength: 0.36,
      seed: 1.1,
    },
    {
      radius: 675,
      height: 124,
      variance: 48,
      baseColor: isCanyon ? '#3D1731' : isMidnight ? '#0C162B' : '#182C44',
      hazeFactor: 0.42,
      rimStrength: 0.28,
      seed: 2.7,
    },
    {
      radius: 785,
      height: 162,
      variance: 62,
      baseColor: isCanyon ? '#592342' : isMidnight ? '#142442' : '#24405E',
      hazeFactor: 0.68,
      rimStrength: 0.22,
      seed: 4.3,
    },
  ];

  horizonLayers.forEach((layer) => {
    const wallGeo = createCanyonHorizonRingGeometry(
      layer.radius,
      layer.height,
      layer.variance,
      layer.seed
    );
    const wallMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: false,
      uniforms: {
        uBaseColor: { value: new THREE.Color(layer.baseColor) },
        uHazeColor: { value: hazeColor },
        uMoonRimColor: { value: moonRimColor },
        uMoonDir: { value: moonDir },
        uHazeFactor: { value: layer.hazeFactor },
        uRimStrength: { value: layer.rimStrength },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
          vUv = uv;
          vWorldNormal = normalize(mat3(modelMatrix) * (-normal));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        uniform vec3 uBaseColor;
        uniform vec3 uHazeColor;
        uniform vec3 uMoonRimColor;
        uniform vec3 uMoonDir;
        uniform float uHazeFactor;
        uniform float uRimStrength;

        void main() {
          // Blend mountain silhouette with atmospheric haze (farther layers lighter)
          // Extra vertical haze near the lower valley floor
          float baseHaze = mix(uHazeFactor + 0.18, uHazeFactor, smoothstep(0.0, 0.65, vUv.y));
          vec3 col = mix(uBaseColor, uHazeColor, clamp(baseHaze, 0.0, 0.85));

          // Subtle moonlight rim lighting along the upper jagged mountain ridge crest
          float crestMask = smoothstep(0.76, 0.99, vUv.y);
          float moonFacing = 0.45 + 0.55 * max(0.0, dot(normalize(vWorldNormal), uMoonDir));
          float rim = pow(crestMask, 2.2) * moonFacing * uRimStrength;
          col += uMoonRimColor * rim;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.position.y = layer.height * 0.28 - 18;
    group.add(wallMesh);
    geometriesToDispose.push(wallGeo);
    materialsToDispose.push(wallMat);
  });

  // ============================================================================
  // 3. TEXTURED SAND/DIRT GROUND WITH NOISE, GRAVEL PATCHES & CONTROLLED SHEEN
  // ============================================================================
  const asphaltTexture = createAsphaltTexture(
    maxAnisotropy,
    config.curbPrimaryHex,
    config.curbSecondaryHex,
    isMidnight
  );
  const groundSandTexture = createDesertSandGroundTexture(
    maxAnisotropy,
    config.groundHex,
    isCanyon
  );
  const groundSheenMap = createGroundRoughnessSheenMap(maxAnisotropy);
  const gravelPatchTexture = createGravelPatchDecalTexture(maxAnisotropy);
  const sandstoneTexture = createSandstoneBandedTexture(maxAnisotropy);
  const skidPatchTexture = createTireSkidPatchTexture(maxAnisotropy);
  texturesToDispose.push(
    asphaltTexture,
    groundSandTexture,
    groundSheenMap,
    gravelPatchTexture,
    sandstoneTexture,
    skidPatchTexture
  );

  // Textured Ground Terrain Plane with Subtle Moonlit Sheen (No Clearcoat Hotspot Glare)
  const groundGeo = new THREE.PlaneGeometry(3600, 3600, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundSandTexture,
    roughnessMap: groundSheenMap,
    roughness: 0.88,
    metalness: 0.06,
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.position.y = -18;
  groundMesh.receiveShadow = true;
  group.add(groundMesh);
  geometriesToDispose.push(groundGeo);
  materialsToDispose.push(groundMat);

  // Closed-Loop 3D Ribbon Road & Textured Sand Embankment Skirt
  const segments = 480;
  const roadPositions: number[] = [];
  const roadNormals: number[] = [];
  const roadUvs: number[] = [];
  const roadIndices: number[] = [];

  const skirtPositions: number[] = [];
  const skirtNormals: number[] = [];
  const skirtUvs: number[] = [];
  const skirtIndices: number[] = [];

  const frame: TrackFrame = {
    position: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    bankAngle: 0,
    curvature: 0,
  };

  const leftEdge = new THREE.Vector3();
  const rightEdge = new THREE.Vector3();
  const leftSkirtBottom = new THREE.Vector3();
  const rightSkirtBottom = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const s = (i / segments) * TRACK_LENGTH;
    evaluateTrackFrame(s, frame);

    leftEdge.copy(frame.position).addScaledVector(frame.right, -ROAD_HALF_WIDTH);
    rightEdge.copy(frame.position).addScaledVector(frame.right, ROAD_HALF_WIDTH);

    leftEdge.y += 0.04;
    rightEdge.y += 0.04;

    roadPositions.push(leftEdge.x, leftEdge.y, leftEdge.z);
    roadPositions.push(rightEdge.x, rightEdge.y, rightEdge.z);

    roadNormals.push(frame.up.x, frame.up.y, frame.up.z);
    roadNormals.push(frame.up.x, frame.up.y, frame.up.z);

    const v = (i / segments) * 110;
    roadUvs.push(0, v);
    roadUvs.push(1, v);

    // Embankment shoulders sloping down to desert floor
    leftSkirtBottom
      .copy(frame.position)
      .addScaledVector(frame.right, -(ROAD_HALF_WIDTH + 18));
    leftSkirtBottom.y = -18.2;

    rightSkirtBottom
      .copy(frame.position)
      .addScaledVector(frame.right, ROAD_HALF_WIDTH + 18);
    rightSkirtBottom.y = -18.2;

    skirtPositions.push(
      leftSkirtBottom.x,
      leftSkirtBottom.y,
      leftSkirtBottom.z,
      leftEdge.x,
      leftEdge.y - 0.06,
      leftEdge.z,
      rightEdge.x,
      rightEdge.y - 0.06,
      rightEdge.z,
      rightSkirtBottom.x,
      rightSkirtBottom.y,
      rightSkirtBottom.z
    );

    const sv = (i / segments) * 60;
    skirtUvs.push(0, sv, 0.3, sv, 0.7, sv, 1, sv);

    for (let k = 0; k < 4; k++) {
      skirtNormals.push(0, 1, 0);
    }

    if (i < segments) {
      const rBase = i * 2;
      roadIndices.push(rBase, rBase + 1, rBase + 2);
      roadIndices.push(rBase + 1, rBase + 3, rBase + 2);

      const sBase = i * 4;
      for (let col = 0; col < 3; col++) {
        const a = sBase + col;
        const b = sBase + col + 1;
        const c = sBase + 4 + col;
        const d = sBase + 4 + col + 1;
        skirtIndices.push(a, b, c);
        skirtIndices.push(b, d, c);
      }
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeBoundingSphere();

  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTexture,
    roughness: isMidnight ? 0.42 : 0.65,
    metalness: isMidnight ? 0.25 : 0.12,
  });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);
  geometriesToDispose.push(roadGeo);
  materialsToDispose.push(roadMat);

  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPositions, 3));
  skirtGeo.setAttribute('normal', new THREE.Float32BufferAttribute(skirtNormals, 3));
  skirtGeo.setAttribute('uv', new THREE.Float32BufferAttribute(skirtUvs, 2));
  skirtGeo.setIndex(skirtIndices);
  skirtGeo.computeVertexNormals();
  skirtGeo.computeBoundingSphere();

  const skirtMat = new THREE.MeshStandardMaterial({
    map: groundSandTexture,
    roughnessMap: groundSheenMap,
    color: new THREE.Color(isCanyon ? '#C26A4A' : '#475569'),
    roughness: 0.86,
    metalness: 0.06,
  });
  const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
  skirtMesh.receiveShadow = true;
  group.add(skirtMesh);
  geometriesToDispose.push(skirtGeo);
  materialsToDispose.push(skirtMat);

  // Scattered Trackside Gravel Patches with Subtle Moonlit Sheen (InstancedMesh)
  const gravelPatchCount = 44;
  const gravelPatchGeo = new THREE.PlaneGeometry(7.5, 11.5);
  gravelPatchGeo.rotateX(-Math.PI / 2);
  const gravelPatchMat = new THREE.MeshStandardMaterial({
    map: gravelPatchTexture,
    roughness: 0.82,
    metalness: 0.08,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const gravelPatchInst = new THREE.InstancedMesh(
    gravelPatchGeo,
    gravelPatchMat,
    gravelPatchCount
  );
  geometriesToDispose.push(gravelPatchGeo);
  materialsToDispose.push(gravelPatchMat);

  for (let i = 0; i < gravelPatchCount; i++) {
    const s = (i / gravelPatchCount) * TRACK_LENGTH + 15;
    evaluateTrackFrame(s, frame);
    const side = i % 2 === 0 ? 1 : -1;
    const latOffset = ROAD_HALF_WIDTH + 2.8 + (i % 3) * 1.6;
    dummy.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * latOffset);
    dummy.position.y = getEmbankmentSurfaceY(frame, side, latOffset) + 0.05;

    const lookPt = new THREE.Vector3().copy(dummy.position).add(frame.tangent);
    dummy.lookAt(lookPt);
    dummy.rotation.z = side * -0.42;
    const sc = 0.8 + (i % 4) * 0.25;
    dummy.scale.set(sc, 1, sc * 1.15);
    dummy.updateMatrix();
    gravelPatchInst.setMatrixAt(i, dummy.matrix);
  }
  gravelPatchInst.instanceMatrix.needsUpdate = true;
  gravelPatchInst.computeBoundingSphere();
  group.add(gravelPatchInst);

  // ============================================================================
  // 4. VARIED LAYERED CANYON FORMATIONS (MESAS, PILLARS, ARCHES & BOULDERS)
  // ============================================================================
  const bandedRockMat = new THREE.MeshStandardMaterial({
    map: sandstoneTexture,
    roughness: 0.84,
    metalness: 0.06,
  });
  materialsToDispose.push(bandedRockMat);

  // Formation A: Stepped Flat-Top Mesas (Base + Upper Plateau Cap)
  const mesaCount = 52;
  const mesaBaseGeo = new THREE.CylinderGeometry(5.5, 9.2, 16, 7);
  mesaBaseGeo.translate(0, 8, 0);
  const mesaCapGeo = new THREE.CylinderGeometry(4.2, 5.2, 8.5, 7);
  mesaCapGeo.translate(0, 20, 0);

  const mesaBaseInst = new THREE.InstancedMesh(mesaBaseGeo, bandedRockMat, mesaCount);
  const mesaCapInst = new THREE.InstancedMesh(mesaCapGeo, bandedRockMat, mesaCount);
  mesaBaseInst.castShadow = true;
  mesaBaseInst.receiveShadow = true;
  mesaCapInst.castShadow = true;
  geometriesToDispose.push(mesaBaseGeo, mesaCapGeo);

  for (let i = 0; i < mesaCount; i++) {
    const s = (i / mesaCount) * TRACK_LENGTH + (i % 3) * 11;
    evaluateTrackFrame(s, frame);
    const side = i % 2 === 0 ? 1 : -1;
    const latDist = ROAD_HALF_WIDTH + 34 + ((i * 19) % 75);

    dummy.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * latDist);
    dummy.position.y = -18.2;

    const sx = 1.1 + ((i * 23) % 140) / 100;
    const sy = 0.85 + ((i * 31) % 130) / 100;
    const sz = 1.1 + ((i * 17) % 140) / 100;
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(0, (i * 1.37) % (Math.PI * 2), 0);
    dummy.updateMatrix();

    mesaBaseInst.setMatrixAt(i, dummy.matrix);
    mesaCapInst.setMatrixAt(i, dummy.matrix);

    tempColor.set(
      isCanyon
        ? i % 3 === 0
          ? '#F97316'
          : i % 3 === 1
            ? '#EA580C'
            : '#D97706'
        : isMidnight
          ? '#334155'
          : '#64748B'
    );
    mesaBaseInst.setColorAt(i, tempColor);
    mesaCapInst.setColorAt(i, tempColor.clone().multiplyScalar(1.12));
  }
  mesaBaseInst.instanceMatrix.needsUpdate = true;
  mesaCapInst.instanceMatrix.needsUpdate = true;
  if (mesaBaseInst.instanceColor) mesaBaseInst.instanceColor.needsUpdate = true;
  if (mesaCapInst.instanceColor) mesaCapInst.instanceColor.needsUpdate = true;
  mesaBaseInst.computeBoundingSphere();
  mesaCapInst.computeBoundingSphere();
  group.add(mesaBaseInst, mesaCapInst);

  // Formation B: Tall Layered Sandstone Pillars / Hoodoos
  const pillarCount = 64;
  const rockPillarGeo = new THREE.CylinderGeometry(1.3, 2.6, 26, 6, 4);
  rockPillarGeo.translate(0, 13, 0);
  // Pinch/bulge strata rings along pillar height
  const pPos = rockPillarGeo.attributes.position;
  for (let k = 0; k < pPos.count; k++) {
    const py = pPos.getY(k);
    const bulge = 1 + 0.22 * Math.sin(py * 0.85);
    pPos.setX(k, pPos.getX(k) * bulge);
    pPos.setZ(k, pPos.getZ(k) * bulge);
  }
  rockPillarGeo.computeVertexNormals();

  const pillarInst = new THREE.InstancedMesh(rockPillarGeo, bandedRockMat, pillarCount);
  pillarInst.castShadow = true;
  geometriesToDispose.push(rockPillarGeo);

  for (let i = 0; i < pillarCount; i++) {
    const s = (i / pillarCount) * TRACK_LENGTH + 18;
    evaluateTrackFrame(s, frame);
    const side = (i + 1) % 2 === 0 ? 1 : -1;
    const latDist = ROAD_HALF_WIDTH + 20 + ((i * 29) % 55);

    dummy.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * latDist);
    dummy.position.y = -18.2;

    const wScale = 0.8 + ((i * 13) % 90) / 100;
    const hScale = 0.75 + ((i * 37) % 140) / 100;
    dummy.scale.set(wScale, hScale, wScale * (0.85 + ((i * 7) % 30) / 100));
    dummy.rotation.set(
      ((i % 5) - 2) * 0.02,
      (i * 2.1) % (Math.PI * 2),
      ((i % 7) - 3) * 0.02
    );
    dummy.updateMatrix();
    pillarInst.setMatrixAt(i, dummy.matrix);

    tempColor.set(isCanyon ? (i % 2 === 0 ? '#EA580C' : '#F59E0B') : '#475569');
    pillarInst.setColorAt(i, tempColor);
  }
  pillarInst.instanceMatrix.needsUpdate = true;
  if (pillarInst.instanceColor) pillarInst.instanceColor.needsUpdate = true;
  pillarInst.computeBoundingSphere();
  group.add(pillarInst);

  // Formation C: Natural Sandstone Canyon Arches
  const archCount = 16;
  const archGeo = new THREE.TorusGeometry(11, 2.6, 7, 16, Math.PI);
  const archInst = new THREE.InstancedMesh(archGeo, bandedRockMat, archCount);
  archInst.castShadow = true;
  geometriesToDispose.push(archGeo);

  for (let i = 0; i < archCount; i++) {
    const s = (i / archCount) * TRACK_LENGTH + 75;
    evaluateTrackFrame(s, frame);
    const side = i % 2 === 0 ? 1 : -1;
    const latDist = ROAD_HALF_WIDTH + 26 + (i % 3) * 14;

    dummy.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * latDist);
    dummy.position.y = -16.5;
    dummy.rotation.set(0, (i * 0.9) % Math.PI, 0);
    const sc = 0.9 + (i % 4) * 0.28;
    dummy.scale.set(sc * 1.2, sc, sc * 0.85);
    dummy.updateMatrix();
    archInst.setMatrixAt(i, dummy.matrix);
    tempColor.set(isCanyon ? '#C2410C' : '#475569');
    archInst.setColorAt(i, tempColor);
  }
  archInst.instanceMatrix.needsUpdate = true;
  if (archInst.instanceColor) archInst.instanceColor.needsUpdate = true;
  archInst.computeBoundingSphere();
  group.add(archInst);

  // Formation D: Scattered Boulders & Track-Edge Small Rocks
  const boulderCount = 140;
  const boulderGeo = new THREE.DodecahedronGeometry(1.6, 1);
  boulderGeo.translate(0, 0.9, 0);
  const boulderInst = new THREE.InstancedMesh(boulderGeo, bandedRockMat, boulderCount);
  geometriesToDispose.push(boulderGeo);

  for (let i = 0; i < boulderCount; i++) {
    const s = (i / boulderCount) * TRACK_LENGTH;
    evaluateTrackFrame(s, frame);
    const side = i % 2 === 0 ? 1 : -1;
    // Half near the road shoulder, half further out in the desert
    const isNearEdge = i % 3 !== 0;
    const latDist = isNearEdge
      ? ROAD_HALF_WIDTH + 2.8 + (i % 5) * 1.4
      : ROAD_HALF_WIDTH + 15 + (i % 9) * 3.5;

    dummy.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * latDist);
    dummy.position.y = getEmbankmentSurfaceY(frame, side, latDist);

    const sx = isNearEdge ? 0.45 + (i % 4) * 0.25 : 1.4 + (i % 5) * 0.8;
    const sy = sx * (0.55 + (i % 3) * 0.2);
    const sz = sx * (0.8 + (i % 4) * 0.25);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(i * 0.4, i * 1.1, (i % 3) * 0.2);
    dummy.updateMatrix();
    boulderInst.setMatrixAt(i, dummy.matrix);

    tempColor.set(
      isCanyon
        ? i % 2 === 0
          ? '#B45309'
          : '#9A3412'
        : '#475569'
    );
    boulderInst.setColorAt(i, tempColor);
  }
  boulderInst.instanceMatrix.needsUpdate = true;
  if (boulderInst.instanceColor) boulderInst.instanceColor.needsUpdate = true;
  boulderInst.computeBoundingSphere();
  group.add(boulderInst);

  // ============================================================================
  // 5. GROUND FLORA & TIRE-MARK PATCHES: CACTI, DRY BUSHES & SKID DECALS
  // ============================================================================
  // Saguaro Cacti (Composite Trunk + Twin Arms InstancedMeshes)
  const cactiCount = 75;
  const cactusTrunkGeo = new THREE.CylinderGeometry(0.28, 0.36, 4.6, 7);
  cactusTrunkGeo.translate(0, 2.3, 0);
  const cactusArmGeo = new THREE.BoxGeometry(1.5, 0.45, 0.45);
  cactusArmGeo.translate(0, 2.6, 0);
  const cactusMat = new THREE.MeshStandardMaterial({
    color: isCanyon ? 0x3f6212 : 0x065f46,
    roughness: 0.85,
    metalness: 0.05,
  });
  const cactusTrunkInst = new THREE.InstancedMesh(cactusTrunkGeo, cactusMat, cactiCount);
  const cactusArmInst = new THREE.InstancedMesh(cactusArmGeo, cactusMat, cactiCount);
  geometriesToDispose.push(cactusTrunkGeo, cactusArmGeo);
  materialsToDispose.push(cactusMat);

  for (let i = 0; i < cactiCount; i++) {
    const s = (i / cactiCount) * TRACK_LENGTH + 9;
    evaluateTrackFrame(s, frame);
    const side = i % 2 === 0 ? -1 : 1;
    const latDist = ROAD_HALF_WIDTH + 5.5 + (i % 6) * 2.4;

    dummy.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * latDist);
    dummy.position.y = getEmbankmentSurfaceY(frame, side, latDist);
    const sc = 0.75 + (i % 5) * 0.14;
    dummy.scale.set(sc, sc, sc);
    dummy.rotation.set(0, (i * 1.7) % (Math.PI * 2), 0);
    dummy.updateMatrix();

    cactusTrunkInst.setMatrixAt(i, dummy.matrix);
    cactusArmInst.setMatrixAt(i, dummy.matrix);
  }
  cactusTrunkInst.instanceMatrix.needsUpdate = true;
  cactusArmInst.instanceMatrix.needsUpdate = true;
  cactusTrunkInst.computeBoundingSphere();
  cactusArmInst.computeBoundingSphere();
  group.add(cactusTrunkInst, cactusArmInst);

  // Dry Desert Scrub Bushes near track edges
  const bushCount = 110;
  const bushGeo = new THREE.IcosahedronGeometry(0.75, 1);
  bushGeo.scale(1.3, 0.65, 1.3);
  bushGeo.translate(0, 0.4, 0);
  const bushMat = new THREE.MeshStandardMaterial({
    color: isCanyon ? 0x78350f : 0x1e3a2f,
    roughness: 0.92,
  });
  const bushInst = new THREE.InstancedMesh(bushGeo, bushMat, bushCount);
  geometriesToDispose.push(bushGeo);
  materialsToDispose.push(bushMat);

  for (let i = 0; i < bushCount; i++) {
    const s = (i / bushCount) * TRACK_LENGTH + 4;
    evaluateTrackFrame(s, frame);
    const side = i % 2 === 0 ? 1 : -1;
    const latDist = ROAD_HALF_WIDTH + 2.1 + (i % 4) * 1.3;

    dummy.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * latDist);
    dummy.position.y = getEmbankmentSurfaceY(frame, side, latDist);
    const sc = 0.65 + (i % 5) * 0.22;
    dummy.scale.set(sc, sc * 0.8, sc);
    dummy.rotation.set(0, i * 1.1, 0);
    dummy.updateMatrix();
    bushInst.setMatrixAt(i, dummy.matrix);

    tempColor.set(i % 2 === 0 ? '#92400E' : '#65A30D');
    bushInst.setColorAt(i, tempColor);
  }
  bushInst.instanceMatrix.needsUpdate = true;
  if (bushInst.instanceColor) bushInst.instanceColor.needsUpdate = true;
  bushInst.computeBoundingSphere();
  group.add(bushInst);

  // Tire-Mark Skid Patches near Corner Braking Zones & Track Edges
  const skidGeo = new THREE.PlaneGeometry(3.4, 18);
  skidGeo.rotateX(-Math.PI / 2);
  const skidMat = new THREE.MeshBasicMaterial({
    map: skidPatchTexture,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  geometriesToDispose.push(skidGeo);
  materialsToDispose.push(skidMat);

  const cornerZones = [180, 380, 580, 890, 1180, 1390, 1680, 1980, 2240];
  cornerZones.forEach((zoneDist, idx) => {
    evaluateTrackFrame(zoneDist, frame);
    const sideOffset = (idx % 2 === 0 ? 1 : -1) * (ROAD_HALF_WIDTH - 3.2);
    const skidMesh = new THREE.Mesh(skidGeo, skidMat);
    skidMesh.position
      .copy(frame.position)
      .addScaledVector(frame.right, sideOffset)
      .addScaledVector(frame.up, 0.06);
    const target = new THREE.Vector3().copy(skidMesh.position).add(frame.tangent);
    skidMesh.lookAt(target);
    group.add(skidMesh);
  });

  // ============================================================================
  // 6. TRACKSIDE DETAILS: GRANDSTANDS, BANNERS, LIGHT POLES, TIRE BARRIERS & SIGNS
  // ============================================================================
  // A. Grandstands at Main Straight & Key Stadium Corners
  const grandstandLocations = [
    { s: 45, side: -1 },
    { s: 135, side: 1 },
    { s: 780, side: -1 },
    { s: 1580, side: 1 },
    { s: 2310, side: -1 },
  ];
  const standBaseGeo = new THREE.BoxGeometry(28, 5.5, 8.5);
  const standRoofGeo = new THREE.BoxGeometry(29.5, 0.45, 10.5);
  const standPillarGeo = new THREE.CylinderGeometry(0.25, 0.25, 6.5, 8);
  const standStructureMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.7,
    roughness: 0.35,
  });
  const standSeatsMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.6,
  });
  const standRoofMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.55,
    metalness: 0.15,
  });
  geometriesToDispose.push(standBaseGeo, standRoofGeo, standPillarGeo);
  materialsToDispose.push(standStructureMat, standSeatsMat, standRoofMat);

  grandstandLocations.forEach(({ s, side }) => {
    evaluateTrackFrame(s, frame);
    const standGroup = new THREE.Group();
    const latDist = ROAD_HALF_WIDTH + 9.5;
    standGroup.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * latDist);
    standGroup.position.y = getEmbankmentSurfaceY(frame, side, latDist);

    // Face toward the track
    const lookTarget = new THREE.Vector3().copy(frame.position);
    standGroup.lookAt(lookTarget);

    const baseMesh = new THREE.Mesh(standBaseGeo, standStructureMat);
    baseMesh.position.set(0, 2.75, 0);
    standGroup.add(baseMesh);

    // 3 Tiered Seating Steps
    for (let t = 0; t < 3; t++) {
      const tierGeo = new THREE.BoxGeometry(26.5, 0.9, 2.1);
      geometriesToDispose.push(tierGeo);
      const tierMesh = new THREE.Mesh(
        tierGeo,
        t % 2 === 0 ? standSeatsMat : standRoofMat
      );
      tierMesh.position.set(0, 3.6 + t * 1.15, 2.4 - t * 2.1);
      standGroup.add(tierMesh);
    }

    // Angled Canopy Roof
    const roofMesh = new THREE.Mesh(standRoofGeo, standRoofMat);
    roofMesh.position.set(0, 9.2, -0.5);
    roofMesh.rotation.x = 0.14;
    standGroup.add(roofMesh);

    [-12, 0, 12].forEach((px) => {
      const pMesh = new THREE.Mesh(standPillarGeo, standStructureMat);
      pMesh.position.set(px, 6.2, -3.2);
      standGroup.add(pMesh);
    });

    group.add(standGroup);
  });

  // B. Trackside Sponsor Banners at Key Corners
  const bannerSpecs = [
    { s: 210, side: 1, text: 'APEX HORIZON', bg: '#0F172A', accent: '#F59E0B' },
    { s: 520, side: -1, text: 'RED ROCK CANYON', bg: '#7C2D12', accent: '#F97316' },
    { s: 940, side: 1, text: 'SOLAR TURBO V10', bg: '#0F172A', accent: '#06B6D4' },
    { s: 1320, side: -1, text: 'APEX CARBON WORKS', bg: '#1E1B4B', accent: '#F43F5E' },
    { s: 1760, side: 1, text: 'NEVADA SECTOR GP', bg: '#7C2D12', accent: '#FBBF24' },
    { s: 2120, side: -1, text: 'NITRO ENDURANCE', bg: '#0F172A', accent: '#10B981' },
  ];
  const bannerBoardGeo = new THREE.BoxGeometry(11.5, 2.4, 0.25);
  geometriesToDispose.push(bannerBoardGeo);

  bannerSpecs.forEach((b) => {
    const tex = createSponsorBannerTexture(maxAnisotropy, b.text, b.bg, b.accent);
    texturesToDispose.push(tex);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.4,
      metalness: 0.1,
    });
    materialsToDispose.push(mat);

    evaluateTrackFrame(b.s, frame);
    const mesh = new THREE.Mesh(bannerBoardGeo, mat);
    mesh.position
      .copy(frame.position)
      .addScaledVector(frame.right, b.side * (ROAD_HALF_WIDTH + 2.4));
    mesh.position.y += 1.3;
    const look = new THREE.Vector3().copy(frame.position);
    mesh.lookAt(look);
    group.add(mesh);
  });

  // C. Red & White Tire Barriers at Key Corners (InstancedMesh)
  const tireStackCount = 120;
  const tireBarrierGeo = new THREE.CylinderGeometry(0.58, 0.58, 1.35, 12);
  tireBarrierGeo.translate(0, 0.675, 0);
  const tireBarrierMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.75,
  });
  const tireBarrierInst = new THREE.InstancedMesh(
    tireBarrierGeo,
    tireBarrierMat,
    tireStackCount
  );
  geometriesToDispose.push(tireBarrierGeo);
  materialsToDispose.push(tireBarrierMat);

  const cornerBarrierStarts = [310, 690, 1120, 1490, 1890, 2190];
  let tbIdx = 0;
  cornerBarrierStarts.forEach((startS, cIdx) => {
    const side = cIdx % 2 === 0 ? 1 : -1;
    for (let k = 0; k < 20; k++) {
      if (tbIdx >= tireStackCount) break;
      evaluateTrackFrame(startS + k * 1.45, frame);
      dummy.position
        .copy(frame.position)
        .addScaledVector(frame.right, side * (ROAD_HALF_WIDTH + 1.15));
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      tireBarrierInst.setMatrixAt(tbIdx, dummy.matrix);

      tempColor.set(k % 2 === 0 ? '#EF4444' : '#CBD5E1');
      tireBarrierInst.setColorAt(tbIdx, tempColor);
      tbIdx++;
    }
  });
  tireBarrierInst.instanceMatrix.needsUpdate = true;
  if (tireBarrierInst.instanceColor) tireBarrierInst.instanceColor.needsUpdate = true;
  tireBarrierInst.computeBoundingSphere();
  group.add(tireBarrierInst);

  // D. Trackside Light Poles with Glowing Warm Luminaires (InstancedMesh)
  const lightPoleCount = 48;
  const poleShaftGeo = new THREE.CylinderGeometry(0.14, 0.22, 8.8, 8);
  poleShaftGeo.translate(0, 4.4, 0);
  const poleLampGeo = new THREE.BoxGeometry(1.8, 0.28, 0.55);
  poleLampGeo.translate(-0.6, 8.8, 0);

  const poleShaftMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.8,
    roughness: 0.3,
  });
  const poleLampMat = new THREE.MeshStandardMaterial({
    color: 0xffedd5,
    emissive: new THREE.Color(isMidnight ? '#38BDF8' : '#FDBA74'),
    emissiveIntensity: 2.6,
    toneMapped: false,
  });
  const poleShaftInst = new THREE.InstancedMesh(
    poleShaftGeo,
    poleShaftMat,
    lightPoleCount
  );
  const poleLampInst = new THREE.InstancedMesh(
    poleLampGeo,
    poleLampMat,
    lightPoleCount
  );
  geometriesToDispose.push(poleShaftGeo, poleLampGeo);
  materialsToDispose.push(poleShaftMat, poleLampMat);

  for (let i = 0; i < lightPoleCount; i++) {
    const s = (i / lightPoleCount) * TRACK_LENGTH;
    evaluateTrackFrame(s, frame);
    const side = i % 2 === 0 ? 1 : -1;
    dummy.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * (ROAD_HALF_WIDTH + 1.6));
    const look = new THREE.Vector3().copy(frame.position);
    dummy.lookAt(look);
    dummy.rotateY(Math.PI * 0.5);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poleShaftInst.setMatrixAt(i, dummy.matrix);
    poleLampInst.setMatrixAt(i, dummy.matrix);
  }
  poleShaftInst.instanceMatrix.needsUpdate = true;
  poleLampInst.instanceMatrix.needsUpdate = true;
  poleShaftInst.computeBoundingSphere();
  poleLampInst.computeBoundingSphere();
  group.add(poleShaftInst, poleLampInst);

  // E. Wooden Signs & Corner Braking Distance Marker Boards (150m, 100m, 50m)
  const markerBoardGeo = new THREE.BoxGeometry(1.9, 1.1, 0.14);
  const woodPostGeo = new THREE.CylinderGeometry(0.11, 0.11, 2.2, 6);
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x78350f,
    roughness: 0.9,
  });
  geometriesToDispose.push(markerBoardGeo, woodPostGeo);
  materialsToDispose.push(woodMat);

  const markerLabels = ['150m', '100m', '50m'];
  const markerTextures = markerLabels.map((lbl) => {
    const t = createSponsorBannerTexture(maxAnisotropy, lbl, '#1E293B', '#F59E0B');
    texturesToDispose.push(t);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
    materialsToDispose.push(m);
    return m;
  });

  [350, 1150, 1920].forEach((turnEntryDist, turnIdx) => {
    const side = turnIdx % 2 === 0 ? -1 : 1;
    markerTextures.forEach((mat, mIdx) => {
      const dist = turnEntryDist - (2 - mIdx) * 32;
      evaluateTrackFrame(dist, frame);

      const signGroup = new THREE.Group();
      signGroup.position
        .copy(frame.position)
        .addScaledVector(frame.right, side * (ROAD_HALF_WIDTH + 2.1));
      const look = new THREE.Vector3()
        .copy(signGroup.position)
        .sub(frame.tangent);
      signGroup.lookAt(look);

      const post = new THREE.Mesh(woodPostGeo, woodMat);
      post.position.y = 1.1;
      const board = new THREE.Mesh(markerBoardGeo, mat);
      board.position.y = 1.85;
      signGroup.add(post, board);
      group.add(signGroup);
    });
  });

  // ============================================================================
  // 7. START/FINISH LINE, OVERHEAD GANTRIES, BOOST PADS & GUARDRAIL POSTS
  // ============================================================================
  const startFinishTex = createStartFinishTexture(maxAnisotropy);
  texturesToDispose.push(startFinishTex);

  evaluateTrackFrame(0, frame);
  const startLineGeo = new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 1.9, 4.2);
  startLineGeo.rotateX(-Math.PI / 2);
  const startLineMat = new THREE.MeshStandardMaterial({
    map: startFinishTex,
    roughness: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const startLineMesh = new THREE.Mesh(startLineGeo, startLineMat);
  startLineMesh.position.copy(frame.position).addScaledVector(frame.up, 0.07);
  const lookTarget = new THREE.Vector3().copy(frame.position).add(frame.tangent);
  startLineMesh.lookAt(lookTarget);
  group.add(startLineMesh);
  geometriesToDispose.push(startLineGeo);
  materialsToDispose.push(startLineMat);

  // Gantry structure at s = 0, s = 800 (Sector 1), s = 1600 (Sector 2)
  const gantryLights: THREE.MeshStandardMaterial[] = [];
  const pillarGeo = new THREE.BoxGeometry(0.9, 9.5, 1.2);
  const beamGeo = new THREE.BoxGeometry(ROAD_HALF_WIDTH * 2 + 3.2, 1.4, 1.4);
  const gantryMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.8,
    roughness: 0.25,
  });
  const sectorNeonMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(config.curbPrimaryHex),
    emissive: new THREE.Color(config.curbPrimaryHex),
    emissiveIntensity: 2.2,
    toneMapped: false,
  });
  geometriesToDispose.push(pillarGeo, beamGeo);
  materialsToDispose.push(gantryMetalMat, sectorNeonMat);

  [0, 800, 1600].forEach((gantryDist, idx) => {
    evaluateTrackFrame(gantryDist, frame);
    const gantryGroup = new THREE.Group();
    gantryGroup.position.copy(frame.position);
    const target = new THREE.Vector3().copy(frame.position).add(frame.tangent);
    gantryGroup.lookAt(target);

    const leftPillar = new THREE.Mesh(pillarGeo, gantryMetalMat);
    leftPillar.position.set(-(ROAD_HALF_WIDTH + 1.1), 4.75, 0);
    const rightPillar = new THREE.Mesh(pillarGeo, gantryMetalMat);
    rightPillar.position.set(ROAD_HALF_WIDTH + 1.1, 4.75, 0);
    const topBeam = new THREE.Mesh(beamGeo, gantryMetalMat);
    topBeam.position.set(0, 9.2, 0);

    const accentStripGeo = new THREE.BoxGeometry(ROAD_HALF_WIDTH * 2, 0.18, 1.5);
    const accentStrip = new THREE.Mesh(accentStripGeo, sectorNeonMat);
    accentStrip.position.set(0, 8.45, 0);
    geometriesToDispose.push(accentStripGeo);

    gantryGroup.add(leftPillar, rightPillar, topBeam, accentStrip);

    if (idx === 0) {
      const podGeo = new THREE.SphereGeometry(0.38, 16, 16);
      geometriesToDispose.push(podGeo);
      for (let p = 0; p < 5; p++) {
        const lightMat = new THREE.MeshStandardMaterial({
          color: 0x334155,
          emissive: 0xef4444,
          emissiveIntensity: 0,
          roughness: 0.2,
          toneMapped: false,
        });
        materialsToDispose.push(lightMat);
        gantryLights.push(lightMat);

        const pod = new THREE.Mesh(podGeo, lightMat);
        pod.position.set((p - 2) * 1.45, 7.75, 0.75);
        gantryGroup.add(pod);
      }
    }

    group.add(gantryGroup);
  });

  // Glowing Nitro Recharge Boost Pads
  const boostPads: BoostPadZone[] = [];
  const padGeo = new THREE.PlaneGeometry(3.2, 11.0);
  padGeo.rotateX(-Math.PI / 2);
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    emissive: 0x06b6d4,
    emissiveIntensity: 2.0,
    roughness: 0.2,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  geometriesToDispose.push(padGeo);
  materialsToDispose.push(padMat);

  const padPlacements = [
    { s: 260, lat: -4.5 },
    { s: 640, lat: 4.2 },
    { s: 1080, lat: 0.0 },
    { s: 1460, lat: -4.8 },
    { s: 1920, lat: 4.5 },
    { s: 2220, lat: 0.0 },
  ];

  padPlacements.forEach((placement) => {
    evaluateTrackFrame(placement.s, frame);
    const mesh = new THREE.Mesh(padGeo, padMat);
    mesh.position
      .copy(frame.position)
      .addScaledVector(frame.right, placement.lat)
      .addScaledVector(frame.up, 0.08);
    const lookPt = new THREE.Vector3().copy(mesh.position).add(frame.tangent);
    mesh.lookAt(lookPt);
    group.add(mesh);

    boostPads.push({
      trackDistance: placement.s,
      lateralOffset: placement.lat,
      mesh,
    });
  });

  // Roadside Guardrail Posts (InstancedMesh)
  const postCount = 240;
  const postGeo = new THREE.BoxGeometry(0.28, 0.85, 0.9);
  postGeo.translate(0, 0.425, 0);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.78,
    roughness: 0.32,
  });
  const postInstanced = new THREE.InstancedMesh(postGeo, postMat, postCount);
  geometriesToDispose.push(postGeo);
  materialsToDispose.push(postMat);

  for (let i = 0; i < postCount; i++) {
    const s = (i / postCount) * TRACK_LENGTH;
    evaluateTrackFrame(s, frame);
    const side = i % 2 === 0 ? 1 : -1;

    dummy.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * (ROAD_HALF_WIDTH + 0.65));
    const look = new THREE.Vector3().copy(dummy.position).add(frame.tangent);
    dummy.lookAt(look);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    postInstanced.setMatrixAt(i, dummy.matrix);
  }
  postInstanced.instanceMatrix.needsUpdate = true;
  postInstanced.computeBoundingSphere();
  group.add(postInstanced);

  const updateEnvironment = (elapsed: number, cameraPos: THREE.Vector3) => {
    // Keep sky dome centered on camera for infinite horizon feel
    skyDomeGroup.position.x = cameraPos.x;
    skyDomeGroup.position.z = cameraPos.z;
    skyMat.uniforms.uTime.value = elapsed;
    // Slowly drift stylized clouds
    cloudGroup.rotation.y = elapsed * 0.0085;
  };

  const dispose = () => {
    geometriesToDispose.forEach((g) => g.dispose());
    materialsToDispose.forEach((m) => m.dispose());
    texturesToDispose.forEach((t) => t.dispose());
  };

  return {
    group,
    asphaltTexture,
    boostPads,
    gantryLights,
    updateEnvironment,
    dispose,
  };
}
