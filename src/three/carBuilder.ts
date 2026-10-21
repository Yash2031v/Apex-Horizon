import * as THREE from 'three';
import { CarBodyVariant, CarLivery } from '../types/racing';

/**
 * Default player car paint colour: Pearl White (slightly grey #E8E8EC so highlights
 * and body contours never blow out under directional sunlight).
 */
export const DEFAULT_CAR_PAINT_HEX = '#E8E8EC';
export const BLOOM_LAYER = 1;

export interface CompositeCarRig {
  root: THREE.Group;
  bodyTiltGroup: THREE.Group;
  paintMaterials: THREE.MeshPhysicalMaterial[];
  accentMaterials: THREE.MeshStandardMaterial[];
  rimMaterials: THREE.MeshStandardMaterial[];
  bodyTrimMaterial: THREE.MeshStandardMaterial;
  basePaintColor: THREE.Color;
  baseAccentColor: THREE.Color;
  baseTrimColor: THREE.Color;
  damageCrackGroup: THREE.Group;
  damageCrackMaterial: THREE.MeshBasicMaterial;
  currentDamageStage: number;
  brakeLightMaterial: THREE.MeshStandardMaterial;
  exhaustGlowMaterial: THREE.MeshStandardMaterial;
  frontWheelPivots: THREE.Group[];
  wheelSpinMeshes: THREE.Object3D[];
  nitroFlames: THREE.Mesh[];
  headlightCones: THREE.Mesh[];
  variantGroups: {
    coupe: THREE.Group;
    widebody: THREE.Group;
    race: THREE.Group;
  };
}

interface SharedMuscleCoupeAssets {
  shadowGeo: THREE.PlaneGeometry;
  lowerChassisGeo: THREE.BufferGeometry;
  cabinGreenhouseGeo: THREE.BufferGeometry;
  hoodBulgeGeo: THREE.BufferGeometry;
  hoodVentGeo: THREE.BufferGeometry;
  frontFenderGeo: THREE.BufferGeometry;
  rearHaunchGeo: THREE.BufferGeometry;
  rearFenderBlisterGeo: THREE.BufferGeometry;
  widebodyFrontFlareGeo: THREE.BufferGeometry;
  widebodyRearFlareGeo: THREE.BufferGeometry;
  widebodyCanardGeo: THREE.BufferGeometry;
  widebodyRockerBladeGeo: THREE.BufferGeometry;
  wheelArchTrimFrontGeo: THREE.BufferGeometry;
  wheelArchTrimRearGeo: THREE.BufferGeometry;
  wheelWellLinerGeo: THREE.CylinderGeometry;
  sideSkirtGeo: THREE.BufferGeometry;
  frontBumperBeamGeo: THREE.BufferGeometry;
  frontSplitterGeo: THREE.BufferGeometry;
  raceSplitterGeo: THREE.BufferGeometry;
  upperGrilleGeo: THREE.BufferGeometry;
  lowerGrilleGeo: THREE.BufferGeometry;
  fogPocketGeo: THREE.BufferGeometry;
  fogSlatGeo: THREE.BufferGeometry;
  headlightHousingGeo: THREE.BufferGeometry;
  projectorLensGeo: THREE.CylinderGeometry;
  drlBarGeo: THREE.BufferGeometry;
  sideMarkerGeo: THREE.BufferGeometry;
  windshieldGeo: THREE.BufferGeometry;
  rearWindowGeo: THREE.BufferGeometry;
  sideWindowGeo: THREE.BufferGeometry;
  interiorCabinGeo: THREE.BufferGeometry;
  mirrorStalkGeo: THREE.CylinderGeometry;
  mirrorCapGeo: THREE.BufferGeometry;
  mirrorGlassGeo: THREE.PlaneGeometry;
  doorHandleGeo: THREE.BufferGeometry;
  doorSeamGeo: THREE.BufferGeometry;
  coupeLipSpoilerGeo: THREE.BufferGeometry;
  coupeLipEdgeGeo: THREE.BufferGeometry;
  raceWingDeckGeo: THREE.BufferGeometry;
  raceWingStrutGeo: THREE.BufferGeometry;
  raceWingEndplateGeo: THREE.BufferGeometry;
  rearPanelGeo: THREE.BufferGeometry;
  tailStripGeo: THREE.BufferGeometry;
  tailBarGeo: THREE.BufferGeometry;
  diffuserBaseGeo: THREE.BufferGeometry;
  diffuserFinGeo: THREE.BufferGeometry;
  exhaustOuterGeo: THREE.CylinderGeometry;
  exhaustInnerGeo: THREE.CylinderGeometry;
  flameGeo: THREE.ConeGeometry;
  headlightConeGeo: THREE.ConeGeometry;
  tireGeo: THREE.LatheGeometry;
  rimBarrelGeo: THREE.CylinderGeometry;
  rimLipGeo: THREE.TorusGeometry;
  rimHubGeo: THREE.CylinderGeometry;
  spokeGeo: THREE.BufferGeometry;
  brakeDiscGeo: THREE.CylinderGeometry;
  caliperGeo: THREE.BufferGeometry;
  // Shared static materials & procedural textures
  grilleTexture: THREE.CanvasTexture;
  darkTrimMat: THREE.MeshStandardMaterial;
  grilleMat: THREE.MeshStandardMaterial;
  tintedGlassMat: THREE.MeshPhysicalMaterial;
  headlightGlassMat: THREE.MeshPhysicalMaterial;
  drlEmissiveMat: THREE.MeshStandardMaterial;
  sideMarkerMat: THREE.MeshStandardMaterial;
  headlightConeMat: THREE.MeshBasicMaterial;
  mirrorReflectMat: THREE.MeshStandardMaterial;
  tireRubberMat: THREE.MeshStandardMaterial;
  brakeDiscMat: THREE.MeshStandardMaterial;
  redCaliperMat: THREE.MeshPhysicalMaterial;
  chromeExhaustMat: THREE.MeshPhysicalMaterial;
  flameMat: THREE.MeshBasicMaterial;
  doorSeamMat: THREE.LineBasicMaterial;
  damageCrackTextures: [
    THREE.CanvasTexture,
    THREE.CanvasTexture,
    THREE.CanvasTexture,
  ];
  hoodCrackGeo: THREE.PlaneGeometry;
  roofCrackGeo: THREE.PlaneGeometry;
  sideCrackGeo: THREE.PlaneGeometry;
  rearCrackGeo: THREE.PlaneGeometry;
}

let _sharedAssets: SharedMuscleCoupeAssets | null = null;

/**
 * Generates a crisp Minecraft-style 32x32 pixel-art block crack & dent texture
 * for stage 1 (<=75% HP), stage 2 (<=50% HP), and stage 3 (<=25% HP).
 */
function createBlockyDamageCrackTexture(stage: 1 | 2 | 3): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);

  const px = 4; // 16x16 blocky pixel grid scaled to 64x64
  const drawPixel = (gx: number, gy: number, color: string) => {
    if (gx < 0 || gx >= 16 || gy < 0 || gy >= 16) return;
    ctx.fillStyle = color;
    ctx.fillRect(gx * px, gy * px, px, px);
  };

  // Stage 1 (<= 75% HP): Initial blocky dark cracks & small dent patches
  const stage1Pixels: [number, number, string][] = [
    [7, 4, '#090D16'],
    [8, 5, '#090D16'],
    [8, 6, '#1E293B'],
    [7, 7, '#090D16'],
    [6, 8, '#090D16'],
    [9, 7, '#1E293B'],
    [10, 8, '#090D16'],
    [5, 5, '#1E293B'],
    [11, 5, '#090D16'],
    [4, 10, '#090D16'],
    [5, 11, '#1E293B'],
  ];

  // Stage 2 (<= 50% HP): Deeper branching pixel fissures & dark metal dent blocks
  const stage2Pixels: [number, number, string][] = [
    [6, 3, '#090D16'],
    [5, 4, '#090D16'],
    [4, 4, '#1E293B'],
    [9, 4, '#090D16'],
    [10, 4, '#1E293B'],
    [6, 9, '#090D16'],
    [5, 10, '#090D16'],
    [3, 11, '#090D16'],
    [8, 8, '#090D16'],
    [8, 9, '#1E293B'],
    [9, 10, '#090D16'],
    [11, 9, '#090D16'],
    [12, 10, '#1E293B'],
    [12, 11, '#090D16'],
    [3, 6, '#090D16'],
    [4, 7, '#1E293B'],
    [12, 6, '#090D16'],
  ];

  // Stage 3 (<= 25% HP): Heavy shattered Minecraft block cracks & darkchar patches
  const stage3Pixels: [number, number, string][] = [
    [2, 2, '#090D16'],
    [3, 3, '#090D16'],
    [4, 3, '#1E293B'],
    [13, 2, '#090D16'],
    [12, 3, '#090D16'],
    [11, 4, '#1E293B'],
    [7, 8, '#05070B'],
    [8, 7, '#05070B'],
    [7, 6, '#05070B'],
    [6, 7, '#05070B'],
    [2, 8, '#090D16'],
    [3, 9, '#1E293B'],
    [2, 12, '#090D16'],
    [3, 13, '#090D16'],
    [7, 11, '#090D16'],
    [8, 12, '#090D16'],
    [8, 13, '#1E293B'],
    [10, 11, '#090D16'],
    [11, 12, '#090D16'],
    [13, 12, '#090D16'],
    [13, 8, '#090D16'],
    [14, 9, '#1E293B'],
  ];

  stage1Pixels.forEach(([x, y, c]) => drawPixel(x, y, c));
  if (stage >= 2) {
    stage2Pixels.forEach(([x, y, c]) => drawPixel(x, y, c));
  }
  if (stage >= 3) {
    stage3Pixels.forEach(([x, y, c]) => drawPixel(x, y, c));
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Helper: Creates a smooth beveled ExtrudeGeometry from a 2D side-profile Shape where:
 * - shape X coordinate = car Z coordinate (-Z is front nose, +Z is rear tail)
 * - shape Y coordinate = car Y coordinate (height above ground)
 * - extrusion depth = car X width (centered around X = 0)
 * Optionally applies a 3D sculpting function `deform(x, y, z)` for trapezoidal cabin taper
 * or curved fender flaring before recomputing smooth vertex normals.
 */
function createSideProfileExtrude(
  shape: THREE.Shape,
  width: number,
  bevelSize: number,
  bevelThickness: number,
  bevelSegments: number = 4,
  curveSegments: number = 16,
  deform?: (x: number, y: number, z: number) => [number, number, number]
): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    steps: 4,
    curveSegments,
    bevelEnabled: bevelSize > 0,
    bevelSize,
    bevelThickness,
    bevelSegments,
  });
  geo.translate(0, 0, -width * 0.5);
  geo.rotateY(-Math.PI / 2);

  if (deform) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const [nx, ny, nz] = deform(pos.getX(i), pos.getY(i), pos.getZ(i));
      pos.setXYZ(i, nx, ny, nz);
    }
    pos.needsUpdate = true;
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * Helper: Creates a smooth beveled ExtrudeGeometry from a 2D front/rear X-Y profile Shape
 * extruded along the car's Z axis (centered at Z = 0).
 */
