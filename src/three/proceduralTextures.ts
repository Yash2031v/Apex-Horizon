import * as THREE from 'three';

export function createAsphaltTexture(
  maxAnisotropy: number,
  curbPrimaryHex: string,
  curbSecondaryHex: string,
  isMidnight: boolean
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Base sun-baked motorsport asphalt (calibrated for ACESFilmic tone mapping so road doesn't crush to black)
  ctx.fillStyle = isMidnight ? '#181E2C' : '#2D323B';
  ctx.fillRect(0, 0, 1024, 1024);

  // Fine mineral aggregate grain & micro-texture across the asphalt
  for (let i = 0; i < 22000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const v = isMidnight
      ? 28 + Math.floor(Math.random() * 24)
      : 52 + Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgba(${v}, ${v + 3}, ${v + 8}, 0.32)`;
    ctx.fillRect(x, y, 2, 3);
  }

  // Darker rubbered-in racing line tracks in the two main lanes
  const gradLeft = ctx.createLinearGradient(180, 0, 420, 0);
  gradLeft.addColorStop(0, 'rgba(0,0,0,0)');
  gradLeft.addColorStop(0.5, 'rgba(10,12,18,0.28)');
  gradLeft.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradLeft;
  ctx.fillRect(180, 0, 240, 1024);

  const gradRight = ctx.createLinearGradient(604, 0, 844, 0);
  gradRight.addColorStop(0, 'rgba(0,0,0,0)');
  gradRight.addColorStop(0.5, 'rgba(10,12,18,0.28)');
  gradRight.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradRight;
  ctx.fillRect(604, 0, 240, 1024);

  // Sandy dust shoulder bleed near outer curbs (warm ochre instead of heavy red)
  if (!isMidnight) {
    const leftDust = ctx.createLinearGradient(44, 0, 145, 0);
    leftDust.addColorStop(0, 'rgba(204, 132, 72, 0.34)');
    leftDust.addColorStop(1, 'rgba(204, 132, 72, 0)');
    ctx.fillStyle = leftDust;
    ctx.fillRect(44, 0, 101, 1024);

    const rightDust = ctx.createLinearGradient(1024 - 145, 0, 1024 - 44, 0);
    rightDust.addColorStop(0, 'rgba(204, 132, 72, 0)');
    rightDust.addColorStop(1, 'rgba(204, 132, 72, 0.34)');
    ctx.fillStyle = rightDust;
    ctx.fillRect(1024 - 145, 0, 101, 1024);
  }

  // Outer rumble kerbs (left & right edges) - slightly darker red (#B91C1C) and warm off-white (#D6D3CD) so they never clip to pure white
  const safePrimaryCurb =
    curbPrimaryHex.toUpperCase() === '#EF4444' ||
    curbPrimaryHex.toUpperCase() === '#EA580C'
      ? '#B91C1C'
      : curbPrimaryHex;
  const safeSecondaryWhite =
    curbSecondaryHex.toUpperCase() === '#F8FAFC' ||
    curbSecondaryHex.toUpperCase() === '#E2E8F0'
      ? '#D6D3CD'
      : curbSecondaryHex;
  const stripeCount = 8;
  const stripeHeight = 1024 / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? safePrimaryCurb : safeSecondaryWhite;
    ctx.fillRect(0, i * stripeHeight, 44, stripeHeight);
    ctx.fillRect(1024 - 44, i * stripeHeight, 44, stripeHeight);
    // Subtle dark bevel seam between kerb blocks so white blocks keep surface detail
    ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
    ctx.fillRect(0, i * stripeHeight, 44, 4);
    ctx.fillRect(1024 - 44, i * stripeHeight, 44, 4);
  }

  // Controlled matte track boundary lines (no HDR blowout)
  ctx.fillStyle = isMidnight ? '#38BDF8' : '#CBD5E1';
  ctx.fillRect(48, 0, 10, 1024);
  ctx.fillRect(1024 - 58, 0, 10, 1024);

  // Center dashed lane dividers (3 lanes)
  ctx.fillStyle = isMidnight
    ? 'rgba(56, 189, 248, 0.48)'
    : 'rgba(203, 213, 225, 0.48)';
  for (let i = 0; i < 4; i++) {
    const y = i * 256 + 36;
    ctx.fillRect(341 - 5, y, 10, 140);
    ctx.fillRect(683 - 5, y, 10, 140);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Layered Warm Orange / Amber / Ochre sedimentary sandstone banding texture with cool slate shadow striations.
 */
export function createSandstoneBandedTexture(
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  const bands: [number, string][] = [
    [0.0, '#784421'],
    [0.12, '#9A5B28'],
    [0.22, '#C27129'],
    [0.31, '#D97706'],
    [0.39, '#B45309'],
    [0.48, '#854D27'],
    [0.58, '#EA580C'],
    [0.67, '#F59E0B'],
    [0.76, '#A15C27'],
    [0.88, '#B46529'],
    [1.0, '#5C3A21'],
  ];
  bands.forEach(([stop, hex]) => grad.addColorStop(stop, hex));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Fine horizontal sedimentary striations with warm highlights & cool slate-shadow crevices
  for (let y = 0; y < 512; y += 3) {
    const alpha = 0.06 + (Math.sin(y * 0.25) * 0.5 + 0.5) * 0.11;
    ctx.fillStyle =
      y % 6 === 0
        ? `rgba(254, 215, 170, ${alpha})`
        : `rgba(30, 41, 59, ${alpha})`;
    ctx.fillRect(0, y, 512, 2);
  }

  // Rock grain noise speckles
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.fillStyle =
      Math.random() > 0.5
        ? 'rgba(255,237,213,0.08)'
        : 'rgba(30,41,59,0.12)';
    ctx.fillRect(x, y, 3, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Sand/dirt ground texture with multi-scale noise variation, coarse gravel patches, and mineral flecks
 * for warm orange-ochre highlights and cool slate shadows.
 */
export function createDesertSandGroundTexture(
  maxAnisotropy: number,
  baseHex: string,
  isCanyon: boolean
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 512, 512);

  // 1. Multi-scale organic noise blotches (warm amber-tan, ochre, and cool slate shadow pockets)
  for (let i = 0; i < 280; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 14 + Math.random() * 56;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    if (isCanyon) {
      g.addColorStop(
        0,
        i % 3 === 0
          ? 'rgba(245, 158, 11, 0.24)'
          : i % 3 === 1
            ? 'rgba(45, 55, 72, 0.24)'
            : 'rgba(186, 200, 224, 0.16)'
      );
    } else {
      g.addColorStop(
        0,
        i % 2 === 0 ? 'rgba(203, 213, 225, 0.10)' : 'rgba(2, 6, 23, 0.24)'
      );
    }
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Embedded Coarse Gravel & Crushed-Stone Patches
  for (let p = 0; p < 42; p++) {
    const px = Math.random() * 512;
    const py = Math.random() * 512;
    const patchRadius = 18 + Math.random() * 32;

    const patchBg = ctx.createRadialGradient(px, py, 2, px, py, patchRadius);
    patchBg.addColorStop(0, 'rgba(100, 92, 88, 0.34)');
    patchBg.addColorStop(1, 'rgba(100, 92, 88, 0)');
    ctx.fillStyle = patchBg;
    ctx.beginPath();
    ctx.arc(px, py, patchRadius, 0, Math.PI * 2);
    ctx.fill();

    for (let s = 0; s < 110; s++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * patchRadius;
      const gx = (px + Math.cos(ang) * dist + 512) % 512;
      const gy = (py + Math.sin(ang) * dist + 512) % 512;
      ctx.fillStyle =
        s % 3 === 0
          ? 'rgba(203, 213, 225, 0.32)'
          : s % 3 === 1
            ? 'rgba(71, 85, 105, 0.38)'
            : 'rgba(24, 24, 27, 0.35)';
      ctx.fillRect(gx, gy, 2.6, 2.6);
    }
  }

  // 3. Subtle wind-blown sand ripples
  ctx.strokeStyle = isCanyon
    ? 'rgba(251, 191, 36, 0.08)'
    : 'rgba(186, 230, 253, 0.06)';
  ctx.lineWidth = 2;
  for (let y = 8; y < 512; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) {
      ctx.lineTo(x, y + Math.sin(x * 0.05 + y) * 3);
    }
    ctx.stroke();
  }

  // 4. Fine pebble & quartz grit noise for moonlit sheen
  for (let i = 0; i < 16000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.fillStyle =
      Math.random() > 0.52
        ? 'rgba(226, 232, 240, 0.14)'
        : 'rgba(35, 12, 6, 0.18)';
    ctx.fillRect(x, y, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(42, 42);
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Linear-space roughness map so gravel & mineral veins catch a subtle moonlit grazing sheen.
 */
export function createGroundRoughnessSheenMap(
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgb(190, 190, 190)';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 130; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 10 + Math.random() * 28;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    const val = i % 2 === 0 ? 110 : 235;
    g.addColorStop(0, `rgba(${val}, ${val}, ${val}, 0.58)`);
    g.addColorStop(1, 'rgba(190, 190, 190, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(42, 42);
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Organic gravel patch decal texture for trackside shoulders and runoff zones.
 */
export function createGravelPatchDecalTexture(
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 256);

  const grad = ctx.createRadialGradient(128, 128, 16, 128, 128, 118);
  grad.addColorStop(0, 'rgba(120, 113, 108, 0.76)');
  grad.addColorStop(0.55, 'rgba(87, 83, 78, 0.54)');
  grad.addColorStop(0.85, 'rgba(68, 64, 60, 0.22)');
  grad.addColorStop(1, 'rgba(68, 64, 60, 0)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 1100; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * 108;
    const x = 128 + Math.cos(ang) * dist;
    const y = 128 + Math.sin(ang) * dist;
    ctx.fillStyle =
      i % 3 === 0
        ? 'rgba(226, 232, 240, 0.36)'
        : i % 3 === 1
          ? 'rgba(148, 163, 184, 0.32)'
          : 'rgba(28, 25, 23, 0.42)';
    ctx.fillRect(x, y, 2.8, 2.8);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Decal texture for rubber tire skid-mark patches near heavy braking zones and track edges.
 */
export function createTireSkidPatchTexture(
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 512);

  const drawTrack = (xCenter: number) => {
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, 'rgba(10, 12, 16, 0)');
    grad.addColorStop(0.2, 'rgba(10, 12, 16, 0.65)');
    grad.addColorStop(0.8, 'rgba(10, 12, 16, 0.65)');
    grad.addColorStop(1, 'rgba(10, 12, 16, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(xCenter - 18, 16, 36, 480);
  };

  drawTrack(74);
  drawTrack(182);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Trackside sponsor billboard & corner distance marker texture.
 */
export function createSponsorBannerTexture(
  maxAnisotropy: number,
  label: string,
  bgHex: string,
  accentHex: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 128);

  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 512, 14);
  ctx.fillRect(0, 114, 512, 14);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(18, 114);
  ctx.lineTo(54, 14);
  ctx.lineTo(82, 14);
  ctx.lineTo(46, 114);
  ctx.fill();

  ctx.fillStyle = '#E2E8F0';
  ctx.font = 'bold 48px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 66);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

export function createStartFinishTexture(
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const cols = 16;
  const rows = 4;
  const w = canvas.width / cols;
  const h = canvas.height / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#CBD5E1' : '#0F172A';
      ctx.fillRect(c * w, r * h, w, h);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 512);
  ctx.save();
  ctx.translate(128, 256);
  ctx.scale(1, 1.85);

  const grad = ctx.createRadialGradient(0, 0, 18, 0, 0, 118);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.55)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 118, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Soft, semi-transparent fractal-noise cloud sprite texture with feathered radial alpha falloff.
 */
export function createSoftCloudSpriteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 512, 256);

  const puffs = [
    { x: 140, y: 142, rx: 95, ry: 54, alpha: 0.42 },
    { x: 215, y: 118, rx: 115, ry: 68, alpha: 0.55 },
    { x: 295, y: 124, rx: 110, ry: 64, alpha: 0.52 },
    { x: 370, y: 145, rx: 90, ry: 50, alpha: 0.38 },
    { x: 256, y: 148, rx: 145, ry: 52, alpha: 0.46 },
    { x: 185, y: 135, rx: 75, ry: 44, alpha: 0.36 },
    { x: 330, y: 138, rx: 80, ry: 45, alpha: 0.36 },
  ];

  puffs.forEach((p) => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(p.rx / 60, p.ry / 60);
    const grad = ctx.createRadialGradient(0, -8, 4, 0, 0, 60);
    grad.addColorStop(0, `rgba(255, 232, 214, ${p.alpha})`);
    grad.addColorStop(0.45, `rgba(251, 176, 145, ${p.alpha * 0.72})`);
    grad.addColorStop(0.78, `rgba(192, 108, 132, ${p.alpha * 0.32})`);
    grad.addColorStop(1, 'rgba(192, 108, 132, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  for (let i = 0; i < 65; i++) {
    const angle = (i / 65) * Math.PI * 2;
    const cx = 256 + Math.cos(angle * 2.3) * (120 * Math.sin(i));
    const cy = 132 + Math.sin(angle * 1.7) * 32;
    const r = 22 + (i % 5) * 8;
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    g.addColorStop(0, 'rgba(255, 215, 190, 0.12)');
    g.addColorStop(1, 'rgba(255, 215, 190, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Soft radial Gaussian circular sprite texture for additive dust motes and gravel plumes.
 */
export function createSoftParticleSpriteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 128, 128);
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.32, 'rgba(255, 245, 230, 0.68)');
  grad.addColorStop(0.68, 'rgba(255, 220, 185, 0.22)');
  grad.addColorStop(1, 'rgba(255, 200, 150, 0.0)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
