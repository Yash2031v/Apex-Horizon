import * as THREE from 'three';
import { CarLivery } from '../types/racing';

export interface CompositeCarRig {
  root: THREE.Group;
  bodyTiltGroup: THREE.Group;
  paintMaterials: THREE.MeshPhysicalMaterial[];
  accentMaterials: THREE.MeshStandardMaterial[];
  rimMaterials: THREE.MeshStandardMaterial[];
  brakeLightMaterial: THREE.MeshStandardMaterial;
  frontWheelPivots: THREE.Group[];
  wheelSpinMeshes: THREE.Object3D[];
  nitroFlames: THREE.Mesh[];
  headlightCones: THREE.Mesh[];
}

export function buildCompositeHypercar(
  livery: CarLivery,
  shadowTexture: THREE.CanvasTexture,
  isPlayer: boolean
): CompositeCarRig {
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

  // 1. Grounded Soft Radial Contact Shadow Plane (y = 0.02 to prevent Z-fighting)
  const shadowGeo = new THREE.PlaneGeometry(2.6, 5.2);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.58,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.set(0, 0.02, 0);
  root.add(shadowMesh);

  // Materials (Varied roughness & metalness >= 0.25 across adjacent parts)
  const primaryPaintMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(livery.primaryHex),
    metalness: livery.metalness,
    roughness: livery.roughness,
    clearcoat: livery.clearcoat,
    clearcoatRoughness: 0.08,
  });
  paintMaterials.push(primaryPaintMat);

  const carbonMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(livery.secondaryHex),
    metalness: 0.35,
    roughness: 0.62,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(livery.accentHex),
    metalness: 0.5,
    roughness: 0.3,
    emissive: new THREE.Color(livery.accentHex),
    emissiveIntensity: 0.22,
  });
  accentMaterials.push(accentMat);

  // Optical Glass Canopy (MeshPhysicalMaterial transmission + depthWrite: false)
  const canopyGlassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0F172A'),
    metalness: 0.1,
    roughness: 0.06,
    transmission: 0.88,
    ior: 1.52,
    thickness: 0.8,
    clearcoat: 1.0,
    transparent: true,
    depthWrite: false,
  });

  // --- PART 1: Sculpted Aerodynamic Monocoque Lower Hull (ExtrudeGeometry with bevels) ---
  const profileShape = new THREE.Shape();
  profileShape.moveTo(-2.15, 0.16);
  profileShape.lineTo(2.15, 0.18);
  profileShape.lineTo(2.22, 0.48);
  profileShape.lineTo(1.35, 0.68);
  profileShape.lineTo(-0.85, 0.66);
  profileShape.lineTo(-1.95, 0.42);
  profileShape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(profileShape, {
    depth: 1.68,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.08,
    bevelThickness: 0.08,
  });
  hullGeo.center();
  // Rotate so length is along Z (-Z is forward), width along X, height along Y
  hullGeo.rotateY(Math.PI / 2);
  const hullMesh = new THREE.Mesh(hullGeo, primaryPaintMat);
  hullMesh.position.set(0, 0.44, 0);
  hullMesh.castShadow = isPlayer;
  hullMesh.receiveShadow = true;
  bodyTiltGroup.add(hullMesh);

  // --- PART 2: Flared Fender Haunches & Side Aero Pods ---
  const fenderGeo = new THREE.BoxGeometry(2.04, 0.34, 3.85);
  const fenderMesh = new THREE.Mesh(fenderGeo, primaryPaintMat);
  fenderMesh.position.set(0, 0.41, 0.05);
  fenderMesh.castShadow = isPlayer;
  bodyTiltGroup.add(fenderMesh);

  // --- PART 3: Carbon Front Splitter & Rear Venturi Diffuser ---
  const splitterGeo = new THREE.BoxGeometry(2.08, 0.08, 4.46);
  const splitterMesh = new THREE.Mesh(splitterGeo, carbonMat);
  splitterMesh.position.set(0, 0.18, 0.02);
  bodyTiltGroup.add(splitterMesh);

  // Livery Accent Racing Stripe along hood & roof
  const stripeGeo = new THREE.BoxGeometry(0.28, 0.04, 3.9);
  const stripeMesh = new THREE.Mesh(stripeGeo, accentMat);
  stripeMesh.position.set(0, 0.75, 0.05);
  bodyTiltGroup.add(stripeMesh);

  // --- PART 4: Teardrop Optical Glass Cockpit Canopy ---
  const canopyShape = new THREE.Shape();
  canopyShape.moveTo(-0.95, 0);
  canopyShape.quadraticCurveTo(-0.3, 0.46, 0.65, 0.38);
  canopyShape.lineTo(1.15, 0);
  canopyShape.closePath();

  const canopyGeo = new THREE.ExtrudeGeometry(canopyShape, {
    depth: 1.16,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.09,
    bevelThickness: 0.09,
  });
  canopyGeo.center();
  canopyGeo.rotateY(Math.PI / 2);
  const canopyMesh = new THREE.Mesh(canopyGeo, canopyGlassMat);
  canopyMesh.position.set(0, 0.86, 0.18);
  canopyMesh.renderOrder = 2;
  bodyTiltGroup.add(canopyMesh);

  // Interior dark cockpit tub & driver helmet silhouette inside glass
  const interiorGeo = new THREE.BoxGeometry(1.05, 0.25, 1.4);
  const interiorMesh = new THREE.Mesh(interiorGeo, carbonMat);
  interiorMesh.position.set(0, 0.68, 0.18);
  bodyTiltGroup.add(interiorMesh);

  // --- PART 5 & 6: Swan-Neck Carbon GT Rear Wing & Twin Struts ---
  const wingDeckGeo = new THREE.BoxGeometry(2.06, 0.06, 0.36);
  const wingDeck = new THREE.Mesh(wingDeckGeo, carbonMat);
  wingDeck.position.set(0, 1.04, 1.98);
  wingDeck.rotation.x = 0.14;
  wingDeck.castShadow = isPlayer;
  bodyTiltGroup.add(wingDeck);

  // Wing endplates in accent livery color
  const endplateGeo = new THREE.BoxGeometry(0.04, 0.26, 0.46);
  const leftPlate = new THREE.Mesh(endplateGeo, accentMat);
  leftPlate.position.set(-1.03, 1.02, 1.98);
  const rightPlate = new THREE.Mesh(endplateGeo, accentMat);
  rightPlate.position.set(1.03, 1.02, 1.98);
  bodyTiltGroup.add(leftPlate, rightPlate);

  const strutGeo = new THREE.BoxGeometry(0.05, 0.36, 0.22);
  const leftStrut = new THREE.Mesh(strutGeo, carbonMat);
  leftStrut.position.set(-0.46, 0.85, 1.92);
  const rightStrut = new THREE.Mesh(strutGeo, carbonMat);
  rightStrut.position.set(0.46, 0.85, 1.92);
  bodyTiltGroup.add(leftStrut, rightStrut);

  // --- PART 7: LED DRL Headlights & Volumetric Night Light Cones ---
  const headLightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color('#E0F2FE'),
    emissiveIntensity: 2.8,
    roughness: 0.1,
    toneMapped: false,
  });
  const hlGeo = new THREE.BoxGeometry(0.42, 0.07, 0.12);
  const leftHl = new THREE.Mesh(hlGeo, headLightMat);
  leftHl.position.set(-0.68, 0.46, -2.14);
  leftHl.rotation.y = 0.15;
  const rightHl = new THREE.Mesh(hlGeo, headLightMat);
  rightHl.position.set(0.68, 0.46, -2.14);
  rightHl.rotation.y = -0.15;
  bodyTiltGroup.add(leftHl, rightHl);

  // Subtle volumetric light cones on the road for Midnight mode
  const coneGeo = new THREE.ConeGeometry(1.6, 14, 16, 1, true);
  coneGeo.rotateX(Math.PI / 2);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xbae6fd,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const leftCone = new THREE.Mesh(coneGeo, coneMat);
  leftCone.position.set(-0.7, 0.22, -9.2);
  const rightCone = new THREE.Mesh(coneGeo, coneMat);
  rightCone.position.set(0.7, 0.22, -9.2);
  bodyTiltGroup.add(leftCone, rightCone);
  headlightCones.push(leftCone, rightCone);

  // --- PART 8: Full-Width Rear LED Tail & Brake Light Strip ---
  const brakeLightMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#EF4444'),
    emissive: new THREE.Color('#FF2A4B'),
    emissiveIntensity: 2.2,
    roughness: 0.2,
    toneMapped: false,
  });
  const tailGeo = new THREE.BoxGeometry(1.76, 0.09, 0.08);
  const tailMesh = new THREE.Mesh(tailGeo, brakeLightMaterial);
  tailMesh.position.set(0, 0.56, 2.18);
  bodyTiltGroup.add(tailMesh);

  // --- PART 9 & 10: Twin Titanium Exhausts & Nitro Boost Plasma Cones ---
  const exhaustGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.24, 12);
  exhaustGeo.rotateX(Math.PI / 2);
  const exhaustMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.9,
    roughness: 0.2,
  });

  const flameGeo = new THREE.ConeGeometry(0.11, 0.95, 12);
  flameGeo.rotateX(Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  [-0.36, 0.36].forEach((xOffset) => {
    const pipe = new THREE.Mesh(exhaustGeo, exhaustMat);
    pipe.position.set(xOffset, 0.32, 2.22);
    bodyTiltGroup.add(pipe);

    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(xOffset, 0.32, 2.75);
    flame.scale.set(0.001, 0.001, 0.001);
    bodyTiltGroup.add(flame);
    nitroFlames.push(flame);
  });

  // --- PART 11: 4 Multi-Part Wheel Assemblies (Tire + Brushed Alloy Rim + Brake Hub) ---
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.85,
    metalness: 0.08,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(livery.rimHex),
    metalness: 0.92,
    roughness: 0.18,
  });
  rimMaterials.push(rimMat);

  const wheelPositions: { x: number; y: number; z: number; isFront: boolean }[] = [
    { x: -0.98, y: 0.35, z: -1.36, isFront: true },
    { x: 0.98, y: 0.35, z: -1.36, isFront: true },
    { x: -1.01, y: 0.37, z: 1.34, isFront: false },
    { x: 1.01, y: 0.37, z: 1.34, isFront: false },
  ];

  const tireGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.32, 24);
  tireGeo.rotateZ(Math.PI / 2);
  const rimOuterGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.33, 16);
  rimOuterGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.34, 0.44, 0.05);

  wheelPositions.forEach((wp) => {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(wp.x, wp.y, wp.z);
    if (!wp.isFront) {
      steerPivot.scale.set(1.08, 1.06, 1.06);
    }
    root.add(steerPivot);

    if (wp.isFront) {
      frontWheelPivots.push(steerPivot);
    }

    const spinGroup = new THREE.Group();
    steerPivot.add(spinGroup);
    wheelSpinMeshes.push(spinGroup);

    const tireMesh = new THREE.Mesh(tireGeo, tireMat);
    const rimMesh = new THREE.Mesh(rimOuterGeo, rimMat);
    const spoke1 = new THREE.Mesh(spokeGeo, accentMat);
    const spoke2 = new THREE.Mesh(spokeGeo, rimMat);
    spoke2.rotation.x = Math.PI / 2;

    spinGroup.add(tireMesh, rimMesh, spoke1, spoke2);
  });

  return {
    root,
    bodyTiltGroup,
    paintMaterials,
    accentMaterials,
    rimMaterials,
    brakeLightMaterial,
    frontWheelPivots,
    wheelSpinMeshes,
    nitroFlames,
    headlightCones,
  };
}

export function applyLiveryToCarRig(rig: CompositeCarRig, livery: CarLivery): void {
  rig.paintMaterials.forEach((mat) => {
    mat.color.set(livery.primaryHex);
    mat.metalness = livery.metalness;
    mat.roughness = livery.roughness;
    mat.clearcoat = livery.clearcoat;
  });
  rig.accentMaterials.forEach((mat) => {
    mat.color.set(livery.accentHex);
    mat.emissive.set(livery.accentHex);
  });
  rig.rimMaterials.forEach((mat) => {
    mat.color.set(livery.rimHex);
  });
}