function createFrontProfileExtrude(
  shape: THREE.Shape,
  depth: number,
  bevelSize: number,
  bevelThickness: number,
  bevelSegments: number = 3,
  curveSegments: number = 12
): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments,
    bevelEnabled: bevelSize > 0,
    bevelSize,
    bevelThickness,
    bevelSegments,
  });
  geo.translate(0, 0, -depth * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Helper: Creates a rounded rectangle 2D shape so no plain sharp boxes are needed.
 */
function createRoundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  const hw = w * 0.5;
  const hh = h * 0.5;
  const rad = Math.min(r, hw * 0.9, hh * 0.9);
  shape.moveTo(-hw + rad, -hh);
  shape.lineTo(hw - rad, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + rad);
  shape.lineTo(hw, hh - rad);
  shape.quadraticCurveTo(hw, hh, hw - rad, hh);
  shape.lineTo(-hw + rad, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - rad);
  shape.lineTo(-hw, -hh + rad);
  shape.quadraticCurveTo(-hw, -hh, -hw + rad, -hh);
  shape.closePath();
  return shape;
}

/**
 * Trapezoidal Cabin / Greenhouse 3D Deformation:
 * Makes the cabin significantly narrower than the lower body and flares inward toward the roof
 * (a true trapezoid cross-section seen from behind), while also tapering smoothly toward the fastback tail.
 */
function deformTrapezoidCabin(x: number, y: number, z: number): [number, number, number] {
  // Normalized height from beltline (y = 0.84) to roof peak (y = 1.25)
  const tY = THREE.MathUtils.clamp((y - 0.84) / 0.41, 0, 1);
  // Trapezoid inward taper: roof is ~30% narrower than the cabin base
  const heightTaper = 1.0 - 0.30 * Math.pow(tY, 0.88);
  // Subtle fastback plan-view taper toward the rear windscreen tail (z > 0.45)
  const rearT = THREE.MathUtils.clamp((z - 0.45) / 1.35, 0, 1);
  const rearTaper = 1.0 - 0.11 * rearT;
  // Subtle curved crown across the roof center
  const centerArch = (1.0 - Math.min(1.0, (x * x) / 0.42)) * 0.026 * tY;
  return [x * heightTaper * rearTaper, y + centerArch, z];
}

/**
 * Generates a crisp procedural hexagonal honeycomb grille texture.
 */
function createHoneycombGrilleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#05070B';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#1E2430';
    ctx.lineWidth = 2.2;
    const r = 8;
    const dx = r * 1.5;
    const dy = r * Math.sqrt(3);

    for (let row = -1; row < canvas.height / dy + 2; row++) {
      for (let col = -1; col < canvas.width / dx + 2; col++) {
        const cx = col * dx;
        const cy = row * dy + (col % 2 === 0 ? 0 : dy * 0.5);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          const vx = cx + r * 0.88 * Math.cos(angle);
          const vy = cy + r * 0.88 * Math.sin(angle);
          if (i === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Generates a soft, low-dynamic-range sunset equirectangular reflection environment map
 * (deep purple zenith -> pink/magenta mid-sky -> warm orange horizon -> dark canyon ground)
 * so glossy clearcoat paint and tinted glass reflect warm sunset tones without HDR white glare.
 */
export function createStudioEnvironmentTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0.0, '#1A0B2E'); // deep purple zenith
    grad.addColorStop(0.28, '#581C4F'); // twilight violet-rose
    grad.addColorStop(0.46, '#B84A5A'); // sunset pink-coral
    grad.addColorStop(0.52, '#E07A48'); // warm sunset horizon band
    grad.addColorStop(0.56, '#2A1D24'); // dark canyon shadow transition
    grad.addColorStop(1.0, '#120E14'); // dark asphalt underbody reflection
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds and caches all shared geometries and common materials for the Modern Muscle Coupe
 * so all 6 cars on track share vertex buffers and maintain 60 FPS.
 */
function getSharedMuscleCoupeAssets(): SharedMuscleCoupeAssets {
  if (_sharedAssets) return _sharedAssets;

  const shadowGeo = new THREE.PlaneGeometry(2.75, 5.25);
  shadowGeo.rotateX(-Math.PI / 2);

  // ============================================================================
  // 1. LOWER BODY CHASSIS (Long Low Hood, Doors, Short Rear Deck)
  // Separated from the narrower trapezoidal cabin so the cabin clearly steps inward!
  // ============================================================================
  const lowerShape = new THREE.Shape();
  lowerShape.moveTo(-2.14, 0.22); // Front lower chin behind splitter
  lowerShape.lineTo(-2.22, 0.52); // Forward-canted shark-nose lower fascia
  lowerShape.lineTo(-2.17, 0.70); // Upper brow over honeycomb grille
  lowerShape.quadraticCurveTo(-1.52, 0.83, -0.56, 0.88); // Long, low muscle hood
  lowerShape.lineTo(0.65, 0.86); // Waistline / beltline through doors
  lowerShape.lineTo(1.68, 0.88); // Rear decklid base below fastback window
  lowerShape.lineTo(2.10, 0.87); // Short rear deck trailing edge
  lowerShape.lineTo(2.14, 0.68); // Upper rear tail panel
  lowerShape.lineTo(2.11, 0.34); // Rear valence above central diffuser
  lowerShape.lineTo(1.75, 0.34); // High clearance behind rear tires so tires are visible from behind
  lowerShape.absarc(1.34, 0.37, 0.42, 0.05, Math.PI - 0.05, false); // Rear wheel arch cutout
  lowerShape.lineTo(-0.94, 0.23); // Lower rocker sill between wheels
  lowerShape.absarc(-1.36, 0.36, 0.42, 0.05, Math.PI - 0.05, false); // Front wheel arch cutout
  lowerShape.lineTo(-2.14, 0.22);
  lowerShape.closePath();

  const lowerChassisGeo = createSideProfileExtrude(
    lowerShape,
    1.62,
    0.075,
    0.075,
    4,
    16,
    (x, y, z) => {
      // Gently round the lower door/rocker flanks and tuck the outer rear valence upward behind the rear tires
      let ny = y;
      if (z > 1.62 && Math.abs(x) > 0.64 && y < 0.48) {
        const rearT = THREE.MathUtils.clamp((z - 1.62) / 0.48, 0, 1);
        ny = Math.max(y, 0.36 + 0.11 * rearT);
      }
      return [x, ny, z];
    }
  );

  // ============================================================================
  // 2. NARROWER TRAPEZOIDAL CABIN / FASTBACK GREENHOUSE
  // Tapers inward from beltline (width 1.44m) up to roof crown (width 1.00m) with a
  // sloped front windscreen, arched fastback roof, and long sloped rear windscreen!
  // ============================================================================
  const cabinShape = new THREE.Shape();
  cabinShape.moveTo(-0.62, 0.85); // Base of A-pillar / cowl
  cabinShape.lineTo(0.02, 1.225); // Sloped windscreen up to front roof header
  cabinShape.quadraticCurveTo(0.36, 1.25, 0.68, 1.195); // Fastback roof crown
  cabinShape.quadraticCurveTo(1.18, 1.07, 1.72, 0.875); // Long sloped fastback rear windscreen
  cabinShape.lineTo(1.74, 0.84); // Base of C-pillar / rear deck junction
  cabinShape.lineTo(-0.62, 0.84);
  cabinShape.closePath();

  const cabinGreenhouseGeo = createSideProfileExtrude(
    cabinShape,
    1.38,
    0.055,
    0.055,
    4,
    18,
    deformTrapezoidCabin
  );

  // ============================================================================
  // 3. LONG HOOD CENTRAL POWER-DOME BULGE & BEVELED HEAT-EXTRACTOR VENTS
  // ============================================================================
  const bulgeShape = new THREE.Shape();
  bulgeShape.moveTo(-2.02, 0.70);
  bulgeShape.quadraticCurveTo(-1.36, 0.885, -0.60, 0.915);
  bulgeShape.lineTo(-0.60, 0.83);
  bulgeShape.quadraticCurveTo(-1.36, 0.80, -2.02, 0.66);
  bulgeShape.closePath();
  const hoodBulgeGeo = createSideProfileExtrude(
    bulgeShape,
    0.66,
    0.055,
    0.055,
    4,
    14,
    (x, y, z) => {
      // Taper hood bulge slightly narrower toward the front nose
      const frontT = THREE.MathUtils.clamp((-z - 0.6) / 1.45, 0, 1);
      return [x * (1.0 - 0.18 * frontT), y, z];
    }
  );

  // Smooth beveled hood heat-extractor vents (no plain BoxGeometry)
  const ventRect = createRoundedRectShape(0.16, 0.32, 0.035);
  const hoodVentGeo = new THREE.ExtrudeGeometry(ventRect, {
    depth: 0.018,
    bevelEnabled: true,
    bevelSize: 0.008,
    bevelThickness: 0.008,
    bevelSegments: 2,
  });
  hoodVentGeo.rotateX(Math.PI / 2);
  hoodVentGeo.computeVertexNormals();

  // ============================================================================
  // 4. CURVED FRONT FENDERS & WIDE FLARED REAR FENDERS (FLARING BEYOND THE CABIN)
  // ============================================================================
  const frontFenderShape = new THREE.Shape();
  frontFenderShape.moveTo(-2.12, 0.24);
  frontFenderShape.lineTo(-2.18, 0.52);
  frontFenderShape.lineTo(-2.13, 0.69);
  frontFenderShape.quadraticCurveTo(-1.50, 0.83, -0.50, 0.87); // Curved front fender crest
  frontFenderShape.lineTo(0.38, 0.85); // Door beltline transition
  frontFenderShape.lineTo(0.38, 0.23);
  frontFenderShape.lineTo(-0.93, 0.23);
  frontFenderShape.absarc(-1.36, 0.36, 0.425, 0.04, Math.PI - 0.04, false);
  frontFenderShape.lineTo(-2.12, 0.24);
  frontFenderShape.closePath();

  const frontFenderGeo = createSideProfileExtrude(
    frontFenderShape,
    1.76,
    0.08,
    0.08,
    4,
    16,
    (x, y, z) => {
      const sign = Math.sign(x) || 1;
      const absX = Math.abs(x);
      // Bulge outward over the front wheel arch (z around -1.36) and taper inward at the door (z > -0.4)
      const archCurve = Math.exp(-Math.pow((z + 1.36) / 0.58, 2));
      const doorPinch = THREE.MathUtils.smoothstep(z, -0.55, 0.35);
      // Round the upper shoulder & lower rocker vertically so cross-section is curved, not flat
      const midY = 0.56;
      const vertCurve = Math.max(0, 1.0 - Math.pow((y - midY) / 0.38, 2));
      const flare = (0.045 * archCurve - 0.045 * doorPinch) * (absX > 0.65 ? 1 : 0);
      const sideRound = 0.032 * vertCurve * (absX > 0.7 ? 1 : 0);
      return [sign * (absX + flare + sideRound), y, z];
    }
  );

  // Wide, Curved Rear Fenders / Haunches that flare dramatically outward beyond the narrow cabin!
  const rearHaunchShape = new THREE.Shape();
  rearHaunchShape.moveTo(0.18, 0.23);
  rearHaunchShape.lineTo(0.28, 0.84);
  rearHaunchShape.quadraticCurveTo(0.96, 0.955, 1.54, 0.91); // Muscular Coke-bottle haunch wave over rear wheel
  rearHaunchShape.lineTo(2.08, 0.86); // Rear quarter trailing deck corner
  rearHaunchShape.lineTo(2.12, 0.66); // Rear bumper side cheek
  rearHaunchShape.lineTo(2.06, 0.45); // High-tucked lower rear corner so wide rear tires are exposed from behind!
  rearHaunchShape.lineTo(1.75, 0.43);
  rearHaunchShape.absarc(1.34, 0.37, 0.43, 0.08, Math.PI - 0.04, false);
  rearHaunchShape.lineTo(0.18, 0.23);
  rearHaunchShape.closePath();

  const rearHaunchGeo = createSideProfileExtrude(
    rearHaunchShape,
    1.86,
    0.095,
    0.095,
    5,
    18,
    (x, y, z) => {
      const sign = Math.sign(x) || 1;
      const absX = Math.abs(x);
      if (absX < 0.62) return [x, y, z];

      // Coke-bottle plan-view flare: starts narrower at the door (z = 0.2), flares wide over the
      // rear wheel (z = 1.05..1.65), and wraps smoothly into the rear tail panel (z = 2.1)
      const rearRise = THREE.MathUtils.smoothstep(z, 0.18, 1.15);
      const tailTuck = THREE.MathUtils.smoothstep(z, 1.68, 2.14);
      const longitudinalFlare = rearRise * (1.0 - 0.28 * tailTuck);

      // Curved vertical cross-section: widest at the mid-shoulder (y = 0.64), curving inward
      // toward the top beltline shelf (y = 0.94) and inward toward the lower sill
      const yNorm = (y - 0.64) / 0.34;
      const verticalCurve = Math.max(-0.35, 1.0 - yNorm * yNorm);

      // Slope the upper haunch shelf smoothly inward toward the narrow cabin base
      const topShelfTaper = y > 0.80 ? (y - 0.80) * 0.42 : 0;

      const extraOutward =
        0.075 * longitudinalFlare + 0.045 * verticalCurve - topShelfTaper;
      return [sign * (absX + extraOutward), y, z];
    }
  );

  // Sculpted Curved Rear Fender Arch Blisters (adds extra organic compound curvature over rear wheels)
  const blisterShape = new THREE.Shape();
  blisterShape.absarc(1.34, 0.37, 0.52, 0.12, Math.PI - 0.12, false);
  blisterShape.absarc(1.34, 0.37, 0.41, Math.PI - 0.12, 0.12, true);
  blisterShape.closePath();
  const rearFenderBlisterGeo = createSideProfileExtrude(
    blisterShape,
    1.98,
    0.045,
    0.045,
    4,
    18,
    (x, y, z) => {
      const sign = Math.sign(x) || 1;
      const absX = Math.abs(x);
      const archCrown = Math.sin(
        THREE.MathUtils.clamp((y - 0.37) / 0.52, 0, 1) * Math.PI
      );
      return [sign * (absX + 0.025 * archCrown), y, z];
    }
  );

  // Wide-Body Variant Extra Flared Overfenders (+14cm wider stance for widebody rivals)
  const wbFrontShape = new THREE.Shape();
  wbFrontShape.absarc(-1.36, 0.36, 0.50, 0.05, Math.PI - 0.05, false);
  wbFrontShape.absarc(-1.36, 0.36, 0.41, Math.PI - 0.05, 0.05, true);
  wbFrontShape.closePath();
  const widebodyFrontFlareGeo = createSideProfileExtrude(wbFrontShape, 2.04, 0.035, 0.035, 3, 16);

  const wbRearShape = new THREE.Shape();
  wbRearShape.absarc(1.34, 0.37, 0.53, 0.06, Math.PI - 0.06, false);
  wbRearShape.absarc(1.34, 0.37, 0.41, Math.PI - 0.06, 0.06, true);
  wbRearShape.closePath();
  const widebodyRearFlareGeo = createSideProfileExtrude(wbRearShape, 2.12, 0.04, 0.04, 3, 16);

  const canardProfile = createRoundedRectShape(2.06, 0.22, 0.04);
  const widebodyCanardGeo = new THREE.ExtrudeGeometry(canardProfile, {
    depth: 0.022,
    bevelEnabled: true,
    bevelSize: 0.006,
    bevelThickness: 0.006,
    bevelSegments: 2,
  });
  widebodyCanardGeo.rotateX(Math.PI / 2);
  widebodyCanardGeo.computeVertexNormals();

  const rockerBladeProfile = createRoundedRectShape(2.08, 1.72, 0.04);
  const widebodyRockerBladeGeo = new THREE.ExtrudeGeometry(rockerBladeProfile, {
    depth: 0.025,
    bevelEnabled: true,
    bevelSize: 0.008,
    bevelThickness: 0.008,
    bevelSegments: 2,
  });
  widebodyRockerBladeGeo.rotateX(Math.PI / 2);
  widebodyRockerBladeGeo.computeVertexNormals();

  // Dark Matte Wheel Arch Trims
  const archFrontShape = new THREE.Shape();
  archFrontShape.absarc(-1.36, 0.36, 0.448, -0.02, Math.PI + 0.02, false);
  archFrontShape.absarc(-1.36, 0.36, 0.398, Math.PI + 0.02, -0.02, true);
  archFrontShape.closePath();
  const wheelArchTrimFrontGeo = createSideProfileExtrude(archFrontShape, 1.94, 0.016, 0.016, 2, 16);

  const archRearShape = new THREE.Shape();
  archRearShape.absarc(1.34, 0.37, 0.455, 0.04, Math.PI - 0.02, false);
  archRearShape.absarc(1.34, 0.37, 0.402, Math.PI - 0.02, 0.04, true);
  archRearShape.closePath();
  const wheelArchTrimRearGeo = createSideProfileExtrude(archRearShape, 2.04, 0.016, 0.016, 2, 16);

  const wheelWellLinerGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.42, 16, 1, false, 0, Math.PI);
  wheelWellLinerGeo.rotateZ(Math.PI / 2);

  // Sculpted Beveled Black Side Skirts
  const skirtShape = new THREE.Shape();
  skirtShape.moveTo(-0.94, 0.165);
  skirtShape.lineTo(0.91, 0.165);
  skirtShape.lineTo(0.91, 0.245);
  skirtShape.lineTo(-0.94, 0.245);
  skirtShape.closePath();
  const sideSkirtGeo = createSideProfileExtrude(skirtShape, 1.92, 0.018, 0.018, 2, 6);

  // ============================================================================
  // 5. FRONT END: BUMPER BEAM, SPLITTER, HONEYCOMB GRILLES & ANGULAR LED HEADLIGHTS
  // ============================================================================
  const bumperBeamShape = new THREE.Shape();
  bumperBeamShape.moveTo(-2.23, 0.45);
  bumperBeamShape.lineTo(-2.14, 0.45);
  bumperBeamShape.lineTo(-2.14, 0.53);
  bumperBeamShape.lineTo(-2.22, 0.53);
  bumperBeamShape.closePath();
  const frontBumperBeamGeo = createSideProfileExtrude(bumperBeamShape, 1.80, 0.025, 0.025, 2, 6);

  const splitterShape = new THREE.Shape();
  splitterShape.moveTo(-2.27, 0.155);
  splitterShape.lineTo(-1.82, 0.155);
  splitterShape.lineTo(-1.82, 0.205);
  splitterShape.lineTo(-2.25, 0.205);
  splitterShape.closePath();
  const frontSplitterGeo = createSideProfileExtrude(splitterShape, 1.88, 0.018, 0.018, 2, 6);

  const raceSplitterShape = new THREE.Shape();
  raceSplitterShape.moveTo(-2.34, 0.145);
  raceSplitterShape.lineTo(-1.78, 0.145);
  raceSplitterShape.lineTo(-1.78, 0.205);
  raceSplitterShape.lineTo(-2.31, 0.205);
  raceSplitterShape.closePath();
  const raceSplitterGeo = createSideProfileExtrude(raceSplitterShape, 2.02, 0.018, 0.018, 2, 6);

  const upperGrilleShape = new THREE.Shape();
  upperGrilleShape.moveTo(-0.46, 0.53);
  upperGrilleShape.lineTo(0.46, 0.53);
  upperGrilleShape.lineTo(0.38, 0.68);
  upperGrilleShape.lineTo(-0.38, 0.68);
  upperGrilleShape.closePath();
  const upperGrilleGeo = createFrontProfileExtrude(upperGrilleShape, 0.08, 0.012, 0.012, 2, 8);

  const lowerGrilleShape = new THREE.Shape();
  lowerGrilleShape.moveTo(-0.44, 0.21);
  lowerGrilleShape.lineTo(0.44, 0.21);
  lowerGrilleShape.lineTo(0.46, 0.45);
  lowerGrilleShape.lineTo(-0.46, 0.45);
  lowerGrilleShape.closePath();
  const lowerGrilleGeo = createFrontProfileExtrude(lowerGrilleShape, 0.08, 0.01, 0.01, 2, 8);

  const fogPocketShape = createRoundedRectShape(0.26, 0.10, 0.025);
  const fogPocketGeo = createFrontProfileExtrude(fogPocketShape, 0.07, 0.008, 0.008, 2, 8);

  const fogSlatShape = createRoundedRectShape(0.24, 0.012, 0.004);
  const fogSlatGeo = createFrontProfileExtrude(fogSlatShape, 0.08, 0.003, 0.003, 1, 4);

  // Angular Headlight Housing (beveled polygon instead of plain box)
  const hlShape = new THREE.Shape();
  hlShape.moveTo(-0.16, -0.055);
  hlShape.lineTo(0.16, -0.045);
  hlShape.lineTo(0.14, 0.058);
  hlShape.lineTo(-0.17, 0.048);
  hlShape.closePath();
  const headlightHousingGeo = createFrontProfileExtrude(hlShape, 0.12, 0.012, 0.012, 2, 8);

  const projectorLensGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.06, 14);
  projectorLensGeo.rotateX(Math.PI / 2);

  const drlShape = createRoundedRectShape(0.31, 0.02, 0.008);
  const drlBarGeo = createFrontProfileExtrude(drlShape, 0.035, 0.004, 0.004, 1, 6);

  const markerShape = createRoundedRectShape(0.20, 0.016, 0.006);
  const sideMarkerGeo = createFrontProfileExtrude(markerShape, 0.018, 0.004, 0.004, 1, 6);
  sideMarkerGeo.rotateY(Math.PI / 2);

  // ============================================================================
  // 6. TRAPEZOIDAL TINTED GLASS WINDOWS, MIRRORS & DOOR HANDLES
  // ============================================================================
  const wsShape = new THREE.Shape();
  wsShape.moveTo(-0.59, 0.885);
  wsShape.lineTo(0.01, 1.22);
  wsShape.lineTo(0.05, 1.20);
  wsShape.lineTo(-0.54, 0.865);
  wsShape.closePath();
  const windshieldGeo = createSideProfileExtrude(
    wsShape,
    1.24,
    0.012,
    0.012,
    2,
    8,
    deformTrapezoidCabin
  );

  // Sloped Fastback Rear Windscreen (Flush with tapered trapezoidal cabin roof & C-pillars)
  const rwShape = new THREE.Shape();
  rwShape.moveTo(0.64, 1.195);
  rwShape.quadraticCurveTo(1.16, 1.075, 1.69, 0.885);
  rwShape.lineTo(1.65, 0.86);
  rwShape.quadraticCurveTo(1.13, 1.045, 0.61, 1.17);
  rwShape.closePath();
  const rearWindowGeo = createSideProfileExtrude(
    rwShape,
    1.18,
    0.012,
    0.012,
    2,
    12,
    deformTrapezoidCabin
  );

  // Tapered Coupe Side Windows (angled inward matching the trapezoid cabin cross-section)
  const swShape = new THREE.Shape();
  swShape.moveTo(-0.48, 0.88); // Base of A-pillar
  swShape.lineTo(0.02, 1.175); // Top of A-pillar
  swShape.quadraticCurveTo(0.36, 1.195, 0.65, 1.14); // Fastback roofline arch
  swShape.lineTo(1.04, 0.91); // Rear fastback quarter window corner
  swShape.lineTo(-0.48, 0.88); // Beltline sill
  swShape.closePath();
  const sideWindowGeo = createSideProfileExtrude(
    swShape,
    1.41,
    0.01,
    0.01,
    2,
    12,
    deformTrapezoidCabin
  );

  const interiorCabinShape = new THREE.Shape();
  interiorCabinShape.moveTo(-0.45, 0.56);
  interiorCabinShape.lineTo(0.95, 0.56);
  interiorCabinShape.lineTo(0.85, 0.86);
  interiorCabinShape.lineTo(-0.42, 0.86);
  interiorCabinShape.closePath();
  const interiorCabinGeo = createSideProfileExtrude(interiorCabinShape, 1.24, 0.02, 0.02, 1, 4);

  // Aerodynamic Side Mirrors & Sculpted Door Handles (beveled shapes, no boxes)
  const mirrorStalkGeo = new THREE.CylinderGeometry(0.016, 0.022, 0.12, 8);
  mirrorStalkGeo.rotateZ(Math.PI / 2);

  const mirrorCapShape = new THREE.Shape();
  mirrorCapShape.moveTo(-0.06, -0.038);
  mirrorCapShape.lineTo(0.08, -0.032);
  mirrorCapShape.quadraticCurveTo(0.11, 0.0, 0.08, 0.042);
  mirrorCapShape.lineTo(-0.05, 0.038);
  mirrorCapShape.closePath();
  const mirrorCapGeo = createFrontProfileExtrude(mirrorCapShape, 0.085, 0.016, 0.016, 3, 10);

  const mirrorGlassGeo = new THREE.PlaneGeometry(0.115, 0.062);

  const handleShape = createRoundedRectShape(0.16, 0.024, 0.01);
  const doorHandleGeo = createFrontProfileExtrude(handleShape, 0.028, 0.006, 0.006, 2, 8);
  doorHandleGeo.rotateY(Math.PI / 2);

  // Thin door seam line geometry (left and right doors)
  const seamPts: THREE.Vector3[] = [];
  [-0.955, 0.955].forEach((xSide) => {
    seamPts.push(new THREE.Vector3(xSide, 0.25, -0.48), new THREE.Vector3(xSide, 0.86, -0.46));
    seamPts.push(new THREE.Vector3(xSide, 0.25, -0.48), new THREE.Vector3(xSide, 0.25, 0.44));
    seamPts.push(new THREE.Vector3(xSide, 0.25, 0.44), new THREE.Vector3(xSide, 0.86, 0.40));
  });
  const doorSeamGeo = new THREE.BufferGeometry().setFromPoints(seamPts);

  // ============================================================================
  // 7. REAR LIP SPOILER & RACE SPEC GT WING
  // ============================================================================
  const lipShape = new THREE.Shape();
  lipShape.moveTo(1.94, 0.865);
  lipShape.quadraticCurveTo(2.04, 0.91, 2.15, 0.965); // Swept ducktail lip spoiler
  lipShape.lineTo(2.17, 0.925);
  lipShape.lineTo(2.02, 0.855);
  lipShape.closePath();
  const coupeLipSpoilerGeo = createSideProfileExtrude(
    lipShape,
    1.72,
    0.022,
    0.022,
    3,
    12,
    (x, y, z) => {
      // Subtle aerodynamic arch across the rear deck width
      const centerCurve = (1.0 - Math.min(1.0, (x * x) / 0.85)) * 0.016;
      return [x, y + centerCurve, z];
    }
  );

  // Dark carbon trailing lip trim along the top edge of the lip spoiler so it pops against pearl white
  const lipEdgeShape = new THREE.Shape();
  lipEdgeShape.moveTo(2.11, 0.945);
  lipEdgeShape.lineTo(2.165, 0.97);
  lipEdgeShape.lineTo(2.178, 0.935);
  lipEdgeShape.lineTo(2.12, 0.92);
  lipEdgeShape.closePath();
  const coupeLipEdgeGeo = createSideProfileExtrude(lipEdgeShape, 1.70, 0.01, 0.01, 2, 8);

  const wingAirfoilShape = new THREE.Shape();
  wingAirfoilShape.moveTo(1.78, 1.18);
  wingAirfoilShape.quadraticCurveTo(1.96, 1.15, 2.14, 1.23);
  wingAirfoilShape.lineTo(2.15, 1.255);
  wingAirfoilShape.quadraticCurveTo(1.96, 1.19, 1.78, 1.205);
  wingAirfoilShape.closePath();
  const raceWingDeckGeo = createSideProfileExtrude(wingAirfoilShape, 1.96, 0.012, 0.012, 2, 10);

  const strutShape = new THREE.Shape();
  strutShape.moveTo(1.78, 0.87);
  strutShape.lineTo(1.94, 1.19);
  strutShape.lineTo(2.04, 1.19);
  strutShape.lineTo(1.92, 0.87);
  strutShape.closePath();
  const raceWingStrutGeo = createSideProfileExtrude(strutShape, 0.035, 0.006, 0.006, 2, 6);

  const epShape = new THREE.Shape();
  epShape.moveTo(1.72, 1.09);
  epShape.lineTo(2.18, 1.13);
  epShape.lineTo(2.22, 1.29);
  epShape.lineTo(1.76, 1.25);
  epShape.closePath();
  const raceWingEndplateGeo = createSideProfileExtrude(epShape, 0.025, 0.006, 0.006, 2, 6);

  // ============================================================================
  // 8. REAR FASCIA, WIDE GLOWING RED TAILLIGHT STRIP, DIFFUSER & DUAL EXHAUSTS
  // ============================================================================
  const rearPanelShape = createRoundedRectShape(1.84, 0.18, 0.045);
  const rearPanelGeo = createFrontProfileExtrude(rearPanelShape, 0.06, 0.012, 0.012, 2, 10);

  // Wide continuous glowing red taillight strip across the full rear width (1.78m wide)
  const tailStripShape = createRoundedRectShape(1.78, 0.048, 0.018);
  const tailStripGeo = createFrontProfileExtrude(tailStripShape, 0.068, 0.008, 0.008, 2, 10);

  // Sculpted triple vertical/angled LED brake light bars flanking the wide strip
  const tailBarShape = createRoundedRectShape(0.062, 0.135, 0.018);
  const tailBarGeo = createFrontProfileExtrude(tailBarShape, 0.074, 0.008, 0.008, 2, 8);

  // Sculpted under-bumper Rear Diffuser (narrower than the rear tires so the tires remain fully visible!)
  const diffuserShape = new THREE.Shape();
  diffuserShape.moveTo(1.80, 0.16);
  diffuserShape.lineTo(2.14, 0.18);
  diffuserShape.lineTo(2.17, 0.33);
  diffuserShape.lineTo(1.86, 0.30);
  diffuserShape.closePath();
  const diffuserBaseGeo = createSideProfileExtrude(diffuserShape, 1.32, 0.018, 0.018, 2, 8);

  const finShape = new THREE.Shape();
  finShape.moveTo(1.84, 0.15);
  finShape.lineTo(2.17, 0.16);
  finShape.lineTo(2.19, 0.31);
  finShape.lineTo(1.88, 0.28);
  finShape.closePath();
  const diffuserFinGeo = createSideProfileExtrude(finShape, 0.024, 0.005, 0.005, 2, 6);

  // Dual Polished Chrome Exhaust Tips + Glowing Inner Core
  const exhaustOuterGeo = new THREE.CylinderGeometry(0.072, 0.078, 0.26, 16);
  exhaustOuterGeo.rotateX(Math.PI / 2);
  const exhaustInnerGeo = new THREE.CylinderGeometry(0.056, 0.056, 0.27, 14);
  exhaustInnerGeo.rotateX(Math.PI / 2);

  const flameGeo = new THREE.ConeGeometry(0.095, 0.9, 10);
  flameGeo.rotateX(Math.PI / 2);

  const headlightConeGeo = new THREE.ConeGeometry(1.6, 14, 14, 1, true);
  headlightConeGeo.rotateX(Math.PI / 2);

  // ============================================================================
  // 9. WIDE-STANCE MULTI-SPOKE CHROME RIMS, SIDEWALL TYRES, DISCS & RED CALIPERS
  // ============================================================================
  const tireProfile: THREE.Vector2[] = [
    new THREE.Vector2(0.245, -0.158), // Inner rim bead
    new THREE.Vector2(0.318, -0.175), // Inner bulging sidewall
    new THREE.Vector2(0.362, -0.148), // Inner tread shoulder
    new THREE.Vector2(0.368, 0.0),    // Crown of wide tire tread
    new THREE.Vector2(0.362, 0.148),  // Outer tread shoulder
    new THREE.Vector2(0.318, 0.175),  // Outer bulging sidewall
    new THREE.Vector2(0.245, 0.158),  // Outer rim bead
    new THREE.Vector2(0.238, 0.0),    // Inner barrel seat
    new THREE.Vector2(0.245, -0.158),
  ];
  const tireGeo = new THREE.LatheGeometry(tireProfile, 26);
  tireGeo.rotateZ(Math.PI / 2);
  tireGeo.computeVertexNormals();

  const rimBarrelGeo = new THREE.CylinderGeometry(0.246, 0.246, 0.29, 22, 1, true);
  rimBarrelGeo.rotateZ(Math.PI / 2);

  const rimLipGeo = new THREE.TorusGeometry(0.244, 0.018, 10, 26);
  rimLipGeo.rotateY(Math.PI / 2);

  const rimHubGeo = new THREE.CylinderGeometry(0.064, 0.070, 0.30, 14);
  rimHubGeo.rotateZ(Math.PI / 2);

  // Beveled sculpted spoke for 10-spoke alloy wheel
  const spokeShape = createRoundedRectShape(0.030, 0.195, 0.008);
  const spokeGeo = createFrontProfileExtrude(spokeShape, 0.020, 0.004, 0.004, 1, 6);
  spokeGeo.rotateY(Math.PI / 2);
  spokeGeo.translate(0, 0.125, 0);

  const brakeDiscGeo = new THREE.CylinderGeometry(0.188, 0.188, 0.034, 18);
  brakeDiscGeo.rotateZ(Math.PI / 2);

  const caliperShape = createRoundedRectShape(0.088, 0.135, 0.022);
  const caliperGeo = createFrontProfileExtrude(caliperShape, 0.068, 0.008, 0.008, 2, 8);
  caliperGeo.rotateY(Math.PI / 2);

  // ============================================================================
  // 10. SHARED MATERIALS
  // ============================================================================
  const grilleTexture = createHoneycombGrilleTexture();

  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#12161F'),
    metalness: 0.25,
    roughness: 0.62,
  });

  const grilleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#181D28'),
    map: grilleTexture,
    bumpMap: grilleTexture,
    bumpScale: 0.015,
    metalness: 0.35,
    roughness: 0.52,
  });

  const tintedGlassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#090E17'),
    metalness: 0.15,
    roughness: 0.08,
    clearcoat: 0.9,
    clearcoatRoughness: 0.06,
    reflectivity: 0.75,
    envMapIntensity: 0.55,
  });

  const headlightGlassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0F172A'),
    metalness: 0.2,
    roughness: 0.08,
    clearcoat: 0.85,
    envMapIntensity: 0.45,
  });

  const drlEmissiveMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#E0F2FE'),
    emissive: new THREE.Color('#BAE6FD'),
    emissiveIntensity: 1.45,
    roughness: 0.2,
    toneMapped: false,
  });

  const sideMarkerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#CBD5E1'),
    emissive: new THREE.Color('#38BDF8'),
    emissiveIntensity: 0.45,
    roughness: 0.3,
  });

  const headlightConeMat = new THREE.MeshBasicMaterial({
    color: 0xbae6fd,
    transparent: true,
    opacity: 0.06,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mirrorReflectMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#CBD5E1'),
    metalness: 0.85,
    roughness: 0.12,
    envMapIntensity: 0.55,
  });

  const tireRubberMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#151922'),
    metalness: 0.08,
    roughness: 0.78,
  });

  const brakeDiscMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#94A3B8'),
    metalness: 0.82,
    roughness: 0.28,
    envMapIntensity: 0.5,
  });

  const redCaliperMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#DC2626'),
    metalness: 0.35,
    roughness: 0.25,
    clearcoat: 0.8,
    envMapIntensity: 0.45,
  });

  const chromeExhaustMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#E2E8F0'),
    metalness: 0.9,
    roughness: 0.14,
    clearcoat: 0.85,
    envMapIntensity: 0.6,
  });

  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const doorSeamMat = new THREE.LineBasicMaterial({
    color: 0x1e293b,
    transparent: true,
    opacity: 0.55,
  });

  const damageCrackTextures: [
    THREE.CanvasTexture,
    THREE.CanvasTexture,
    THREE.CanvasTexture,
  ] = [
    createBlockyDamageCrackTexture(1),
    createBlockyDamageCrackTexture(2),
    createBlockyDamageCrackTexture(3),
  ];

  const hoodCrackGeo = new THREE.PlaneGeometry(1.18, 1.15);
  hoodCrackGeo.rotateX(-Math.PI / 2);

  const roofCrackGeo = new THREE.PlaneGeometry(0.92, 0.95);
  roofCrackGeo.rotateX(-Math.PI / 2);

  const sideCrackGeo = new THREE.PlaneGeometry(1.35, 0.44);

  const rearCrackGeo = new THREE.PlaneGeometry(1.12, 0.52);
  rearCrackGeo.rotateX(-Math.PI / 2);

  _sharedAssets = {
    shadowGeo,
    lowerChassisGeo,
    cabinGreenhouseGeo,
    hoodBulgeGeo,
    hoodVentGeo,
    frontFenderGeo,
    rearHaunchGeo,
    rearFenderBlisterGeo,
    widebodyFrontFlareGeo,
    widebodyRearFlareGeo,
    widebodyCanardGeo,
    widebodyRockerBladeGeo,
    wheelArchTrimFrontGeo,
    wheelArchTrimRearGeo,
    wheelWellLinerGeo,
    sideSkirtGeo,
    frontBumperBeamGeo,
    frontSplitterGeo,
    raceSplitterGeo,
    upperGrilleGeo,
    lowerGrilleGeo,
    fogPocketGeo,
    fogSlatGeo,
    headlightHousingGeo,
    projectorLensGeo,
    drlBarGeo,
    sideMarkerGeo,
    windshieldGeo,
    rearWindowGeo,
    sideWindowGeo,
    interiorCabinGeo,
    mirrorStalkGeo,
    mirrorCapGeo,
    mirrorGlassGeo,
    doorHandleGeo,
    doorSeamGeo,
    coupeLipSpoilerGeo,
    coupeLipEdgeGeo,
    raceWingDeckGeo,
    raceWingStrutGeo,
    raceWingEndplateGeo,
    rearPanelGeo,
    tailStripGeo,
    tailBarGeo,
    diffuserBaseGeo,
    diffuserFinGeo,
    exhaustOuterGeo,
    exhaustInnerGeo,
    flameGeo,
    headlightConeGeo,
    tireGeo,
    rimBarrelGeo,
    rimLipGeo,
    rimHubGeo,
    spokeGeo,
    brakeDiscGeo,
    caliperGeo,
    grilleTexture,
    darkTrimMat,
    grilleMat,
    tintedGlassMat,
    headlightGlassMat,
    drlEmissiveMat,
    sideMarkerMat,
    headlightConeMat,
    mirrorReflectMat,
    tireRubberMat,
    brakeDiscMat,
    redCaliperMat,
    chromeExhaustMat,
    flameMat,
    doorSeamMat,
    damageCrackTextures,
    hoodCrackGeo,
    roofCrackGeo,
    sideCrackGeo,
    rearCrackGeo,
  };

  return _sharedAssets;
}

