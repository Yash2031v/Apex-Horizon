import React, { useMemo } from 'react';
import * as THREE from 'three';
import { CarLivery, RaceTelemetry, TRACK_CONFIGS, TrackTheme } from '../types/racing';
import { evaluateTrackFrame, TRACK_LENGTH, TrackFrame } from '../three/trackBuilder';

interface TrackMinimapProps {
  telemetry: RaceTelemetry;
  trackTheme: TrackTheme;
  livery: CarLivery;
}

const VIEW_WIDTH = 190;
const VIEW_HEIGHT = 154;
const PADDING = 18;

const _tempFrame: TrackFrame = {
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  bankAngle: 0,
  curvature: 0,
};

interface MapProjection {
  fullPath: string;
  sectorPaths: [string, string, string];
  sectorBoundaries: { x: number; y: number; label: string }[];
  startFinish: { x: number; y: number; nx: number; ny: number };
  boostPadPoints: { x: number; y: number }[];
  projectPoint: (
    trackDistance: number,
    lateralOffset: number
  ) => { x: number; y: number; angleDeg: number };
}

export const TrackMinimap: React.FC<TrackMinimapProps> = ({
  telemetry,
  trackTheme,
  livery,
}) => {
  const trackConfig = TRACK_CONFIGS[trackTheme];

  // Precompute the 2D circuit projection & sector SVG paths once
  const mapProjection = useMemo<MapProjection>(() => {
    const sampleCount = 180;
    const rawPts: { x: number; z: number; nx: number; nz: number }[] = [];

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i <= sampleCount; i++) {
      const s = (i / sampleCount) * TRACK_LENGTH;
      evaluateTrackFrame(s, _tempFrame);
      const x = _tempFrame.position.x;
      const z = _tempFrame.position.z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      rawPts.push({
        x,
        z,
        nx: _tempFrame.right.x,
        nz: _tempFrame.right.z,
      });
    }

    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const scale = Math.min(
      (VIEW_WIDTH - PADDING * 2) / spanX,
      (VIEW_HEIGHT - PADDING * 2) / spanZ
    );

    const offsetX = (VIEW_WIDTH - spanX * scale) * 0.5;
    const offsetY = (VIEW_HEIGHT - spanZ * scale) * 0.5;

    const toSvg = (wx: number, wz: number) => ({
      x: Number(((wx - minX) * scale + offsetX).toFixed(2)),
      y: Number(((wz - minZ) * scale + offsetY).toFixed(2)),
    });

    const projectedPts = rawPts.map((pt) => toSvg(pt.x, pt.z));

    const buildPathSegment = (startIdx: number, endIdx: number) => {
      let d = '';
      for (let i = startIdx; i <= endIdx; i++) {
        const p = projectedPts[i];
        d += i === startIdx ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`;
      }
      return d;
    };

    const fullPath = `${buildPathSegment(0, sampleCount)} Z`;
    const s1End = Math.floor(sampleCount / 3);
    const s2End = Math.floor((sampleCount * 2) / 3);

    const sectorPaths: [string, string, string] = [
      buildPathSegment(0, s1End),
      buildPathSegment(s1End, s2End),
      buildPathSegment(s2End, sampleCount),
    ];

    const sectorBoundaries = [
      { ...projectedPts[0], label: 'S1' },
      { ...projectedPts[s1End], label: 'S2' },
      { ...projectedPts[s2End], label: 'S3' },
    ];

    const sf0 = rawPts[0];
    const sfSvg = toSvg(sf0.x, sf0.z);

    const boostDistances = [260, 640, 1080, 1460, 1920, 2220];
    const boostPadPoints = boostDistances.map((dist) => {
      evaluateTrackFrame(dist, _tempFrame);
      return toSvg(_tempFrame.position.x, _tempFrame.position.z);
    });

    const projectPoint = (trackDistance: number, lateralOffset: number) => {
      evaluateTrackFrame(trackDistance, _tempFrame);
      // Exaggerate lateral offset slightly on minimap so side-by-side overtaking is visible
      const wx = _tempFrame.position.x + _tempFrame.right.x * lateralOffset * 1.8;
      const wz = _tempFrame.position.z + _tempFrame.right.z * lateralOffset * 1.8;
      const svgPt = toSvg(wx, wz);
      const angleDeg =
        (Math.atan2(_tempFrame.tangent.z, _tempFrame.tangent.x) * 180) / Math.PI;
      return {
        x: svgPt.x,
        y: svgPt.y,
        angleDeg,
      };
    };

    return {
      fullPath,
      sectorPaths,
      sectorBoundaries,
      startFinish: {
        x: sfSvg.x,
        y: sfSvg.y,
        nx: sf0.nx,
        ny: sf0.nz,
      },
      boostPadPoints,
      projectPoint,
    };
  }, []);

  // Compute live positions for AI rivals and Player
  const rivalMarkers = telemetry.standings
    .filter((s) => !s.isPlayer)
    .map((rival) => {
      const pos = mapProjection.projectPoint(
        rival.trackDistance,
        rival.lateralOffset
      );
      return {
        ...rival,
        ...pos,
      };
    });

  const playerEntry = telemetry.standings.find((s) => s.isPlayer);
  const playerMarker = mapProjection.projectPoint(
    playerEntry ? playerEntry.trackDistance : telemetry.lapProgress * TRACK_LENGTH,
    playerEntry ? playerEntry.lateralOffset : 0
  );

  const activeSector = telemetry.sectorIndex; // 0, 1, 2
  const sf = mapProjection.startFinish;

  return (
    <aside
      aria-label="Real-time circuit minimap"
      className="pointer-events-auto absolute top-16 right-4 z-10 w-52 rounded-xl bg-[#0B0F19]/92 border border-white/15 p-3 shadow-xl select-none"
    >
      {/* Minimap Header */}
      <div className="flex items-center justify-between text-[11px] pb-1.5 border-b border-white/10">
        <span className="font-display font-bold text-white tracking-tight truncate">
          Circuit Radar
        </span>
        <span className="font-mono-tabular text-slate-400 whitespace-nowrap">
          Sector <strong className="text-amber-400">S{activeSector + 1}</strong> ·{' '}
          {Math.round(telemetry.lapProgress * 100)}%
        </span>
      </div>

      {/* SVG Real-Time Circuit Layout */}
      <div className="relative w-full flex items-center justify-center py-1">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="w-full h-auto overflow-visible"
        >
          {/* Outer Track Border Shadow */}
          <path
            d={mapProjection.fullPath}
            fill="none"
            stroke="#020617"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Base Circuit Asphalt Track */}
          <path
            d={mapProjection.fullPath}
            fill="none"
            stroke="#334155"
            strokeWidth="6.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Active Sector Highlight */}
          <path
            d={mapProjection.sectorPaths[activeSector]}
            fill="none"
            stroke={trackConfig.curbPrimaryHex}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.85"
          />

          {/* Center Racing Line */}
          <path
            d={mapProjection.fullPath}
            fill="none"
            stroke="#94A3B8"
            strokeWidth="1"
            strokeDasharray="3 3"
            strokeOpacity="0.45"
          />

          {/* Nitro Boost Pad Ticks */}
          {mapProjection.boostPadPoints.map((bp, idx) => (
            <circle
              key={idx}
              cx={bp.x}
              cy={bp.y}
              r="2.1"
              fill="#06B6D4"
              opacity="0.85"
            />
          ))}

          {/* Sector Split Labels (S1, S2, S3) */}
          {mapProjection.sectorBoundaries.map((sb, idx) => (
            <g key={sb.label}>
              <circle
                cx={sb.x}
                cy={sb.y}
                r="2.5"
                fill={idx === activeSector ? '#F59E0B' : '#64748B'}
              />
            </g>
          ))}

          {/* Start / Finish Line Bar */}
          <line
            x1={sf.x - sf.nx * 6.5}
            y1={sf.y - sf.ny * 6.5}
            x2={sf.x + sf.nx * 6.5}
            y2={sf.y + sf.ny * 6.5}
            stroke="#F8FAFC"
            strokeWidth="2.6"
          />

          {/* AI Rival Car Markers */}
          {rivalMarkers.map((rv) => (
            <g
              key={rv.id}
              transform={`translate(${rv.x}, ${rv.y})`}
            >
              <circle
                r="3.6"
                fill={rv.colorHex}
                stroke="#080A0F"
                strokeWidth="1.2"
              />
              <text
                y="-5.5"
                textAnchor="middle"
                fill="#CBD5E1"
                fontSize="7.5"
                fontFamily="JetBrains Mono, monospace"
                fontWeight="700"
              >
                {rv.teamCode}
              </text>
            </g>
          ))}

          {/* Player Car Directional Arrow Marker (Rendered on top) */}
          <g
            transform={`translate(${playerMarker.x}, ${playerMarker.y}) rotate(${playerMarker.angleDeg})`}
          >
            <circle
              r="7.5"
              fill={livery.primaryHex}
              fillOpacity="0.24"
            />
            <polygon
              points="6.5,0 -4.5,-4.2 -2.4,0 -4.5,4.2"
              fill={livery.primaryHex}
              stroke="#FFFFFF"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      </div>

      {/* Minimap Footer Legend */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-white/10 font-mono-tabular">
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-xs inline-block"
            style={{ backgroundColor: livery.primaryHex }}
          />
          <span className="text-white font-semibold">YOU (P{telemetry.position})</span>
        </div>
        <span>{trackConfig.lengthKm}</span>
      </div>
    </aside>
  );
};
