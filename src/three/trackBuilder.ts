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
export const KERB_WIDTH = 1.0; // painted kerb & outer edge strip width (meters)
export const PROP_SAFETY_MARGIN = 3.0; // minimum 3m safety margin beyond kerb
export const MIN_SAFE_PROP_OFFSET =
  ROAD_HALF_WIDTH + KERB_WIDTH + PROP_SAFETY_MARGIN; // 15.5m minimum centreline clearance
export const TRACK_BLOOM_LAYER = 1; // selective bloom layer for lamps, gantry neon & boost pads

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

export interface TimeOfDayEnvironmentState {
  sunDir: THREE.Vector3;
  topColor: THREE.Color;
  midColor: THREE.Color;
  horizonColor: THREE.Color;
  sunColor: THREE.Color;
  sunGlowColor: THREE.Color;
  cloudTint: THREE.Color;
  cloudOpacity: number;
  starIntensity: number;
  lampEmissiveIntensity: number;
}

export interface BuiltTrack {
  group: THREE.Group;
  asphaltTexture: THREE.CanvasTexture;
  boostPads: BoostPadZone[];
  gantryLights: THREE.MeshStandardMaterial[];
  propDebugGroup: THREE.Group;
  togglePropDebug: () => boolean;
  updateEnvironment: (
    elapsed: number,
    cameraPos: THREE.Vector3,
    todState?: TimeOfDayEnvironmentState
  ) => void;
  dispose: () => void;
}

/**
 * Evaluates the closed-loop 2400m Grand Touring circuit at distance `s` (in meters).
 * Combines a base oval with multi-harmonic sweeping S-curves, hairpin chicanes, and rolling hills.
 */