/**
 * Toggles the 3 muscle coupe body variants ('coupe' | 'widebody' | 'race') on a car rig.
 */
export function setCarRigVariant(rig: CompositeCarRig, variant: CarBodyVariant = 'coupe'): void {
  rig.variantGroups.coupe.visible = variant === 'coupe' || variant === 'widebody';
  rig.variantGroups.widebody.visible = variant === 'widebody';
  rig.variantGroups.race.visible = variant === 'race';
}

/**
 * Builds the Modern Muscle Coupe with:
 * - Narrower trapezoidal cabin cross-section + sloped rear windscreen + fastback roofline
 * - Wide, curved rear fenders flaring well beyond the cabin
 * - Smooth beveled geometries (no plain boxes)
 * - Rear lip spoiler, under-bumper diffuser & dual exhaust tips
 * - Full-width glowing red taillight strip that brightens under braking
 * - Wide-stance visible rear tyres and 10-spoke chrome rims
 * - Pearl white (#E8E8EC) MeshPhysicalMaterial with clearcoat, zero emissive blowout, envMap & rim sheen
 */
export function buildCompositeHypercar(
  livery: CarLivery,
  shadowTexture: THREE.CanvasTexture,
  isPlayer: boolean,
  paintColorHex: string = livery.primaryHex || DEFAULT_CAR_PAINT_HEX,
  variant: CarBodyVariant = livery.variant || (isPlayer ? 'coupe' : 'widebody')
): CompositeCarRig {
  const assets = getSharedMuscleCoupeAssets();

  const root = new THREE.Group();
  const bodyTiltGroup = new THREE.Group();
  root.add(bodyTiltGroup);

  const paintMaterials: THREE.MeshPhysicalMaterial[] = [];
  const accentMaterials: THREE.MeshStandardMaterial[] = [];
  const rimMaterials: THREE.MeshStandardMaterial[] = [];
  const frontWheelPivots: THREE.Group[] = [];
  const wheelSpinMeshes: THREE.Object3D[] = [];
  const nitroFlames: THREE.Mesh[] = [];
  const headlightCones: THREE.Mesh[] = [];

  // 1. Soft Radial Contact Shadow Plane under the car
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.66,
  });
  const shadowMesh = new THREE.Mesh(assets.shadowGeo, shadowMat);
  shadowMesh.position.set(0, 0.02, 0);
  root.add(shadowMesh);

  // 2. Glossy Clearcoat Paint Material (Default Pearl White #E8E8EC with zero emissive and subtle rim sheen)
  const resolvedPaintHex =
    isPlayer && paintColorHex.toUpperCase() === '#F8FAFC'
      ? DEFAULT_CAR_PAINT_HEX
      : paintColorHex;

  const basePaintColor = new THREE.Color(resolvedPaintHex);
  const primaryPaintMat = new THREE.MeshPhysicalMaterial({
    color: basePaintColor.clone(),
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0.0,
    metalness: Math.min(0.22, livery.metalness),
    roughness: Math.max(0.22, livery.roughness),
    clearcoat: 0.85,
    clearcoatRoughness: 0.09,
    reflectivity: 0.72,
    envMapIntensity: 0.42,
  });
  paintMaterials.push(primaryPaintMat);

  const baseAccentColor = new THREE.Color(livery.accentHex);
  const accentMat = new THREE.MeshStandardMaterial({
    color: baseAccentColor.clone(),
    metalness: 0.5,
    roughness: 0.32,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0.0,
    envMapIntensity: 0.4,
  });
  accentMaterials.push(accentMat);

  // Per-car cloned body trim material so red hit flashes never mutate shared assets.darkTrimMat
  const bodyTrimMat = assets.darkTrimMat.clone();
  const baseTrimColor = bodyTrimMat.color.clone();

  // Metallic Chrome / Alloy Rim Material
  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(livery.rimHex || '#CBD5E1'),
    metalness: 0.88,
    roughness: 0.16,
    envMapIntensity: 0.65,
  });
  rimMaterials.push(rimMat);

  // --- BODY: Lower Chassis + Narrower Trapezoidal Fastback Cabin + Flared Curved Fenders ---
  const lowerChassisMesh = new THREE.Mesh(assets.lowerChassisGeo, primaryPaintMat);
  lowerChassisMesh.castShadow = isPlayer;
  lowerChassisMesh.receiveShadow = true;
  bodyTiltGroup.add(lowerChassisMesh);

  const cabinGreenhouseMesh = new THREE.Mesh(assets.cabinGreenhouseGeo, primaryPaintMat);
  cabinGreenhouseMesh.castShadow = isPlayer;
  cabinGreenhouseMesh.receiveShadow = true;
  bodyTiltGroup.add(cabinGreenhouseMesh);

  const hoodBulgeMesh = new THREE.Mesh(assets.hoodBulgeGeo, primaryPaintMat);
  hoodBulgeMesh.castShadow = isPlayer;
  hoodBulgeMesh.receiveShadow = true;
  bodyTiltGroup.add(hoodBulgeMesh);

  // Beveled Hood Heat-Extractor Vents
  [-0.27, 0.27].forEach((xSide) => {
    const vent = new THREE.Mesh(assets.hoodVentGeo, bodyTrimMat);
    vent.position.set(xSide, 0.855, -1.36);
    vent.rotation.x = 0.09;
    vent.rotation.z = xSide < 0 ? 0.06 : -0.06;
    bodyTiltGroup.add(vent);
  });

  const frontFendersMesh = new THREE.Mesh(assets.frontFenderGeo, primaryPaintMat);
  frontFendersMesh.castShadow = isPlayer;
  frontFendersMesh.receiveShadow = true;
  bodyTiltGroup.add(frontFendersMesh);

  const rearHaunchesMesh = new THREE.Mesh(assets.rearHaunchGeo, primaryPaintMat);
  rearHaunchesMesh.castShadow = isPlayer;
  rearHaunchesMesh.receiveShadow = true;
  bodyTiltGroup.add(rearHaunchesMesh);

  const rearBlistersMesh = new THREE.Mesh(assets.rearFenderBlisterGeo, primaryPaintMat);
  rearBlistersMesh.castShadow = isPlayer;
  rearBlistersMesh.receiveShadow = true;
  bodyTiltGroup.add(rearBlistersMesh);

  // Dark Wheel Arch Trims & Black Side Skirts
  const frontArchTrimMesh = new THREE.Mesh(assets.wheelArchTrimFrontGeo, bodyTrimMat);
  const rearArchTrimMesh = new THREE.Mesh(assets.wheelArchTrimRearGeo, bodyTrimMat);
  const sideSkirtMesh = new THREE.Mesh(assets.sideSkirtGeo, bodyTrimMat);
  bodyTiltGroup.add(frontArchTrimMesh, rearArchTrimMesh, sideSkirtMesh);

  // Dark Wheel-Well Inner Liners (recessed inward so the wide rear tires are unobstructed from behind)
  [
    { x: -0.74, z: -1.36 },
    { x: 0.74, z: -1.36 },
    { x: -0.74, z: 1.34 },
    { x: 0.74, z: 1.34 },
  ].forEach((well) => {
    const liner = new THREE.Mesh(assets.wheelWellLinerGeo, assets.darkTrimMat);
    liner.position.set(well.x, 0.37, well.z);
    bodyTiltGroup.add(liner);
  });

  // --- FRONT END: Painted Bumper Crossbar, Black Honeycomb Grilles, Splitter & Angular LED Headlights ---
  const bumperBeamMesh = new THREE.Mesh(assets.frontBumperBeamGeo, primaryPaintMat);
  const frontSplitterMesh = new THREE.Mesh(assets.frontSplitterGeo, assets.darkTrimMat);
  bodyTiltGroup.add(bumperBeamMesh, frontSplitterMesh);

  const upperGrilleMesh = new THREE.Mesh(assets.upperGrilleGeo, assets.grilleMat);
  upperGrilleMesh.position.set(0, 0, -2.19);
  upperGrilleMesh.rotation.x = 0.14;
  bodyTiltGroup.add(upperGrilleMesh);

  const lowerGrilleMesh = new THREE.Mesh(assets.lowerGrilleGeo, assets.grilleMat);
  lowerGrilleMesh.position.set(0, 0, -2.18);
  bodyTiltGroup.add(lowerGrilleMesh);

  [-1, 1].forEach((side) => {
    const fogPocket = new THREE.Mesh(assets.fogPocketGeo, assets.darkTrimMat);
    fogPocket.position.set(side * 0.66, 0.28, -2.14);
    fogPocket.rotation.y = side * -0.18;
    bodyTiltGroup.add(fogPocket);

    [-0.022, 0.022].forEach((yOff) => {
      const slat = new THREE.Mesh(assets.fogSlatGeo, assets.darkTrimMat);
      slat.position.set(side * 0.66, 0.28 + yOff, -2.15);
      slat.rotation.y = side * -0.18;
      bodyTiltGroup.add(slat);
    });

    const sideMarker = new THREE.Mesh(assets.sideMarkerGeo, assets.sideMarkerMat);
    sideMarker.position.set(side * 0.96, 0.37, -1.86);
    bodyTiltGroup.add(sideMarker);

    const hlGroup = new THREE.Group();
    hlGroup.position.set(side * 0.67, 0.595, -2.12);
    hlGroup.rotation.y = side * -0.22;

    const housing = new THREE.Mesh(assets.headlightHousingGeo, assets.headlightGlassMat);
    hlGroup.add(housing);

    const mainProjector = new THREE.Mesh(assets.projectorLensGeo, assets.drlEmissiveMat);
    mainProjector.position.set(side * -0.04, -0.005, -0.055);
    mainProjector.layers.enable(BLOOM_LAYER);
    hlGroup.add(mainProjector);

    const innerProjector = new THREE.Mesh(assets.projectorLensGeo, assets.drlEmissiveMat);
    innerProjector.scale.set(0.7, 0.7, 0.7);
    innerProjector.position.set(side * 0.075, -0.01, -0.055);
    innerProjector.layers.enable(BLOOM_LAYER);
    hlGroup.add(innerProjector);

    const drlTop = new THREE.Mesh(assets.drlBarGeo, assets.drlEmissiveMat);
    drlTop.position.set(0, 0.052, -0.06);
    drlTop.rotation.z = side * 0.06;
    drlTop.layers.enable(BLOOM_LAYER);
    hlGroup.add(drlTop);

    bodyTiltGroup.add(hlGroup);

    const cone = new THREE.Mesh(assets.headlightConeGeo, assets.headlightConeMat);
    cone.position.set(side * 0.68, 0.24, -9.2);
    bodyTiltGroup.add(cone);
    headlightCones.push(cone);
  });

  // --- TRAPEZOIDAL TINTED GLASS, MIRRORS & DOOR DETAILS ---
  const windshieldMesh = new THREE.Mesh(assets.windshieldGeo, assets.tintedGlassMat);
  const rearWindowMesh = new THREE.Mesh(assets.rearWindowGeo, assets.tintedGlassMat);
  const sideWindowsMesh = new THREE.Mesh(assets.sideWindowGeo, assets.tintedGlassMat);
  const interiorCabinMesh = new THREE.Mesh(assets.interiorCabinGeo, assets.darkTrimMat);
  bodyTiltGroup.add(windshieldMesh, rearWindowMesh, sideWindowsMesh, interiorCabinMesh);

  const doorSeams = new THREE.LineSegments(assets.doorSeamGeo, assets.doorSeamMat);
  bodyTiltGroup.add(doorSeams);

  [-1, 1].forEach((side) => {
    const mirrorGroup = new THREE.Group();
    mirrorGroup.position.set(side * 0.84, 0.90, -0.36);

    const stalk = new THREE.Mesh(assets.mirrorStalkGeo, assets.darkTrimMat);
    stalk.position.set(side * 0.05, -0.02, 0);
    stalk.rotation.z = side * 0.25;
    mirrorGroup.add(stalk);

    const cap = new THREE.Mesh(assets.mirrorCapGeo, primaryPaintMat);
    cap.position.set(side * 0.12, 0.01, 0.02);
    cap.scale.x = side;
    mirrorGroup.add(cap);

    const glass = new THREE.Mesh(assets.mirrorGlassGeo, assets.mirrorReflectMat);
    glass.position.set(side * 0.12, 0.01, 0.066);
    mirrorGroup.add(glass);

    bodyTiltGroup.add(mirrorGroup);

    const handle = new THREE.Mesh(assets.doorHandleGeo, primaryPaintMat);
    handle.position.set(side * 0.955, 0.78, 0.26);
    bodyTiltGroup.add(handle);
  });

  // --- REAR END: WIDE GLOWING RED TAILLIGHT STRIP, DIFFUSER & DUAL EXHAUST TIPS ---
  const brakeLightMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#DC2626'),
    emissive: new THREE.Color('#EF4444'),
    emissiveIntensity: 0.85,
    roughness: 0.22,
    toneMapped: false,
  });

  // Non-emissive dark ruby trim for flanking bezel bars so only the light strip mesh glows
  const tailTrimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7F1D1D'),
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0.0,
    roughness: 0.35,
    metalness: 0.2,
  });

  const rearPanelMesh = new THREE.Mesh(assets.rearPanelGeo, assets.darkTrimMat);
  rearPanelMesh.position.set(0, 0.76, 2.13);
  bodyTiltGroup.add(rearPanelMesh);

  // Full-width glowing red LED taillight strip across the rear (only mesh using brakeLightMaterial)
  const tailStripMesh = new THREE.Mesh(assets.tailStripGeo, brakeLightMaterial);
  tailStripMesh.position.set(0, 0.775, 2.145);
  tailStripMesh.layers.enable(BLOOM_LAYER);
  bodyTiltGroup.add(tailStripMesh);

  [-1, 1].forEach((side) => {
    [0.56, 0.69, 0.82].forEach((xAbs) => {
      const bar = new THREE.Mesh(assets.tailBarGeo, tailTrimMat);
      bar.position.set(side * xAbs, 0.755, 2.15);
      bar.rotation.z = side * -0.09;
      bodyTiltGroup.add(bar);
    });
  });

  // Under-Bumper Rear Diffuser + 4 Sculpted Vertical Aero Strakes
  const diffuserBase = new THREE.Mesh(assets.diffuserBaseGeo, assets.darkTrimMat);
  bodyTiltGroup.add(diffuserBase);

  [-0.34, -0.11, 0.11, 0.34].forEach((xFin) => {
    const fin = new THREE.Mesh(assets.diffuserFinGeo, assets.darkTrimMat);
    fin.position.set(xFin, 0, 0);
    bodyTiltGroup.add(fin);
  });

  // Dual Exhaust Tips with Subtle Inner High-Speed Glow & Nitro Flames
  const exhaustGlowMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1E1B18'),
    emissive: new THREE.Color('#EA580C'),
    emissiveIntensity: 0.05,
    roughness: 0.42,
  });

  [-0.55, 0.55].forEach((xOffset) => {
    const outerPipe = new THREE.Mesh(assets.exhaustOuterGeo, assets.chromeExhaustMat);
    outerPipe.position.set(xOffset, 0.25, 2.16);
    bodyTiltGroup.add(outerPipe);

    const innerCore = new THREE.Mesh(assets.exhaustInnerGeo, exhaustGlowMaterial);
    innerCore.position.set(xOffset, 0.25, 2.165);
    bodyTiltGroup.add(innerCore);

    const flame = new THREE.Mesh(assets.flameGeo, assets.flameMat);
    flame.position.set(xOffset, 0.25, 2.68);
    flame.scale.set(0.001, 0.001, 0.001);
    flame.layers.enable(BLOOM_LAYER);
    bodyTiltGroup.add(flame);
    nitroFlames.push(flame);
  });

  // --- BODY VARIANTS: 1) Coupe (Lip Spoiler), 2) Wide-Body, 3) Race Version (Big GT Wing) ---
  const coupeGroup = new THREE.Group();
  const lipSpoilerMesh = new THREE.Mesh(assets.coupeLipSpoilerGeo, primaryPaintMat);
  const lipEdgeMesh = new THREE.Mesh(assets.coupeLipEdgeGeo, assets.darkTrimMat);
  coupeGroup.add(lipSpoilerMesh, lipEdgeMesh);
  bodyTiltGroup.add(coupeGroup);

  const widebodyGroup = new THREE.Group();
  const wbFrontFlare = new THREE.Mesh(assets.widebodyFrontFlareGeo, primaryPaintMat);
  const wbRearFlare = new THREE.Mesh(assets.widebodyRearFlareGeo, primaryPaintMat);
  const wbCanard = new THREE.Mesh(assets.widebodyCanardGeo, assets.darkTrimMat);
  wbCanard.position.set(0, 0.28, -2.08);
  wbCanard.rotation.x = 0.18;
  const wbRocker = new THREE.Mesh(assets.widebodyRockerBladeGeo, assets.darkTrimMat);
  wbRocker.position.set(0, 0.16, 0.0);
  widebodyGroup.add(wbFrontFlare, wbRearFlare, wbCanard, wbRocker);
  bodyTiltGroup.add(widebodyGroup);

  const raceGroup = new THREE.Group();
  const raceWingDeck = new THREE.Mesh(assets.raceWingDeckGeo, assets.darkTrimMat);
  const raceSplitter = new THREE.Mesh(assets.raceSplitterGeo, assets.darkTrimMat);
  const leftStrut = new THREE.Mesh(assets.raceWingStrutGeo, assets.darkTrimMat);
  leftStrut.position.set(-0.44, 0, 0);
  const rightStrut = new THREE.Mesh(assets.raceWingStrutGeo, assets.darkTrimMat);
  rightStrut.position.set(0.44, 0, 0);
  const leftEndplate = new THREE.Mesh(assets.raceWingEndplateGeo, primaryPaintMat);
  leftEndplate.position.set(-0.98, 0, 0);
  const rightEndplate = new THREE.Mesh(assets.raceWingEndplateGeo, primaryPaintMat);
  rightEndplate.position.set(0.98, 0, 0);
  raceGroup.add(
    raceWingDeck,
    raceSplitter,
    leftStrut,
    rightStrut,
    leftEndplate,
    rightEndplate
  );
  bodyTiltGroup.add(raceGroup);

  // --- WHEELS: WIDE STANCE, VISIBLE REAR TYRES & 10-SPOKE CHROME RIMS WITH RED CALIPERS ---
  const wheelPositions: { x: number; y: number; z: number; isFront: boolean }[] = [
    { x: -0.94, y: 0.36, z: -1.36, isFront: true },
    { x: 0.94, y: 0.36, z: -1.36, isFront: true },
    { x: -0.98, y: 0.38, z: 1.34, isFront: false },
    { x: 0.98, y: 0.38, z: 1.34, isFront: false },
  ];

  wheelPositions.forEach((wp) => {
    const isLeft = wp.x < 0;
    const outSign = isLeft ? -1 : 1;

    const steerPivot = new THREE.Group();
    steerPivot.position.set(wp.x, wp.y, wp.z);
    if (!wp.isFront) {
      // Extra wide rear tyre & deep-dish rim stance so rear tyres and rims are clearly visible from behind
      steerPivot.scale.set(1.24, 1.04, 1.04);
    }
    root.add(steerPivot);

    if (wp.isFront) {
      frontWheelPivots.push(steerPivot);
    }

    // Non-spinning Red Brake Caliper attached to steering knuckle
    const caliper = new THREE.Mesh(assets.caliperGeo, assets.redCaliperMat);
    caliper.position.set(
      outSign * 0.055,
      0.06,
      wp.isFront ? 0.115 : -0.115
    );
    caliper.rotation.x = wp.isFront ? -0.45 : 0.45;
    steerPivot.add(caliper);

    // Spinning Wheel Assembly (Tyre + Chrome Barrel + Outer Lip + Center Hub + 10 Spokes + Brake Rotor)
    const spinGroup = new THREE.Group();
    steerPivot.add(spinGroup);
    wheelSpinMeshes.push(spinGroup);

    const tireMesh = new THREE.Mesh(assets.tireGeo, assets.tireRubberMat);
    const barrelMesh = new THREE.Mesh(assets.rimBarrelGeo, rimMat);
    const outerLipMesh = new THREE.Mesh(assets.rimLipGeo, rimMat);
    outerLipMesh.position.x = outSign * 0.148;
    const hubMesh = new THREE.Mesh(assets.rimHubGeo, rimMat);
    const discMesh = new THREE.Mesh(assets.brakeDiscGeo, assets.brakeDiscMat);
    discMesh.position.x = outSign * 0.025;

    spinGroup.add(tireMesh, barrelMesh, outerLipMesh, hubMesh, discMesh);

    // 10 Thin Multi-Spoke Chrome Alloy Spokes
    const numSpokes = 10;
    for (let s = 0; s < numSpokes; s++) {
      const spoke = new THREE.Mesh(assets.spokeGeo, rimMat);
      const pairIdx = Math.floor(s / 2);
      const pairOffset = s % 2 === 0 ? -0.19 : 0.19;
      const angle = (pairIdx * (Math.PI * 2)) / 5 + pairOffset;
      spoke.position.x = outSign * 0.128;
      spoke.rotation.x = angle;
      spoke.rotation.z = outSign * -0.08;
      spinGroup.add(spoke);
    }
  });

  // --- PROGRESSIVE MINECRAFT BLOCK CRACK & DENT OVERLAYS (75%, 50%, 25% HP) ---
  const damageCrackMaterial = new THREE.MeshBasicMaterial({
    map: assets.damageCrackTextures[0],
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });

  const damageCrackGroup = new THREE.Group();
  damageCrackGroup.visible = false;

  const hoodCrackMesh = new THREE.Mesh(assets.hoodCrackGeo, damageCrackMaterial);
  hoodCrackMesh.position.set(0, 0.905, -1.22);
  hoodCrackMesh.rotation.x = 0.085;
  damageCrackGroup.add(hoodCrackMesh);

  const roofCrackMesh = new THREE.Mesh(assets.roofCrackGeo, damageCrackMaterial);
  roofCrackMesh.position.set(0, 1.245, 0.22);
  damageCrackGroup.add(roofCrackMesh);

  const leftSideCrackMesh = new THREE.Mesh(assets.sideCrackGeo, damageCrackMaterial);
  leftSideCrackMesh.position.set(-1.02, 0.62, 0.15);
  leftSideCrackMesh.rotation.y = -Math.PI / 2;
  damageCrackGroup.add(leftSideCrackMesh);

  const rightSideCrackMesh = new THREE.Mesh(assets.sideCrackGeo, damageCrackMaterial);
  rightSideCrackMesh.position.set(1.02, 0.62, 0.15);
  rightSideCrackMesh.rotation.y = Math.PI / 2;
  damageCrackGroup.add(rightSideCrackMesh);

  const rearDeckCrackMesh = new THREE.Mesh(assets.rearCrackGeo, damageCrackMaterial);
  rearDeckCrackMesh.position.set(0, 0.96, 1.72);
  rearDeckCrackMesh.rotation.x = -0.08;
  damageCrackGroup.add(rearDeckCrackMesh);

  bodyTiltGroup.add(damageCrackGroup);

  const rig: CompositeCarRig = {
    root,
    bodyTiltGroup,
    paintMaterials,
    accentMaterials,
    rimMaterials,
    bodyTrimMaterial: bodyTrimMat,
    basePaintColor,
    baseAccentColor,
    baseTrimColor,
    damageCrackGroup,
    damageCrackMaterial,
    currentDamageStage: 0,
    brakeLightMaterial,
    exhaustGlowMaterial,
    frontWheelPivots,
    wheelSpinMeshes,
    nitroFlames,
    headlightCones,
    variantGroups: {
      coupe: coupeGroup,
      widebody: widebodyGroup,
      race: raceGroup,
    },
  };

  setCarRigVariant(rig, variant);
  return rig;
}

