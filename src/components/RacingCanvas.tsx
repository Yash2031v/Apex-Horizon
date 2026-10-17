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
}

interface RacingCanvasProps {
  trackTheme: TrackTheme;
  livery: CarLivery;
  cameraMode: CameraMode;
  raceStatus: RaceStatus;
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
      totalLaps,
      onTelemetryUpdate,
      onStatusChange,
    };
  }, [
    trackTheme,
    livery,
    cameraMode,
    raceStatus,
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

    // Build 5 AI Rival Composite Hypercars
    const rivalRigs: CompositeCarRig[] = [];
    const rivalsState: RivalCarState[] = [];
    const rivalHeadings: number[] = [];

    AI_DRIVERS.forEach((driver, index) => {
      const rivalLivery = CAR_LIVERIES[driver.liveryIdx % CAR_LIVERIES.length];
      const rig = buildCompositeHypercar(rivalLivery, shadowTexture, false);
      rig.root.rotation.order = 'YXZ';
      rig.headlightCones.forEach((c) => {
        c.visible = initialConfig.headlightsActive;
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

    // Mutable Driving & Race State
    const keys: Record<string, boolean> = {};
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
      playerState.nitro = 100;
      playerState.lap = 1;
      playerState.currentLapTimeMs = 0;
      playerState.lastLapTimeMs = null;
      playerState.driftScore = 0;
      playerState.currentDriftPoints = 0;
      playerState.countdownTimer = 3.2;
      playerState.lastCountdownInt = 4;
      playerState.padBoostTimer = 0;

      rivalsState.forEach((rival, idx) => {
        rival.trackDistance = (idx + 1) * 11;
        rival.lateralOffset = idx % 2 === 0 ? 3.6 : -3.6;
        rival.targetLateral = rival.lateralOffset;
        rival.speed = 0;
        rival.lap = 1;
        rival.gapSeconds = 0;

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
      if (e.code === 'KeyR') {
        playerState.lateralOffset = 0;
        playerState.lateralVelocity = 0;
        playerState.driftAngle = 0;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys[e.code] = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

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
        bloomPass.resolution.set(Math.max(1, Math.floor(w * 0.5)), Math.max(1, Math.floor(h * 0.5)));
      }
    };
    window.addEventListener('resize', handleResize);

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
        totalLaps: maxLaps,
        onTelemetryUpdate: emitTelemetry,
        onStatusChange: setStatus,
      } = propsRef.current;

      const activeTrack = sceneObjectsRef.current?.builtTrack;

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

      // Read Combined Keyboard + Touch Controls
      const tc = touchControlsRef.current;
      const canDrive = currentStatus === 'racing';

      const throttleInput =
        canDrive && (keys['KeyW'] || keys['ArrowUp'] || tc.throttle) ? 1 : 0;
      const brakeInput =
        canDrive && (keys['KeyS'] || keys['ArrowDown'] || tc.brake) ? 1 : 0;
      const leftInput =
        canDrive && (keys['KeyA'] || keys['ArrowLeft'] || tc.left) ? 1 : 0;
      const rightInput =
        canDrive && (keys['KeyD'] || keys['ArrowRight'] || tc.right) ? 1 : 0;
      const wantsNitro =
        canDrive &&
        (keys['ShiftLeft'] ||
          keys['ShiftRight'] ||
          keys['Space'] ||
          tc.nitro);

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

      // Longitudinal Physics
      if (currentStatus !== 'paused') {
        const baseTopSpeed = 77.5; // ~279 km/h
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

        // Guardrail Clamp & Bounce
        const guardrailLimit = ROAD_HALF_WIDTH + 0.25;
        if (Math.abs(playerState.lateralOffset) > guardrailLimit) {
          playerState.lateralOffset =
            Math.sign(playerState.lateralOffset) * guardrailLimit;
          playerState.lateralVelocity *= -0.35;
          playerState.speed *= 0.92;
        }

        // Drift Detection & Scoring (Unchanged)
        const isDrifting =
          canDrive &&
          Math.abs(playerState.steerAngle) > 0.45 &&
          playerState.speed > 42 &&
          (Math.abs(_playerFrame.curvature) > 0.025 || brakeInput > 0);

        // Visual slip angle: max 8 degrees, applied only above 70% speed or on gravel
        const maxSlipRad = THREE.MathUtils.degToRad(8);
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

      // 1 & 2. Update heading (yaw) from steering input, speed, and direction of travel,
      // then smoothly interpolate visual rotation toward target heading (rotation.y = heading)
      const speedMoveFactor = THREE.MathUtils.clamp(
        Math.abs(playerState.speed) / 16,
        0,
        1
      );
      const yawRateFromSteer = -playerState.steerAngle * speedMoveFactor * 1.55;
      playerState.heading += yawRateFromSteer * dt;

      // Direction of travel vector combining forward spline tangent, lateral velocity, and active steering turn
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

      // Smoothly interpolate visual rotation toward target heading + visual slip angle
      const targetVisualYaw = playerState.heading + playerState.driftAngle;
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

      // 4. Outward Body Roll: tilt car body outward in corners (away from turn center),
      // proportional to steering and speed (max ~4-6 deg).
      // In local car space (-Z forward, +X right, +Y up), +rotation.z tilts roof toward -X (left, outside of right turn),
      // and -rotation.z tilts roof toward +X (right, outside of left turn).
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

      // 3. Rotate front wheels by steering angle (~28 deg max, within 25-30 deg) and spin all wheels based on speed
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
          let gz = gravAttr.getZ(i) + Math.max(12, playerState.speed * 0.45) * dt;
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

      // 7. Update 5 AI Rivals & Orient Toward Next Track Waypoint with Smooth Rotation
      rivalsState.forEach((rival, idx) => {
        const rig = rivalRigs[idx];
        evaluateTrackFrame(rival.trackDistance, _rivalFrame);

        if (currentStatus === 'racing' || currentStatus === 'finished') {
          const cornerSlowdown = Math.abs(_rivalFrame.curvature) * 65;
          const distGap = playerState.trackDistance - rival.trackDistance;
          const rubberBand = THREE.MathUtils.clamp(distGap * 0.08, -5.5, 7.5);
          const desiredSpeed =
            rival.baseMaxSpeed - cornerSlowdown + rubberBand;

          rival.speed = THREE.MathUtils.damp(
            rival.speed,
            desiredSpeed,
            2.2,
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

          const longDiff = rival.trackDistance - playerState.trackDistance;
          const latDiff = rival.lateralOffset - playerState.lateralOffset;
          if (Math.abs(longDiff) < 4.3 && Math.abs(latDiff) < 1.95) {
            const pushDir = latDiff >= 0 ? -1 : 1;
            playerState.lateralVelocity += pushDir * 8.5;
            rival.lateralOffset -= pushDir * 0.6;
            if (longDiff > 0 && playerState.speed > rival.speed) {
              rival.speed += 3.5;
              playerState.speed *= 0.94;
            }
          }
        }

        evaluateTrackFrame(rival.trackDistance, _rivalFrame);
        _rivalWorldPos
          .copy(_rivalFrame.position)
          .addScaledVector(_rivalFrame.right, rival.lateralOffset);
        rig.root.position.copy(_rivalWorldPos);

        // Evaluate next waypoint along the track spline ahead of the AI car
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

        // AI front wheel steering & outward body roll in corners
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
      });

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

      // 6. Camera Choreography: Chase Camera Follows Car's Heading with Increased Smooth Damping + Halved Sideways Offset
      const targetFov =
        currentCamMode === 'hood'
          ? 68 + (playerState.speed / 90) * 14
          : 60 + (playerState.speed / 90) * 16 + (isBoosting ? 5 : 0);
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6.0, dt);
      camera.updateProjectionMatrix();

      // Increased heading damping (11.5) so camera tracks car heading more tightly while still showing cornering rotation
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

      _carForward
        .set(
          -Math.sin(playerState.visualHeading),
          _playerFrame.tangent.y,
          -Math.cos(playerState.visualHeading)
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
        // Chase camera: lateral offset reduced by half, increased heading damping
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
        Math.abs(playerState.driftAngle) > 0.11 &&
        playerState.speed > 40;

      // Update Procedural Web Audio Engine
      soundEngine.updateTelemetry(
        rpm,
        throttleInput,
        isCurrentlyDrifting,
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
          isSlipstreaming,
          isOffTrack,
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