export function getTrackCenterPosition(
  s: number,
  target: THREE.Vector3
): THREE.Vector3 {
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

export const GROUND_FLOOR_Y = -0.45; // Desert canyon floor base elevation just below start/finish straight (y=0)

/**
 * Computes the horizontal unit right normal on the XZ plane from the track's tangent.
 * Matches crossVectors(tangent, UP) = (-tz, 0, tx) so +1 is always the RIGHT side of the track
 * and -1 is always the LEFT side of the track.
 */
export function getHorizontalTrackNormal(
  tangent: THREE.Vector3,
  outNormal: THREE.Vector3
): THREE.Vector3 {
  const tx = tangent.x;
  const tz = tangent.z;
  const len = Math.hypot(tx, tz) || 1;
  return outNormal.set(-tz / len, 0, tx / len);
}

/**
 * Computes a pure yaw angle (rotation around the world Y axis, with pitch = 0 and roll = 0)
 * from the track's tangent projected onto the XZ plane so that a prop's local +Z forward axis
 * faces directly toward the track centreline (plus an optional yawOffset).
 */
export function getTrackYawFacingTrack(
  tangent: THREE.Vector3,
  side: number,
  yawOffset: number = 0
): number {
  const tx = tangent.x;
  const tz = tangent.z;
  const len = Math.hypot(tx, tz) || 1;
  // Horizontal outward right normal is (-tz / len, 0, tx / len).
  // Inward direction toward the track centreline from `side` (+1 right, -1 left) is -side * normalXZ:
  const inwardX = (side * tz) / len;
  const inwardZ = (-side * tx) / len;
  return Math.atan2(inwardX, inwardZ) + yawOffset;
}

/**
 * Computes exact terrain / track-edge shoulder surface Y at a given lateral distance from track centreline
 * so trackside props sit flush on the verge or desert floor without floating or sinking.
 */
export function getEmbankmentSurfaceY(
  frame: TrackFrame,
  side: number,
  latDist: number,
  groundY: number = GROUND_FLOOR_Y
): number {
  const edgeY = frame.position.y + side * frame.right.y * ROAD_HALF_WIDTH + 0.04;
  const vergeOuterLat = ROAD_HALF_WIDTH + 14.5; // 26.0m: wide, gently graded trackside run-off shoulder
  const slopeMidLat = ROAD_HALF_WIDTH + 26.0; // 37.5m: mid-embankment transition
  const skirtOuterLat = ROAD_HALF_WIDTH + 46.0; // 57.5m: embankment base blending into desert floor

  if (latDist <= ROAD_HALF_WIDTH) {
    return edgeY;
  }
  if (latDist <= vergeOuterLat) {
    const tVerge = (latDist - ROAD_HALF_WIDTH) / 14.5;
    return THREE.MathUtils.lerp(edgeY - 0.03, edgeY - 0.25, tVerge);
  }
  const midY = THREE.MathUtils.lerp(edgeY - 0.25, groundY, 0.45);
  if (latDist <= slopeMidLat) {
    const tMid = (latDist - vergeOuterLat) / (slopeMidLat - vergeOuterLat);
    return THREE.MathUtils.lerp(edgeY - 0.25, midY, tMid);
  }
  if (latDist >= skirtOuterLat) {
    return groundY;
  }
  const tOuter = (latDist - slopeMidLat) / (skirtOuterLat - slopeMidLat);
  return THREE.MathUtils.lerp(midY, groundY, tOuter);
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

interface TrackSamplePoint {
  s: number;
  frame: TrackFrame;
  normalXZ: THREE.Vector3;
}

interface RegisteredObjectProp {
  kind: 'object';
  name: string;
  object: THREE.Object3D;
  inwardRadius: number;
  yawOffset: number;
  allowTilt: boolean;
  groundYOffset: number;
  localBoxSize: THREE.Vector3;
}

interface RegisteredInstancedProp {
  kind: 'instanced';
  name: string;
  mesh: THREE.InstancedMesh;
  companionMesh?: THREE.InstancedMesh;
  count: number;
  inwardRadius: number;
  yawOffsets?: Float32Array;
  allowTilt: boolean;
  groundYOffset: number;
  localBoxSize: THREE.Vector3;
}

type RegisteredTrackProp = RegisteredObjectProp | RegisteredInstancedProp;

const _refinedFrame: TrackFrame = {
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  bankAngle: 0,
  curvature: 0,
};
const _refinedNormalXZ = new THREE.Vector3();

/**
 * Finds the exact closest point along the 2400m curved track centreline on the XZ plane
 * with continuous tangent projection refinement so there is zero discrete sample error on hills or curves.
 */
function findClosestTrackSampleXZ(
  wx: number,
  wz: number,
  samples: TrackSamplePoint[]
): {
  sample: TrackSamplePoint;
  distXZ: number;
  side: number;
} {
  let bestIdx = 0;
  let bestDistSq = Infinity;

  for (let i = 0; i < samples.length; i++) {
    const dx = wx - samples[i].frame.position.x;
    const dz = wz - samples[i].frame.position.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i;
    }
  }

  const coarse = samples[bestIdx];
  const dx0 = wx - coarse.frame.position.x;
  const dz0 = wz - coarse.frame.position.z;
  const tx = coarse.frame.tangent.x;
  const tz = coarse.frame.tangent.z;
  const tLen = Math.hypot(tx, tz) || 1;
  const alongS = (dx0 * tx + dz0 * tz) / tLen;
  const refinedS =
    (((coarse.s + alongS) % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;

  evaluateTrackFrame(refinedS, _refinedFrame);
  getHorizontalTrackNormal(_refinedFrame.tangent, _refinedNormalXZ);

  const dx = wx - _refinedFrame.position.x;
  const dz = wz - _refinedFrame.position.z;
  const dotRight = dx * _refinedNormalXZ.x + dz * _refinedNormalXZ.z;
  const side = dotRight >= 0 ? 1 : -1;
  const distXZ = Math.hypot(dx, dz);

  return {
    sample: {
      s: refinedS,
      frame: _refinedFrame,
      normalXZ: _refinedNormalXZ,
    },
    distXZ,
    side,
  };
}

/**
 * Computes a curve-validated world position (with base on terrain height) and upright yaw-only quaternion
 * so every placed prop already satisfies the closest-curve-point check with zero warnings.
 */
function computeValidatedPropPlacement(
  s: number,
  side: number,
  desiredLatDist: number,
  inwardRadius: number,
  yawOffset: number,
  groundYOffset: number,
  trackSamples: TrackSamplePoint[],
  outFrame: TrackFrame,
  outNormalXZ: THREE.Vector3,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion
): void {
  const safeLat = Math.max(
    desiredLatDist,
    MIN_SAFE_PROP_OFFSET + inwardRadius + 0.35
  );
  evaluateTrackFrame(s, outFrame);
  getHorizontalTrackNormal(outFrame.tangent, outNormalXZ);

  outPos.copy(outFrame.position).addScaledVector(outNormalXZ, side * safeLat);

  const { sample, distXZ, side: actualSide } = findClosestTrackSampleXZ(
    outPos.x,
    outPos.z,
    trackSamples
  );
  const minReq = MIN_SAFE_PROP_OFFSET + inwardRadius;
  const finalDist = distXZ < minReq ? minReq + 0.35 : distXZ;

  if (distXZ < minReq) {
    outPos.x =
      sample.frame.position.x + sample.normalXZ.x * actualSide * finalDist;
    outPos.z =
      sample.frame.position.z + sample.normalXZ.z * actualSide * finalDist;
  }
  outPos.y =
    getEmbankmentSurfaceY(sample.frame, actualSide, finalDist) + groundYOffset;

  const yaw = getTrackYawFacingTrack(
    sample.frame.tangent,
    actualSide,
    yawOffset
  );
  outQuat.setFromAxisAngle(_up, yaw);
}

/**
 * One-time load validation and auto-correction pass:
 * - Verifies every trackside prop's distance from the curved track centreline (accounting for prop inward half-depth).
 * - Verifies every prop is upright (pitch & roll within 2 degrees of 0 unless allowTilt is true).
 * - Verifies every prop's base sits on the sampled terrain/track-edge height.
 * - Logs a warning and auto-corrects any offending prop; rebuilds InstancedMesh matrices using
 *   a consistent `matrix.compose(position, quaternion, scale)` order and updates `instanceMatrix.needsUpdate`.
 */
function validateAndCorrectTracksideProps(
  registeredProps: RegisteredTrackProp[],
  trackSamples: TrackSamplePoint[]
): void {
  const MAX_ALLOWED_TILT_RAD = THREE.MathUtils.degToRad(2.0);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  const localUp = new THREE.Vector3();

  for (const prop of registeredProps) {
    if (prop.kind === 'object') {
      prop.object.updateMatrixWorld(true);
      pos.copy(prop.object.position);
      quat.copy(prop.object.quaternion);
      scale.copy(prop.object.scale);

      const { sample, distXZ, side } = findClosestTrackSampleXZ(
        pos.x,
        pos.z,
        trackSamples
      );
      const minRequiredCenterDist = MIN_SAFE_PROP_OFFSET + prop.inwardRadius;
      const isTooClose = distXZ < minRequiredCenterDist - 0.05;

      localUp.set(0, 1, 0).applyQuaternion(quat);
      const tiltRad = Math.acos(THREE.MathUtils.clamp(localUp.y, -1, 1));
      const isTilted = !prop.allowTilt && tiltRad > MAX_ALLOWED_TILT_RAD;

      const targetDist = isTooClose ? minRequiredCenterDist + 0.25 : distXZ;
      const expectedY =
        getEmbankmentSurfaceY(sample.frame, side, targetDist) +
        prop.groundYOffset;
      const isFloatingOrSunken = Math.abs(pos.y - expectedY) > 0.15;

      if (isTooClose || isTilted || isFloatingOrSunken) {
        console.warn(
          `[TrackPropValidator] Auto-correcting prop "${prop.name}": dist=${distXZ.toFixed(
            2
          )}m (min=${minRequiredCenterDist.toFixed(2)}m), tilt=${THREE.MathUtils.radToDeg(
            tiltRad
          ).toFixed(1)}°, y=${pos.y.toFixed(2)}m (expected=${expectedY.toFixed(2)}m)`
        );

        if (isTooClose) {
          pos.x = sample.frame.position.x + sample.normalXZ.x * side * targetDist;
          pos.z = sample.frame.position.z + sample.normalXZ.z * side * targetDist;
        }
        pos.y = expectedY;

        if (!prop.allowTilt) {
          const cleanYaw = getTrackYawFacingTrack(
            sample.frame.tangent,
            side,
            prop.yawOffset
          );
          quat.setFromAxisAngle(_up, cleanYaw);
        }

        prop.object.position.copy(pos);
        prop.object.quaternion.copy(quat);
        prop.object.scale.copy(scale);
        prop.object.updateMatrix();
        prop.object.updateMatrixWorld(true);
      }
    } else {
      let correctedCount = 0;
      for (let i = 0; i < prop.count; i++) {
        prop.mesh.getMatrixAt(i, mat);
        mat.decompose(pos, quat, scale);

        const { sample, distXZ, side } = findClosestTrackSampleXZ(
          pos.x,
          pos.z,
          trackSamples
        );
        const scaledInwardRadius =
          prop.inwardRadius * Math.max(scale.x, scale.z);
        const minRequiredCenterDist = MIN_SAFE_PROP_OFFSET + scaledInwardRadius;
        const isTooClose = distXZ < minRequiredCenterDist - 0.05;

        localUp.set(0, 1, 0).applyQuaternion(quat);
        const tiltRad = Math.acos(THREE.MathUtils.clamp(localUp.y, -1, 1));
        const isTilted = !prop.allowTilt && tiltRad > MAX_ALLOWED_TILT_RAD;

        const targetDist = isTooClose ? minRequiredCenterDist + 0.25 : distXZ;
        const expectedY =
          getEmbankmentSurfaceY(sample.frame, side, targetDist) +
          prop.groundYOffset;
        const isFloatingOrSunken = Math.abs(pos.y - expectedY) > 0.15;

        const yawOffset = prop.yawOffsets ? prop.yawOffsets[i] : 0;

        if (isTooClose || isTilted || isFloatingOrSunken) {
          correctedCount++;
          if (isTooClose) {
            pos.x =
              sample.frame.position.x + sample.normalXZ.x * side * targetDist;
            pos.z =
              sample.frame.position.z + sample.normalXZ.z * side * targetDist;
          }
          pos.y = expectedY;
        }

        if (!prop.allowTilt) {
          const cleanYaw = getTrackYawFacingTrack(
            sample.frame.tangent,
            side,
            yawOffset
          );
          quat.setFromAxisAngle(_up, cleanYaw);
        }

        // Always rebuild InstancedMesh matrix with consistent compose(position, quaternion, scale) order
        mat.compose(pos, quat, scale);
        prop.mesh.setMatrixAt(i, mat);
        if (prop.companionMesh) {
          prop.companionMesh.setMatrixAt(i, mat);
        }
      }

      if (correctedCount > 0) {
        console.warn(
          `[TrackPropValidator] Auto-corrected ${correctedCount}/${prop.count} instances in "${prop.name}" to enforce safe offset (>=${MIN_SAFE_PROP_OFFSET}m), upright yaw-only rotation, and terrain ground height.`
        );
      }

      prop.mesh.instanceMatrix.needsUpdate = true;
      prop.mesh.computeBoundingSphere();
      if (prop.companionMesh) {
        prop.companionMesh.instanceMatrix.needsUpdate = true;
        prop.companionMesh.computeBoundingSphere();
      }
    }
  }
}

/**
 * Builds the batched debug visualization group (toggled with Key P) showing:
 * 1. Oriented wireframe bounding box for every prop and InstancedMesh instance (cyan/green)
 * 2. Local +Z Forward Arrow with arrowhead pointing toward the track (bright yellow/orange)
 * 3. Local +Y Upright Axis line confirming 0 pitch / 0 roll (bright green) & +X Right Axis (red)
 * 4. Continuous Left & Right Safe-Offset Boundary Lines at `MIN_SAFE_PROP_OFFSET` (15.5m) along the track
 */
function buildPropDebugHelperGroup(
  registeredProps: RegisteredTrackProp[],
  trackSamples: TrackSamplePoint[],
  geometriesToDispose: THREE.BufferGeometry[],
  materialsToDispose: THREE.Material[]
): THREE.Group {
  const debugGroup = new THREE.Group();
  debugGroup.name = 'TrackPropDebugHelpers';
  debugGroup.visible = false;

  const positions: number[] = [];
  const colors: number[] = [];

  const pushSegment = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    g: number,
    b: number
  ) => {
    positions.push(ax, ay, az, bx, by, bz);
    colors.push(r, g, b, r, g, b);
  };

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  const c0 = new THREE.Vector3();
  const c1 = new THREE.Vector3();
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());

  const addPropGizmo = (
    p: THREE.Vector3,
    q: THREE.Quaternion,
    s: THREE.Vector3,
    boxSize: THREE.Vector3,
    isInstanced: boolean
  ) => {
    const hx = Math.max(0.35, boxSize.x * 0.5 * s.x);
    const hy = Math.max(0.5, boxSize.y * s.y);
    const hz = Math.max(0.35, boxSize.z * 0.5 * s.z);

    // 8 corners of local bounding box with base at y = 0 and top at y = hy
    corners[0].set(-hx, 0, -hz).applyQuaternion(q).add(p);
    corners[1].set(hx, 0, -hz).applyQuaternion(q).add(p);
    corners[2].set(hx, 0, hz).applyQuaternion(q).add(p);
    corners[3].set(-hx, 0, hz).applyQuaternion(q).add(p);
    corners[4].set(-hx, hy, -hz).applyQuaternion(q).add(p);
    corners[5].set(hx, hy, -hz).applyQuaternion(q).add(p);
    corners[6].set(hx, hy, hz).applyQuaternion(q).add(p);
    corners[7].set(-hx, hy, hz).applyQuaternion(q).add(p);

    const br = isInstanced ? 0.13 : 0.98;
    const bg = isInstanced ? 0.83 : 0.75;
    const bb = isInstanced ? 0.93 : 0.14;

    // Bottom rectangle
    for (let k = 0; k < 4; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % 4];
      pushSegment(a.x, a.y, a.z, b.x, b.y, b.z, br, bg, bb);
    }
    // Top rectangle
    for (let k = 0; k < 4; k++) {
      const a = corners[k + 4];
      const b = corners[((k + 1) % 4) + 4];
      pushSegment(a.x, a.y, a.z, b.x, b.y, b.z, br, bg, bb);
    }
    // Vertical pillars
    for (let k = 0; k < 4; k++) {
      const a = corners[k];
      const b = corners[k + 4];
      pushSegment(a.x, a.y, a.z, b.x, b.y, b.z, br, bg, bb);
    }

    // Axis Helper + Forward Arrow (+Z points toward track)
    const arrowLen = Math.max(2.2, hz + 1.6);
    const upLen = Math.max(2.2, hy + 1.0);
    const rightLen = Math.max(1.4, hx + 0.6);

    // +X Right Axis (Red)
    c0.set(0, 0.25, 0).applyQuaternion(q).add(p);
    c1.set(rightLen, 0.25, 0).applyQuaternion(q).add(p);
    pushSegment(c0.x, c0.y, c0.z, c1.x, c1.y, c1.z, 0.96, 0.25, 0.25);

    // +Y Upright Axis (Green)
    c1.set(0, upLen, 0).applyQuaternion(q).add(p);
    pushSegment(p.x, p.y, p.z, c1.x, c1.y, c1.z, 0.15, 0.95, 0.35);

    // +Z Forward Arrow toward Track (Bright Yellow-Cyan with Arrowhead)
    c0.set(0, 0.45, 0).applyQuaternion(q).add(p);
    c1.set(0, 0.45, arrowLen).applyQuaternion(q).add(p);
    pushSegment(c0.x, c0.y, c0.z, c1.x, c1.y, c1.z, 1.0, 0.92, 0.15);

    // Arrowhead barbs
    const barbLeft = new THREE.Vector3(-0.45, 0.45, arrowLen - 0.65)
      .applyQuaternion(q)
      .add(p);
    const barbRight = new THREE.Vector3(0.45, 0.45, arrowLen - 0.65)
      .applyQuaternion(q)
      .add(p);
    pushSegment(
      c1.x,
      c1.y,
      c1.z,
      barbLeft.x,
      barbLeft.y,
      barbLeft.z,
      1.0,
      0.92,
      0.15
    );
    pushSegment(
      c1.x,
      c1.y,
      c1.z,
      barbRight.x,
      barbRight.y,
      barbRight.z,
      1.0,
      0.92,
      0.15
    );
  };

  for (const prop of registeredProps) {
    if (prop.kind === 'object') {
      addPropGizmo(
        prop.object.position,
        prop.object.quaternion,
        prop.object.scale,
        prop.localBoxSize,
        false
      );
    } else {
      for (let i = 0; i < prop.count; i++) {
        prop.mesh.getMatrixAt(i, mat);
        mat.decompose(pos, quat, scale);
        addPropGizmo(pos, quat, scale, prop.localBoxSize, true);
      }
    }
  }

  // Add Left & Right Safe Offset Boundary Lines (15.5m from centreline) around the entire track
  for (let i = 0; i < trackSamples.length; i++) {
    const curr = trackSamples[i];
    const next = trackSamples[(i + 1) % trackSamples.length];
    for (const side of [-1, 1]) {
      const y0 =
        getEmbankmentSurfaceY(curr.frame, side, MIN_SAFE_PROP_OFFSET) + 0.18;
      const y1 =
        getEmbankmentSurfaceY(next.frame, side, MIN_SAFE_PROP_OFFSET) + 0.18;
      const x0 =
        curr.frame.position.x + curr.normalXZ.x * side * MIN_SAFE_PROP_OFFSET;
      const z0 =
        curr.frame.position.z + curr.normalXZ.z * side * MIN_SAFE_PROP_OFFSET;
      const x1 =
        next.frame.position.x + next.normalXZ.x * side * MIN_SAFE_PROP_OFFSET;
      const z1 =
        next.frame.position.z + next.normalXZ.z * side * MIN_SAFE_PROP_OFFSET;
      pushSegment(x0, y0, z0, x1, y1, z1, 0.96, 0.25, 0.65);
    }
  }

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  lineGeo.computeBoundingSphere();

  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
  });

  const lineSegments = new THREE.LineSegments(lineGeo, lineMat);
  lineSegments.frustumCulled = false;
  debugGroup.add(lineSegments);

  geometriesToDispose.push(lineGeo);
  materialsToDispose.push(lineMat);

  return debugGroup;
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
  const registeredProps: RegisteredTrackProp[] = [];

  const isCanyon = config.id === 'canyon';
  const isMidnight = config.id === 'midnight';

  // Pre-sample 960 points along the 2400m track (2.5m spacing) for fast curve-aware prop validation
  const sampleCount = 960;
  const trackSamples: TrackSamplePoint[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const s = (i / sampleCount) * TRACK_LENGTH;
    const sampleFrame: TrackFrame = {
      position: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      bankAngle: 0,
      curvature: 0,
    };
    evaluateTrackFrame(s, sampleFrame);
    const normalXZ = new THREE.Vector3();
    getHorizontalTrackNormal(sampleFrame.tangent, normalXZ);
    trackSamples.push({ s, frame: sampleFrame, normalXZ });
  }

  // ============================================================================
  // 1. MULTI-STOP SUNSET SKY DOME (DEEP PURPLE -> PINK/MAGENTA -> WARM ORANGE) & LOW SUN HALO
  // ============================================================================
  const skyDomeGroup = new THREE.Group();
  const skyGeo = new THREE.SphereGeometry(2600, 48, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTopColor: {
        value: new THREE.Color(
          isCanyon ? '#1A0B2E' : isMidnight ? '#03050C' : '#0F243C'
        ),
      },
      uMidColor: {
        value: new THREE.Color(
          isCanyon ? '#9D2B6B' : isMidnight ? '#091126' : '#1E4E79'
        ),
      },
      uHorizonColor: {
        value: new THREE.Color(
          isCanyon ? '#F97316' : isMidnight ? '#0F1E38' : '#F59E0B'
        ),
      },
      uSunColor: {
        value: new THREE.Color(
          isCanyon ? '#FFF0E5' : isMidnight ? '#7DD3FC' : '#FEF3C7'
        ),
      },
      uSunGlowColor: {
        value: new THREE.Color(
          isCanyon ? '#FB7185' : isMidnight ? '#0284C7' : '#FB923C'
        ),
      },
      uSunDir: {
        value: new THREE.Vector3(-0.52, 0.135, -0.84).normalize(),
      },
      uStarIntensity: {
        value: isMidnight ? 0.85 : 0.0,
      },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldOffset;
      void main() {
        vWorldOffset = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunGlowColor;
      uniform vec3 uSunDir;
      uniform float uStarIntensity;
      uniform float uTime;
      varying vec3 vWorldOffset;

      void main() {
        vec3 dir = normalize(vWorldOffset);
        float h = clamp(dir.y, 0.0, 1.0);

        // Multi-stop sky gradient: horizon -> mid-sky -> zenith
        vec3 sky = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.24, h));
        sky = mix(sky, uTopColor, smoothstep(0.20, 0.78, h));

        float horizonBloom = pow(1.0 - h, 4.8);
        sky += uSunGlowColor * horizonBloom * 0.16;

        // Sun / Moon disc with soft atmospheric halo (clamped below bloom threshold so sky never blows out)
        float sunCos = max(dot(dir, uSunDir), 0.0);
        float wideHalo = pow(sunCos, 7.5) * 0.30;
        float coreHalo = pow(sunCos, 44.0) * 0.42;
        float sunDisc = smoothstep(0.9983, 0.9995, sunCos);

        sky += uSunGlowColor * wideHalo;
        sky += mix(uSunGlowColor, uSunColor, 0.6) * coreHalo;
        sky = mix(sky, uSunColor * 0.92, sunDisc);

        // Procedural high-altitude twinkling stars when dusk/night emerges
        if (uStarIntensity > 0.01 && h > 0.12) {
          vec3 starCell = floor(dir * 210.0);
          float starHash = fract(sin(dot(starCell, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
          float starSpark = smoothstep(0.9935, 0.9992, starHash);
          float twinkle = 0.65 + 0.35 * sin(uTime * 2.8 + starHash * 62.8);
          float zenithMask = smoothstep(0.14, 0.58, h) * (1.0 - smoothstep(0.985, 0.999, sunCos));
          sky += vec3(0.86, 0.92, 1.0) * starSpark * twinkle * zenithMask * uStarIntensity * 0.75;
        }

        float cloudBand = smoothstep(0.03, 0.18, h) * (1.0 - smoothstep(0.22, 0.52, h));
        float w1 = sin(dir.x * 11.0 + dir.z * 7.0 + uTime * 0.015);
        float w2 = cos(dir.x * 23.0 - dir.z * 16.0 - uTime * 0.01);
        float wisp = smoothstep(0.15, 0.85, w1 * 0.55 + w2 * 0.45);
        vec3 cloudLit = mix(uMidColor * 1.05, uSunGlowColor * 0.95, 0.45 + 0.55 * pow(sunCos, 2.0));
        sky = mix(sky, cloudLit, cloudBand * wisp * 0.22);

        gl_FragColor = vec4(clamp(sky, 0.0, 0.88), 1.0);
      }
    `,
  });
  const skyDomeMesh = new THREE.Mesh(skyGeo, skyMat);
  skyDomeGroup.add(skyDomeMesh);
  geometriesToDispose.push(skyGeo);
  materialsToDispose.push(skyMat);

  // Soft Billowing Cloud Sprites Ring around the Sky Dome
  const cloudTexture = createSoftCloudSpriteTexture();
  texturesToDispose.push(cloudTexture);

  const cloudGroup = new THREE.Group();
  const cloudPlaneGeo = new THREE.PlaneGeometry(540, 175);
  geometriesToDispose.push(cloudPlaneGeo);

  const cloudCount = 26;
  const sunDirNorm = new THREE.Vector3(-0.52, 0.135, -0.84).normalize();
  const cloudMaterials: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < cloudCount; i++) {
    const angle = (i / cloudCount) * Math.PI * 2 + (i % 3) * 0.08;
    const radius = 1750 + (i % 4) * 140;
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const cy = 190 + (i % 5) * 62;

    const cloudDir = new THREE.Vector3(cx, cy, cz).normalize();
    const sunAlign = Math.max(0, cloudDir.dot(sunDirNorm));

    const cloudColor = new THREE.Color(
      isCanyon ? '#6B2D5C' : isMidnight ? '#1E293B' : '#93C5FD'
    ).lerp(
      new THREE.Color(isCanyon ? '#FB923C' : '#FDE68A'),
      0.32 + 0.62 * Math.pow(sunAlign, 1.6)
    );

    const cloudMat = new THREE.MeshBasicMaterial({
      map: cloudTexture,
      color: cloudColor,
      transparent: true,
      opacity: isMidnight ? 0.16 : 0.36,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(cloudMat);
    cloudMaterials.push(cloudMat);

    const cloudMesh = new THREE.Mesh(cloudPlaneGeo, cloudMat);
    cloudMesh.position.set(cx, cy, cz);
    cloudMesh.lookAt(0, cy * 0.7, 0);
    const scaleX = 0.85 + (i % 4) * 0.35;
    const scaleY = 0.7 + (i % 3) * 0.25;
    cloudMesh.scale.set(scaleX, scaleY, 1);
    cloudGroup.add(cloudMesh);
  }
  skyDomeGroup.add(cloudGroup);
  group.add(skyDomeGroup);

  // ============================================================================
  // 2. LAYERED DISTANT CANYON MOUNTAIN RINGS WITH MATCHING SUNSET HAZE & RIM LIGHT
  // ============================================================================
  const horizonLayers = [
    {
      radius: 1080,
      height: 155,
      variance: 58,
      seed: 1.1,
      baseHex: isCanyon ? '#4A2538' : isMidnight ? '#0B1325' : '#1E3A5F',
      hazeHex: isCanyon ? '#D96B43' : isMidnight ? '#111C35' : '#64748B',
      rimHex: isCanyon ? '#FDBA74' : isMidnight ? '#38BDF8' : '#FDE68A',
      hazeStrength: 0.36,
    },
    {
      radius: 1460,
      height: 230,
      variance: 88,
      seed: 2.7,
      baseHex: isCanyon ? '#331A38' : isMidnight ? '#080E1C' : '#172554',
      hazeHex: isCanyon ? '#C85A48' : isMidnight ? '#0F172A' : '#475569',
      rimHex: isCanyon ? '#FB7185' : isMidnight ? '#0284C7' : '#FBBF24',
      hazeStrength: 0.58,
    },
    {
      radius: 1880,
      height: 310,
      variance: 120,
      seed: 4.4,
      baseHex: isCanyon ? '#1F102E' : isMidnight ? '#050811' : '#0F172A',
      hazeHex: isCanyon ? '#9D2B6B' : isMidnight ? '#090D16' : '#334155',
      rimHex: isCanyon ? '#F97316' : isMidnight ? '#0369A1' : '#F59E0B',
      hazeStrength: 0.78,
    },
  ];

  const ringMaterials: THREE.ShaderMaterial[] = [];
  horizonLayers.forEach((layer) => {
    const ringGeo = createCanyonHorizonRingGeometry(
      layer.radius,
      layer.height,
      layer.variance,
      layer.seed
    );
    const ringMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: true,
      fog: false,
      uniforms: {
        uBaseColor: { value: new THREE.Color(layer.baseHex) },
        uHazeColor: { value: new THREE.Color(layer.hazeHex) },
        uRimColor: { value: new THREE.Color(layer.rimHex) },
        uSunDir: { value: sunDirNorm.clone() },
        uHazeStrength: { value: layer.hazeStrength },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldDir;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(worldPos.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uBaseColor;
        uniform vec3 uHazeColor;
        uniform vec3 uRimColor;
        uniform vec3 uSunDir;
        uniform float uHazeStrength;
        varying vec2 vUv;
        varying vec3 vWorldDir;

        void main() {
          float sunAlign = max(dot(normalize(vec3(vWorldDir.x, 0.0, vWorldDir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
          float strata = 0.92 + 0.08 * sin(vUv.y * 42.0);
          vec3 rockCol = uBaseColor * strata;

          float bottomHaze = pow(1.0 - clamp(vUv.y, 0.0, 1.0), 1.7);
          vec3 col = mix(rockCol, uHazeColor, clamp(bottomHaze * 0.75 + uHazeStrength * 0.5, 0.0, 0.92));

          float crestMask = smoothstep(0.62, 0.98, vUv.y);
          float rimStrength = crestMask * (0.25 + 0.75 * pow(sunAlign, 2.2));
          col = mix(col, uRimColor, rimStrength * 0.55);

          gl_FragColor = vec4(clamp(col, 0.0, 0.85), 1.0);
        }
      `,
    });

    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    skyDomeGroup.add(ringMesh);
    geometriesToDispose.push(ringGeo);
    materialsToDispose.push(ringMat);
    ringMaterials.push(ringMat);
  });

  // ============================================================================
  // 3. PROCEDURAL TEXTURES, DESERT FLOOR, GRAVEL PATCHES & RIBBON ROAD
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

  // Expansive Desert Floor with Subtle Sand Ripples & Specular Sheen
  const groundGeo = new THREE.PlaneGeometry(5200, 5200);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundSandTexture,
    roughnessMap: groundSheenMap,
    roughness: 0.88,
    metalness: 0.06,
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.position.y = GROUND_FLOOR_Y;
  groundMesh.receiveShadow = true;
  group.add(groundMesh);
  geometriesToDispose.push(groundGeo);
  materialsToDispose.push(groundMat);

  // Closed-Loop 3D Ribbon Road, Gravel Run-Off Shoulder Apron, Embankment Skirt & Continuous Guardrail Beam
  const segments = 480;
  const roadPositions: number[] = [];
  const roadNormals: number[] = [];
  const roadUvs: number[] = [];
  const roadIndices: number[] = [];

  const skirtPositions: number[] = [];
  const skirtNormals: number[] = [];
  const skirtUvs: number[] = [];
  const skirtIndices: number[] = [];

  const apronPositions: number[] = [];
  const apronNormals: number[] = [];
  const apronUvs: number[] = [];
  const apronIndices: number[] = [];

  const railPositions: number[] = [];
  const railNormals: number[] = [];
  const railIndices: number[] = [];

  const frame: TrackFrame = {
    position: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    bankAngle: 0,
    curvature: 0,
  };
  const normalXZ = new THREE.Vector3();

  const leftEdge = new THREE.Vector3();
  const rightEdge = new THREE.Vector3();
  const leftTuckedEdge = new THREE.Vector3();
  const rightTuckedEdge = new THREE.Vector3();
  const leftVergeOuter = new THREE.Vector3();
  const rightVergeOuter = new THREE.Vector3();
  const leftSlopeMid = new THREE.Vector3();
  const rightSlopeMid = new THREE.Vector3();
  const leftSkirtBottom = new THREE.Vector3();
  const rightSkirtBottom = new THREE.Vector3();

  const leftApronInner = new THREE.Vector3();
  const leftApronOuter = new THREE.Vector3();
  const rightApronInner = new THREE.Vector3();
  const rightApronOuter = new THREE.Vector3();

  const railLatDist = MIN_SAFE_PROP_OFFSET + 0.55; // 16.05m from centreline (aligned with guardrail posts)

  for (let i = 0; i <= segments; i++) {
    const s = (i / segments) * TRACK_LENGTH;
    evaluateTrackFrame(s, frame);
    getHorizontalTrackNormal(frame.tangent, normalXZ);

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

    // Tucked inner embankment edges 25cm under the road ribbon so banked turns never expose a seam
    leftTuckedEdge
      .copy(frame.position)
      .addScaledVector(frame.right, -(ROAD_HALF_WIDTH - 0.25));
    leftTuckedEdge.y = leftEdge.y - 0.03;

    rightTuckedEdge
      .copy(frame.position)
      .addScaledVector(frame.right, ROAD_HALF_WIDTH - 0.25);
    rightTuckedEdge.y = rightEdge.y - 0.03;

    // Wide 14.5m trackside run-off shoulder plateau (lat = 26.0m) where barriers, poles, and props sit
    const vergeLat = ROAD_HALF_WIDTH + 14.5;
    leftVergeOuter
      .copy(frame.position)
      .addScaledVector(normalXZ, -vergeLat);
    leftVergeOuter.y = getEmbankmentSurfaceY(frame, -1, vergeLat);

    rightVergeOuter
      .copy(frame.position)
      .addScaledVector(normalXZ, vergeLat);
    rightVergeOuter.y = getEmbankmentSurfaceY(frame, 1, vergeLat);

    // Mid-slope embankment transition (lat = 37.5m)
    const midLat = ROAD_HALF_WIDTH + 26.0;
    leftSlopeMid
      .copy(frame.position)
      .addScaledVector(normalXZ, -midLat);
    leftSlopeMid.y = getEmbankmentSurfaceY(frame, -1, midLat);

    rightSlopeMid
      .copy(frame.position)
      .addScaledVector(normalXZ, midLat);
    rightSlopeMid.y = getEmbankmentSurfaceY(frame, 1, midLat);

    // Outer embankment base meeting the desert canyon floor (lat = 57.5m, y = GROUND_FLOOR_Y)
    const outerLat = ROAD_HALF_WIDTH + 46.0;
    leftSkirtBottom
      .copy(frame.position)
      .addScaledVector(normalXZ, -outerLat);
    leftSkirtBottom.y = GROUND_FLOOR_Y;

    rightSkirtBottom
      .copy(frame.position)
      .addScaledVector(normalXZ, outerLat);
    rightSkirtBottom.y = GROUND_FLOOR_Y;

    // 8-vertex cross-section ordered strictly from Left (-normalXZ) to Right (+normalXZ)
    skirtPositions.push(
      leftSkirtBottom.x,
      leftSkirtBottom.y,
      leftSkirtBottom.z,
      leftSlopeMid.x,
      leftSlopeMid.y,
      leftSlopeMid.z,
      leftVergeOuter.x,
      leftVergeOuter.y,
      leftVergeOuter.z,
      leftTuckedEdge.x,
      leftTuckedEdge.y,
      leftTuckedEdge.z,
      rightTuckedEdge.x,
      rightTuckedEdge.y,
      rightTuckedEdge.z,
      rightVergeOuter.x,
      rightVergeOuter.y,
      rightVergeOuter.z,
      rightSlopeMid.x,
      rightSlopeMid.y,
      rightSlopeMid.z,
      rightSkirtBottom.x,
      rightSkirtBottom.y,
      rightSkirtBottom.z
    );

    // Scale UVs to match groundSandTexture.repeat (42x42) so texel density is crisp and seamless
    const sv = (i / segments) * 1.6;
    skirtUvs.push(
      0.0,
      sv,
      0.08,
      sv,
      0.16,
      sv,
      0.23,
      sv,
      0.27,
      sv,
      0.34,
      sv,
      0.42,
      sv,
      0.5,
      sv
    );

    for (let k = 0; k < 8; k++) {
      skirtNormals.push(0, 1, 0);
    }

    // Dedicated Gravel Run-Off Shoulder Apron immediately bordering the outer kerbs (11.35m to 16.25m)
    const apronOuterLat = MIN_SAFE_PROP_OFFSET + 0.75; // 16.25m
    leftApronInner
      .copy(frame.position)
      .addScaledVector(frame.right, -(ROAD_HALF_WIDTH - 0.15));
    leftApronInner.y = leftEdge.y - 0.015;

    leftApronOuter
      .copy(frame.position)
      .addScaledVector(normalXZ, -apronOuterLat);
    leftApronOuter.y = getEmbankmentSurfaceY(frame, -1, apronOuterLat) + 0.018;

    rightApronInner
      .copy(frame.position)
      .addScaledVector(frame.right, ROAD_HALF_WIDTH - 0.15);
    rightApronInner.y = rightEdge.y - 0.015;

    rightApronOuter
      .copy(frame.position)
      .addScaledVector(normalXZ, apronOuterLat);
    rightApronOuter.y = getEmbankmentSurfaceY(frame, 1, apronOuterLat) + 0.018;

    apronPositions.push(
      leftApronOuter.x,
      leftApronOuter.y,
      leftApronOuter.z,
      leftApronInner.x,
      leftApronInner.y,
      leftApronInner.z,
      rightApronInner.x,
      rightApronInner.y,
      rightApronInner.z,
      rightApronOuter.x,
      rightApronOuter.y,
      rightApronOuter.z
    );
    const av = (i / segments) * 2.4;
    apronUvs.push(0, av, 0.08, av, 0, av, 0.08, av);
    for (let k = 0; k < 4; k++) {
      apronNormals.push(0, 1, 0);
    }

    // Continuous 3D Steel W-Beam Guardrail Ribbon on Left & Right Roadsides (at lat = 16.05m)
    const leftRailBaseY = getEmbankmentSurfaceY(frame, -1, railLatDist);
    const rightRailBaseY = getEmbankmentSurfaceY(frame, 1, railLatDist);
    const lx = frame.position.x - normalXZ.x * railLatDist;
    const lz = frame.position.z - normalXZ.z * railLatDist;
    const rx = frame.position.x + normalXZ.x * railLatDist;
    const rz = frame.position.z + normalXZ.z * railLatDist;

    // 4 vertices per segment: Left bottom (0), Left top (1), Right bottom (2), Right top (3)
    railPositions.push(
      lx,
      leftRailBaseY + 0.44,
      lz,
      lx,
      leftRailBaseY + 0.78,
      lz,
      rx,
      rightRailBaseY + 0.44,
      rz,
      rx,
      rightRailBaseY + 0.78,
      rz
    );
    // Inward-facing normals toward the track
    railNormals.push(
      normalXZ.x,
      0.15,
      normalXZ.z,
      normalXZ.x,
      0.15,
      normalXZ.z,
      -normalXZ.x,
      0.15,
      -normalXZ.z,
      -normalXZ.x,
      0.15,
      -normalXZ.z
    );

    if (i < segments) {
      const rBase = i * 2;
      roadIndices.push(rBase, rBase + 1, rBase + 2);
      roadIndices.push(rBase + 1, rBase + 3, rBase + 2);

      const sBase = i * 8;
      for (let col = 0; col < 7; col++) {
        // Skip the centre road strip (col === 3) so skirt covers the left and right shoulders/embankments
        if (col === 3) continue;
        const a = sBase + col;
        const b = sBase + col + 1;
        const c = sBase + 8 + col;
        const d = sBase + 8 + col + 1;
        skirtIndices.push(a, b, c);
        skirtIndices.push(b, d, c);
      }

      const aBase = i * 4;
      for (const col of [0, 2]) {
        const a = aBase + col;
        const b = aBase + col + 1;
        const c = aBase + 4 + col;
        const d = aBase + 4 + col + 1;
        apronIndices.push(a, b, c);
        apronIndices.push(b, d, c);
      }

      const rlBase = i * 4;
      // Left rail strip (vertices 0, 1)
      railIndices.push(rlBase + 0, rlBase + 1, rlBase + 4);
      railIndices.push(rlBase + 1, rlBase + 5, rlBase + 4);
      // Right rail strip (vertices 2, 3)
      railIndices.push(rlBase + 2, rlBase + 6, rlBase + 3);
      railIndices.push(rlBase + 3, rlBase + 6, rlBase + 7);
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(roadPositions, 3)
  );
  roadGeo.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(roadNormals, 3)
  );
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeBoundingSphere();

  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTexture,
    roughness: isMidnight ? 0.42 : 0.62,
    metalness: isMidnight ? 0.25 : 0.1,
  });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);
  geometriesToDispose.push(roadGeo);
  materialsToDispose.push(roadMat);

  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(skirtPositions, 3)
  );
  skirtGeo.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(skirtNormals, 3)
  );
  skirtGeo.setAttribute('uv', new THREE.Float32BufferAttribute(skirtUvs, 2));
  skirtGeo.setIndex(skirtIndices);
  skirtGeo.computeVertexNormals();
  skirtGeo.computeBoundingSphere();

  const skirtMat = new THREE.MeshStandardMaterial({
    map: groundSandTexture,
    roughnessMap: groundSheenMap,
    color: new THREE.Color(isCanyon ? '#E5C5A8' : '#64748B'),
    roughness: 0.86,
    metalness: 0.06,
    side: THREE.DoubleSide,
  });
  const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
  skirtMesh.receiveShadow = true;
  group.add(skirtMesh);
  geometriesToDispose.push(skirtGeo);
  materialsToDispose.push(skirtMat);

  // Trackside Gravel Run-Off Apron Mesh (immediately outside the red/white kerbs)
  const apronGeo = new THREE.BufferGeometry();
  apronGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(apronPositions, 3)
  );
  apronGeo.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(apronNormals, 3)
  );
  apronGeo.setAttribute('uv', new THREE.Float32BufferAttribute(apronUvs, 2));
  apronGeo.setIndex(apronIndices);
  apronGeo.computeVertexNormals();
  apronGeo.computeBoundingSphere();

  const apronMat = new THREE.MeshStandardMaterial({
    map: groundSandTexture,
    roughnessMap: groundSheenMap,
    color: new THREE.Color(isCanyon ? '#D4955A' : '#64748B'),
    roughness: 0.9,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
  });
  const apronMesh = new THREE.Mesh(apronGeo, apronMat);
  apronMesh.receiveShadow = true;
  group.add(apronMesh);
  geometriesToDispose.push(apronGeo);
  materialsToDispose.push(apronMat);

  // Continuous Metallic Armco W-Beam Guardrail Ribbon along both sides of the track
  const railGeo = new THREE.BufferGeometry();
  railGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(railPositions, 3)
  );
  railGeo.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(railNormals, 3)
  );
  railGeo.setIndex(railIndices);
  railGeo.computeBoundingSphere();

  const railMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.72,
    roughness: 0.34,
    side: THREE.DoubleSide,
  });
  const railMesh = new THREE.Mesh(railGeo, railMat);
  railMesh.castShadow = true;
  railMesh.receiveShadow = true;
  group.add(railMesh);
  geometriesToDispose.push(railGeo);
  materialsToDispose.push(railMat);

  // Reusable transform objects for consistent compose(position, quaternion, scale)
  const instPos = new THREE.Vector3();
  const instQuat = new THREE.Quaternion();
  const instScale = new THREE.Vector3();
  const instMatrix = new THREE.Matrix4();
  const tempColor = new THREE.Color();

  // Scattered Trackside Gravel Patches on the Run-Off Verge (InstancedMesh, Upright Yaw-Only)
  const gravelPatchCount = 44;
  const gravelPatchGeo = new THREE.PlaneGeometry(5.5, 9.5);
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
    getHorizontalTrackNormal(frame.tangent, normalXZ);
    const side = i % 2 === 0 ? 1 : -1;
    const latOffset = MIN_SAFE_PROP_OFFSET + 3.2 + (i % 3) * 1.2;

    instPos
      .copy(frame.position)
      .addScaledVector(normalXZ, side * latOffset);
    instPos.y = getEmbankmentSurfaceY(frame, side, latOffset) + 0.05;

    const yaw = getTrackYawFacingTrack(frame.tangent, side);
    instQuat.setFromAxisAngle(_up, yaw);
    const sc = 0.75 + (i % 4) * 0.18;
    instScale.set(sc, 1, sc);
    instMatrix.compose(instPos, instQuat, instScale);
    gravelPatchInst.setMatrixAt(i, instMatrix);
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

  // Formation A: Stepped Flat-Top Mesas (Base + Upper Plateau Cap, Pivot at Base y = 0)
  const mesaCount = 52;
  const mesaBaseGeo = new THREE.CylinderGeometry(5.5, 9.2, 16, 7);
  mesaBaseGeo.translate(0, 8, 0);
  const mesaCapGeo = new THREE.CylinderGeometry(4.2, 5.2, 8.5, 7);
  mesaCapGeo.translate(0, 20, 0);

  const mesaBaseInst = new THREE.InstancedMesh(
    mesaBaseGeo,
    bandedRockMat,
    mesaCount
  );
  const mesaCapInst = new THREE.InstancedMesh(
    mesaCapGeo,
    bandedRockMat,
    mesaCount
  );
  mesaBaseInst.castShadow = true;
  mesaBaseInst.receiveShadow = true;
  mesaCapInst.castShadow = true;
  geometriesToDispose.push(mesaBaseGeo, mesaCapGeo);

  const mesaYawOffsets = new Float32Array(mesaCount);
  for (let i = 0; i < mesaCount; i++) {
    const s = (i / mesaCount) * TRACK_LENGTH + (i % 3) * 11;
    const side = i % 2 === 0 ? 1 : -1;
    const latDist = ROAD_HALF_WIDTH + 48 + ((i * 19) % 75);

    const sx = 1.1 + ((i * 23) % 140) / 100;
    const sy = 0.85 + ((i * 31) % 130) / 100;
    const sz = 1.1 + ((i * 17) % 140) / 100;
    instScale.set(sx, sy, sz);

    mesaYawOffsets[i] = ((i * 0.45) % 1.2) - 0.6;
    computeValidatedPropPlacement(
      s,
      side,
      latDist,
      9.2 * Math.max(sx, sz),
      mesaYawOffsets[i],
      0,
      trackSamples,
      frame,
      normalXZ,
      instPos,
      instQuat
    );
    instMatrix.compose(instPos, instQuat, instScale);

    mesaBaseInst.setMatrixAt(i, instMatrix);
    mesaCapInst.setMatrixAt(i, instMatrix);

    tempColor.set(
      isCanyon
        ? i % 3 === 0
          ? '#F59E0B'
          : i % 3 === 1
            ? '#D97706'
            : '#C27838'
        : isMidnight
          ? '#334155'
          : '#64748B'
    );
    mesaBaseInst.setColorAt(i, tempColor);
    mesaCapInst.setColorAt(i, tempColor.clone().multiplyScalar(1.08));
  }
  mesaBaseInst.instanceMatrix.needsUpdate = true;
  mesaCapInst.instanceMatrix.needsUpdate = true;
  if (mesaBaseInst.instanceColor) mesaBaseInst.instanceColor.needsUpdate = true;
  if (mesaCapInst.instanceColor) mesaCapInst.instanceColor.needsUpdate = true;
  mesaBaseInst.computeBoundingSphere();
  mesaCapInst.computeBoundingSphere();
  group.add(mesaBaseInst, mesaCapInst);

  registeredProps.push({
    kind: 'instanced',
    name: 'CanyonMesas',
    mesh: mesaBaseInst,
    companionMesh: mesaCapInst,
    count: mesaCount,
    inwardRadius: 9.2,
    yawOffsets: mesaYawOffsets,
    allowTilt: false,
    groundYOffset: 0,
    localBoxSize: new THREE.Vector3(18.4, 24.2, 18.4),
  });

  // Formation B: Tall Layered Sandstone Pillars / Hoodoos (Pivot at Base y = 0)
  const pillarCount = 64;
  const rockPillarGeo = new THREE.CylinderGeometry(1.3, 2.6, 26, 6, 4);
  rockPillarGeo.translate(0, 13, 0);
  const pPos = rockPillarGeo.attributes.position;
  for (let k = 0; k < pPos.count; k++) {
    const py = pPos.getY(k);
    const bulge = 1 + 0.22 * Math.sin(py * 0.85);
    pPos.setX(k, pPos.getX(k) * bulge);
    pPos.setZ(k, pPos.getZ(k) * bulge);
  }
  rockPillarGeo.computeVertexNormals();

  const pillarInst = new THREE.InstancedMesh(
    rockPillarGeo,
    bandedRockMat,
    pillarCount
  );
  pillarInst.castShadow = true;
  geometriesToDispose.push(rockPillarGeo);

  const pillarYawOffsets = new Float32Array(pillarCount);
  for (let i = 0; i < pillarCount; i++) {
    const s = (i / pillarCount) * TRACK_LENGTH + 18;
    const side = (i + 1) % 2 === 0 ? 1 : -1;
    const latDist = ROAD_HALF_WIDTH + 38 + ((i * 29) % 55);

    const wScale = 0.8 + ((i * 13) % 90) / 100;
    const hScale = 0.75 + ((i * 37) % 140) / 100;
    const zScale = wScale * (0.85 + ((i * 7) % 30) / 100);
    instScale.set(wScale, hScale, zScale);

    pillarYawOffsets[i] = ((i % 5) - 2) * 0.2;
    computeValidatedPropPlacement(
      s,
      side,
      latDist,
      2.8 * Math.max(wScale, zScale),
      pillarYawOffsets[i],
      0,
      trackSamples,
      frame,
      normalXZ,
      instPos,
      instQuat
    );
    instMatrix.compose(instPos, instQuat, instScale);
    pillarInst.setMatrixAt(i, instMatrix);

    tempColor.set(isCanyon ? (i % 2 === 0 ? '#D97706' : '#F59E0B') : '#475569');
    pillarInst.setColorAt(i, tempColor);
  }
  pillarInst.instanceMatrix.needsUpdate = true;
  if (pillarInst.instanceColor) pillarInst.instanceColor.needsUpdate = true;
  pillarInst.computeBoundingSphere();
  group.add(pillarInst);

  registeredProps.push({
    kind: 'instanced',
    name: 'SandstonePillars',
    mesh: pillarInst,
    count: pillarCount,
    inwardRadius: 2.8,
    yawOffsets: pillarYawOffsets,
    allowTilt: false,
    groundYOffset: 0,
    localBoxSize: new THREE.Vector3(5.2, 26, 5.2),
  });

  // Formation C: Natural Sandstone Canyon Arches (Pivot at Base y = 0)
  const archCount = 16;
  const archGeo = new THREE.TorusGeometry(11, 2.6, 7, 16, Math.PI);
  const archInst = new THREE.InstancedMesh(archGeo, bandedRockMat, archCount);
  archInst.castShadow = true;
  geometriesToDispose.push(archGeo);

  for (let i = 0; i < archCount; i++) {
    const s = (i / archCount) * TRACK_LENGTH + 75;
    const side = i % 2 === 0 ? 1 : -1;
    const latDist = ROAD_HALF_WIDTH + 52 + (i % 3) * 14;

    const sc = 0.9 + (i % 4) * 0.25;
    instScale.set(sc * 1.15, sc, sc * 0.85);
    computeValidatedPropPlacement(
      s,
      side,
      latDist,
      13.6 * sc * 1.15,
      0,
      0,
      trackSamples,
      frame,
      normalXZ,
      instPos,
      instQuat
    );
    instMatrix.compose(instPos, instQuat, instScale);
    archInst.setMatrixAt(i, instMatrix);

    tempColor.set(isCanyon ? '#D97706' : '#475569');
    archInst.setColorAt(i, tempColor);
  }
  archInst.instanceMatrix.needsUpdate = true;
  if (archInst.instanceColor) archInst.instanceColor.needsUpdate = true;
  archInst.computeBoundingSphere();
  group.add(archInst);

  registeredProps.push({
    kind: 'instanced',
    name: 'CanyonArches',
    mesh: archInst,
    count: archCount,
    inwardRadius: 13.6,
    allowTilt: false,
    groundYOffset: 0,
    localBoxSize: new THREE.Vector3(24, 13.6, 5.2),
  });

  // Formation D: Scattered Boulders & Trackside Rocks (Pivot at Base y = 0, Safe Offset)
  const boulderCount = 140;
  const boulderGeo = new THREE.DodecahedronGeometry(1.4, 1);
  boulderGeo.translate(0, 1.15, 0);
  const boulderInst = new THREE.InstancedMesh(
    boulderGeo,
    bandedRockMat,
    boulderCount
  );
  geometriesToDispose.push(boulderGeo);

  const boulderYawOffsets = new Float32Array(boulderCount);
  for (let i = 0; i < boulderCount; i++) {
    const s = (i / boulderCount) * TRACK_LENGTH;
    const side = i % 2 === 0 ? 1 : -1;
    const isNearEdge = i % 3 !== 0;
    const latDist = isNearEdge
      ? MIN_SAFE_PROP_OFFSET + 2.6 + (i % 5) * 1.2
      : ROAD_HALF_WIDTH + 38 + (i % 9) * 3.5;

    const sx = isNearEdge ? 0.45 + (i % 4) * 0.22 : 1.3 + (i % 5) * 0.65;
    const sy = sx * (0.58 + (i % 3) * 0.18);
    const sz = sx * (0.8 + (i % 4) * 0.2);
    instScale.set(sx, sy, sz);

    boulderYawOffsets[i] = ((i % 7) - 3) * 0.25;
    computeValidatedPropPlacement(
      s,
      side,
      latDist,
      1.4 * Math.max(sx, sz),
      boulderYawOffsets[i],
      0,
      trackSamples,
      frame,
      normalXZ,
      instPos,
      instQuat
    );
    instMatrix.compose(instPos, instQuat, instScale);
    boulderInst.setMatrixAt(i, instMatrix);

    tempColor.set(
      isCanyon ? (i % 2 === 0 ? '#C27838' : '#A1622F') : '#475569'
    );
    boulderInst.setColorAt(i, tempColor);
  }
  boulderInst.instanceMatrix.needsUpdate = true;
  if (boulderInst.instanceColor) boulderInst.instanceColor.needsUpdate = true;
  boulderInst.computeBoundingSphere();
  group.add(boulderInst);

  registeredProps.push({
    kind: 'instanced',
    name: 'TracksideBoulders',
    mesh: boulderInst,
    count: boulderCount,
    inwardRadius: 1.4,
    yawOffsets: boulderYawOffsets,
    allowTilt: false,
    groundYOffset: 0,
    localBoxSize: new THREE.Vector3(2.8, 2.4, 2.8),
  });

  // ============================================================================
  // 5. GROUND FLORA & TIRE-MARK PATCHES: CACTI, DRY BUSHES & SKID DECALS
  // ============================================================================
  // Saguaro Cacti (Composite Trunk + Twin Arms InstancedMeshes, Pivot at Base y = 0)
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
  const cactusTrunkInst = new THREE.InstancedMesh(
    cactusTrunkGeo,
    cactusMat,
    cactiCount
  );
  const cactusArmInst = new THREE.InstancedMesh(
    cactusArmGeo,
    cactusMat,
    cactiCount
  );
  geometriesToDispose.push(cactusTrunkGeo, cactusArmGeo);
  materialsToDispose.push(cactusMat);

  const cactiYawOffsets = new Float32Array(cactiCount);
  for (let i = 0; i < cactiCount; i++) {
    const s = (i / cactiCount) * TRACK_LENGTH + 9;
    const side = i % 2 === 0 ? -1 : 1;
    const latDist = MIN_SAFE_PROP_OFFSET + 3.0 + (i % 5) * 1.4;

    const sc = 0.75 + (i % 5) * 0.14;
    instScale.set(sc, sc, sc);
    cactiYawOffsets[i] = ((i % 5) - 2) * 0.25;
    computeValidatedPropPlacement(
      s,
      side,
      latDist,
      0.8 * sc,
      cactiYawOffsets[i],
      0,
      trackSamples,
      frame,
      normalXZ,
      instPos,
      instQuat
    );
    instMatrix.compose(instPos, instQuat, instScale);

    cactusTrunkInst.setMatrixAt(i, instMatrix);
    cactusArmInst.setMatrixAt(i, instMatrix);
  }
  cactusTrunkInst.instanceMatrix.needsUpdate = true;
  cactusArmInst.instanceMatrix.needsUpdate = true;
  cactusTrunkInst.computeBoundingSphere();
  cactusArmInst.computeBoundingSphere();
  group.add(cactusTrunkInst, cactusArmInst);

  registeredProps.push({
    kind: 'instanced',
    name: 'SaguaroCacti',
    mesh: cactusTrunkInst,
    companionMesh: cactusArmInst,
    count: cactiCount,
    inwardRadius: 0.8,
    yawOffsets: cactiYawOffsets,
    allowTilt: false,
    groundYOffset: 0,
    localBoxSize: new THREE.Vector3(1.5, 4.6, 0.8),
  });

  // Dry Desert Scrub Bushes on Trackside Verge (Pivot at Base y = 0, Safe Offset)
  const bushCount = 110;
  const bushGeo = new THREE.IcosahedronGeometry(0.75, 1);
  bushGeo.scale(1.3, 0.65, 1.3);
  bushGeo.translate(0, 0.48, 0);
  const bushMat = new THREE.MeshStandardMaterial({
    color: isCanyon ? 0x78350f : 0x1e3a2f,
    roughness: 0.92,
  });
  const bushInst = new THREE.InstancedMesh(bushGeo, bushMat, bushCount);
  geometriesToDispose.push(bushGeo);
  materialsToDispose.push(bushMat);

  for (let i = 0; i < bushCount; i++) {
    const s = (i / bushCount) * TRACK_LENGTH + 4;
    const side = i % 2 === 0 ? 1 : -1;
    const latDist = MIN_SAFE_PROP_OFFSET + 1.8 + (i % 4) * 1.4;

    const sc = 0.65 + (i % 5) * 0.22;
    instScale.set(sc, sc * 0.8, sc);
    computeValidatedPropPlacement(
      s,
      side,
      latDist,
      0.95 * sc,
      0,
      0,
      trackSamples,
      frame,
      normalXZ,
      instPos,
      instQuat
    );
    instMatrix.compose(instPos, instQuat, instScale);
    bushInst.setMatrixAt(i, instMatrix);

    tempColor.set(i % 2 === 0 ? '#92400E' : '#65A30D');
    bushInst.setColorAt(i, tempColor);
  }
  bushInst.instanceMatrix.needsUpdate = true;
  if (bushInst.instanceColor) bushInst.instanceColor.needsUpdate = true;
  bushInst.computeBoundingSphere();
  group.add(bushInst);

  registeredProps.push({
    kind: 'instanced',
    name: 'DesertScrubBushes',
    mesh: bushInst,
    count: bushCount,
    inwardRadius: 0.95,
    allowTilt: false,
    groundYOffset: 0,
    localBoxSize: new THREE.Vector3(1.9, 1.0, 1.9),
  });

  // Tire-Mark Skid Patches on Asphalt Surface near Corner Braking Zones
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
  // A. Grandstands at Main Straight & Key Stadium Corners (Pivot at Base y = 0, Upright Yaw-Only)
  const grandstandLocations = [
    { s: 45, side: -1 },
    { s: 135, side: 1 },
    { s: 780, side: -1 },
    { s: 1580, side: 1 },
    { s: 2310, side: -1 },
  ];
  const standPlinthGeo = new THREE.BoxGeometry(28.4, 2.2, 8.8);
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
  geometriesToDispose.push(
    standPlinthGeo,
    standBaseGeo,
    standRoofGeo,
    standPillarGeo
  );
  materialsToDispose.push(standStructureMat, standSeatsMat, standRoofMat);

  grandstandLocations.forEach(({ s, side }, idx) => {
    const standGroup = new THREE.Group();
    const latDist = MIN_SAFE_PROP_OFFSET + 6.5;
    computeValidatedPropPlacement(
      s,
      side,
      latDist,
      4.5,
      0,
      0,
      trackSamples,
      frame,
      normalXZ,
      standGroup.position,
      standGroup.quaternion
    );

    const plinthMesh = new THREE.Mesh(standPlinthGeo, standStructureMat);
    plinthMesh.position.set(0, -1.0, 0);
    standGroup.add(plinthMesh);

    const baseMesh = new THREE.Mesh(standBaseGeo, standStructureMat);
    baseMesh.position.set(0, 2.75, 0);
    standGroup.add(baseMesh);

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

    registeredProps.push({
      kind: 'object',
      name: `Grandstand_${idx}_s${s}`,
      object: standGroup,
      inwardRadius: 4.5,
      yawOffset: 0,
      allowTilt: false,
      groundYOffset: 0,
      localBoxSize: new THREE.Vector3(28, 9.5, 8.8),
    });
  });

  // B. Trackside Sponsor Banners at Key Corners (Pivot at Base y = 0 with Support Legs, Upright Yaw-Only)
  const bannerSpecs = [
    { s: 210, side: 1, text: 'APEX HORIZON', bg: '#0F172A', accent: '#F59E0B' },
    {
      s: 520,
      side: -1,
      text: 'RED ROCK CANYON',
      bg: '#7C2D12',
      accent: '#F97316',
    },
    {
      s: 940,
      side: 1,
      text: 'SOLAR TURBO V10',
      bg: '#0F172A',
      accent: '#06B6D4',
    },
    {
      s: 1320,
      side: -1,
      text: 'APEX CARBON WORKS',
      bg: '#1E1B4B',
      accent: '#F43F5E',
    },
    {
      s: 1760,
      side: 1,
      text: 'NEVADA SECTOR GP',
      bg: '#7C2D12',
      accent: '#FBBF24',
    },
    {
      s: 2120,
      side: -1,
      text: 'NITRO ENDURANCE',
      bg: '#0F172A',
      accent: '#10B981',
    },
  ];
  const bannerBoardGeo = new THREE.BoxGeometry(11.5, 2.4, 0.25);
  const bannerPostGeo = new THREE.CylinderGeometry(0.14, 0.16, 3.6, 8);
  geometriesToDispose.push(bannerBoardGeo, bannerPostGeo);

  bannerSpecs.forEach((b, idx) => {
    const tex = createSponsorBannerTexture(
      maxAnisotropy,
      b.text,
      b.bg,
      b.accent
    );
    texturesToDispose.push(tex);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.4,
      metalness: 0.1,
    });
    materialsToDispose.push(mat);

    const bannerGroup = new THREE.Group();
    const latDist = MIN_SAFE_PROP_OFFSET + 2.8;
    computeValidatedPropPlacement(
      b.s,
      b.side,
      latDist,
      0.8,
      0,
      0,
      trackSamples,
      frame,
      normalXZ,
      bannerGroup.position,
      bannerGroup.quaternion
    );

    const leftLeg = new THREE.Mesh(bannerPostGeo, standStructureMat);
    leftLeg.position.set(-4.5, 1.3, -0.16);
    const rightLeg = new THREE.Mesh(bannerPostGeo, standStructureMat);
    rightLeg.position.set(4.5, 1.3, -0.16);

    const boardMesh = new THREE.Mesh(bannerBoardGeo, mat);
    boardMesh.position.set(0, 1.95, 0);

    bannerGroup.add(leftLeg, rightLeg, boardMesh);
    group.add(bannerGroup);

    registeredProps.push({
      kind: 'object',
      name: `SponsorBanner_${idx}_${b.text}`,
      object: bannerGroup,
      inwardRadius: 0.8,
      yawOffset: 0,
      allowTilt: false,
      groundYOffset: 0,
      localBoxSize: new THREE.Vector3(11.5, 3.2, 0.5),
    });
  });

  // C. Red & White Tire Barriers at Key Corners (InstancedMesh, Pivot at Base y = 0, Upright Yaw-Only)
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
    const latDist = MIN_SAFE_PROP_OFFSET + 1.25;
    for (let k = 0; k < 20; k++) {
      if (tbIdx >= tireStackCount) break;
      instScale.set(1, 1, 1);
      computeValidatedPropPlacement(
        startS + k * 1.45,
        side,
        latDist,
        0.58,
        0,
        0,
        trackSamples,
        frame,
        normalXZ,
        instPos,
        instQuat
      );
      instMatrix.compose(instPos, instQuat, instScale);
      tireBarrierInst.setMatrixAt(tbIdx, instMatrix);

      tempColor.set(k % 2 === 0 ? '#B91C1C' : '#CBD5E1');
      tireBarrierInst.setColorAt(tbIdx, tempColor);
      tbIdx++;
    }
  });
  tireBarrierInst.instanceMatrix.needsUpdate = true;
  if (tireBarrierInst.instanceColor)
    tireBarrierInst.instanceColor.needsUpdate = true;
  tireBarrierInst.computeBoundingSphere();
  group.add(tireBarrierInst);

  registeredProps.push({
    kind: 'instanced',
    name: 'CornerTireBarriers',
    mesh: tireBarrierInst,
    count: tireStackCount,
    inwardRadius: 0.58,
    allowTilt: false,
    groundYOffset: 0,
    localBoxSize: new THREE.Vector3(1.16, 1.35, 1.16),
  });

  // D. Trackside Light Poles with Glowing Warm Luminaires (InstancedMesh, Pivot at Base y = 0, Overhang along +Z)
  const lightPoleCount = 48;
  const poleShaftGeo = new THREE.CylinderGeometry(0.14, 0.22, 8.8, 8);
  poleShaftGeo.translate(0, 4.4, 0);
  const poleLampGeo = new THREE.BoxGeometry(0.55, 0.28, 1.8);
  poleLampGeo.translate(0, 8.8, 0.6);

  const poleShaftMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.8,
    roughness: 0.3,
  });
  const poleLampMat = new THREE.MeshStandardMaterial({
    color: 0xffedd5,
    emissive: new THREE.Color(isMidnight ? '#38BDF8' : '#FDBA74'),
    emissiveIntensity: 1.65,
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
  poleLampInst.layers.enable(TRACK_BLOOM_LAYER);
  geometriesToDispose.push(poleShaftGeo, poleLampGeo);
  materialsToDispose.push(poleShaftMat, poleLampMat);

  for (let i = 0; i < lightPoleCount; i++) {
    const s = (i / lightPoleCount) * TRACK_LENGTH;
    const side = i % 2 === 0 ? 1 : -1;
    const latDist = MIN_SAFE_PROP_OFFSET + 1.6;
    instScale.set(1, 1, 1);
    computeValidatedPropPlacement(
      s,
      side,
      latDist,
      0.6,
      0,
      0,
      trackSamples,
      frame,
      normalXZ,
      instPos,
      instQuat
    );
    instMatrix.compose(instPos, instQuat, instScale);

    poleShaftInst.setMatrixAt(i, instMatrix);
    poleLampInst.setMatrixAt(i, instMatrix);
  }
  poleShaftInst.instanceMatrix.needsUpdate = true;
  poleLampInst.instanceMatrix.needsUpdate = true;
  poleShaftInst.computeBoundingSphere();
  poleLampInst.computeBoundingSphere();
  group.add(poleShaftInst, poleLampInst);

  registeredProps.push({
    kind: 'instanced',
    name: 'TracksideLightPoles',
    mesh: poleShaftInst,
    companionMesh: poleLampInst,
    count: lightPoleCount,
    inwardRadius: 0.6,
    allowTilt: false,
    groundYOffset: 0,
    localBoxSize: new THREE.Vector3(0.6, 9.0, 1.8),
  });

  // E. Wooden Signs & Corner Braking Distance Marker Boards (150m, 100m, 50m - Pivot at Base y = 0, Upright Yaw-Only)
  const markerBoardGeo = new THREE.BoxGeometry(1.9, 1.1, 0.14);
  const woodPostGeo = new THREE.CylinderGeometry(0.11, 0.11, 2.4, 6);
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
    const latDist = MIN_SAFE_PROP_OFFSET + 1.25;
    markerTextures.forEach((mat, mIdx) => {
      const dist = turnEntryDist - (2 - mIdx) * 32;
      const yawOffset = side * -0.32;

      const signGroup = new THREE.Group();
      computeValidatedPropPlacement(
        dist,
        side,
        latDist,
        0.5,
        yawOffset,
        0,
        trackSamples,
        frame,
        normalXZ,
        signGroup.position,
        signGroup.quaternion
      );

      const post = new THREE.Mesh(woodPostGeo, woodMat);
      post.position.y = 1.05;
      const board = new THREE.Mesh(markerBoardGeo, mat);
      board.position.y = 1.85;
      signGroup.add(post, board);
      group.add(signGroup);

      registeredProps.push({
        kind: 'object',
        name: `BrakingMarker_${turnIdx}_${markerLabels[mIdx]}`,
        object: signGroup,
        inwardRadius: 0.5,
        yawOffset,
        allowTilt: false,
        groundYOffset: 0,
        localBoxSize: new THREE.Vector3(1.9, 2.4, 0.35),
      });
    });
  });

  // F. Roadside Cheering Spectators (Both Hands Raised Above & Waving Different Colored Glowing Lights)
  const spectatorPlacements: { s: number; side: number; latDist: number; phase: number; speed: number }[] = [];
  const fanZones = [
    { start: 18, end: 235, step: 9, sides: [-1, 1] },
    { start: 270, end: 465, step: 11, sides: [-1, 1] },
    { start: 560, end: 750, step: 12, sides: [1, -1] },
    { start: 830, end: 1030, step: 11, sides: [-1, 1] },
    { start: 1120, end: 1350, step: 11, sides: [-1, 1] },
    { start: 1490, end: 1710, step: 12, sides: [1, -1] },
    { start: 1850, end: 2140, step: 11, sides: [-1, 1] },
    { start: 2260, end: 2390, step: 9, sides: [-1, 1] },
  ];

  let specSeed = 1337;
  const nextSpecRand = () => {
    specSeed = (specSeed * 1664525 + 1013904223) % 4294967296;
    return specSeed / 4294967296;
  };

  for (const zone of fanZones) {
    for (let s = zone.start; s <= zone.end; s += zone.step) {
      for (const side of zone.sides) {
        // Place spectators in small lively clusters just behind the roadside guardrail
        const jitterS = (nextSpecRand() - 0.5) * 3.2;
        const rowOffset = (nextSpecRand() * 1.45);
        const latDist = MIN_SAFE_PROP_OFFSET + 1.38 + rowOffset;
        spectatorPlacements.push({
          s: (s + jitterS + TRACK_LENGTH) % TRACK_LENGTH,
          side,
          latDist,
          phase: nextSpecRand() * Math.PI * 2,
          speed: 4.8 + nextSpecRand() * 3.4,
        });
      }
    }
  }

  const spectatorCount = spectatorPlacements.length;

  // Lower body / legs (pivot at ground y = 0)
  const specLegsGeo = new THREE.BoxGeometry(0.42, 0.86, 0.26);
  specLegsGeo.translate(0, 0.43, 0);
  const specLegsMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.85,
  });

  // Torso (pivot at ground y = 0, sits at y = 0.84..1.58)
  const specTorsoGeo = new THREE.BoxGeometry(0.52, 0.74, 0.30);
  specTorsoGeo.translate(0, 1.21, 0);
  const specTorsoMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.65,
  });

  // Head (pivot at ground y = 0, sits at y = 1.76)
  const specHeadGeo = new THREE.SphereGeometry(0.18, 10, 10);
  specHeadGeo.translate(0, 1.77, 0);
  const specHeadMat = new THREE.MeshStandardMaterial({
    color: 0xf1c27d,
    roughness: 0.6,
  });

  // Raised Arm Geometry: pivot at shoulder (0, 0, 0), extends upward (+Y) so both hands are raised above head
  const specArmGeo = new THREE.CylinderGeometry(0.068, 0.078, 0.66, 8);
  specArmGeo.translate(0, 0.33, 0);
  const specArmMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.65,
  });

  // Handheld Glowing Lightstick Geometry: attached to the raised hand at top of arm (y = 0.62..1.22 from shoulder)
  const specLightGeo = new THREE.CylinderGeometry(0.062, 0.048, 0.62, 8);
  specLightGeo.translate(0, 0.90, 0);
  // Unlit / HDR-like Basic material with per-instance neon color + selective bloom layer
  const specLightMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  });

  const specLegsInst = new THREE.InstancedMesh(specLegsGeo, specLegsMat, spectatorCount);
  const specTorsoInst = new THREE.InstancedMesh(specTorsoGeo, specTorsoMat, spectatorCount);
  const specHeadInst = new THREE.InstancedMesh(specHeadGeo, specHeadMat, spectatorCount);
  const specLeftArmInst = new THREE.InstancedMesh(specArmGeo, specArmMat, spectatorCount);
  const specRightArmInst = new THREE.InstancedMesh(specArmGeo, specArmMat, spectatorCount);
  const specLeftLightInst = new THREE.InstancedMesh(specLightGeo, specLightMat, spectatorCount);
  const specRightLightInst = new THREE.InstancedMesh(specLightGeo, specLightMat, spectatorCount);

  specLeftLightInst.layers.enable(TRACK_BLOOM_LAYER);
  specRightLightInst.layers.enable(TRACK_BLOOM_LAYER);

  geometriesToDispose.push(specLegsGeo, specTorsoGeo, specHeadGeo, specArmGeo, specLightGeo);
  materialsToDispose.push(specLegsMat, specTorsoMat, specHeadMat, specArmMat, specLightMat);

  const jacketPalette = [
    new THREE.Color(0xe11d48),
    new THREE.Color(0x2563eb),
    new THREE.Color(0x0d9488),
    new THREE.Color(0xd97706),
    new THREE.Color(0x7c3aed),
    new THREE.Color(0x475569),
    new THREE.Color(0xe2e8f0),
  ];

  // High-intensity neon colors for handheld cheering lights (multiplied > 1.0 so they trigger selective bloom)
  const neonLightPalette = [
    new THREE.Color(0x00f5d4).multiplyScalar(2.2), // Neon Cyan
    new THREE.Color(0xff2a85).multiplyScalar(2.2), // Hot Magenta
    new THREE.Color(0xa3e635).multiplyScalar(2.2), // Electric Lime
    new THREE.Color(0xff7b00).multiplyScalar(2.2), // Vivid Orange
    new THREE.Color(0xa855f7).multiplyScalar(2.2), // Neon Violet
    new THREE.Color(0xfacc15).multiplyScalar(2.2), // Laser Yellow
    new THREE.Color(0x38bdf8).multiplyScalar(2.2), // Sky Laser Blue
    new THREE.Color(0xff3b30).multiplyScalar(2.2), // Neon Coral Red
  ];

  const specBasePos = new Array<THREE.Vector3>(spectatorCount);
  const specBaseQuat = new Array<THREE.Quaternion>(spectatorCount);

  for (let i = 0; i < spectatorCount; i++) {
    const info = spectatorPlacements[i];
    const yawJitter = (nextSpecRand() - 0.5) * 0.25;
    instScale.set(1, 1, 1);

    computeValidatedPropPlacement(
      info.s,
      info.side,
      info.latDist,
      0.35,
      yawJitter,
      0,
      trackSamples,
      frame,
      normalXZ,
      instPos,
      instQuat
    );

    specBasePos[i] = instPos.clone();
    specBaseQuat[i] = instQuat.clone();

    instMatrix.compose(instPos, instQuat, instScale);
    specLegsInst.setMatrixAt(i, instMatrix);
    specTorsoInst.setMatrixAt(i, instMatrix);
    specHeadInst.setMatrixAt(i, instMatrix);
    specLeftArmInst.setMatrixAt(i, instMatrix);
    specRightArmInst.setMatrixAt(i, instMatrix);
    specLeftLightInst.setMatrixAt(i, instMatrix);
    specRightLightInst.setMatrixAt(i, instMatrix);

    const jacketCol = jacketPalette[i % jacketPalette.length];
    specTorsoInst.setColorAt(i, jacketCol);
    specLeftArmInst.setColorAt(i, jacketCol);
    specRightArmInst.setColorAt(i, jacketCol);

    // Ensure left and right hands hold DIFFERENT colored glowing lights
    const leftColorIdx = Math.floor(nextSpecRand() * neonLightPalette.length);
    const rightColorIdx =
      (leftColorIdx + 1 + Math.floor(nextSpecRand() * (neonLightPalette.length - 1))) %
      neonLightPalette.length;

    specLeftLightInst.setColorAt(i, neonLightPalette[leftColorIdx]);
    specRightLightInst.setColorAt(i, neonLightPalette[rightColorIdx]);
  }

  specLegsInst.instanceMatrix.needsUpdate = true;
  specTorsoInst.instanceMatrix.needsUpdate = true;
  specHeadInst.instanceMatrix.needsUpdate = true;
  specLeftArmInst.instanceMatrix.needsUpdate = true;
  specRightArmInst.instanceMatrix.needsUpdate = true;
  specLeftLightInst.instanceMatrix.needsUpdate = true;
  specRightLightInst.instanceMatrix.needsUpdate = true;
  if (specTorsoInst.instanceColor) specTorsoInst.instanceColor.needsUpdate = true;
  if (specLeftArmInst.instanceColor) specLeftArmInst.instanceColor.needsUpdate = true;
  if (specRightArmInst.instanceColor) specRightArmInst.instanceColor.needsUpdate = true;
  if (specLeftLightInst.instanceColor) specLeftLightInst.instanceColor.needsUpdate = true;
  if (specRightLightInst.instanceColor) specRightLightInst.instanceColor.needsUpdate = true;

  specLegsInst.computeBoundingSphere();
  specTorsoInst.computeBoundingSphere();
  specHeadInst.computeBoundingSphere();
  specLeftArmInst.computeBoundingSphere();
  specRightArmInst.computeBoundingSphere();
  specLeftLightInst.computeBoundingSphere();
  specRightLightInst.computeBoundingSphere();

  group.add(
    specLegsInst,
    specTorsoInst,
    specHeadInst,
    specLeftArmInst,
    specRightArmInst,
    specLeftLightInst,
    specRightLightInst
  );

  registeredProps.push({
    kind: 'instanced',
    name: 'RoadsideCheeringSpectators',
    mesh: specLegsInst,
    companionMesh: specTorsoInst,
    count: spectatorCount,
    inwardRadius: 0.35,
    allowTilt: false,
    groundYOffset: 0,
    localBoxSize: new THREE.Vector3(0.7, 2.6, 0.5),
  });

  // Pre-allocated scratch objects for zero-GC per-frame spectator cheering animation
  const animBodyPos = new THREE.Vector3();
  const animShoulderOffset = new THREE.Vector3();
  const animShoulderWorldPos = new THREE.Vector3();
  const animArmLocalEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  const animArmLocalQuat = new THREE.Quaternion();
  const animArmWorldQuat = new THREE.Quaternion();
  const animUnitScale = new THREE.Vector3(1, 1, 1);
  const animMatrix = new THREE.Matrix4();

  const updateCheeringSpectators = (elapsed: number) => {
    for (let i = 0; i < spectatorCount; i++) {
      const info = spectatorPlacements[i];
      const baseP = specBasePos[i];
      const baseQ = specBaseQuat[i];
      const t = elapsed * info.speed + info.phase;

      // Subtle excited vertical cheer bounce for upper body & head
      const bounceY = Math.abs(Math.sin(t)) * 0.11;
      animBodyPos.set(baseP.x, baseP.y + bounceY, baseP.z);
      animMatrix.compose(animBodyPos, baseQ, animUnitScale);
      specTorsoInst.setMatrixAt(i, animMatrix);
      specHeadInst.setMatrixAt(i, animMatrix);

      // Left arm raised above head (+Y) & waving side-to-side and forward/back
      const leftWaveZ = 0.28 + Math.sin(t) * 0.42; // Raised V-angle outward/inward
      const leftWaveX = -0.18 + Math.cos(t * 0.85) * 0.32; // Forward/backward cheer wave
      animShoulderOffset.set(-0.29, 1.50 + bounceY, 0.04).applyQuaternion(baseQ);
      animShoulderWorldPos.copy(baseP).add(animShoulderOffset);
      animArmLocalEuler.set(leftWaveX, 0, leftWaveZ);
      animArmLocalQuat.setFromEuler(animArmLocalEuler);
      animArmWorldQuat.copy(baseQ).multiply(animArmLocalQuat);
      animMatrix.compose(animShoulderWorldPos, animArmWorldQuat, animUnitScale);
      specLeftArmInst.setMatrixAt(i, animMatrix);
      specLeftLightInst.setMatrixAt(i, animMatrix);

      // Right arm raised above head (+Y) & waving with opposite/sync rhythm
      const rightWaveZ = -0.28 + Math.sin(t + 0.65) * 0.42;
      const rightWaveX = -0.18 - Math.cos(t * 0.85 + 0.4) * 0.32;
      animShoulderOffset.set(0.29, 1.50 + bounceY, 0.04).applyQuaternion(baseQ);
      animShoulderWorldPos.copy(baseP).add(animShoulderOffset);
      animArmLocalEuler.set(rightWaveX, 0, rightWaveZ);
      animArmLocalQuat.setFromEuler(animArmLocalEuler);
      animArmWorldQuat.copy(baseQ).multiply(animArmLocalQuat);
      animMatrix.compose(animShoulderWorldPos, animArmWorldQuat, animUnitScale);
      specRightArmInst.setMatrixAt(i, animMatrix);
      specRightLightInst.setMatrixAt(i, animMatrix);
    }

    specTorsoInst.instanceMatrix.needsUpdate = true;
    specHeadInst.instanceMatrix.needsUpdate = true;
    specLeftArmInst.instanceMatrix.needsUpdate = true;
    specRightArmInst.instanceMatrix.needsUpdate = true;
    specLeftLightInst.instanceMatrix.needsUpdate = true;
    specRightLightInst.instanceMatrix.needsUpdate = true;
  };
  // Initialize spectator arm poses immediately at t = 0
  updateCheeringSpectators(0);

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
  const gantryHalfSpan = MIN_SAFE_PROP_OFFSET + 0.7; // 16.2m from centreline
  const pillarGeo = new THREE.BoxGeometry(0.95, 10.6, 1.25);
  const beamGeo = new THREE.BoxGeometry(gantryHalfSpan * 2 + 1.4, 1.4, 1.4);
  const gantryMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.8,
    roughness: 0.25,
  });
  const sectorNeonMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(config.curbPrimaryHex),
    emissive: new THREE.Color(config.curbPrimaryHex),
    emissiveIntensity: 1.55,
    toneMapped: false,
  });
  geometriesToDispose.push(pillarGeo, beamGeo);
  materialsToDispose.push(gantryMetalMat, sectorNeonMat);

  [0, 800, 1600].forEach((gantryDist, idx) => {
    evaluateTrackFrame(gantryDist, frame);
    const gantryGroup = new THREE.Group();
    gantryGroup.position.copy(frame.position);

    const tangentYaw = Math.atan2(frame.tangent.x, frame.tangent.z);
    gantryGroup.rotation.set(0, tangentYaw, 0);

    const leftPillar = new THREE.Mesh(pillarGeo, gantryMetalMat);
    leftPillar.position.set(-gantryHalfSpan, 4.3, 0);
    const rightPillar = new THREE.Mesh(pillarGeo, gantryMetalMat);
    rightPillar.position.set(gantryHalfSpan, 4.3, 0);
    const topBeam = new THREE.Mesh(beamGeo, gantryMetalMat);
    topBeam.position.set(0, 9.2, 0);

    const accentStripGeo = new THREE.BoxGeometry(
      gantryHalfSpan * 2,
      0.18,
      1.5
    );
    const accentStrip = new THREE.Mesh(accentStripGeo, sectorNeonMat);
    accentStrip.position.set(0, 8.45, 0);
    accentStrip.layers.enable(TRACK_BLOOM_LAYER);
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
        pod.layers.enable(TRACK_BLOOM_LAYER);
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
    emissiveIntensity: 1.4,
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
    mesh.layers.enable(TRACK_BLOOM_LAYER);
    group.add(mesh);

    boostPads.push({
      trackDistance: placement.s,
      lateralOffset: placement.lat,
      mesh,
    });
  });

  // Roadside Guardrail Posts (InstancedMesh, Pivot at Base y = 0, Safe Offset, Upright Yaw-Only)
  const postCount = 240;
  const postGeo = new THREE.BoxGeometry(0.9, 0.85, 0.28);
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
    const side = i % 2 === 0 ? 1 : -1;
    const latDist = MIN_SAFE_PROP_OFFSET + 0.55;
    instScale.set(1, 1, 1);
    computeValidatedPropPlacement(
      s,
      side,
      latDist,
      0.2,
      0,
      0,
      trackSamples,
      frame,
      normalXZ,
      instPos,
      instQuat
    );
    instMatrix.compose(instPos, instQuat, instScale);
    postInstanced.setMatrixAt(i, instMatrix);
  }
  postInstanced.instanceMatrix.needsUpdate = true;
  postInstanced.computeBoundingSphere();
  group.add(postInstanced);

  registeredProps.push({
    kind: 'instanced',
    name: 'RoadsideGuardrailPosts',
    mesh: postInstanced,
    count: postCount,
    inwardRadius: 0.2,
    allowTilt: false,
    groundYOffset: 0,
    localBoxSize: new THREE.Vector3(0.9, 0.85, 0.28),
  });

  // ============================================================================
  // 8. ONE-TIME PROP VALIDATION, AUTO-CORRECTION & DEBUG HELPER GROUP (KEY P)
  // ============================================================================
  validateAndCorrectTracksideProps(registeredProps, trackSamples);

  const propDebugGroup = buildPropDebugHelperGroup(
    registeredProps,
    trackSamples,
    geometriesToDispose,
    materialsToDispose
  );
  group.add(propDebugGroup);

  const togglePropDebug = (): boolean => {
    propDebugGroup.visible = !propDebugGroup.visible;
    return propDebugGroup.visible;
  };

  const updateEnvironment = (
    elapsed: number,
    cameraPos: THREE.Vector3,
    todState?: TimeOfDayEnvironmentState
  ) => {
    // Keep sky dome centered on camera for infinite horizon feel
    skyDomeGroup.position.x = cameraPos.x;
    skyDomeGroup.position.z = cameraPos.z;
    skyMat.uniforms.uTime.value = elapsed;

    if (todState) {
      skyMat.uniforms.uSunDir.value.copy(todState.sunDir);
      skyMat.uniforms.uTopColor.value.copy(todState.topColor);
      skyMat.uniforms.uMidColor.value.copy(todState.midColor);
      skyMat.uniforms.uHorizonColor.value.copy(todState.horizonColor);
      skyMat.uniforms.uSunColor.value.copy(todState.sunColor);
      skyMat.uniforms.uSunGlowColor.value.copy(todState.sunGlowColor);
      skyMat.uniforms.uStarIntensity.value = todState.starIntensity;

      for (let i = 0; i < ringMaterials.length; i++) {
        const rMat = ringMaterials[i];
        rMat.uniforms.uSunDir.value.copy(todState.sunDir);
        const layerFactor = 0.28 + i * 0.16;
        rMat.uniforms.uBaseColor.value
          .copy(todState.topColor)
          .lerp(todState.midColor, 0.45 - i * 0.12)
          .multiplyScalar(0.85);
        rMat.uniforms.uHazeColor.value
          .copy(todState.horizonColor)
          .lerp(todState.midColor, layerFactor);
        rMat.uniforms.uRimColor.value.copy(todState.sunGlowColor);
      }

      for (let i = 0; i < cloudMaterials.length; i++) {
        cloudMaterials[i].color.copy(todState.cloudTint);
        cloudMaterials[i].opacity = todState.cloudOpacity;
      }

      poleLampMat.emissiveIntensity = todState.lampEmissiveIntensity;
    }

    // Slowly drift stylized clouds
    cloudGroup.rotation.y = elapsed * 0.0085;
    // Animate roadside cheering spectators waving both raised hands & glowing lightsticks
    updateCheeringSpectators(elapsed);
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
    propDebugGroup,
    togglePropDebug,
    updateEnvironment,
    dispose,
  };
}