const _hitFlashRedColor = new THREE.Color('#FF2424');
const _tempBodyColor = new THREE.Color();

/**
 * Updates both the 0.25s Minecraft-style Red Hit Flash and the 3-stage Progressive Block Crack
 * & Paint Darkening (at <=75%, <=50%, and <=25% HP) without mutating shared materials or allocating memory.
 */
export function updateCarDamageAndHitFlash(
  rig: CompositeCarRig,
  hitFlashTimer: number,
  hpRatio: number
): void {
  const assets = getSharedMuscleCoupeAssets();
  const clampedHp = THREE.MathUtils.clamp(hpRatio, 0, 1);

  // Determine progressive damage stage: 0 (>75%), 1 (<=75%), 2 (<=50%), 3 (<=25%)
  const stage =
    clampedHp <= 0.25 ? 3 : clampedHp <= 0.5 ? 2 : clampedHp <= 0.75 ? 1 : 0;

  if (stage !== rig.currentDamageStage) {
    rig.currentDamageStage = stage;
    if (stage === 0) {
      rig.damageCrackGroup.visible = false;
      rig.damageCrackMaterial.opacity = 0;
    } else {
      rig.damageCrackGroup.visible = true;
      rig.damageCrackMaterial.map = assets.damageCrackTextures[stage - 1];
      rig.damageCrackMaterial.opacity =
        stage === 1 ? 0.62 : stage === 2 ? 0.78 : 0.94;
      rig.damageCrackMaterial.needsUpdate = true;
    }
  }

  // Darken paint progressively at each damage stage (1.0 -> 0.89 -> 0.77 -> 0.63)
  const stageDarken =
    stage === 0 ? 1.0 : stage === 1 ? 0.89 : stage === 2 ? 0.77 : 0.63;

  // 0.25s red hit flash fade factor (1.0 on impact -> fades smoothly back to 0.0 over 0.25s)
  const flashAlpha = THREE.MathUtils.clamp(hitFlashTimer / 0.25, 0, 1);

  // Restore / interpolate paint materials
  _tempBodyColor.copy(rig.basePaintColor).multiplyScalar(stageDarken);
  if (flashAlpha > 0) {
    _tempBodyColor.lerp(_hitFlashRedColor, flashAlpha * 0.78);
  }
  for (let i = 0; i < rig.paintMaterials.length; i++) {
    const mat = rig.paintMaterials[i];
    mat.color.copy(_tempBodyColor);
    if (flashAlpha > 0) {
      mat.emissive.setHex(0xdc2626);
      mat.emissiveIntensity = flashAlpha * 0.52;
    } else {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0.0;
    }
  }

  // Restore / interpolate accent materials
  _tempBodyColor.copy(rig.baseAccentColor).multiplyScalar(stageDarken);
  if (flashAlpha > 0) {
    _tempBodyColor.lerp(_hitFlashRedColor, flashAlpha * 0.78);
  }
  for (let i = 0; i < rig.accentMaterials.length; i++) {
    const mat = rig.accentMaterials[i];
    mat.color.copy(_tempBodyColor);
    if (flashAlpha > 0) {
      mat.emissive.setHex(0xdc2626);
      mat.emissiveIntensity = flashAlpha * 0.52;
    } else {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0.0;
    }
  }

  // Restore / interpolate per-car body trim material
  _tempBodyColor.copy(rig.baseTrimColor);
  if (flashAlpha > 0) {
    _tempBodyColor.lerp(_hitFlashRedColor, flashAlpha * 0.68);
    rig.bodyTrimMaterial.emissive.setHex(0xb91c1c);
    rig.bodyTrimMaterial.emissiveIntensity = flashAlpha * 0.45;
  } else {
    rig.bodyTrimMaterial.emissive.setHex(0x000000);
    rig.bodyTrimMaterial.emissiveIntensity = 0.0;
  }
  rig.bodyTrimMaterial.color.copy(_tempBodyColor);
}

export function applyLiveryToCarRig(rig: CompositeCarRig, livery: CarLivery): void {
  const resolvedHex =
    livery.primaryHex && livery.primaryHex.toUpperCase() === '#F8FAFC'
      ? DEFAULT_CAR_PAINT_HEX
      : livery.primaryHex || DEFAULT_CAR_PAINT_HEX;

  rig.basePaintColor.set(resolvedHex);
  rig.baseAccentColor.set(livery.accentHex);

  rig.paintMaterials.forEach((mat) => {
    mat.color.set(resolvedHex);
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 0.0;
    mat.metalness = Math.min(0.22, livery.metalness);
    mat.roughness = Math.max(0.22, livery.roughness);
    mat.clearcoat = 0.85;
  });
  rig.accentMaterials.forEach((mat) => {
    mat.color.set(livery.accentHex);
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 0.0;
  });
  rig.rimMaterials.forEach((mat) => {
    mat.color.set(livery.rimHex);
  });
  if (livery.variant) {
    setCarRigVariant(rig, livery.variant);
  }
}
