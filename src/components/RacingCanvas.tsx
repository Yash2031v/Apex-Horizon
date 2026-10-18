import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  CameraMode,
  CAR_LIVERIES,
  CarLivery,
  CombatDifficulty,
  RaceStatus,
  RaceTelemetry,
  RivalCarState,
  TRACK_CONFIGS,
  TrackTheme,
} from '../types/racing';
import {
  applyLiveryToCarRig,
  buildCompositeHypercar,
  CompositeCarRig,
} from '../three/carBuilder';
import {
  createContactShadowTexture,
  createSoftParticleSpriteTexture,
} from '../three/proceduralTextures';
import {
  BuiltTrack,
  buildRacingTrack,
  evaluateTrackFrame,
  ROAD_HALF_WIDTH,
  TRACK_LENGTH,
  TrackFrame,
} from '../three/trackBuilder';
import { soundEngine } from '../audio/soundEngine';

export interface TouchDriveControls {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  nitro: boolean;
  fireMg: boolean;
  fireMissile: boolean;
}

interface RacingCanvasProps {
  trackTheme: TrackTheme;
  livery: CarLivery;
  cameraMode: CameraMode;
  raceStatus: RaceStatus;
  combatMode: boolean;
  combatDifficulty: CombatDifficulty;
  permanentElimination: boolean;
  totalLaps: number;
  resetSignal: number;
  touchControlsRef: React.MutableRefObject<TouchDriveControls>;
  onTelemetryUpdate: (telemetry: RaceTelemetry) => void;
  onStatusChange: (status: RaceStatus) => void;
}

// Custom lightweight Color Grading (warm highlights, cool shadows) + Subtle Vignette ShaderPass
const CanyonGradeVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignetteOffset: { value: 1.05 },
    uVignetteDarkness: { value: 0.42 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVignetteOffset;
    uniform float uVignetteDarkness;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 col = texel.rgb;

      // Luminance for split-toning (warm golden highlights, cool twilight-violet shadows)
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 coolShadows = vec3(0.93, 0.94, 1.05);
      vec3 warmHighlights = vec3(1.06, 1.01, 0.94);
      col *= mix(coolShadows, warmHighlights, smoothstep(0.15, 0.85, lum));

      // Subtle contrast S-curve polish
      col = mix(col, smoothstep(0.0, 1.0, col), 0.12);

      // Soft optical vignette
      vec2 uv = (vUv - vec2(0.5)) * vec2(uVignetteOffset);
      float vig = clamp(1.0 - dot(uv, uv) * uVignetteDarkness, 0.0, 1.0);
      col *= vig;

      gl_FragColor = vec4(col, texel.a);
    }
  `,
};

/**
 * Builds a soft round additive sprite ShaderMaterial for dust & wind particles
 * that smoothly fades out and culls particles close to the camera.
 */
function createSoftAdditiveParticleMaterial(
  spriteTex: THREE.Texture,
  colorHex: number,
  pointSize: number,
  initialOpacity: number,
  minCullDist: number = 4.5,
  fadeFullDist: number = 10.5
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: spriteTex },
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: initialOpacity },
      uSize: { value: pointSize },
      uMinDist: { value: minCullDist },
      uFadeDist: { value: fadeFullDist },
    },
    vertexShader: `
      uniform float uSize;
      uniform float uMinDist;
      uniform float uFadeDist;
      varying float vProximityAlpha;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float camDist = length(mvPosition.xyz);

        // Smoothly fade out and cull particles close to the camera
        vProximityAlpha = smoothstep(uMinDist, uFadeDist, camDist);

        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (camDist < uMinDist) ? 0.0 : (uSize * (300.0 / max(1.0, -mvPosition.z)));
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vProximityAlpha;

      void main() {
        if (vProximityAlpha <= 0.01 || uOpacity <= 0.005) discard;

        // Soft radial falloff + procedural soft sprite texture
        vec2 centered = gl_PointCoord - vec2(0.5);
        float radialDist = length(centered);
        if (radialDist > 0.5) discard;

        float radialSoftness = pow(1.0 - radialDist * 2.0, 1.8);
        vec4 texColor = texture2D(uMap, gl_PointCoord);
        float finalAlpha = texColor.a * radialSoftness * uOpacity * vProximityAlpha;

        if (finalAlpha <= 0.01) discard;
        gl_FragColor = vec4(uColor * finalAlpha, finalAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// Pre-allocated module-scope math objects (Zero GC in render loop)
const _playerFrame: TrackFrame = {
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  bankAngle: 0,
  curvature: 0,
};
const _rivalFrame: TrackFrame = {
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  bankAngle: 0,
  curvature: 0,
};
const _rivalNextFrame: TrackFrame = {
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  bankAngle: 0,
  curvature: 0,
};
const _camFrame: TrackFrame = {
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  bankAngle: 0,
  curvature: 0,
};

const _carWorldPos = new THREE.Vector3();
const _rivalWorldPos = new THREE.Vector3();
const _rivalNextWaypointPos = new THREE.Vector3();
const _rivalToNext = new THREE.Vector3();
const _travelDir = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _carForward = new THREE.Vector3();
const _carRight = new THREE.Vector3();
const _toRival = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _projVec = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();
const _desiredLookAt = new THREE.Vector3();
const _smoothedCamPos = new THREE.Vector3();
const _smoothedLookAt = new THREE.Vector3();

/**
 * Shortest-arc angular damping (handles -PI..+PI wraparound seamlessly).
 */
function dampAngle(
  current: number,
  target: number,
  lambda: number,
  dt: number
): number {
  let diff = (target - current + Math.PI) % (Math.PI * 2);
  if (diff < 0) diff += Math.PI * 2;
  diff -= Math.PI;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

const AI_DRIVERS = [
  { id: 'ai-1', name: 'M. Weber', code: 'WEB', liveryIdx: 1, baseSpeed: 74.5 },
  { id: 'ai-2', name: 'L. Leclerc', code: 'LEC', liveryIdx: 2, baseSpeed: 73.2 },
  { id: 'ai-3', name: 'K. Sato', code: 'SAT', liveryIdx: 3, baseSpeed: 71.8 },
  { id: 'ai-4', name: 'C. Norris', code: 'NOR', liveryIdx: 4, baseSpeed: 70.4 },
  { id: 'ai-5', name: 'E. Vance', code: 'VAN', liveryIdx: 0, baseSpeed: 68.8 },
];

export const RacingCanvas: React.FC<RacingCanvasProps> = ({
  trackTheme,
  livery,
  cameraMode,
  raceStatus,
  combatMode,
  combatDifficulty,
  permanentElimination,
  totalLaps,
  resetSignal,
  touchControlsRef,
  onTelemetryUpdate,
  onStatusChange,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  // Store latest props in refs so WebGL animation loop never tears down on React state changes
  const propsRef = useRef({
    trackTheme,
    livery,
    cameraMode,
    raceStatus,
    combatMode,
    combatDifficulty,
    permanentElimination,
    totalLaps,
    onTelemetryUpdate,
    onStatusChange,
  });

  useEffect(() => {
    propsRef.current = {
      trackTheme,
      livery,
      cameraMode,
      raceStatus,
      combatMode,
      combatDifficulty,
      permanentElimination,
      totalLaps,
      onTelemetryUpdate,
      onStatusChange,
    };
  }, [
    trackTheme,
    livery,
    cameraMode,
    raceStatus,
    combatMode,
    combatDifficulty,
    permanentElimination,
    totalLaps,
    onTelemetryUpdate,
    onStatusChange,
  ]);

  // References to Three.js scene objects for dynamic theme/livery updates without recreating WebGLRenderer
  const sceneObjectsRef = useRef<{
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    sunLight: THREE.DirectionalLight;
    rimLight: THREE.DirectionalLight;
    hemiLight: THREE.HemisphereLight;
    playerRig: CompositeCarRig;
    rivalRigs: CompositeCarRig[];
    builtTrack: BuiltTrack | null;
    resetRaceState: () => void;
  } | null>(null);

  // Update player car livery immediately when user clicks swatch
  useEffect(() => {
    if (sceneObjectsRef.current) {
      applyLiveryToCarRig(sceneObjectsRef.current.playerRig, livery);
    }
  }, [livery]);

  // Update track geometry & atmosphere when trackTheme changes
  useEffect(() => {
    const ctx = sceneObjectsRef.current;
    if (!ctx) return;

    const config = TRACK_CONFIGS[trackTheme];
    ctx.scene.background = new THREE.Color(config.skyHex);
    ctx.scene.fog = new THREE.FogExp2(config.fogHex, config.fogDensity);

    ctx.sunLight.color.set(config.sunColorHex);
    ctx.sunLight.intensity = config.sunIntensity;
    ctx.hemiLight.color.set(config.hemiSkyHex);
    ctx.hemiLight.groundColor.set(config.hemiGroundHex);
    ctx.hemiLight.intensity = config.hemiIntensity;

    if (ctx.builtTrack) {
      ctx.scene.remove(ctx.builtTrack.group);
      ctx.builtTrack.dispose();
    }

    const maxAniso = ctx.renderer.capabilities.getMaxAnisotropy();
    const newTrack = buildRacingTrack(config, maxAniso);
    ctx.scene.add(newTrack.group);
    ctx.builtTrack = newTrack;

    // Toggle volumetric headlight cones for Midnight track
    const showCones = config.headlightsActive;
    ctx.playerRig.headlightCones.forEach((c) => {
      c.visible = showCones;
    });
    ctx.rivalRigs.forEach((rig) => {
      rig.headlightCones.forEach((c) => {
        c.visible = showCones;
      });
    });
  }, [trackTheme]);

  // Trigger race reset when resetSignal increments
  useEffect(() => {
    if (resetSignal > 0 && sceneObjectsRef.current) {
      sceneObjectsRef.current.resetRaceState();
    }
  }, [resetSignal]);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const isHeadless =
      navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent);

    const scene = new THREE.Scene();
    const initialConfig = TRACK_CONFIGS[propsRef.current.trackTheme];
    scene.background = new THREE.Color(initialConfig.skyHex);
    scene.fog = new THREE.FogExp2(initialConfig.fogHex, initialConfig.fogDensity);

    const camera = new THREE.PerspectiveCamera(
      64,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.2,
      980
    );

    const renderer = new THREE.WebGLRenderer({
      antialias: !isHeadless,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    renderer.setPixelRatio(isHeadless ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = !isHeadless;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Post-Processing Pipeline (Light-Only Bloom + Warm/Cool Color Grading + Vignette)
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    if (!isHeadless) {
      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(
          Math.max(1, Math.floor(container.clientWidth * 0.5)),
          Math.max(1, Math.floor(container.clientHeight * 0.5))
        ),
        0.20, // reduced bloom intensity so kerbs and white lines never blow out
        0.32, // tight halo radius
        1.08 // raised HDR threshold: only emissive lamps, brake lights & sun glow
      );
      composer.addPass(bloomPass);

      const gradeVignettePass = new ShaderPass(CanyonGradeVignetteShader);
      composer.addPass(gradeVignettePass);
    }

    // WebGL Context Loss & Restoration Safety
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    // Studio Environment Reflection (RoomEnvironment + PMREMGenerator)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 3-Point Studio & Sunset Lighting Rig (Long Directional Shadows + Warm Rim Light)
    const hemiLight = new THREE.HemisphereLight(
      initialConfig.hemiSkyHex,
      initialConfig.hemiGroundHex,
      initialConfig.hemiIntensity
    );
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(
      initialConfig.sunColorHex,
      initialConfig.sunIntensity
    );
    // Low sunset angle for long dramatic shadows across the road and rocks
    sunLight.position.set(-75, 42, -105);
    sunLight.castShadow = !isHeadless;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 280;
    const d = 44;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);
    scene.add(sunLight.target);

    // Warm Rim Light opposing the key light to sculpt car bevels and rock edges
    const rimLight = new THREE.DirectionalLight(0xfdba74, 1.45);
    rimLight.position.set(65, 28, 85);
    scene.add(rimLight);
    scene.add(rimLight.target);

    // Build Initial Track
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const builtTrack = buildRacingTrack(initialConfig, maxAniso);
    scene.add(builtTrack.group);

    // Shared Contact Shadow Texture
    const shadowTexture = createContactShadowTexture();

    // Build Player Composite Hypercar (11-part THREE.Group)
    const playerRig = buildCompositeHypercar(
      propsRef.current.livery,
      shadowTexture,
      true
    );
    // Use YXZ Euler order so rotation.y is world heading (yaw), rotation.x is hill pitch, rotation.z is bank
    playerRig.root.rotation.order = 'YXZ';
    playerRig.headlightCones.forEach((c) => {
      c.visible = initialConfig.headlightsActive;
    });
    scene.add(playerRig.root);

    // Build 5 AI Rival Composite Hypercars + 3D World-Space Health Bars
    const rivalRigs: CompositeCarRig[] = [];
    const rivalsState: RivalCarState[] = [];
    const rivalHeadings: number[] = [];
    const rivalHealthBarRigs: {
      group: THREE.Group;
      fillMesh: THREE.Mesh;
      fillMat: THREE.MeshBasicMaterial;
      lockBox: THREE.LineSegments;
    }[] = [];

    const hpBgGeo = new THREE.PlaneGeometry(1.1, 0.11);
    const hpBgMat = new THREE.MeshBasicMaterial({
      color: 0x090d16,
      transparent: true,
      opacity: 0.78,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hpFillGeo = new THREE.PlaneGeometry(1.04, 0.07);
    const lockBoxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.15, 1.15, 4.3));
    const lockBoxMat = new THREE.LineBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.85,
    });

    AI_DRIVERS.forEach((driver, index) => {
      const rivalLivery = CAR_LIVERIES[driver.liveryIdx % CAR_LIVERIES.length];
      const rig = buildCompositeHypercar(rivalLivery, shadowTexture, false);
      rig.root.rotation.order = 'YXZ';
      rig.headlightCones.forEach((c) => {
        c.visible = initialConfig.headlightsActive;
      });

      // Compact 3D Floating Health Bar above each AI car (100 HP max)
      const hbGroup = new THREE.Group();
      hbGroup.position.set(0, 2.15, 0);
      const bgMesh = new THREE.Mesh(hpBgGeo, hpBgMat);
      bgMesh.renderOrder = 10;
      hbGroup.add(bgMesh);

      const fillMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const fillMesh = new THREE.Mesh(hpFillGeo, fillMat);
      fillMesh.position.set(0, 0, 0.01);
      fillMesh.renderOrder = 11;
      hbGroup.add(fillMesh);
      rig.root.add(hbGroup);

      const lockBox = new THREE.LineSegments(lockBoxGeo, lockBoxMat);
      lockBox.position.set(0, 0.65, 0);
      lockBox.visible = false;
      rig.root.add(lockBox);

      rivalHealthBarRigs.push({
        group: hbGroup,
        fillMesh,
        fillMat,
        lockBox,
      });

      scene.add(rig.root);
      rivalRigs.push(rig);

      const startDist = (index + 1) * 14;
      evaluateTrackFrame(startDist, _rivalFrame);
      rivalHeadings.push(
        Math.atan2(-_rivalFrame.tangent.x, -_rivalFrame.tangent.z)
      );

      rivalsState.push({
        id: driver.id,
        driverName: driver.name,
        teamCode: driver.code,
        livery: rivalLivery,
        trackDistance: startDist,
        lateralOffset: (index % 2 === 0 ? -1 : 1) * 3.8,
        targetLateral: (index % 2 === 0 ? -1 : 1) * 3.8,
        speed: 0,
        baseMaxSpeed: driver.baseSpeed,
        lap: 1,
        gapSeconds: 0,
        hp: 100,
        maxHp: 100,
        isEliminated: false,
        respawnTimer: 0,
        hitSlowTimer: 0,
        hitFlashTimer: 0,
        aiFireCooldown: 0.4 + index * 0.25,
        aiBurstRemaining: 3,
        aiReloadTimer: 1.4 + index * 0.45,
      });
    });

    // Shared Soft Round Particle Sprite Texture (Additive + Camera Proximity Culling)
    const softParticleSpriteTex = createSoftParticleSpriteTexture();

    // 1. High-Speed Wind / Slipstream Soft Round Particle Field
    const particleCount = 90;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 18;
      particlePositions[i * 3 + 1] = 0.5 + Math.random() * 4.5;
      particlePositions[i * 3 + 2] = -Math.random() * 40;
    }
    particleGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(particlePositions, 3)
    );
    const particleMat = createSoftAdditiveParticleMaterial(
      softParticleSpriteTex,
      0x38bdf8,
      0.32,
      0.0,
      4.8,
      11.0
    );
    const speedParticles = new THREE.Points(particleGeo, particleMat);
    playerRig.root.add(speedParticles);

    // 2. Ambient Floating Desert Dust Motes (Round Soft Sprites + Additive Blending + Camera Culling)
    const ambientDustCount = 110;
    const ambientDustGeo = new THREE.BufferGeometry();
    const ambientDustPositions = new Float32Array(ambientDustCount * 3);
    for (let i = 0; i < ambientDustCount; i++) {
      ambientDustPositions[i * 3] = (Math.random() - 0.5) * 36;
      ambientDustPositions[i * 3 + 1] = 0.4 + Math.random() * 9.5;
      ambientDustPositions[i * 3 + 2] = (Math.random() - 0.5) * 44;
    }
    ambientDustGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(ambientDustPositions, 3)
    );
    const ambientDustMat = createSoftAdditiveParticleMaterial(
      softParticleSpriteTex,
      0xfdba74,
      0.42,
      0.38,
      5.0,
      12.0
    );
    const ambientDustPoints = new THREE.Points(ambientDustGeo, ambientDustMat);
    playerRig.root.add(ambientDustPoints);

    // 3. Off-Track Gravel / Sand Dust Plume Trail (Round Soft Sprites + Additive Blending + Camera Culling)
    const gravelDustCount = 48;
    const gravelDustGeo = new THREE.BufferGeometry();
    const gravelDustPositions = new Float32Array(gravelDustCount * 3);
    for (let i = 0; i < gravelDustCount; i++) {
      const side = i % 2 === 0 ? -0.95 : 0.95;
      const trailProgress = (i / gravelDustCount) * 8.5;
      gravelDustPositions[i * 3] = side + (Math.random() - 0.5) * 0.8;
      gravelDustPositions[i * 3 + 1] = 0.18 + trailProgress * 0.22;
      gravelDustPositions[i * 3 + 2] = 1.65 + trailProgress;
    }
    gravelDustGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(gravelDustPositions, 3)
    );
    const gravelDustMat = createSoftAdditiveParticleMaterial(
      softParticleSpriteTex,
      0xf59e0b,
      1.15,
      0.0,
      4.2,
      9.5
    );
    const gravelDustPoints = new THREE.Points(gravelDustGeo, gravelDustMat);
    playerRig.root.add(gravelDustPoints);

    // 4. Pooled Collision & Hit Spark Particles (World-Space, Zero-GC Pool)
    const sparkPoolCount = 48;
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(sparkPoolCount * 3);
    const sparkVelocities = new Float32Array(sparkPoolCount * 3);
    const sparkLifetimes = new Float32Array(sparkPoolCount);
    for (let i = 0; i < sparkPoolCount; i++) {
      sparkPositions[i * 3 + 1] = -999; // hidden below ground when inactive
      sparkLifetimes[i] = 0;
    }
    sparkGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(sparkPositions, 3)
    );
    const sparkMat = createSoftAdditiveParticleMaterial(
      softParticleSpriteTex,
      0xfbbf24,
      0.58,
      0.95,
      1.2,
      3.5
    );
    const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    sparkPoints.frustumCulled = false;
    scene.add(sparkPoints);

    let sparkCursor = 0;
    const spawnCollisionSparks = (
      wx: number,
      wy: number,
      wz: number,
      count: number,
      impactScale: number
    ) => {
      const posAttr = sparkGeo.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      for (let k = 0; k < count; k++) {
        const idx = sparkCursor % sparkPoolCount;
        sparkCursor++;
        posAttr.setXYZ(
          idx,
          wx + (Math.random() - 0.5) * 0.6,
          wy + 0.45 + Math.random() * 0.35,
          wz + (Math.random() - 0.5) * 0.6
        );
        const speedSpread = 5.5 + impactScale * 9.5;
        sparkVelocities[idx * 3] = (Math.random() - 0.5) * speedSpread;
        sparkVelocities[idx * 3 + 1] = 2.8 + Math.random() * 5.2;
        sparkVelocities[idx * 3 + 2] = (Math.random() - 0.5) * speedSpread;
        sparkLifetimes[idx] = 0.24 + Math.random() * 0.18;
      }
      posAttr.needsUpdate = true;
    };

    // 5. Pooled Smoke Trail (Missile Exhaust + <=30% HP Car Engine Smoke, Zero-GC Pool)
    const smokePoolCount = 96;
    const smokeGeo = new THREE.BufferGeometry();
    const smokePositions = new Float32Array(smokePoolCount * 3);
    const smokeVelocities = new Float32Array(smokePoolCount * 3);
    const smokeLifetimes = new Float32Array(smokePoolCount);
    for (let i = 0; i < smokePoolCount; i++) {
      smokePositions[i * 3 + 1] = -999;
      smokeLifetimes[i] = 0;
    }
    smokeGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(smokePositions, 3)
    );
    const smokeMat = createSoftAdditiveParticleMaterial(
      softParticleSpriteTex,
      0x94a3b8,
      1.65,
      0.52,
      1.5,
      4.5
    );
    const smokePoints = new THREE.Points(smokeGeo, smokeMat);
    smokePoints.frustumCulled = false;
    scene.add(smokePoints);

    let smokeCursor = 0;
    const spawnSmokePuff = (
      wx: number,
      wy: number,
      wz: number,
      vx: number,
      vy: number,
      vz: number,
      life: number = 0.55
    ) => {
      const posAttr = smokeGeo.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      const idx = smokeCursor % smokePoolCount;
      smokeCursor++;
      posAttr.setXYZ(
        idx,
        wx + (Math.random() - 0.5) * 0.35,
        wy + (Math.random() - 0.5) * 0.25,
        wz + (Math.random() - 0.5) * 0.35
      );
      smokeVelocities[idx * 3] = vx + (Math.random() - 0.5) * 1.6;
      smokeVelocities[idx * 3 + 1] = vy + 1.8 + Math.random() * 1.5;
      smokeVelocities[idx * 3 + 2] = vz + (Math.random() - 0.5) * 1.6;
      smokeLifetimes[idx] = life;
      posAttr.needsUpdate = true;
    };

    // 6. Pooled Glowing Machine Gun Tracer Streaks (Zero-GC Pool)
    const BULLET_POOL_SIZE = 32;
    const tracerGeo = new THREE.BoxGeometry(0.09, 0.09, 2.35);
    const playerTracerMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    const rivalTracerMat = new THREE.MeshBasicMaterial({
      color: 0xfb7185,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
    });

    interface PooledBullet {
      active: boolean;
      isPlayer: boolean;
      ownerIdx: number;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      life: number;
      mesh: THREE.Mesh;
    }
    const bulletPool: PooledBullet[] = [];
    for (let i = 0; i < BULLET_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(tracerGeo, playerTracerMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      bulletPool.push({
        active: false,
        isPlayer: true,
        ownerIdx: -1,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        mesh,
      });
    }
    let bulletCursor = 0;

    const spawnBullet = (
      isPlayer: boolean,
      ownerIdx: number,
      wx: number,
      wy: number,
      wz: number,
      dirX: number,
      dirY: number,
      dirZ: number,
      baseSpeed: number
    ) => {
      const b = bulletPool[bulletCursor % BULLET_POOL_SIZE];
      bulletCursor++;
      b.active = true;
      b.isPlayer = isPlayer;
      b.ownerIdx = ownerIdx;
      b.x = wx;
      b.y = wy;
      b.z = wz;
      const projectileSpeed = baseSpeed + 145;
      b.vx = dirX * projectileSpeed;
      b.vy = dirY * projectileSpeed;
      b.vz = dirZ * projectileSpeed;
      b.life = 1.15;
      b.mesh.material = isPlayer ? playerTracerMat : rivalTracerMat;
      b.mesh.position.set(wx, wy, wz);
      b.mesh.lookAt(wx + dirX, wy + dirY, wz + dirZ);
      b.mesh.visible = true;
    };

    // 7. Pooled Homing Missiles (Small Composite Rockets with Smoke Trail, Zero-GC Pool)
    const MISSILE_POOL_SIZE = 6;
    const missileBodyGeo = new THREE.CylinderGeometry(0.11, 0.14, 1.35, 8);
    missileBodyGeo.rotateX(Math.PI * 0.5);
    const missileNoseGeo = new THREE.ConeGeometry(0.11, 0.42, 8);
    missileNoseGeo.rotateX(Math.PI * 0.5);
    missileNoseGeo.translate(0, 0, 0.88);
    const missileFinGeo = new THREE.BoxGeometry(0.48, 0.04, 0.32);
    missileFinGeo.translate(0, 0, -0.52);
    const missileFlareGeo = new THREE.SphereGeometry(0.16, 8, 8);
    missileFlareGeo.translate(0, 0, -0.72);

    const missileBodyMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      metalness: 0.6,
      roughness: 0.25,
    });
    const missileNoseMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 0.8,
      roughness: 0.3,
    });
    const missileFinMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.4,
    });
    const missileFlareMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      blending: THREE.AdditiveBlending,
    });

    interface PooledMissile {
      active: boolean;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      life: number;
      targetIdx: number;
      smokeTimer: number;
      group: THREE.Group;
    }
    const missilePool: PooledMissile[] = [];
    for (let i = 0; i < MISSILE_POOL_SIZE; i++) {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(missileBodyGeo, missileBodyMat));
      grp.add(new THREE.Mesh(missileNoseGeo, missileNoseMat));
      const fin1 = new THREE.Mesh(missileFinGeo, missileFinMat);
      const fin2 = new THREE.Mesh(missileFinGeo, missileFinMat);
      fin2.rotation.z = Math.PI * 0.5;
      grp.add(fin1);
      grp.add(fin2);
      grp.add(new THREE.Mesh(missileFlareGeo, missileFlareMat));
      grp.visible = false;
      scene.add(grp);
      missilePool.push({
        active: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        targetIdx: -1,
        smokeTimer: 0,
        group: grp,
      });
    }
    let missileCursor = 0;

    // 8. Pooled Muzzle Flashes (Glowing Star Burst at Gun Barrel / Missile Tube, Zero-GC Pool)
    const MUZZLE_FLASH_POOL_SIZE = 8;
    const muzzleFlashGeo = new THREE.OctahedronGeometry(0.32, 0);
    interface PooledMuzzleFlash {
      active: boolean;
      timer: number;
      duration: number;
      mesh: THREE.Mesh;
      mat: THREE.MeshBasicMaterial;
    }
    const muzzleFlashPool: PooledMuzzleFlash[] = [];
    for (let i = 0; i < MUZZLE_FLASH_POOL_SIZE; i++) {
      const mfMat = new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mfMesh = new THREE.Mesh(muzzleFlashGeo, mfMat);
      mfMesh.visible = false;
      mfMesh.frustumCulled = false;
      scene.add(mfMesh);
      muzzleFlashPool.push({
        active: false,
        timer: 0,
        duration: 0.065,
        mesh: mfMesh,
        mat: mfMat,
      });
    }
    let muzzleFlashCursor = 0;

    const spawnMuzzleFlash = (
      wx: number,
      wy: number,
      wz: number,
      scaleMult: number = 1.0,
      colorHex: number = 0xfef08a
    ) => {
      const mf = muzzleFlashPool[muzzleFlashCursor % MUZZLE_FLASH_POOL_SIZE];
      muzzleFlashCursor++;
      mf.active = true;
      mf.timer = 0;
      mf.duration = 0.065 * scaleMult;
      mf.mat.color.setHex(colorHex);
      mf.mat.opacity = 0.96;
      mf.mesh.position.set(wx, wy, wz);
      mf.mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      mf.mesh.scale.setScalar(0.85 * scaleMult);
      mf.mesh.visible = true;
    };

    // 9. Pooled Floating Track Pickups (Repair +30 HP & Ammo +Missiles, 15s Respawn)
    const pickupCrossVGeo = new THREE.BoxGeometry(0.32, 1.05, 0.32);
    const pickupCrossHGeo = new THREE.BoxGeometry(1.05, 0.32, 0.32);
    const pickupAmmoOctGeo = new THREE.OctahedronGeometry(0.58, 0);
    const pickupRingGeo = new THREE.RingGeometry(0.85, 1.12, 24);
    pickupRingGeo.rotateX(-Math.PI * 0.5);

    const repairPickupMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.5,
    });
    const repairRingMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ammoPickupMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.7,
    });
    const ammoRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    interface TrackPickupNode {
      type: 'repair' | 'ammo';
      trackDistance: number;
      lateralOffset: number;
      basePos: THREE.Vector3;
      active: boolean;
      respawnTimer: number;
      group: THREE.Group;
      coreGroup: THREE.Group;
    }

    const PICKUP_SPOTS: {
      type: 'repair' | 'ammo';
      fraction: number;
      lateral: number;
    }[] = [
      { type: 'ammo', fraction: 0.11, lateral: -3.1 },
      { type: 'repair', fraction: 0.23, lateral: 3.1 },
      { type: 'ammo', fraction: 0.35, lateral: -2.7 },
      { type: 'repair', fraction: 0.48, lateral: 2.8 },
      { type: 'ammo', fraction: 0.61, lateral: -3.2 },
      { type: 'repair', fraction: 0.73, lateral: 3.0 },
      { type: 'ammo', fraction: 0.84, lateral: -2.5 },
      { type: 'repair', fraction: 0.94, lateral: 2.9 },
    ];

    const pickupPool: TrackPickupNode[] = PICKUP_SPOTS.map((spot) => {
      const dist = spot.fraction * TRACK_LENGTH;
      evaluateTrackFrame(dist, _camFrame);
      const basePos = _camFrame.position
        .clone()
        .addScaledVector(_camFrame.right, spot.lateral);

      const group = new THREE.Group();
      group.position.copy(basePos);

      const coreGroup = new THREE.Group();
      coreGroup.position.y = 1.05;

      if (spot.type === 'repair') {
        coreGroup.add(new THREE.Mesh(pickupCrossVGeo, repairPickupMat));
        coreGroup.add(new THREE.Mesh(pickupCrossHGeo, repairPickupMat));
        const ring = new THREE.Mesh(pickupRingGeo, repairRingMat);
        ring.position.y = 0.08;
        group.add(ring);
      } else {
        coreGroup.add(new THREE.Mesh(pickupAmmoOctGeo, ammoPickupMat));
        const ring = new THREE.Mesh(pickupRingGeo, ammoRingMat);
        ring.position.y = 0.08;
        group.add(ring);
      }

      group.add(coreGroup);
      scene.add(group);

      return {
        type: spot.type,
        trackDistance: dist,
        lateralOffset: spot.lateral,
        basePos,
        active: true,
        respawnTimer: 0,
        group,
        coreGroup,
      };
    });

    // 10. Pooled Stylized Arcade Explosions (Fireball Sphere + Shockwave Ring + Debris Cubes)
    const EXPLOSION_POOL_SIZE = 4;
    const fireballGeo = new THREE.SphereGeometry(1.0, 14, 12);
    const shockwaveGeo = new THREE.RingGeometry(0.65, 1.0, 24);
    shockwaveGeo.rotateX(-Math.PI * 0.5);

    interface PooledExplosion {
      active: boolean;
      timer: number;
      duration: number;
      fireballMesh: THREE.Mesh;
      fireballMat: THREE.MeshBasicMaterial;
      ringMesh: THREE.Mesh;
      ringMat: THREE.MeshBasicMaterial;
    }
    const explosionPool: PooledExplosion[] = [];
    for (let i = 0; i < EXPLOSION_POOL_SIZE; i++) {
      const fbMat = new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const fbMesh = new THREE.Mesh(fireballGeo, fbMat);
      fbMesh.visible = false;
      scene.add(fbMesh);

      const rgMat = new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const rgMesh = new THREE.Mesh(shockwaveGeo, rgMat);
      rgMesh.visible = false;
      scene.add(rgMesh);

      explosionPool.push({
        active: false,
        timer: 0,
        duration: 0.65,
        fireballMesh: fbMesh,
        fireballMat: fbMat,
        ringMesh: rgMesh,
        ringMat: rgMat,
      });
    }
    let explosionCursor = 0;

    const DEBRIS_POOL_SIZE = 28;
    const debrisGeo = new THREE.BoxGeometry(0.32, 0.22, 0.38);
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: 0xf97316,
      emissiveIntensity: 0.65,
      roughness: 0.4,
      metalness: 0.7,
    });
    interface PooledDebris {
      active: boolean;
      life: number;
      vx: number;
      vy: number;
      vz: number;
      rx: number;
      ry: number;
      mesh: THREE.Mesh;
    }
    const debrisPool: PooledDebris[] = [];
    for (let i = 0; i < DEBRIS_POOL_SIZE; i++) {
      const dMesh = new THREE.Mesh(debrisGeo, debrisMat);
      dMesh.visible = false;
      scene.add(dMesh);
      debrisPool.push({
        active: false,
        life: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        mesh: dMesh,
      });
    }
    let debrisCursor = 0;

    const spawnStylizedExplosion = (wx: number, wy: number, wz: number) => {
      soundEngine.playExplosion();

      // Short camera shake on explosions scaled by distance to player
      const dx = wx - _carWorldPos.x;
      const dz = wz - _carWorldPos.z;
      const distToPlayer = Math.sqrt(dx * dx + dz * dz);
      const shakeProximity = THREE.MathUtils.clamp(
        1.0 - distToPlayer / 110.0,
        0.22,
        1.0
      );
      playerState.cameraShakeTimer = Math.max(
        playerState.cameraShakeTimer,
        0.38
      );
      playerState.cameraShakeIntensity = Math.max(
        playerState.cameraShakeIntensity,
        0.16 + shakeProximity * 0.34
      );

      const exp = explosionPool[explosionCursor % EXPLOSION_POOL_SIZE];
      explosionCursor++;
      exp.active = true;
      exp.timer = 0;
      exp.duration = 0.68;
      exp.fireballMesh.position.set(wx, wy + 0.7, wz);
      exp.fireballMesh.scale.setScalar(0.5);
      exp.fireballMat.opacity = 0.95;
      exp.fireballMesh.visible = true;

      exp.ringMesh.position.set(wx, wy + 0.15, wz);
      exp.ringMesh.scale.setScalar(0.8);
      exp.ringMat.opacity = 0.9;
      exp.ringMesh.visible = true;

      for (let k = 0; k < 9; k++) {
        const deb = debrisPool[debrisCursor % DEBRIS_POOL_SIZE];
        debrisCursor++;
        deb.active = true;
        deb.life = 0.75 + Math.random() * 0.35;
        deb.mesh.position.set(
          wx + (Math.random() - 0.5) * 1.2,
          wy + 0.5 + Math.random() * 0.6,
          wz + (Math.random() - 0.5) * 1.2
        );
        deb.vx = (Math.random() - 0.5) * 18;
        deb.vy = 6.5 + Math.random() * 9.5;
        deb.vz = (Math.random() - 0.5) * 18;
        deb.rx = (Math.random() - 0.5) * 14;
        deb.ry = (Math.random() - 0.5) * 14;
        deb.mesh.visible = true;
      }

      spawnCollisionSparks(wx, wy + 0.4, wz, 20, 1.0);
      for (let s = 0; s < 8; s++) {
        spawnSmokePuff(
          wx + (Math.random() - 0.5) * 1.5,
          wy + 0.6,
          wz + (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 4,
          2.5 + Math.random() * 3,
          (Math.random() - 0.5) * 4,
          0.85
        );
      }
    };

    // Per-pair 0.3s collision cooldowns & overtake/corner tracking
    const collisionCooldowns: Record<string, number> = {};
    const rivalWasAhead: boolean[] = AI_DRIVERS.map(() => true);

    // Mutable Driving, Race & Combat State
    const keys: Record<string, boolean> = {};
    const mouseButtons = { left: false, right: false };
    const playerState = {
      trackDistance: 0, // meters from start
      lateralOffset: 0, // -ROAD_HALF_WIDTH..+ROAD_HALF_WIDTH
      lateralVelocity: 0,
      speed: 0, // m/s (max ~92 m/s = 330 km/h with nitro)
      steerAngle: 0, // -1..1
      heading: 0, // car travel direction yaw in world radians
      visualHeading: 0, // smoothly interpolated yaw applied to rotation.y
      camHeading: 0, // smoothly damped chase camera yaw following car heading
      driftAngle: 0, // radians visual slip angle
      spinYawVelocity: 0, // post-collision spin yaw rate (decays over ~1s)
      spinOffsetAngle: 0, // accumulated spin angle offset decaying back to 0
      cameraShakeTimer: 0, // remaining camera shake time (s)
      cameraShakeIntensity: 0, // shake amplitude
      wallHitCooldown: 0, // 0.3s cooldown for barrier hits
      inCornerZone: false,
      cornerClean: true,
      scoreEventLabel: null as string | null,
      scoreEventTimer: 0,
      nitro: 100, // 0..100
      lap: 1,
      currentLapTimeMs: 0,
      bestLapTimeMs: null as number | null,
      lastLapTimeMs: null as number | null,
      driftScore: 0,
      currentDriftPoints: 0,
      countdownTimer: 3.4,
      lastCountdownInt: 4,
      padBoostTimer: 0,
      // Combat state
      hp: 100,
      maxHp: 100,
      isDestroyed: false,
      respawnTimer: 0,
      invulnerableTimer: 0,
      hitFlashTimer: 0,
      mgHeat: 0,
      mgOverheated: false,
      mgFireTimer: 0,
      mgBarrelToggle: 1,
      missileAmmo: 6,
      missileMaxAmmo: 6,
      missileCooldown: 0,
      missileRechargeTimer: 0,
      kills: 0,
      killFeed: [] as {
        id: string;
        message: string;
        timestamp: number;
        isPlayerKill: boolean;
      }[],
      lockedRivalIdx: -1,
      damageSmokeTimer: 0,
    };

    const triggerScoreEvent = (label: string) => {
      playerState.scoreEventLabel = label;
      playerState.scoreEventTimer = 1.8;
    };

    const pushKillFeed = (message: string, isPlayerKill: boolean) => {
      playerState.killFeed = [
        {
          id: `${Date.now()}_${Math.random()}`,
          message,
          timestamp: performance.now(),
          isPlayerKill,
        },
        ...playerState.killFeed.slice(0, 3),
      ];
    };

    const resetRaceState = () => {
      evaluateTrackFrame(0, _playerFrame);
      const startYaw = Math.atan2(
        -_playerFrame.tangent.x,
        -_playerFrame.tangent.z
      );

      playerState.trackDistance = 0;
      playerState.lateralOffset = -3.6;
      playerState.lateralVelocity = 0;
      playerState.speed = 0;
      playerState.steerAngle = 0;
      playerState.heading = startYaw;
      playerState.visualHeading = startYaw;
      playerState.camHeading = startYaw;
      playerState.driftAngle = 0;
      playerState.spinYawVelocity = 0;
      playerState.spinOffsetAngle = 0;
      playerState.cameraShakeTimer = 0;
      playerState.cameraShakeIntensity = 0;
      playerState.wallHitCooldown = 0;
      playerState.inCornerZone = false;
      playerState.cornerClean = true;
      playerState.scoreEventLabel = null;
      playerState.scoreEventTimer = 0;
      playerState.nitro = 100;
      playerState.lap = 1;
      playerState.currentLapTimeMs = 0;
      playerState.lastLapTimeMs = null;
      playerState.driftScore = 0;
      playerState.currentDriftPoints = 0;
      playerState.countdownTimer = 3.2;
      playerState.lastCountdownInt = 4;
      playerState.padBoostTimer = 0;

      playerState.hp = 100;
      playerState.isDestroyed = false;
      playerState.respawnTimer = 0;
      playerState.invulnerableTimer = 0;
      playerState.hitFlashTimer = 0;
      playerState.mgHeat = 0;
      playerState.mgOverheated = false;
      playerState.mgFireTimer = 0;
      playerState.missileAmmo = 6;
      playerState.missileCooldown = 0;
      playerState.missileRechargeTimer = 0;
      playerState.kills = 0;
      playerState.killFeed = [];
      playerState.lockedRivalIdx = -1;
      playerRig.root.visible = true;
      playerRig.paintMaterials.forEach((mat) => {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      });

      bulletPool.forEach((b) => {
        b.active = false;
        b.mesh.visible = false;
      });
      missilePool.forEach((m) => {
        m.active = false;
        m.group.visible = false;
      });
      muzzleFlashPool.forEach((mf) => {
        mf.active = false;
        mf.mesh.visible = false;
      });
      pickupPool.forEach((pk) => {
        pk.active = true;
        pk.respawnTimer = 0;
        pk.group.visible = propsRef.current.combatMode;
      });

      Object.keys(collisionCooldowns).forEach((k) => {
        collisionCooldowns[k] = 0;
      });

      rivalsState.forEach((rival, idx) => {
        rival.trackDistance = (idx + 1) * 11;
        rival.lateralOffset = idx % 2 === 0 ? 3.6 : -3.6;
        rival.targetLateral = rival.lateralOffset;
        rival.speed = 0;
        rival.lap = 1;
        rival.gapSeconds = 0;
        rival.hp = 100;
        rival.maxHp = 100;
        rival.isEliminated = false;
        rival.respawnTimer = 0;
        rival.hitSlowTimer = 0;
        rival.hitFlashTimer = 0;
        rival.aiFireCooldown = 0.4 + idx * 0.25;
        rival.aiBurstRemaining = 3;
        rival.aiReloadTimer = 1.4 + idx * 0.45;
        rivalWasAhead[idx] = true;
        rivalRigs[idx].root.visible = true;
        rivalRigs[idx].paintMaterials.forEach((mat) => {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        });

        evaluateTrackFrame(rival.trackDistance, _rivalFrame);
        rivalHeadings[idx] = Math.atan2(
          -_rivalFrame.tangent.x,
          -_rivalFrame.tangent.z
        );
      });

      // Position camera smoothly behind starting grid
      _carWorldPos
        .copy(_playerFrame.position)
        .addScaledVector(_playerFrame.right, playerState.lateralOffset);
      _smoothedCamPos
        .copy(_carWorldPos)
        .addScaledVector(_playerFrame.tangent, -9.5)
        .addScaledVector(_playerFrame.up, 3.6);
      _smoothedLookAt
        .copy(_carWorldPos)
        .addScaledVector(_playerFrame.tangent, 12);
    };

    resetRaceState();

    sceneObjectsRef.current = {
      scene,
      renderer,
      sunLight,
      rimLight,
      hemiLight,
      playerRig,
      rivalRigs,
      builtTrack,
      resetRaceState,
    };

    // Pre-compile shaders once after setup
    renderer.compile(scene, camera);

    const onKeyDown = (e: KeyboardEvent) => {
      keys[e.code] = true;
      soundEngine.init();
      if (e.code === 'Space' && propsRef.current.raceStatus === 'racing') {
        e.preventDefault();
      }
      if (e.code === 'KeyR') {
        playerState.lateralOffset = 0;
        playerState.lateralVelocity = 0;
        playerState.driftAngle = 0;
        playerState.spinYawVelocity = 0;
        playerState.spinOffsetAngle = 0;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys[e.code] = false;
    };
    const onMouseDown = (e: MouseEvent) => {
      soundEngine.init();
      if (e.button === 0) mouseButtons.left = true;
      if (e.button === 2) mouseButtons.right = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) mouseButtons.left = false;
      if (e.button === 2) mouseButtons.right = false;
    };
    const onContextMenu = (e: MouseEvent) => {
      if (propsRef.current.combatMode) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) {
        composer.setSize(w, h);
      }
      if (bloomPass) {
        bloomPass.resolution.set(
          Math.max(1, Math.floor(w * 0.5)),
          Math.max(1, Math.floor(h * 0.5))
        );
      }
    };
    window.addEventListener('resize', handleResize);

    // Helper to apply damage to a rival car (with hit flash, sparks, 0.5s slowdown, and 0 HP explosion)
    const damageRival = (
      rivalIdx: number,
      damageAmount: number,
      byPlayer: boolean
    ) => {
      const rival = rivalsState[rivalIdx];
      const rig = rivalRigs[rivalIdx];
      if (!rival || rival.isEliminated) return;

      rival.hp = Math.max(0, rival.hp - damageAmount);
      rival.hitFlashTimer = 0.14;
      rival.hitSlowTimer = 0.5; // brief 0.5s slowdown on hit
      rig.paintMaterials.forEach((mat) => {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = 1.65;
      });

      spawnCollisionSparks(
        rig.root.position.x,
        rig.root.position.y + 0.5,
        rig.root.position.z,
        8,
        0.55
      );

      if (byPlayer) {
        soundEngine.playHitConfirm();
        playerState.driftScore += 50;
        triggerScoreEvent(`Target Hit +50`);
      }

      if (rival.hp <= 0) {
        rival.isEliminated = true;
        rival.respawnTimer = 5.0; // Respawn at back of pack after 5s with 50 HP (unless permanent elimination is ON)
        rival.speed = 0;
        rig.root.visible = false;
        spawnStylizedExplosion(
          rig.root.position.x,
          rig.root.position.y,
          rig.root.position.z
        );

        const permSuffix = propsRef.current.permanentElimination ? ' [OUT]' : '';
        if (byPlayer) {
          playerState.kills += 1;
          playerState.driftScore += 300;
          triggerScoreEvent(`ELIMINATED ${rival.driverName}${permSuffix} +300`);
          pushKillFeed(
            `ELIMINATED ${rival.driverName}${permSuffix} (+300)`,
            true
          );
        } else {
          pushKillFeed(`${rival.driverName} ELIMINATED${permSuffix}`, false);
        }
      }
    };

    // Helper to apply damage to the player car
    const damagePlayer = (damageAmount: number, sourceLabel: string) => {
      if (
        !propsRef.current.combatMode ||
        playerState.isDestroyed ||
        playerState.invulnerableTimer > 0
      ) {
        return;
      }
      playerState.hp = Math.max(0, playerState.hp - damageAmount);
      playerState.hitFlashTimer = 0.14;
      soundEngine.playHitConfirm();
      playerRig.paintMaterials.forEach((mat) => {
        mat.emissive.setHex(0xef4444);
        mat.emissiveIntensity = 1.6;
      });

      if (playerState.hp <= 0) {
        playerState.isDestroyed = true;
        playerState.respawnTimer = 3.0; // Respawn after 3 seconds
        playerState.speed = 0;
        playerState.lateralVelocity = 0;
        playerState.driftScore = Math.max(0, playerState.driftScore - 100);
        playerRig.root.visible = false;
        triggerScoreEvent(`DESTROYED -100`);
        pushKillFeed(`YOU WERE ELIMINATED BY ${sourceLabel} (-100)`, false);
        spawnStylizedExplosion(
          _carWorldPos.x,
          _carWorldPos.y,
          _carWorldPos.z
        );
      }
    };

    const clock = new THREE.Clock();
    let animFrameId = 0;
    let lastHudEmitTime = 0;

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const rawDelta = clock.getDelta();
      const dt = Math.min(rawDelta, 0.05);
      const elapsed = clock.getElapsedTime();

      const {
        raceStatus: currentStatus,
        cameraMode: currentCamMode,
        combatMode: isCombatMode,
        combatDifficulty: currentDifficulty,
        permanentElimination: isPermanentElimination,
        totalLaps: maxLaps,
        onTelemetryUpdate: emitTelemetry,
        onStatusChange: setStatus,
      } = propsRef.current;

      const activeTrack = sceneObjectsRef.current?.builtTrack;

      // AI Shooting Difficulty Configuration (Easy, Normal, Hard)
      const aiDifficultyConfig =
        currentDifficulty === 'easy'
          ? {
              burstInterval: 0.24,
              burstCount: 3,
              reloadDelay: 4.2,
              spreadRad: THREE.MathUtils.degToRad(9.5),
              maxRange: 46,
            }
          : currentDifficulty === 'hard'
            ? {
                burstInterval: 0.11,
                burstCount: 6,
                reloadDelay: 1.75,
                spreadRad: THREE.MathUtils.degToRad(2.6),
                maxRange: 78,
              }
            : {
                burstInterval: 0.16,
                burstCount: 4,
                reloadDelay: 2.8,
                spreadRad: THREE.MathUtils.degToRad(5.5),
                maxRange: 62,
              };

      // Tick down collision cooldowns & score banner timer
      for (const key in collisionCooldowns) {
        if (collisionCooldowns[key] > 0) {
          collisionCooldowns[key] = Math.max(0, collisionCooldowns[key] - dt);
        }
      }
      if (playerState.wallHitCooldown > 0) {
        playerState.wallHitCooldown = Math.max(
          0,
          playerState.wallHitCooldown - dt
        );
      }
      if (playerState.cameraShakeTimer > 0) {
        playerState.cameraShakeTimer = Math.max(
          0,
          playerState.cameraShakeTimer - dt
        );
      }
      if (playerState.scoreEventTimer > 0) {
        playerState.scoreEventTimer = Math.max(
          0,
          playerState.scoreEventTimer - dt
        );
        if (playerState.scoreEventTimer <= 0) {
          playerState.scoreEventLabel = null;
        }
      }

      // Handle Player Respawn (3s) & Blinking Invulnerability
      if (playerState.isDestroyed && currentStatus === 'racing') {
        playerState.respawnTimer -= dt;
        if (playerState.respawnTimer <= 0) {
          playerState.isDestroyed = false;
          playerState.hp = 100;
          playerState.lateralOffset = 0;
          playerState.lateralVelocity = 0;
          playerState.speed = 32;
          playerState.invulnerableTimer = 3.0; // 3s blinking invulnerability
          playerRig.root.visible = true;
          triggerScoreEvent('RESPAWNED — INVULNERABLE');
        }
      }
      if (playerState.invulnerableTimer > 0) {
        playerState.invulnerableTimer = Math.max(
          0,
          playerState.invulnerableTimer - dt
        );
        // Blink player mesh while invulnerable
        playerRig.root.visible =
          playerState.invulnerableTimer > 0
            ? Math.floor(elapsed * 16) % 2 === 0
            : true;
      } else if (!playerState.isDestroyed) {
        playerRig.root.visible = true;
      }

      if (playerState.hitFlashTimer > 0) {
        playerState.hitFlashTimer = Math.max(0, playerState.hitFlashTimer - dt);
        if (playerState.hitFlashTimer <= 0) {
          playerRig.paintMaterials.forEach((mat) => {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          });
        }
      }

      // Handle Race Countdown Lights (5 red pods -> green GO!)
      if (currentStatus === 'countdown') {
        playerState.countdownTimer -= dt;
        const countInt = Math.ceil(playerState.countdownTimer);
        if (countInt !== playerState.lastCountdownInt && countInt >= 0) {
          playerState.lastCountdownInt = countInt;
          soundEngine.playCountdownBeep(countInt === 0);
        }

        if (activeTrack) {
          const litCount = Math.min(
            5,
            Math.max(0, Math.floor((3.2 - playerState.countdownTimer) * 1.8))
          );
          activeTrack.gantryLights.forEach((mat, idx) => {
            const isLit = idx < litCount;
            mat.emissive.setHex(0xef4444);
            mat.emissiveIntensity = isLit ? 3.5 : 0.1;
          });
        }

        if (playerState.countdownTimer <= 0) {
          if (activeTrack) {
            activeTrack.gantryLights.forEach((mat) => {
              mat.emissive.setHex(0x10b981);
              mat.emissiveIntensity = 4.0;
            });
          }
          setStatus('racing');
        }
      }

      // Read Combined Keyboard + Mouse + Touch Controls
      const tc = touchControlsRef.current;
      const canDrive = currentStatus === 'racing' && !playerState.isDestroyed;

      const throttleInput =
        canDrive && (keys['KeyW'] || keys['ArrowUp'] || tc.throttle) ? 1 : 0;
      const brakeInput =
        canDrive && (keys['KeyS'] || keys['ArrowDown'] || tc.brake) ? 1 : 0;
      const leftInput =
        canDrive && (keys['KeyA'] || keys['ArrowLeft'] || tc.left) ? 1 : 0;
      const rightInput =
        canDrive && (keys['KeyD'] || keys['ArrowRight'] || tc.right) ? 1 : 0;
      // When Combat Mode is ON, Space/Left-Click fires Machine Gun and Shift fires Nitro; when OFF, Space also fires Nitro
      const wantsNitro =
        canDrive &&
        (keys['ShiftLeft'] ||
          keys['ShiftRight'] ||
          (!isCombatMode && keys['Space']) ||
          tc.nitro);
      const wantsMachineGun =
        canDrive &&
        isCombatMode &&
        (keys['Space'] || mouseButtons.left || tc.fireMg);
      const wantsMissile =
        canDrive &&
        isCombatMode &&
        (keys['KeyF'] || mouseButtons.right || tc.fireMissile);

      // Evaluate Player Track Frame
      evaluateTrackFrame(playerState.trackDistance, _playerFrame);

      // Check Boost Pads
      if (activeTrack && canDrive) {
        const normDist =
          ((playerState.trackDistance % TRACK_LENGTH) + TRACK_LENGTH) %
          TRACK_LENGTH;
        for (let i = 0; i < activeTrack.boostPads.length; i++) {
          const pad = activeTrack.boostPads[i];
          if (
            Math.abs(normDist - pad.trackDistance) < 6.5 &&
            Math.abs(playerState.lateralOffset - pad.lateralOffset) < 2.4
          ) {
            playerState.padBoostTimer = 0.85;
            playerState.nitro = Math.min(100, playerState.nitro + 35 * dt);
          }
        }
      }

      if (playerState.padBoostTimer > 0) {
        playerState.padBoostTimer = Math.max(0, playerState.padBoostTimer - dt);
      }

      // Check Slipstream behind AI Rivals
      let isSlipstreaming = false;
      for (let i = 0; i < rivalsState.length; i++) {
        const rv = rivalsState[i];
        if (rv.isEliminated) continue;
        const distAhead = rv.trackDistance - playerState.trackDistance;
        if (
          distAhead > 4.5 &&
          distAhead < 28 &&
          Math.abs(rv.lateralOffset - playerState.lateralOffset) < 2.1 &&
          playerState.speed > 28
        ) {
          isSlipstreaming = true;
          break;
        }
      }

      const isBoosting =
        canDrive &&
        ((wantsNitro && playerState.nitro > 1 && throttleInput > 0) ||
          playerState.padBoostTimer > 0);

      if (wantsNitro && playerState.nitro > 0 && throttleInput > 0 && canDrive) {
        playerState.nitro = Math.max(0, playerState.nitro - 26 * dt);
      } else if (canDrive) {
        const rechargeRate = isSlipstreaming ? 14 : 5.5;
        playerState.nitro = Math.min(
          100,
          playerState.nitro + rechargeRate * dt
        );
      }

      // Off-track check
      const absLat = Math.abs(playerState.lateralOffset);
      const isOffTrack = absLat > ROAD_HALF_WIDTH - 0.6;
      if (isOffTrack) {
        playerState.cornerClean = false;
      }

      const baseTopSpeed = 77.5; // ~279 km/h
      let isTyreScrubbing = false;
      let isSliding = false;

      // Longitudinal & Cornering Physics (Shooting never slows the player's car)
      if (currentStatus !== 'paused') {
        const boostBonus = isBoosting ? 16.5 : 0; // up to ~338 km/h
        const slipBonus = isSlipstreaming ? 5.5 : 0;
        const offTrackPenalty = isOffTrack ? 26.0 : 0;
        const maxSpeed =
          baseTopSpeed + boostBonus + slipBonus - offTrackPenalty;

        if (canDrive) {
          if (throttleInput > 0) {
            const accel = isBoosting ? 36.0 : 22.5;
            playerState.speed = THREE.MathUtils.damp(
              playerState.speed,
              maxSpeed,
              accel / 18,
              dt
            );
          } else if (brakeInput > 0) {
            if (playerState.speed > 1.5) {
              playerState.speed = Math.max(0, playerState.speed - 44 * dt);
            } else {
              playerState.speed = THREE.MathUtils.damp(
                playerState.speed,
                -14,
                3.0,
                dt
              );
            }
          } else {
            playerState.speed = THREE.MathUtils.damp(
              playerState.speed,
              0,
              isOffTrack ? 2.4 : 0.65,
              dt
            );
          }
        } else {
          playerState.speed = THREE.MathUtils.damp(
            playerState.speed,
            0,
            1.8,
            dt
          );
        }

        // Steering & Apex Drift Physics
        const rawSteer = rightInput - leftInput;
        playerState.steerAngle = THREE.MathUtils.damp(
          playerState.steerAngle,
          rawSteer,
          10.5,
          dt
        );

        const speedFactor = Math.min(
          1,
          Math.abs(playerState.speed) / 18
        );
        const turnRate = 15.5 * speedFactor;

        const centrifugalPush =
          _playerFrame.curvature *
          playerState.speed *
          playerState.speed *
          0.026;

        const targetLatVel =
          playerState.steerAngle * turnRate + centrifugalPush;
        playerState.lateralVelocity = THREE.MathUtils.damp(
          playerState.lateralVelocity,
          targetLatVel,
          7.5,
          dt
        );
        playerState.lateralOffset += playerState.lateralVelocity * dt;

        // 3. Speed Loss When Forcing a Turn (Tyre Scrub & High-Slip Slide Drag)
        const absSteer = Math.abs(playerState.steerAngle);
        const speedNorm = Math.abs(playerState.speed) / baseTopSpeed;
        if (canDrive && absSteer > 0.25 && speedNorm > 0.45 && playerState.speed > 0) {
          const cornerSeverity =
            1.0 + Math.abs(_playerFrame.curvature) * 4.2;
          const scrubFactor =
            Math.pow(absSteer, 1.85) *
            THREE.MathUtils.clamp((speedNorm - 0.42) / 0.58, 0, 1) *
            cornerSeverity;
          const scrubDecel = scrubFactor * 14.5;
          playerState.speed = Math.max(12, playerState.speed - scrubDecel * dt);
          if (scrubFactor > 0.22) {
            isTyreScrubbing = true;
          }
        }

        // Decay post-collision spin yaw over ~1 second & apply extra slide drag while sliding/spun
        playerState.spinYawVelocity = THREE.MathUtils.damp(
          playerState.spinYawVelocity,
          0,
          2.8,
          dt
        );
        playerState.spinOffsetAngle += playerState.spinYawVelocity * dt;
        playerState.spinOffsetAngle = THREE.MathUtils.damp(
          playerState.spinOffsetAngle,
          0,
          3.4,
          dt
        );

        const maxSlipRad = THREE.MathUtils.degToRad(8);
        isSliding =
          canDrive &&
          (Math.abs(playerState.spinOffsetAngle) > 0.08 ||
            Math.abs(playerState.spinYawVelocity) > 0.22 ||
            (Math.abs(playerState.driftAngle) > maxSlipRad * 0.72 &&
              playerState.speed > 36));

        if (isSliding && playerState.speed > 10) {
          const slideDrag =
            9.5 + Math.min(14.0, Math.abs(playerState.spinYawVelocity) * 4.5);
          playerState.speed = Math.max(8, playerState.speed - slideDrag * dt);
        }

        // Guardrail Barrier Hit Detection, Sound, Sparks & Bounce
        const guardrailLimit = ROAD_HALF_WIDTH + 0.25;
        if (Math.abs(playerState.lateralOffset) > guardrailLimit) {
          const hitSide = Math.sign(playerState.lateralOffset);
          playerState.lateralOffset = hitSide * guardrailLimit;

          const wallImpactSpeed =
            Math.abs(playerState.lateralVelocity) +
            Math.abs(playerState.speed) * 0.22;
          const wallSeverity = THREE.MathUtils.clamp(
            wallImpactSpeed / 26,
            0.18,
            1.0
          );

          playerState.lateralVelocity *= -0.42;
          playerState.speed *= Math.max(0.68, 0.92 - wallSeverity * 0.18);
          playerState.cornerClean = false;

          if (playerState.wallHitCooldown <= 0 && Math.abs(playerState.speed) > 6) {
            playerState.wallHitCooldown = 0.32;
            soundEngine.playWallHit(wallSeverity);
            playerState.cameraShakeTimer = 0.22;
            playerState.cameraShakeIntensity = 0.1 + wallSeverity * 0.18;
            playerState.spinYawVelocity += -hitSide * wallSeverity * 1.45;

            const penalty = Math.round(60 + wallSeverity * 90);
            playerState.driftScore = Math.max(
              0,
              playerState.driftScore - penalty
            );
            triggerScoreEvent(`Barrier Contact -${penalty}`);

            if (isCombatMode) {
              damagePlayer(Math.round(wallSeverity * 12), 'BARRIER IMPACT');
            }

            evaluateTrackFrame(playerState.trackDistance, _playerFrame);
            _carWorldPos
              .copy(_playerFrame.position)
              .addScaledVector(_playerFrame.right, playerState.lateralOffset);
            spawnCollisionSparks(
              _carWorldPos.x,
              _carWorldPos.y,
              _carWorldPos.z,
              10,
              wallSeverity
            );
          }
        }

        // Clean Corner Exit Detection & Reward
        const absCurvature = Math.abs(_playerFrame.curvature);
        if (canDrive && absCurvature > 0.068 && playerState.speed > 36) {
          if (!playerState.inCornerZone) {
            playerState.inCornerZone = true;
            playerState.cornerClean = !isOffTrack;
          }
        } else if (playerState.inCornerZone && absCurvature < 0.028) {
          if (playerState.cornerClean && !isOffTrack && playerState.speed > 40) {
            playerState.driftScore += 100;
            triggerScoreEvent('Clean Corner +100');
          }
          playerState.inCornerZone = false;
          playerState.cornerClean = true;
        }

        // Drift Detection & Scoring (Unchanged)
        const isDrifting =
          canDrive &&
          Math.abs(playerState.steerAngle) > 0.45 &&
          playerState.speed > 42 &&
          (Math.abs(_playerFrame.curvature) > 0.025 || brakeInput > 0);

        // Visual slip angle: max 8 degrees, applied only above 70% speed or on gravel
        const speedRatio = Math.abs(playerState.speed) / baseTopSpeed;
        const isAbove70PercentSpeed = speedRatio > 0.7;
        let targetDriftAngle = 0;

        if (isAbove70PercentSpeed || isOffTrack) {
          const highSpeedSlip = isAbove70PercentSpeed
            ? THREE.MathUtils.clamp((speedRatio - 0.7) / 0.3, 0, 1) * maxSlipRad
            : 0;
          const gravelSlip =
            isOffTrack && Math.abs(playerState.speed) > 5
              ? THREE.MathUtils.clamp(Math.abs(playerState.speed) / 28, 0, 1) *
                maxSlipRad
              : 0;
          const slipMagnitude = Math.min(
            maxSlipRad,
            Math.max(highSpeedSlip, gravelSlip)
          );
          targetDriftAngle = THREE.MathUtils.clamp(
            -playerState.steerAngle * slipMagnitude,
            -maxSlipRad,
            maxSlipRad
          );
        }

        playerState.driftAngle = THREE.MathUtils.damp(
          playerState.driftAngle,
          targetDriftAngle,
          8.5,
          dt
        );

        if (isDrifting) {
          const pts = Math.round(playerState.speed * dt * 4.5);
          playerState.currentDriftPoints += pts;
          playerState.driftScore += pts;
        } else if (playerState.currentDriftPoints > 0) {
          playerState.currentDriftPoints = 0;
        }

        // Advance along track spline
        const prevLap = Math.floor(playerState.trackDistance / TRACK_LENGTH) + 1;
        playerState.trackDistance += playerState.speed * dt;
        const newLap =
          Math.max(1, Math.floor(playerState.trackDistance / TRACK_LENGTH) + 1);

        if (canDrive) {
          playerState.currentLapTimeMs += dt * 1000;
          if (newLap > prevLap && playerState.trackDistance > TRACK_LENGTH * 0.5) {
            soundEngine.playLapComplete();
            playerState.lastLapTimeMs = playerState.currentLapTimeMs;
            playerState.missileAmmo = Math.min(
              playerState.missileMaxAmmo,
              playerState.missileAmmo + 2
            );
            if (
              playerState.bestLapTimeMs === null ||
              playerState.currentLapTimeMs < playerState.bestLapTimeMs
            ) {
              playerState.bestLapTimeMs = playerState.currentLapTimeMs;
            }
            playerState.currentLapTimeMs = 0;

            if (newLap > maxLaps) {
              setStatus('finished');
            } else {
              playerState.lap = newLap;
            }
          }
        }
      }

      // Update Player 3D Transform & Heading (Yaw)
      evaluateTrackFrame(playerState.trackDistance, _playerFrame);
      _carWorldPos
        .copy(_playerFrame.position)
        .addScaledVector(_playerFrame.right, playerState.lateralOffset);
      playerRig.root.position.copy(_carWorldPos);

      const speedMoveFactor = THREE.MathUtils.clamp(
        Math.abs(playerState.speed) / 16,
        0,
        1
      );
      const yawRateFromSteer = -playerState.steerAngle * speedMoveFactor * 1.55;
      playerState.heading += yawRateFromSteer * dt;

      const forwardSpeedMag = Math.max(5.0, Math.abs(playerState.speed));
      const steerLateralTurn =
        playerState.steerAngle *
        Math.max(2.2, forwardSpeedMag * 0.32) *
        speedMoveFactor;
      const curveTurnBias = _playerFrame.curvature * forwardSpeedMag * 1.85;
      _travelDir
        .copy(_playerFrame.tangent)
        .multiplyScalar(forwardSpeedMag)
        .addScaledVector(
          _playerFrame.right,
          playerState.lateralVelocity + steerLateralTurn + curveTurnBias
        )
        .normalize();

      const travelHeading = Math.atan2(-_travelDir.x, -_travelDir.z);
      playerState.heading = dampAngle(
        playerState.heading,
        travelHeading,
        12.5,
        dt
      );

      const targetVisualYaw =
        playerState.heading +
        playerState.driftAngle +
        playerState.spinOffsetAngle;
      playerState.visualHeading = dampAngle(
        playerState.visualHeading,
        targetVisualYaw,
        14.5,
        dt
      );

      const roadPitch = Math.asin(
        THREE.MathUtils.clamp(_playerFrame.tangent.y, -0.45, 0.45)
      );
      playerRig.root.rotation.y = playerState.visualHeading;
      playerRig.root.rotation.x = THREE.MathUtils.damp(
        playerRig.root.rotation.x,
        roadPitch,
        12.0,
        dt
      );
      playerRig.root.rotation.z = 0;

      // Car forward & right unit vectors along player heading
      _carForward
        .set(
          -Math.sin(playerState.visualHeading),
          _playerFrame.tangent.y,
          -Math.cos(playerState.visualHeading)
        )
        .normalize();
      _carRight
        .set(
          Math.cos(playerState.visualHeading),
          0,
          -Math.sin(playerState.visualHeading)
        )
        .normalize();

      // Outward Body Roll
      const maxRollRad = THREE.MathUtils.degToRad(5.4);
      const speedRollFactor = THREE.MathUtils.clamp(
        Math.abs(playerState.speed) / 62,
        0,
        1
      );
      const cornerLoad = THREE.MathUtils.clamp(
        playerState.steerAngle + _playerFrame.curvature * 2.0,
        -1.0,
        1.0
      );
      const targetRoll = THREE.MathUtils.clamp(
        cornerLoad * speedRollFactor * maxRollRad,
        -THREE.MathUtils.degToRad(5.8),
        THREE.MathUtils.degToRad(5.8)
      );
      const targetPitch =
        throttleInput > 0 ? 0.022 : brakeInput > 0 ? -0.035 : 0;
      playerRig.bodyTiltGroup.rotation.z = THREE.MathUtils.damp(
        playerRig.bodyTiltGroup.rotation.z,
        targetRoll,
        10.5,
        dt
      );
      playerRig.bodyTiltGroup.rotation.x = THREE.MathUtils.damp(
        playerRig.bodyTiltGroup.rotation.x,
        targetPitch,
        10.5,
        dt
      );

      // Front wheel steering & spin
      const maxFrontWheelSteerRad = THREE.MathUtils.degToRad(28);
      playerRig.frontWheelPivots.forEach((pivot) => {
        pivot.rotation.y = THREE.MathUtils.damp(
          pivot.rotation.y,
          -playerState.steerAngle * maxFrontWheelSteerRad,
          16.0,
          dt
        );
      });
      const wheelSpinDelta = (playerState.speed * dt) / 0.35;
      playerRig.wheelSpinMeshes.forEach((w) => {
        w.rotation.x -= wheelSpinDelta;
      });

      // Brake Light Intensity & Nitro Exhaust Flames
      playerRig.brakeLightMaterial.emissiveIntensity =
        brakeInput > 0 ? 4.8 : 1.4;
      const flameScale = isBoosting
        ? 0.9 + Math.sin(elapsed * 45) * 0.25
        : 0.001;
      playerRig.nitroFlames.forEach((flame) => {
        flame.scale.set(
          isBoosting ? 1.1 : 0.001,
          flameScale,
          isBoosting ? 1.1 : 0.001
        );
      });

      // ============================================================================
      // FLOATING TRACK PICKUPS: Repair (+30 HP) & Ammo (+Missiles), 15s Respawn
      // ============================================================================
      pickupPool.forEach((pk, idx) => {
        if (!isCombatMode) {
          pk.group.visible = false;
          return;
        }

        if (!pk.active) {
          if (currentStatus !== 'paused') {
            pk.respawnTimer -= dt;
            if (pk.respawnTimer <= 0) {
              pk.active = true;
              pk.group.visible = true;
            }
          }
          return;
        }

        pk.group.visible = true;
        pk.coreGroup.rotation.y = elapsed * 2.4 + idx * 0.8;
        pk.coreGroup.position.y =
          1.05 + Math.sin(elapsed * 3.2 + idx * 1.1) * 0.22;

        // Check pickup collection by Player
        if (canDrive) {
          const dx = _carWorldPos.x - pk.basePos.x;
          const dz = _carWorldPos.z - pk.basePos.z;
          if (dx * dx + dz * dz < 14.5) {
            pk.active = false;
            pk.respawnTimer = 15.0; // Respawn after 15 seconds
            pk.group.visible = false;
            soundEngine.playPickup(pk.type);
            spawnCollisionSparks(
              pk.basePos.x,
              pk.basePos.y + 0.8,
              pk.basePos.z,
              12,
              0.65
            );

            if (pk.type === 'repair') {
              playerState.hp = Math.min(playerState.maxHp, playerState.hp + 30);
              triggerScoreEvent('REPAIR PICKUP +30 HP');
            } else {
              playerState.missileAmmo = Math.min(
                playerState.missileMaxAmmo,
                playerState.missileAmmo + 3
              );
              playerState.mgHeat = Math.max(0, playerState.mgHeat - 35);
              playerState.mgOverheated = false;
              triggerScoreEvent('AMMO PICKUP +3 MISSILES');
            }
          }
        }
      });

      // Update 5 AI Rivals, Respawns, Hit Slowdown, Player-vs-AI & AI-vs-AI Collisions
      let minPackDistance = playerState.trackDistance;
      for (let i = 0; i < rivalsState.length; i++) {
        if (!rivalsState[i].isEliminated) {
          minPackDistance = Math.min(
            minPackDistance,
            rivalsState[i].trackDistance
          );
        }
      }

      rivalsState.forEach((rival, idx) => {
        const rig = rivalRigs[idx];

        if (rival.hitFlashTimer > 0) {
          rival.hitFlashTimer = Math.max(0, rival.hitFlashTimer - dt);
          if (rival.hitFlashTimer <= 0) {
            rig.paintMaterials.forEach((mat) => {
              mat.emissive.setHex(0x000000);
              mat.emissiveIntensity = 0;
            });
          }
        }

        // Handle Eliminated Rival Respawn after 5s at back of the pack with 50 HP (disabled if Permanent Elimination is ON)
        if (rival.isEliminated) {
          if (currentStatus === 'racing' && !isPermanentElimination) {
            rival.respawnTimer -= dt;
            if (rival.respawnTimer <= 0) {
              rival.isEliminated = false;
              rival.hp = 50; // Respawn with 50 HP
              rival.maxHp = 100;
              rival.trackDistance = Math.max(0, minPackDistance - 26 - idx * 4);
              rival.lateralOffset = (idx % 2 === 0 ? -1 : 1) * 3.4;
              rival.targetLateral = rival.lateralOffset;
              rival.speed = rival.baseMaxSpeed * 0.78;
              rival.aiReloadTimer = 1.5;
              rival.aiBurstRemaining = aiDifficultyConfig.burstCount;
              rig.root.visible = true;
              evaluateTrackFrame(rival.trackDistance, _rivalFrame);
              rivalHeadings[idx] = Math.atan2(
                -_rivalFrame.tangent.x,
                -_rivalFrame.tangent.z
              );
            }
          }
          return;
        }

        evaluateTrackFrame(rival.trackDistance, _rivalFrame);

        if (currentStatus === 'racing' || currentStatus === 'finished') {
          if (rival.hitSlowTimer > 0) {
            rival.hitSlowTimer = Math.max(0, rival.hitSlowTimer - dt);
          }

          const cornerSlowdown = Math.abs(_rivalFrame.curvature) * 65;
          const distGap = playerState.trackDistance - rival.trackDistance;
          const rubberBand = THREE.MathUtils.clamp(distGap * 0.08, -5.5, 7.5);
          const hitSlowFactor = rival.hitSlowTimer > 0 ? 0.72 : 1.0; // Brief 0.5s slowdown when hit
          const desiredSpeed =
            (rival.baseMaxSpeed - cornerSlowdown + rubberBand) * hitSlowFactor;

          rival.speed = THREE.MathUtils.damp(
            rival.speed,
            desiredSpeed,
            rival.hitSlowTimer > 0 ? 6.5 : 2.2,
            dt
          );
          rival.trackDistance += rival.speed * dt;
          rival.lap =
            Math.max(1, Math.floor(rival.trackDistance / TRACK_LENGTH) + 1);

          if (Math.sin(elapsed * 0.7 + idx * 2.1) > 0.65) {
            rival.targetLateral =
              Math.sin(elapsed * 0.35 + idx * 1.9) * (ROAD_HALF_WIDTH * 0.58);
          }
          rival.lateralOffset = THREE.MathUtils.damp(
            rival.lateralOffset,
            rival.targetLateral,
            1.8,
            dt
          );

          // Player-vs-AI Box/Circle Overlap Collision Detection on XZ / Track Plane
          if (!playerState.isDestroyed) {
            const longDiff = rival.trackDistance - playerState.trackDistance;
            const latDiff = rival.lateralOffset - playerState.lateralOffset;
            const minLongSep = 4.35;
            const minLatSep = 2.02;

            if (
              Math.abs(longDiff) < minLongSep &&
              Math.abs(latDiff) < minLatSep
            ) {
              const latPushSign = latDiff >= 0 ? -1 : 1;
              const latOverlap = minLatSep - Math.abs(latDiff);
              playerState.lateralOffset += latPushSign * latOverlap * 0.58;
              rival.lateralOffset -= latPushSign * latOverlap * 0.42;

              if (Math.abs(longDiff) < 3.4) {
                const longPushSign = longDiff >= 0 ? -1 : 1;
                playerState.trackDistance += longPushSign * 0.35;
                rival.trackDistance -= longPushSign * 0.35;
              }

              const pairKey = `player_${rival.id}`;
              if ((collisionCooldowns[pairKey] ?? 0) <= 0) {
                collisionCooldowns[pairKey] = 0.32;

                const relLongSpeed = Math.abs(playerState.speed - rival.speed);
                const relLatSpeed = Math.abs(playerState.lateralVelocity);
                const rawImpact =
                  (relLongSpeed +
                    relLatSpeed * 0.7 +
                    playerState.speed * 0.25) /
                  42;
                const impactSeverity = THREE.MathUtils.clamp(
                  rawImpact,
                  0.18,
                  1.0
                );

                soundEngine.playCarCollision(impactSeverity);

                playerState.lateralVelocity +=
                  latPushSign * (6.5 + impactSeverity * 9.5);
                playerState.heading +=
                  latPushSign * (0.06 + impactSeverity * 0.12);

                if (impactSeverity > 0.52) {
                  const speedFraction = THREE.MathUtils.lerp(
                    0.76,
                    0.54,
                    (impactSeverity - 0.52) / 0.48
                  );
                  playerState.speed *= speedFraction;
                  rival.speed *= 0.84;
                  playerState.spinYawVelocity +=
                    latPushSign * (1.35 + impactSeverity * 1.85);
                } else {
                  playerState.speed *= 1.0 - impactSeverity * 0.24;
                  rival.speed *= 1.0 - impactSeverity * 0.16;
                  playerState.spinYawVelocity +=
                    latPushSign * impactSeverity * 0.75;
                }

                playerState.cameraShakeTimer = 0.28;
                playerState.cameraShakeIntensity = 0.12 + impactSeverity * 0.26;
                playerState.cornerClean = false;

                const scorePenalty = Math.round(90 + impactSeverity * 160);
                playerState.driftScore = Math.max(
                  0,
                  playerState.driftScore - scorePenalty
                );
                triggerScoreEvent(`Collision -${scorePenalty}`);

                if (isCombatMode) {
                  damagePlayer(
                    Math.round(8 + impactSeverity * 14),
                    rival.driverName
                  );
                  damageRival(idx, Math.round(6 + impactSeverity * 12), false);
                }

                const contactX = (_carWorldPos.x + rig.root.position.x) * 0.5;
                const contactY = (_carWorldPos.y + rig.root.position.y) * 0.5;
                const contactZ = (_carWorldPos.z + rig.root.position.z) * 0.5;
                spawnCollisionSparks(
                  contactX,
                  contactY,
                  contactZ,
                  14,
                  impactSeverity
                );
              }
            }
          }

          // Check Clean Overtake Reward
          const isNowAhead = rival.trackDistance > playerState.trackDistance;
          if (
            rivalWasAhead[idx] &&
            !isNowAhead &&
            playerState.trackDistance > 35 &&
            (collisionCooldowns[`player_${rival.id}`] ?? 0) <= 0 &&
            !isOffTrack
          ) {
            playerState.driftScore += 150;
            triggerScoreEvent(`Clean Overtake +150`);
          }
          rivalWasAhead[idx] = isNowAhead;
        }
      });

      // AI-vs-AI Collision Detection & Separation
      if (currentStatus === 'racing' || currentStatus === 'finished') {
        for (let i = 0; i < rivalsState.length; i++) {
          if (rivalsState[i].isEliminated) continue;
          for (let j = i + 1; j < rivalsState.length; j++) {
            if (rivalsState[j].isEliminated) continue;
            const a = rivalsState[i];
            const b = rivalsState[j];
            const dLong = b.trackDistance - a.trackDistance;
            const dLat = b.lateralOffset - a.lateralOffset;
            if (Math.abs(dLong) < 4.2 && Math.abs(dLat) < 1.95) {
              const pushSign = dLat >= 0 ? 1 : -1;
              const overlap = (1.95 - Math.abs(dLat)) * 0.5;
              a.lateralOffset -= pushSign * overlap;
              b.lateralOffset += pushSign * overlap;
              a.targetLateral = THREE.MathUtils.clamp(
                a.lateralOffset - pushSign * 1.2,
                -ROAD_HALF_WIDTH * 0.7,
                ROAD_HALF_WIDTH * 0.7
              );
              b.targetLateral = THREE.MathUtils.clamp(
                b.lateralOffset + pushSign * 1.2,
                -ROAD_HALF_WIDTH * 0.7,
                ROAD_HALF_WIDTH * 0.7
              );

              const aiPairKey = `${a.id}_${b.id}`;
              if ((collisionCooldowns[aiPairKey] ?? 0) <= 0) {
                collisionCooldowns[aiPairKey] = 0.3;
                a.speed *= 0.91;
                b.speed *= 0.91;
              }
            }
          }
        }
      }

      // Update AI Rival 3D Transforms & Smooth Waypoint Orientation
      rivalsState.forEach((rival, idx) => {
        if (rival.isEliminated) return;
        const rig = rivalRigs[idx];
        evaluateTrackFrame(rival.trackDistance, _rivalFrame);
        _rivalWorldPos
          .copy(_rivalFrame.position)
          .addScaledVector(_rivalFrame.right, rival.lateralOffset);
        rig.root.position.copy(_rivalWorldPos);

        const waypointLookAhead = 14.0;
        const nextLateral = THREE.MathUtils.lerp(
          rival.lateralOffset,
          rival.targetLateral,
          0.45
        );
        evaluateTrackFrame(
          rival.trackDistance + waypointLookAhead,
          _rivalNextFrame
        );
        _rivalNextWaypointPos
          .copy(_rivalNextFrame.position)
          .addScaledVector(_rivalNextFrame.right, nextLateral);

        _rivalToNext
          .subVectors(_rivalNextWaypointPos, _rivalWorldPos)
          .normalize();
        const targetRivalYaw = Math.atan2(-_rivalToNext.x, -_rivalToNext.z);
        const prevRivalYaw = rivalHeadings[idx];
        const smoothedRivalYaw = dampAngle(
          prevRivalYaw,
          targetRivalYaw,
          11.0,
          dt
        );
        rivalHeadings[idx] = smoothedRivalYaw;

        const rivalRoadPitch = Math.asin(
          THREE.MathUtils.clamp(_rivalFrame.tangent.y, -0.45, 0.45)
        );
        rig.root.rotation.y = smoothedRivalYaw;
        rig.root.rotation.x = THREE.MathUtils.damp(
          rig.root.rotation.x,
          rivalRoadPitch,
          10.0,
          dt
        );
        rig.root.rotation.z = 0;

        let yawDelta = targetRivalYaw - smoothedRivalYaw;
        yawDelta = ((yawDelta + Math.PI) % (Math.PI * 2)) - Math.PI;
        const aiSteer = THREE.MathUtils.clamp(
          -yawDelta * 2.4 + _rivalFrame.curvature * 1.8,
          -1,
          1
        );
        rig.frontWheelPivots.forEach((pivot) => {
          pivot.rotation.y = THREE.MathUtils.damp(
            pivot.rotation.y,
            -aiSteer * maxFrontWheelSteerRad,
            12.0,
            dt
          );
        });
        const aiSpeedRoll = THREE.MathUtils.clamp(rival.speed / 65, 0, 1);
        rig.bodyTiltGroup.rotation.z = THREE.MathUtils.damp(
          rig.bodyTiltGroup.rotation.z,
          aiSteer * aiSpeedRoll * THREE.MathUtils.degToRad(4.8),
          9.0,
          dt
        );

        const rSpin = (rival.speed * dt) / 0.35;
        rig.wheelSpinMeshes.forEach((w) => {
          w.rotation.x -= rSpin;
        });

        // AI SHOOTING BACK: Rivals occasionally shoot when player is ahead and in front,
        // with difficulty-scaled accuracy cone, fire rate, and reload delay between bursts.
        if (isCombatMode && canDrive && currentStatus === 'racing') {
          if (rival.aiReloadTimer > 0) {
            rival.aiReloadTimer = Math.max(0, rival.aiReloadTimer - dt);
            if (rival.aiReloadTimer <= 0) {
              rival.aiBurstRemaining = aiDifficultyConfig.burstCount;
            }
          } else {
            const distAhead = playerState.trackDistance - rival.trackDistance;
            const latDiff = Math.abs(
              playerState.lateralOffset - rival.lateralOffset
            );

            // Check if player is ahead on track and within rival's forward cone
            if (
              distAhead > 5.0 &&
              distAhead < aiDifficultyConfig.maxRange &&
              latDiff < 3.6
            ) {
              _toRival.subVectors(_carWorldPos, _rivalWorldPos);
              const worldDist = _toRival.length();
              if (worldDist > 3.0) {
                _toRival.divideScalar(worldDist);
                const rFwdX = -Math.sin(smoothedRivalYaw);
                const rFwdZ = -Math.cos(smoothedRivalYaw);
                const forwardDot = rFwdX * _toRival.x + rFwdZ * _toRival.z;

                if (forwardDot > 0.78) {
                  rival.aiFireCooldown -= dt;
                  if (rival.aiFireCooldown <= 0) {
                    rival.aiFireCooldown = aiDifficultyConfig.burstInterval;
                    rival.aiBurstRemaining -= 1;

                    if (rival.aiBurstRemaining <= 0) {
                      rival.aiReloadTimer =
                        aiDifficultyConfig.reloadDelay *
                        (0.85 + Math.random() * 0.35);
                    }

                    // Apply angular inaccuracy based on Easy/Normal/Hard spread
                    const spread = aiDifficultyConfig.spreadRad;
                    const errYaw = (Math.random() - 0.5) * 2.0 * spread;
                    const cosE = Math.cos(errYaw);
                    const sinE = Math.sin(errYaw);
                    const dirX = _toRival.x * cosE - _toRival.z * sinE;
                    const dirZ = _toRival.x * sinE + _toRival.z * cosE;
                    const dirY =
                      _toRival.y + (Math.random() - 0.5) * spread * 0.35;

                    const aiMuzzleX = _rivalWorldPos.x + rFwdX * 2.1;
                    const aiMuzzleY = _rivalWorldPos.y + 0.62;
                    const aiMuzzleZ = _rivalWorldPos.z + rFwdZ * 2.1;

                    spawnBullet(
                      false,
                      idx,
                      aiMuzzleX,
                      aiMuzzleY,
                      aiMuzzleZ,
                      dirX,
                      dirY,
                      dirZ,
                      rival.speed
                    );
                    spawnMuzzleFlash(
                      aiMuzzleX,
                      aiMuzzleY,
                      aiMuzzleZ,
                      0.85,
                      0xfb7185
                    );
                    if (worldDist < 48) {
                      soundEngine.playMachineGunShot(0.25);
                    }
                  }
                }
              }
            }
          }
        }
      });

      // ============================================================================
      // COMBAT SYSTEM: 8° Aim-Assist Targeting, Machine Gun, Homing Missiles & Smoke
      // ============================================================================
      const cos8Deg = Math.cos(THREE.MathUtils.degToRad(8));
      let bestLockIdx = -1;
      let bestLockDist = 115; // max lock range in meters

      if (isCombatMode && !playerState.isDestroyed) {
        for (let i = 0; i < rivalsState.length; i++) {
          const rv = rivalsState[i];
          if (rv.isEliminated) continue;
          const rPos = rivalRigs[i].root.position;
          _toRival.subVectors(rPos, _carWorldPos);
          const dist = _toRival.length();
          if (dist > 3.0 && dist < bestLockDist) {
            _toRival.divideScalar(dist);
            const dot = _carForward.dot(_toRival);
            if (dot >= cos8Deg) {
              bestLockDist = dist;
              bestLockIdx = i;
            }
          }
        }
      }
      playerState.lockedRivalIdx = bestLockIdx;

      // Update 3D Health Bars & Red Target Lock Bracket above each AI car
      rivalsState.forEach((rival, idx) => {
        const hb = rivalHealthBarRigs[idx];
        if (!isCombatMode || rival.isEliminated) {
          hb.group.visible = false;
          hb.lockBox.visible = false;
          return;
        }
        hb.group.visible = true;
        hb.group.lookAt(camera.position);
        const hpRatio = THREE.MathUtils.clamp(rival.hp / rival.maxHp, 0.01, 1);
        hb.fillMesh.scale.x = hpRatio;
        hb.fillMesh.position.x = -0.52 * (1 - hpRatio);
        hb.fillMat.color.setHex(
          hpRatio > 0.5 ? 0x10b981 : hpRatio > 0.3 ? 0xf59e0b : 0xef4444
        );
        hb.lockBox.visible = idx === bestLockIdx;
      });

      if (currentStatus !== 'paused') {
        // 1. Machine Gun Heat & Firing (4 HP per bullet, fast fire rate, overheat lockout, Muzzle Flash)
        if (playerState.mgFireTimer > 0) {
          playerState.mgFireTimer = Math.max(0, playerState.mgFireTimer - dt);
        }

        if (
          wantsMachineGun &&
          !playerState.mgOverheated &&
          playerState.mgFireTimer <= 0
        ) {
          playerState.mgFireTimer = 0.085; // ~11.7 rounds/sec
          playerState.mgHeat = Math.min(100, playerState.mgHeat + 7.5);
          if (playerState.mgHeat >= 100) {
            playerState.mgOverheated = true;
            triggerScoreEvent('WEAPON OVERHEATED');
          }

          playerState.mgBarrelToggle *= -1;
          const muzzleX =
            _carWorldPos.x +
            _carForward.x * 2.15 +
            _carRight.x * (0.52 * playerState.mgBarrelToggle);
          const muzzleY = _carWorldPos.y + 0.62;
          const muzzleZ =
            _carWorldPos.z +
            _carForward.z * 2.15 +
            _carRight.z * (0.52 * playerState.mgBarrelToggle);

          // Aim along car heading, or snap within 8-deg aim-assist cone to locked rival
          if (bestLockIdx >= 0) {
            const targetPos = rivalRigs[bestLockIdx].root.position;
            _aimDir
              .set(
                targetPos.x - muzzleX,
                targetPos.y + 0.55 - muzzleY,
                targetPos.z - muzzleZ
              )
              .normalize();
          } else {
            _aimDir.copy(_carForward);
          }

          spawnBullet(
            true,
            -1,
            muzzleX,
            muzzleY,
            muzzleZ,
            _aimDir.x,
            _aimDir.y,
            _aimDir.z,
            Math.max(0, playerState.speed)
          );
          spawnMuzzleFlash(muzzleX, muzzleY, muzzleZ, 1.0, 0xfef08a);
          soundEngine.playMachineGunShot(playerState.mgHeat / 100);
        } else {
          const coolRate = playerState.mgOverheated ? 36.0 : 28.0;
          playerState.mgHeat = Math.max(0, playerState.mgHeat - coolRate * dt);
          if (playerState.mgOverheated && playerState.mgHeat <= 18) {
            playerState.mgOverheated = false;
          }
        }

        // 2. Homing Missile Firing & Ammo Recharge (35 HP damage, slow fire rate, slight homing)
        if (playerState.missileCooldown > 0) {
          playerState.missileCooldown = Math.max(
            0,
            playerState.missileCooldown - dt
          );
        }
        if (playerState.missileAmmo < playerState.missileMaxAmmo && canDrive) {
          playerState.missileRechargeTimer += dt;
          if (playerState.missileRechargeTimer >= 12.0) {
            playerState.missileRechargeTimer = 0;
            playerState.missileAmmo += 1;
          }
        }

        if (
          wantsMissile &&
          playerState.missileCooldown <= 0 &&
          playerState.missileAmmo > 0
        ) {
          playerState.missileCooldown = 1.15;
          playerState.missileAmmo -= 1;

          // Find nearest active rival ahead for slight homing
          let homingIdx = bestLockIdx;
          if (homingIdx < 0) {
            let nearestAheadDist = 140;
            for (let i = 0; i < rivalsState.length; i++) {
              const rv = rivalsState[i];
              if (rv.isEliminated) continue;
              const dAhead = rv.trackDistance - playerState.trackDistance;
              if (dAhead > 2 && dAhead < nearestAheadDist) {
                nearestAheadDist = dAhead;
                homingIdx = i;
              }
            }
          }

          const m = missilePool[missileCursor % MISSILE_POOL_SIZE];
          missileCursor++;
          m.active = true;
          m.x = _carWorldPos.x + _carForward.x * 2.4;
          m.y = _carWorldPos.y + 0.68;
          m.z = _carWorldPos.z + _carForward.z * 2.4;
          const launchSpeed = Math.max(30, playerState.speed) + 78;
          m.vx = _carForward.x * launchSpeed;
          m.vy = _carForward.y * launchSpeed;
          m.vz = _carForward.z * launchSpeed;
          m.life = 3.2;
          m.targetIdx = homingIdx;
          m.smokeTimer = 0;
          m.group.position.set(m.x, m.y, m.z);
          m.group.lookAt(
            m.x + _carForward.x,
            m.y + _carForward.y,
            m.z + _carForward.z
          );
          m.group.visible = true;
          spawnMuzzleFlash(m.x, m.y, m.z, 1.45, 0xf97316);
          soundEngine.playMissileLaunch();
        }

        // Update Pooled Muzzle Flashes
        for (let i = 0; i < MUZZLE_FLASH_POOL_SIZE; i++) {
          const mf = muzzleFlashPool[i];
          if (!mf.active) continue;
          mf.timer += dt;
          if (mf.timer >= mf.duration) {
            mf.active = false;
            mf.mesh.visible = false;
          } else {
            const p = mf.timer / mf.duration;
            mf.mesh.scale.setScalar(0.95 * (1 + p * 0.7));
            mf.mat.opacity = (1 - p) * 0.95;
          }
        }

        // Update Pooled Tracer Bullets & Check Hits
        for (let i = 0; i < BULLET_POOL_SIZE; i++) {
          const b = bulletPool[i];
          if (!b.active) continue;
          b.life -= dt;
          if (b.life <= 0) {
            b.active = false;
            b.mesh.visible = false;
            continue;
          }
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.z += b.vz * dt;
          b.mesh.position.set(b.x, b.y, b.z);

          if (b.isPlayer) {
            for (let rIdx = 0; rIdx < rivalsState.length; rIdx++) {
              const rv = rivalsState[rIdx];
              if (rv.isEliminated) continue;
              const rPos = rivalRigs[rIdx].root.position;
              const dx = b.x - rPos.x;
              const dy = b.y - (rPos.y + 0.6);
              const dz = b.z - rPos.z;
              if (dx * dx + dz * dz < 3.6 && Math.abs(dy) < 1.3) {
                b.active = false;
                b.mesh.visible = false;
                damageRival(rIdx, 4, true); // 4 HP per machine gun bullet
                break;
              }
            }
          } else if (!playerState.isDestroyed) {
            const dx = b.x - _carWorldPos.x;
            const dy = b.y - (_carWorldPos.y + 0.6);
            const dz = b.z - _carWorldPos.z;
            if (dx * dx + dz * dz < 3.4 && Math.abs(dy) < 1.3) {
              b.active = false;
              b.mesh.visible = false;
              const shooterName =
                b.ownerIdx >= 0
                  ? rivalsState[b.ownerIdx].driverName
                  : 'RIVAL';
              damagePlayer(4, shooterName);
              spawnCollisionSparks(b.x, b.y, b.z, 6, 0.4);
            }
          }
        }

        // Update Pooled Homing Missiles & Smoke Trails
        for (let i = 0; i < MISSILE_POOL_SIZE; i++) {
          const m = missilePool[i];
          if (!m.active) continue;
          m.life -= dt;
          if (m.life <= 0) {
            m.active = false;
            m.group.visible = false;
            continue;
          }

          // Slight homing toward target rival ahead
          if (
            m.targetIdx >= 0 &&
            !rivalsState[m.targetIdx].isEliminated
          ) {
            const tPos = rivalRigs[m.targetIdx].root.position;
            _toRival
              .set(tPos.x - m.x, tPos.y + 0.55 - m.y, tPos.z - m.z)
              .normalize();
            const curSpeed = Math.sqrt(
              m.vx * m.vx + m.vy * m.vy + m.vz * m.vz
            );
            _aimDir.set(m.vx, m.vy, m.vz).divideScalar(Math.max(1, curSpeed));
            _aimDir.lerp(_toRival, 1 - Math.exp(-3.4 * dt)).normalize();
            m.vx = _aimDir.x * curSpeed;
            m.vy = _aimDir.y * curSpeed;
            m.vz = _aimDir.z * curSpeed;
          }

          m.x += m.vx * dt;
          m.y += m.vy * dt;
          m.z += m.vz * dt;
          m.group.position.set(m.x, m.y, m.z);
          m.group.lookAt(m.x + m.vx, m.y + m.vy, m.z + m.vz);

          m.smokeTimer += dt;
          if (m.smokeTimer >= 0.025) {
            m.smokeTimer = 0;
            spawnSmokePuff(m.x, m.y, m.z, 0, 0.6, 0, 0.42);
          }

          // Check missile impact against any active rival (35 HP damage)
          for (let rIdx = 0; rIdx < rivalsState.length; rIdx++) {
            const rv = rivalsState[rIdx];
            if (rv.isEliminated) continue;
            const rPos = rivalRigs[rIdx].root.position;
            const dx = m.x - rPos.x;
            const dy = m.y - (rPos.y + 0.6);
            const dz = m.z - rPos.z;
            if (dx * dx + dz * dz < 6.8 && Math.abs(dy) < 1.8) {
              m.active = false;
              m.group.visible = false;
              spawnCollisionSparks(m.x, m.y, m.z, 18, 0.95);
              damageRival(rIdx, 35, true); // 35 HP per missile
              break;
            }
          }
        }

        // Continuous Smoke Emission at <= 30% HP for Player and Rivals
        playerState.damageSmokeTimer += dt;
        if (playerState.damageSmokeTimer >= 0.05) {
          playerState.damageSmokeTimer = 0;
          if (
            isCombatMode &&
            !playerState.isDestroyed &&
            playerState.hp > 0 &&
            playerState.hp <= 30
          ) {
            spawnSmokePuff(
              _carWorldPos.x - _carForward.x * 1.3,
              _carWorldPos.y + 0.65,
              _carWorldPos.z - _carForward.z * 1.3,
              0,
              1.5,
              0,
              0.65
            );
          }
          for (let i = 0; i < rivalsState.length; i++) {
            const rv = rivalsState[i];
            if (isCombatMode && !rv.isEliminated && rv.hp > 0 && rv.hp <= 30) {
              const rPos = rivalRigs[i].root.position;
              spawnSmokePuff(rPos.x, rPos.y + 0.65, rPos.z, 0, 1.5, 0, 0.65);
            }
          }
        }

        // Update Pooled Smoke Particles
        const smokePosAttr = smokeGeo.getAttribute(
          'position'
        ) as THREE.BufferAttribute;
        let smokeActive = false;
        for (let i = 0; i < smokePoolCount; i++) {
          if (smokeLifetimes[i] > 0) {
            smokeActive = true;
            smokeLifetimes[i] -= dt;
            if (smokeLifetimes[i] <= 0) {
              smokePosAttr.setY(i, -999);
            } else {
              smokePosAttr.setXYZ(
                i,
                smokePosAttr.getX(i) + smokeVelocities[i * 3] * dt,
                smokePosAttr.getY(i) + smokeVelocities[i * 3 + 1] * dt,
                smokePosAttr.getZ(i) + smokeVelocities[i * 3 + 2] * dt
              );
            }
          }
        }
        if (smokeActive) {
          smokePosAttr.needsUpdate = true;
        }

        // Update Pooled Stylized Explosions (Fireball + Shockwave Ring + Debris)
        for (let i = 0; i < EXPLOSION_POOL_SIZE; i++) {
          const exp = explosionPool[i];
          if (!exp.active) continue;
          exp.timer += dt;
          const progress = exp.timer / exp.duration;
          if (progress >= 1) {
            exp.active = false;
            exp.fireballMesh.visible = false;
            exp.ringMesh.visible = false;
          } else {
            const fbScale = 0.6 + Math.pow(progress, 0.55) * 5.8;
            exp.fireballMesh.scale.setScalar(fbScale);
            exp.fireballMat.opacity = (1 - progress) * 0.92;

            const rgScale = 1.0 + progress * 13.5;
            exp.ringMesh.scale.setScalar(rgScale);
            exp.ringMat.opacity = (1 - progress) * 0.88;
          }
        }

        for (let i = 0; i < DEBRIS_POOL_SIZE; i++) {
          const deb = debrisPool[i];
          if (!deb.active) continue;
          deb.life -= dt;
          if (deb.life <= 0) {
            deb.active = false;
            deb.mesh.visible = false;
          } else {
            deb.mesh.position.x += deb.vx * dt;
            deb.mesh.position.y += deb.vy * dt;
            deb.mesh.position.z += deb.vz * dt;
            deb.vy -= 22.0 * dt;
            deb.mesh.rotation.x += deb.rx * dt;
            deb.mesh.rotation.y += deb.ry * dt;
          }
        }
      }

      // 1. Speed Wind Particles Update
      particleMat.uniforms.uOpacity.value = THREE.MathUtils.clamp(
        (playerState.speed - 48) / 40,
        0,
        isBoosting ? 0.65 : 0.28
      );
      const posAttr = particleGeo.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      for (let i = 0; i < particleCount; i++) {
        let pz = posAttr.getZ(i) + playerState.speed * dt * 1.4;
        if (pz > 4) pz = -38;
        posAttr.setZ(i, pz);
      }
      posAttr.needsUpdate = true;

      // 2. Ambient Desert Dust Motes Floating in the Air
      const ambAttr = ambientDustGeo.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      for (let i = 0; i < ambientDustCount; i++) {
        let ay = ambAttr.getY(i) + Math.sin(elapsed * 1.2 + i) * 0.008;
        let az = ambAttr.getZ(i) + (playerState.speed * 0.35 + 1.8) * dt;
        if (az > 22) az = -22;
        if (ay < 0.3) ay = 8.5;
        ambAttr.setY(i, ay);
        ambAttr.setZ(i, az);
      }
      ambAttr.needsUpdate = true;

      // 3. Off-Track Gravel / Sand Dust Plume Trail behind Car
      const isKickingGravel = isOffTrack && Math.abs(playerState.speed) > 8;
      gravelDustMat.uniforms.uOpacity.value = THREE.MathUtils.damp(
        gravelDustMat.uniforms.uOpacity.value,
        isKickingGravel ? 0.58 : 0.0,
        8.0,
        dt
      );
      if (gravelDustMat.uniforms.uOpacity.value > 0.02) {
        const gravAttr = gravelDustGeo.getAttribute(
          'position'
        ) as THREE.BufferAttribute;
        for (let i = 0; i < gravelDustCount; i++) {
          let gz =
            gravAttr.getZ(i) + Math.max(12, playerState.speed * 0.45) * dt;
          let gy = gravAttr.getY(i) + 1.8 * dt;
          if (gz > 10.5) {
            gz = 1.65 + (i % 4) * 0.35;
            gy = 0.22;
          }
          gravAttr.setY(i, gy);
          gravAttr.setZ(i, gz);
        }
        gravAttr.needsUpdate = true;
      }

      // 4. Update Pooled World-Space Collision Spark Particles
      const sparkPosAttr = sparkGeo.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      let sparksActive = false;
      for (let i = 0; i < sparkPoolCount; i++) {
        if (sparkLifetimes[i] > 0) {
          sparksActive = true;
          sparkLifetimes[i] -= dt;
          if (sparkLifetimes[i] <= 0) {
            sparkPosAttr.setY(i, -999);
          } else {
            const sx = sparkPosAttr.getX(i) + sparkVelocities[i * 3] * dt;
            const sy = sparkPosAttr.getY(i) + sparkVelocities[i * 3 + 1] * dt;
            const sz = sparkPosAttr.getZ(i) + sparkVelocities[i * 3 + 2] * dt;
            sparkVelocities[i * 3 + 1] -= 14.5 * dt; // gravity on sparks
            sparkPosAttr.setXYZ(i, sx, sy, sz);
          }
        }
      }
      if (sparksActive) {
        sparkPosAttr.needsUpdate = true;
      }

      // Keep Sunset Key Light (Long Shadows) & Warm Rim Light centered on Player Car
      sunLight.position.set(
        _carWorldPos.x - 65,
        _carWorldPos.y + 38,
        _carWorldPos.z - 90
      );
      sunLight.target.position.copy(_carWorldPos);

      rimLight.position.set(
        _carWorldPos.x + 55,
        _carWorldPos.y + 24,
        _carWorldPos.z + 75
      );
      rimLight.target.position.copy(_carWorldPos);

      // 6. Camera Choreography: Chase Camera Follows Car's Heading with Increased Smooth Damping + Halved Sideways Offset + Impact Shake
      const targetFov =
        currentCamMode === 'hood'
          ? 68 + (playerState.speed / 90) * 14
          : 60 + (playerState.speed / 90) * 16 + (isBoosting ? 5 : 0);
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6.0, dt);
      camera.updateProjectionMatrix();

      playerState.camHeading = dampAngle(
        playerState.camHeading,
        playerState.heading,
        11.5,
        dt
      );
      _camForward
        .set(
          -Math.sin(playerState.camHeading),
          _playerFrame.tangent.y,
          -Math.cos(playerState.camHeading)
        )
        .normalize();
      _camRight
        .set(
          Math.cos(playerState.camHeading),
          0,
          -Math.sin(playerState.camHeading)
        )
        .normalize();

      if (currentCamMode === 'hood') {
        _desiredCamPos
          .copy(_carWorldPos)
          .addScaledVector(_playerFrame.up, 1.18)
          .addScaledVector(_carForward, 0.35);
        _desiredLookAt
          .copy(_carWorldPos)
          .addScaledVector(_carForward, 28)
          .addScaledVector(_playerFrame.up, 0.9);
        camera.position.copy(_desiredCamPos);
        camera.lookAt(_desiredLookAt);
      } else if (currentCamMode === 'aerial') {
        evaluateTrackFrame(playerState.trackDistance - 16, _camFrame);
        _desiredCamPos
          .copy(_carWorldPos)
          .addScaledVector(_camForward, -15.5)
          .addScaledVector(_playerFrame.up, 9.2)
          .addScaledVector(_camRight, playerState.steerAngle * 1.1);
        _desiredLookAt
          .copy(_carWorldPos)
          .addScaledVector(_carForward, 12)
          .addScaledVector(_playerFrame.up, 0.8);

        _smoothedCamPos.lerp(_desiredCamPos, 1 - Math.exp(-8 * dt));
        _smoothedLookAt.lerp(_desiredLookAt, 1 - Math.exp(-12 * dt));
        camera.position.copy(_smoothedCamPos);
        camera.lookAt(_smoothedLookAt);
      } else {
        const turnSideOffset =
          (playerState.steerAngle * 0.52 - playerState.driftAngle * 1.05) *
          THREE.MathUtils.clamp(0.35 + speedMoveFactor * 0.65, 0.35, 1.0);

        _desiredCamPos
          .copy(_carWorldPos)
          .addScaledVector(_camForward, -7.2)
          .addScaledVector(_playerFrame.up, 2.55)
          .addScaledVector(_camRight, turnSideOffset);
        _desiredLookAt
          .copy(_carWorldPos)
          .addScaledVector(_carForward, 9.5)
          .addScaledVector(
            _camRight,
            playerState.steerAngle * 0.42 * speedMoveFactor
          )
          .addScaledVector(_playerFrame.up, 0.85);

        _smoothedCamPos.lerp(_desiredCamPos, 1 - Math.exp(-13.5 * dt));
        _smoothedLookAt.lerp(_desiredLookAt, 1 - Math.exp(-17.0 * dt));
        camera.position.copy(_smoothedCamPos);
        camera.lookAt(_smoothedLookAt);
      }

      // Apply short physical camera shake on collision impact
      if (playerState.cameraShakeTimer > 0) {
        const shakeDecay = playerState.cameraShakeTimer / 0.28;
        const amp = playerState.cameraShakeIntensity * shakeDecay;
        camera.position.x += Math.sin(elapsed * 95) * amp;
        camera.position.y += Math.cos(elapsed * 115) * amp * 0.7;
      }

      // Update Sky Dome, Stars & Drifting Clouds
      if (activeTrack) {
        activeTrack.updateEnvironment(elapsed, camera.position);
      }

      // Calculate Engine RPM & Gear (6-speed sequential + R/N)
      const absSpeedKmh = Math.abs(playerState.speed) * 3.6;
      let gear = '1';
      let rpm = 1200;
      if (playerState.speed < -0.5) {
        gear = 'R';
        rpm = 1800 + Math.min(6500, absSpeedKmh * 110);
      } else if (absSpeedKmh < 2) {
        gear = 'N';
        rpm = 1150 + throttleInput * 2800;
      } else {
        const gearThresholds = [0, 52, 98, 146, 198, 252, 360];
        let gIdx = 1;
        for (let g = 1; g <= 6; g++) {
          if (absSpeedKmh >= gearThresholds[g - 1]) {
            gIdx = g;
          }
        }
        gear = String(gIdx);
        const low = gearThresholds[gIdx - 1];
        const high = gearThresholds[gIdx];
        const ratio = THREE.MathUtils.clamp(
          (absSpeedKmh - low) / Math.max(1, high - low),
          0,
          1
        );
        rpm = Math.round(3100 + ratio * 5700);
      }

      const isCurrentlyDrifting =
        canDrive &&
        Math.abs(playerState.driftAngle) > 0.08 &&
        playerState.speed > 40;

      const squealIntensity = canDrive
        ? Math.max(
            isCurrentlyDrifting ? 0.9 : 0,
            isSliding ? 1.0 : 0,
            isTyreScrubbing
              ? THREE.MathUtils.clamp(
                  Math.abs(playerState.steerAngle) * 0.75,
                  0.25,
                  0.75
                )
              : 0
          )
        : 0;
      const gravelIntensity =
        canDrive && isOffTrack
          ? THREE.MathUtils.clamp(Math.abs(playerState.speed) / 36, 0, 1)
          : 0;

      // Update Procedural Web Audio Engine (Engine, Tyre Squeal, Gravel Loop, Nitro)
      soundEngine.updateTelemetry(
        rpm,
        throttleInput,
        squealIntensity,
        gravelIntensity,
        isBoosting,
        currentStatus === 'paused' || currentStatus === 'ready'
      );

      // Render Scene via Post-Processing Composer (or direct Renderer fallback)
      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }

      // Throttle React HUD Telemetry Updates (~20 Hz)
      if (elapsed - lastHudEmitTime > 0.05) {
        lastHudEmitTime = elapsed;

        // Project 3D Crosshair ahead of car along heading & Rival Target Overlays to 2D Screen Percentages
        camera.updateMatrixWorld();
        _projVec
          .copy(_carWorldPos)
          .addScaledVector(_carForward, 32)
          .addScaledVector(_playerFrame.up, 0.75);
        _projVec.project(camera);
        const crosshairScreen = {
          x: (_projVec.x * 0.5 + 0.5) * 100,
          y: (-_projVec.y * 0.5 + 0.5) * 100,
          visible:
            isCombatMode &&
            !playerState.isDestroyed &&
            _projVec.z > -1 &&
            _projVec.z < 1,
          hasLock: bestLockIdx >= 0,
        };

        const rivalOverlays = rivalsState.map((rv, idx) => {
          if (!isCombatMode || rv.isEliminated) {
            return {
              id: rv.id,
              driverName: rv.driverName,
              hp: rv.hp,
              maxHp: rv.maxHp,
              screenX: 50,
              screenY: 50,
              visible: false,
              isLockedTarget: false,
              distanceMeters: 999,
            };
          }
          const rPos = rivalRigs[idx].root.position;
          const dist = rPos.distanceTo(_carWorldPos);
          _projVec.set(rPos.x, rPos.y + 2.35, rPos.z).project(camera);
          const inFrustum =
            dist < 135 &&
            _projVec.z > 0 &&
            _projVec.z < 1 &&
            Math.abs(_projVec.x) <= 0.96 &&
            Math.abs(_projVec.y) <= 0.92;
          return {
            id: rv.id,
            driverName: rv.driverName,
            hp: Math.round(rv.hp),
            maxHp: rv.maxHp,
            screenX: (_projVec.x * 0.5 + 0.5) * 100,
            screenY: (-_projVec.y * 0.5 + 0.5) * 100,
            visible: inFrustum,
            isLockedTarget: idx === bestLockIdx,
            distanceMeters: Math.round(dist),
          };
        });

        const activeRivalsCount = rivalsState.filter(
          (r) => !r.isEliminated
        ).length;

        const allStandings = [
          {
            id: 'player',
            driverName: 'You (Apex Horizon)',
            teamCode: propsRef.current.livery.code,
            isPlayer: true,
            distance: playerState.trackDistance,
            lateralOffset: playerState.lateralOffset,
            colorHex: propsRef.current.livery.primaryHex,
          },
          ...rivalsState.map((r) => ({
            id: r.id,
            driverName: r.driverName,
            teamCode: r.teamCode,
            isPlayer: false,
            distance: r.trackDistance,
            lateralOffset: r.lateralOffset,
            colorHex: r.livery.primaryHex,
          })),
        ].sort((a, b) => b.distance - a.distance);

        const leaderDist = allStandings[0].distance;
        const playerPosIndex = allStandings.findIndex((s) => s.isPlayer);

        const normTrackDist =
          ((playerState.trackDistance % TRACK_LENGTH) + TRACK_LENGTH) %
          TRACK_LENGTH;
        const lapProgress = normTrackDist / TRACK_LENGTH;
        const sectorIndex = Math.min(2, Math.floor(lapProgress * 3));

        emitTelemetry({
          status: currentStatus,
          countdownValue: Math.max(1, Math.ceil(playerState.countdownTimer)),
          speedKmh: Math.round(absSpeedKmh),
          rpm,
          gear,
          nitro: Math.round(playerState.nitro),
          isBoosting,
          isDrifting: isCurrentlyDrifting,
          isTyreScrubbing,
          isSliding,
          isSlipstreaming,
          isOffTrack,
          scoreEventLabel: playerState.scoreEventLabel,
          lap: playerState.lap,
          totalLaps: maxLaps,
          position: playerPosIndex + 1,
          totalCars: allStandings.length,
          currentLapTimeMs: playerState.currentLapTimeMs,
          bestLapTimeMs: playerState.bestLapTimeMs,
          lastLapTimeMs: playerState.lastLapTimeMs,
          sectorIndex,
          driftScore: playerState.driftScore,
          currentDriftPoints: playerState.currentDriftPoints,
          lapProgress,
          combatMode: isCombatMode,
          combatDifficulty: currentDifficulty,
          permanentElimination: isPermanentElimination,
          activeRivalsCount,
          playerHp: Math.round(playerState.hp),
          playerMaxHp: playerState.maxHp,
          isPlayerDestroyed: playerState.isDestroyed,
          playerRespawnTimer: Number(playerState.respawnTimer.toFixed(1)),
          isPlayerInvulnerable: playerState.invulnerableTimer > 0,
          mgHeat: Math.round(playerState.mgHeat),
          mgOverheated: playerState.mgOverheated,
          missileAmmo: playerState.missileAmmo,
          missileMaxAmmo: playerState.missileMaxAmmo,
          missileCooldown: Number(playerState.missileCooldown.toFixed(1)),
          kills: playerState.kills,
          killFeed: playerState.killFeed,
          crosshairScreen,
          rivalOverlays,
          standings: allStandings.map((item, idx) => ({
            id: item.id,
            driverName: item.driverName,
            teamCode: item.teamCode,
            isPlayer: item.isPlayer,
            position: idx + 1,
            gapSeconds:
              idx === 0
                ? 0
                : Number(
                    ((leaderDist - item.distance) / 68).toFixed(2)
                  ),
            colorHex: item.colorHex,
            trackDistance: item.distance,
            lateralOffset: item.lateralOffset,
          })),
        });
      }
    };

    animFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener(
        'webglcontextlost',
        handleContextLost
      );
      renderer.domElement.removeEventListener(
        'webglcontextrestored',
        handleContextRestored
      );
      sceneObjectsRef.current?.builtTrack?.dispose();
      shadowTexture.dispose();
      softParticleSpriteTex.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      ambientDustGeo.dispose();
      ambientDustMat.dispose();
      gravelDustGeo.dispose();
      gravelDustMat.dispose();
      sparkGeo.dispose();
      sparkMat.dispose();
      smokeGeo.dispose();
      smokeMat.dispose();
      muzzleFlashGeo.dispose();
      muzzleFlashPool.forEach((mf) => mf.mat.dispose());
      tracerGeo.dispose();
      playerTracerMat.dispose();
      rivalTracerMat.dispose();
      missileBodyGeo.dispose();
      missileNoseGeo.dispose();
      missileFinGeo.dispose();
      missileFlareGeo.dispose();
      missileBodyMat.dispose();
      missileNoseMat.dispose();
      missileFinMat.dispose();
      missileFlareMat.dispose();
      pickupCrossVGeo.dispose();
      pickupCrossHGeo.dispose();
      pickupAmmoOctGeo.dispose();
      pickupRingGeo.dispose();
      repairPickupMat.dispose();
      repairRingMat.dispose();
      ammoPickupMat.dispose();
      ammoRingMat.dispose();
      fireballGeo.dispose();
      shockwaveGeo.dispose();
      debrisGeo.dispose();
      debrisMat.dispose();
      hpBgGeo.dispose();
      hpBgMat.dispose();
      hpFillGeo.dispose();
      lockBoxGeo.dispose();
      lockBoxMat.dispose();
      composer?.dispose();
      renderer.dispose();
    };
  }, [touchControlsRef]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#080A0F]">
      {/* Isolated WebGL Mount Container */}
      <div
        ref={canvasMountRef}
        className="w-full h-full"
        aria-label="3D Grand Touring Racing Viewport"
      />

      {contextLost && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#080A0F]/95 p-6 text-center">
          <div className="max-w-md space-y-2 border border-white/15 bg-[#0F1420] p-6 rounded-xl">
            <h2 className="font-display text-lg font-bold text-white">
              Graphics Context Paused
            </h2>
            <p className="text-sm text-slate-300">
              WebGL rendering context is restoring. Click Reset Race to resume on the circuit.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
