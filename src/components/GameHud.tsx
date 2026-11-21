import React, { useEffect, useRef, useState } from 'react';
import {
  computeMouseSteerAxes,
  formatDistance,
  MOUSE_DEADZONE_PX,
} from '../game/flightMath';
import type { HudSnapshot } from '../game/types';

interface GameHudProps {
  hud: HudSnapshot;
  uiOverlayOpen: boolean;
  radarCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onDockNow: () => void;
  onToggleAutoDock: () => void;
  onToggleCruise: () => void;
  onCycleTarget: () => void;
  onSelectWaypoint: (id: string) => void;
  onSelectTarget: (id: string) => void;
  onToggleStarMap: () => void;
  onTriggerJump: () => void;
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startDeg));
  const y1 = cy + r * Math.sin(rad(startDeg));
  const x2 = cx + r * Math.cos(rad(endDeg));
  const y2 = cy + r * Math.sin(rad(endDeg));
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  uiOverlayOpen,
  radarCanvasRef,
  onDockNow,
  onToggleAutoDock,
  onToggleCruise,
  onCycleTarget,
  onSelectWaypoint,
  onSelectTarget,
  onToggleStarMap,
  onTriggerJump,
}) => {
  const [showControls, setShowControls] = useState(false);
  const [targetPanelExpanded, setTargetPanelExpanded] = useState(false);
  const prevSystemIdRef = useRef(hud.currentSystemId);
  const reticleRef = useRef<HTMLDivElement | null>(null);
  const tetherLineRef = useRef<SVGLineElement | null>(null);
  const deadzoneRingRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (prevSystemIdRef.current !== hud.currentSystemId) {
      setTargetPanelExpanded(false);
      prevSystemIdRef.current = hud.currentSystemId;
    }
  }, [hud.currentSystemId]);

  const showVirtualJoystick =
    hud.phase === 'playing' &&
    !hud.isDocked &&
    hud.mouseSteerEnabled &&
    !uiOverlayOpen &&
    !hud.autoDockActive;

  useEffect(() => {
    const resetVisuals = () => {
      if (reticleRef.current) {
        reticleRef.current.style.transform = 'translate(-50%, -50%) translate3d(0px, 0px, 0px)';
        reticleRef.current.dataset.active = 'false';
      }
      if (tetherLineRef.current) {
        tetherLineRef.current.setAttribute('x2', '0');
        tetherLineRef.current.setAttribute('y2', '0');
        tetherLineRef.current.style.opacity = '0';
      }
      if (deadzoneRingRef.current) {
        deadzoneRingRef.current.dataset.active = 'false';
      }
    };

    resetVisuals();
    if (!showVirtualJoystick) return;

    const onMouseMove = (e: MouseEvent) => {
      const cx = window.innerWidth * 0.5;
      const cy = window.innerHeight * 0.5;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const steer = computeMouseSteerAxes(dx, dy);

      if (reticleRef.current) {
        reticleRef.current.style.transform = `translate(-50%, -50%) translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0px)`;
        reticleRef.current.dataset.active = steer.inDeadzone ? 'false' : 'true';
      }
      if (tetherLineRef.current) {
        if (steer.inDeadzone) {
          tetherLineRef.current.style.opacity = '0';
        } else {
          const dist = Math.hypot(dx, dy) || 1;
          const startX = (dx / dist) * MOUSE_DEADZONE_PX;
          const startY = (dy / dist) * MOUSE_DEADZONE_PX;
          tetherLineRef.current.setAttribute('x1', startX.toFixed(1));
          tetherLineRef.current.setAttribute('y1', startY.toFixed(1));
          tetherLineRef.current.setAttribute('x2', dx.toFixed(1));
          tetherLineRef.current.setAttribute('y2', dy.toFixed(1));
          tetherLineRef.current.style.opacity = (0.28 + steer.magnitude * 0.48).toFixed(2);
        }
      }
      if (deadzoneRingRef.current) {
        deadzoneRingRef.current.dataset.active = steer.inDeadzone ? 'false' : 'true';
      }
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [showVirtualJoystick]);

  const throttlePct = Math.round(hud.throttle * 100);
  const hullPct = Math.round((hud.hull / hud.maxHull) * 100);
  const shieldPct = Math.round((hud.shield / hud.maxShield) * 100);

  const throttleZeroDeg = 148;
  const throttleTopDeg = 230;
  const throttleRevDeg = 130;
  const throttleEndDeg =
    hud.throttle >= 0
      ? throttleZeroDeg + hud.throttle * (throttleTopDeg - throttleZeroDeg)
      : throttleZeroDeg - (Math.abs(hud.throttle) / 0.35) * (throttleZeroDeg - throttleRevDeg);

  const hullStartDeg = 48;
  const hullMaxDeg = -48;
  const hullEndDeg = hullStartDeg + (hullPct / 100) * (hullMaxDeg - hullStartDeg);
  const shieldEndDeg = hullStartDeg + (shieldPct / 100) * (hullMaxDeg - hullStartDeg);

  const target = hud.target;
  const docking = hud.docking;
  const showDockButton = docking.isReadyToDock && docking.distanceMeters <= 180;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Hyperspace Tunnel Edge Glow */}
      {hud.hyperspaceCountdown !== null && (
        <div
          className="fixed inset-0 z-10 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at center, rgba(var(--hud-accent-rgb), 0) 46%, rgba(var(--hud-accent-rgb), 0.24) 100%)',
          }}
        />
      )}

      {/* Hyperspace Screen-Flash Overlay */}
      {hud.hyperspaceFlash > 0.01 && (
        <div
          className="fixed inset-0 z-40 pointer-events-none"
          style={{
            backgroundColor: 'var(--hud-accent-bright)',
            opacity: Math.min(1, hud.hyperspaceFlash),
          }}
        />
      )}

      {/* High-Contrast Red Diamond Hostile Pirate Ship Brackets */}
      {hud.hostileMarkers.map((m) => (
        <button
          key={m.id}
          type="button"
          tabIndex={-1}
          data-testid={`hostile-bracket-${m.id}`}
          aria-label={`Target ${m.name} (${formatDistance(m.distanceMeters)})`}
          onClick={(e) => {
            e.currentTarget.blur();
            onSelectTarget(m.id);
          }}
          style={{
            left: `${m.screenX}%`,
            top: `${m.screenY}%`,
            transform: 'translate(-50%, -50%)',
          }}
          className="fixed z-10 pointer-events-auto group cursor-pointer bg-transparent border-0 p-1 focus:outline-none"
        >
          <div className="flex flex-col items-center">
            <div className="w-14 h-2 mb-1.5 rounded-sm flex flex-col gap-0.5 bg-[#090d16]/90 px-0.5 py-0.5 border border-rose-500/65">
              <div className="h-[2px] w-full bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-sky-400" style={{ width: `${m.shieldPct}%` }} />
              </div>
              <div className="h-[2px] w-full bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-rose-500" style={{ width: `${m.hullPct}%` }} />
              </div>
            </div>

            <div className="relative w-14 h-14 flex items-center justify-center transition-transform group-hover:scale-110">
              <svg
                viewBox="0 0 56 56"
                className={`w-14 h-14 overflow-visible ${
                  m.isLocked
                    ? 'drop-shadow-[0_0_9px_rgba(244,63,94,0.95)]'
                    : 'drop-shadow-[0_0_5px_rgba(244,63,94,0.65)]'
                }`}
              >
                <polygon
                  points="28,3 53,28 28,53 3,28"
                  fill={m.isLocked ? 'rgba(244, 63, 94, 0.12)' : 'rgba(244, 63, 94, 0.05)'}
                  stroke={m.isLocked ? '#ff3b5c' : '#f43f5e'}
                  strokeWidth={m.isLocked ? '2.2' : '1.7'}
                />
                {m.isLocked && (
                  <>
                    <polyline
                      points="21,10 28,3 35,10"
                      fill="none"
                      stroke="#ffe4e6"
                      strokeWidth="2"
                    />
                    <polyline
                      points="21,46 28,53 35,46"
                      fill="none"
                      stroke="#ffe4e6"
                      strokeWidth="2"
                    />
                    <polyline
                      points="10,21 3,28 10,35"
                      fill="none"
                      stroke="#ffe4e6"
                      strokeWidth="2"
                    />
                    <polyline
                      points="46,21 53,28 46,35"
                      fill="none"
                      stroke="#ffe4e6"
                      strokeWidth="2"
                    />
                  </>
                )}
              </svg>
            </div>

            <div className="mt-1 rounded-md px-1.5 py-0.5 bg-[#090d16]/90 border border-rose-500/70 font-mono-tech text-[9px] tracking-wider text-rose-100 whitespace-nowrap uppercase">
              {m.name} · {formatDistance(m.distanceMeters)}
            </div>
          </div>
        </button>
      ))}

      {/* Lead Indicator Pip for Locked Hostile */}
      {target && target.kind === 'pirate' && target.leadOnScreen && target.leadScreenX !== undefined && target.leadScreenY !== undefined && (
        <div
          data-testid="target-lead-pip"
          style={{
            left: `${target.leadScreenX}%`,
            top: `${target.leadScreenY}%`,
            transform: 'translate(-50%, -50%)',
          }}
          className="fixed z-10 pointer-events-none flex flex-col items-center"
        >
          <svg viewBox="0 0 28 28" className="w-7 h-7">
            <circle
              cx="14"
              cy="14"
              r="9"
              fill="none"
              stroke={hud.gimbalLocked ? 'var(--hud-accent)' : '#fbbf24'}
              strokeWidth={hud.gimbalLocked ? '2' : '1.5'}
              strokeDasharray={hud.gimbalLocked ? undefined : '3 2'}
            />
            <circle cx="14" cy="14" r="2.2" fill={hud.gimbalLocked ? 'var(--hud-accent)' : '#f87171'} />
          </svg>
          <span
            className={`rounded-sm font-mono-tech text-[8px] tracking-widest uppercase bg-[#090d16]/85 px-1 ${
              hud.gimbalLocked
                ? 'text-[var(--hud-accent-bright)] border border-[var(--hud-border-strong)]'
                : 'text-amber-300'
            }`}
          >
            {hud.gimbalLocked ? 'GIMBAL' : 'LEAD'}
          </span>
        </div>
      )}

      {/* Subtle World-Space Target Lock Bracket (for non-pirate waypoints) */}
      {target && target.onScreen && target.kind !== 'pirate' && (
        <div
          data-testid="onscreen-target-bracket"
          style={{
            left: `${target.screenX}%`,
            top: `${target.screenY}%`,
            transform: 'translate(-50%, -50%)',
          }}
          className="fixed z-10 pointer-events-none flex flex-col items-center"
        >
          <div
            className={`w-10 h-10 border relative ${
              target.kind === 'bay' || target.kind === 'station'
                ? 'border-[var(--hud-accent)]'
                : target.kind === 'planet'
                  ? 'border-violet-400/85'
                  : target.kind === 'canister'
                    ? 'border-emerald-400/85'
                    : 'border-amber-400/80'
            }`}
            style={{
              clipPath:
                'polygon(0 0, 28% 0, 28% 2px, 2px 2px, 2px 28%, 0 28%, 0 72%, 2px 72%, 2px 98%, 28% 98%, 28% 100%, 0 100%, 72% 100%, 72% 98%, 98% 98%, 98% 72%, 100% 72%, 100% 100%, 100% 0, 72% 0, 72% 2px, 98% 2px, 98% 28%, 100% 28%)',
            }}
          />
          <div className="rounded-md font-mono-tech text-[10px] tracking-wider text-[var(--hud-accent-bright)] whitespace-nowrap text-center mt-2 px-1.5 py-0.5 bg-[#090d16]/78 border hud-panel">
            {target.name.split('//')[0].trim()} · {formatDistance(target.distanceMeters)}
          </div>
        </div>
      )}

      {/* Off-Screen Directional Waypoint Arrow */}
      {target && !target.onScreen && (
        <div
          data-testid="offscreen-target-arrow"
          style={{
            left: `${target.edgeX}%`,
            top: `${target.edgeY}%`,
            transform: 'translate(-50%, -50%)',
          }}
          className="fixed z-20 pointer-events-none flex flex-col items-center"
        >
          <svg
            viewBox="0 0 28 28"
            className="w-7 h-7"
            style={{
              transform: `rotate(${target.edgeAngleDeg.toFixed(1)}deg)`,
              filter: 'drop-shadow(0 0 6px var(--hud-glow))',
            }}
          >
            <polygon
              points="14,2 24,23 14,18 4,23"
              fill={
                target.kind === 'pirate'
                  ? '#f87171'
                  : target.kind === 'planet'
                    ? '#a78bfa'
                    : target.kind === 'star' || target.kind === 'asteroid_belt'
                      ? '#fbbf24'
                      : 'var(--hud-accent)'
              }
              stroke="#090d16"
              strokeWidth="1.5"
            />
          </svg>
          <div
            className={`mt-0.5 rounded-md px-1.5 py-0.5 bg-[#090d16]/85 border font-mono-tech text-[9px] tracking-wider whitespace-nowrap uppercase ${
              target.kind === 'pirate'
                ? 'border-rose-400/60 text-rose-200'
                : 'hud-panel text-[var(--hud-accent-bright)]'
            }`}
          >
            {target.name.split('//')[0].trim()} · {formatDistance(target.distanceMeters)}
          </div>
        </div>
      )}

      {/* Virtual-Joystick Center Deadzone Ring & Mouse Cursor Reticle */}
      {showVirtualJoystick && (
        <div
          data-testid="mouse-flight-overlay"
          className="fixed inset-0 z-10 pointer-events-none overflow-hidden"
          aria-hidden="true"
        >
          {/* Translucent Center Deadzone Ring */}
          <div
            ref={deadzoneRingRef}
            data-testid="mouse-deadzone-ring"
            data-active="false"
            style={{
              width: `${MOUSE_DEADZONE_PX * 2}px`,
              height: `${MOUSE_DEADZONE_PX * 2}px`,
            }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed hud-ring-deadzone transition-colors"
          />

          {/* Vector Tether from Deadzone Edge to Cursor Reticle */}
          <svg className="fixed left-1/2 top-1/2 overflow-visible w-px h-px">
            <line
              ref={tetherLineRef}
              x1="0"
              y1="0"
              x2="0"
              y2="0"
              stroke="var(--hud-accent)"
              strokeWidth="1.25"
              strokeDasharray="3 3"
              style={{ opacity: 0 }}
            />
          </svg>

          {/* Mouse Cursor Reticle */}
          <div
            ref={reticleRef}
            data-testid="mouse-cursor-reticle"
            data-active="false"
            className="fixed left-1/2 top-1/2 hud-mouse-reticle"
            style={{ transform: 'translate(-50%, -50%) translate3d(0px, 0px, 0px)' }}
          >
            <svg viewBox="0 0 22 22" className="w-5 h-5 overflow-visible">
              <circle
                cx="11"
                cy="11"
                r="6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeOpacity="0.85"
              />
              <line x1="11" y1="1" x2="11" y2="5" stroke="currentColor" strokeWidth="1.3" />
              <line x1="11" y1="17" x2="11" y2="21" stroke="currentColor" strokeWidth="1.3" />
              <line x1="1" y1="11" x2="5" y2="11" stroke="currentColor" strokeWidth="1.3" />
              <line x1="17" y1="11" x2="21" y2="11" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="11" cy="11" r="1.4" fill="currentColor" />
            </svg>
          </div>
        </div>
      )}

      {/* Center Reticle + Curved SVG Arc Gauges */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        aria-label="Flight Reticle"
      >
        <svg viewBox="0 0 240 200" className="w-[240px] h-[200px] overflow-visible">
          <path
            d={describeArc(120, 100, 74, 130, 230)}
            fill="none"
            stroke="rgba(148, 163, 184, 0.2)"
            strokeWidth="4"
            strokeLinecap="butt"
          />
          <path
            d={describeArc(120, 100, 74, -48, 48)}
            fill="none"
            stroke="rgba(148, 163, 184, 0.2)"
            strokeWidth="4"
            strokeLinecap="butt"
          />

          {Math.abs(hud.throttle) > 0.01 && (
            <path
              d={
                hud.throttle >= 0
                  ? describeArc(120, 100, 74, throttleZeroDeg, throttleEndDeg)
                  : describeArc(120, 100, 74, throttleEndDeg, throttleZeroDeg)
              }
              fill="none"
              stroke={hud.throttle >= 0 ? 'var(--hud-accent)' : '#f59e0b'}
              strokeWidth="4.5"
              strokeLinecap="butt"
            />
          )}

          <line
            x1={120 + 68 * Math.cos((throttleZeroDeg * Math.PI) / 180)}
            y1={100 + 68 * Math.sin((throttleZeroDeg * Math.PI) / 180)}
            x2={120 + 80 * Math.cos((throttleZeroDeg * Math.PI) / 180)}
            y2={100 + 80 * Math.sin((throttleZeroDeg * Math.PI) / 180)}
            stroke="#e2e8f0"
            strokeWidth="1.5"
          />

          {hullPct > 0 && (
            <path
              d={describeArc(120, 100, 74, hullEndDeg, hullStartDeg)}
              fill="none"
              stroke={hullPct > 55 ? '#34d399' : hullPct > 25 ? '#fbbf24' : '#f87171'}
              strokeWidth="4.5"
              strokeLinecap="butt"
            />
          )}
          {shieldPct > 0 && (
            <path
              d={describeArc(120, 100, 82, shieldEndDeg, hullStartDeg)}
              fill="none"
              stroke="var(--hud-accent)"
              strokeOpacity="0.82"
              strokeWidth="2.2"
              strokeLinecap="butt"
            />
          )}

          <circle
            cx="120"
            cy="100"
            r="14"
            fill="none"
            stroke="rgba(var(--hud-accent-rgb), 0.58)"
            strokeWidth="1.2"
          />
          <line x1="98" y1="100" x2="111" y2="100" stroke="var(--hud-accent-bright)" strokeWidth="1.4" />
          <line x1="129" y1="100" x2="142" y2="100" stroke="var(--hud-accent-bright)" strokeWidth="1.4" />
          <line x1="120" y1="78" x2="120" y2="91" stroke="var(--hud-accent-bright)" strokeWidth="1.4" />
          <line x1="120" y1="109" x2="120" y2="122" stroke="var(--hud-accent-bright)" strokeWidth="1.4" />
          <circle cx="120" cy="100" r="1.5" fill="var(--hud-accent)" />

          <text
            x="24"
            y="96"
            textAnchor="end"
            fill={hud.cruiseActive ? 'var(--hud-accent-bright)' : '#f1f5f9'}
            stroke="#090d16"
            strokeWidth="3.5"
            paintOrder="stroke fill"
            fontSize="13"
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {hud.speedMps >= 1000
              ? `${(hud.speedMps / 1000).toFixed(2)}k`
              : Math.round(hud.speedMps)}
          </text>
          <text
            x="24"
            y="109"
            textAnchor="end"
            fill={hud.cruiseActive ? 'var(--hud-accent)' : 'var(--hud-accent-soft)'}
            stroke="#090d16"
            strokeWidth="3"
            paintOrder="stroke fill"
            fontSize="9"
            fontWeight="600"
            letterSpacing="1.2"
            fontFamily="JetBrains Mono, monospace"
          >
            {hud.cruiseActive
              ? 'CRUISE 16x'
              : throttlePct < 0
                ? `REV ${throttlePct}%`
                : `THR ${throttlePct}%`}
          </text>

          <text
            x="216"
            y="96"
            textAnchor="start"
            fill="#f1f5f9"
            stroke="#090d16"
            strokeWidth="3.5"
            paintOrder="stroke fill"
            fontSize="13"
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {hullPct}%
          </text>
          <text
            x="216"
            y="109"
            textAnchor="start"
            fill="#34d399"
            stroke="#090d16"
            strokeWidth="3"
            paintOrder="stroke fill"
            fontSize="9"
            fontWeight="600"
            letterSpacing="1.2"
            fontFamily="JetBrains Mono, monospace"
          >
            SHD {shieldPct}%
          </text>
        </svg>
      </div>

      {/* Hyperspace Countdown Banner (top-center clear zone) */}
      {hud.hyperspaceCountdown !== null && (
        <div
          data-testid="hyperspace-countdown"
          className="fixed top-4 left-1/2 -translate-x-1/2 rounded-lg px-5 py-2 bg-[#060a14]/92 border border-[var(--hud-border-strong)] text-center max-w-[360px]"
        >
          <div className="font-mono-tech text-[10px] tracking-[0.22em] uppercase text-[var(--hud-accent-soft)] truncate">
            HYPERSPACE JUMP → {hud.selectedJumpSystemName?.toUpperCase() ?? 'DESTINATION'}
          </div>
          <div className="font-mono-tech text-lg font-bold text-amber-300 mt-0.5">
            T-{Math.max(0, hud.hyperspaceCountdown).toFixed(1)}s
          </div>
        </div>
      )}

      {/* Transient Alert Banner (top-center clear zone) */}
      {hud.alertMessage && hud.hyperspaceCountdown === null && !hud.isScoopingFuel && (
        <div className="fixed z-30 top-4 left-1/2 -translate-x-1/2 rounded-lg px-4 py-1.5 bg-[#090d16]/90 border border-amber-400/50 font-mono-tech text-xs tracking-[0.12em] uppercase text-amber-200 whitespace-nowrap max-w-[580px] truncate">
          {hud.alertMessage}
        </div>
      )}

      {/* Supercruise Telemetry Indicator */}
      {hud.cruiseActive && hud.hyperspaceCountdown === null && (
        <div
          data-testid="hud-cruise-badge"
          className="fixed top-14 left-1/2 -translate-x-1/2 rounded-lg px-4 py-1 bg-[#090d16]/88 border border-[var(--hud-border-strong)] font-mono-tech text-[11px] tracking-[0.2em] uppercase text-[var(--hud-accent-bright)] whitespace-nowrap"
        >
          SUPERCRUISE ACTIVE · {(hud.speedMps / 1000).toFixed(2)} KM/S · PRESS [J] TO DROP
        </div>
      )}

      {/* Solar Fuel Scooping Telemetry Banner */}
      {hud.isScoopingFuel && hud.hyperspaceCountdown === null && (
        <div
          data-testid="fuel-scoop-banner"
          className="fixed top-4 left-1/2 -translate-x-1/2 rounded-lg w-[320px] px-4 py-2 bg-[#060a14]/92 border border-amber-400/75"
        >
          <div className="flex items-center justify-between font-mono-tech text-[10px] tracking-[0.18em] uppercase text-amber-300 mb-1">
            <span>SOLAR FUEL SCOOP ACTIVE</span>
            <span className="font-bold">
              {hud.fuel.toFixed(1)} / {hud.maxFuel.toFixed(1)} LY
            </span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full"
              style={{ width: `${Math.min(100, (hud.fuel / hud.maxFuel) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Top-Left Compact Telemetry & Single-Row Flight Action Bar */}
      <div className="fixed z-30 top-4 left-4 flex flex-col gap-1.5 pointer-events-auto w-[360px] max-w-[calc(100vw-2rem)]">
        <div className="rounded-lg flex items-center justify-between gap-2 px-3 py-2 bg-[#090d16]/82 border hud-panel">
          <div>
            <div className="font-mono-tech text-[10px] tracking-[0.16em] text-slate-400 uppercase">
              System
            </div>
            <div
              data-testid="hud-system-name"
              className="font-mono-tech text-sm font-bold text-[var(--hud-accent-soft)]"
            >
              {hud.currentSystemName}
            </div>
          </div>
          <div className="h-7 w-px bg-slate-600/40" />
          <div>
            <div className="font-mono-tech text-[10px] tracking-[0.16em] text-slate-400 uppercase">
              Credits
            </div>
            <div
              data-testid="hud-credits"
              className="font-mono-tech text-sm font-bold text-amber-300"
            >
              {hud.credits.toFixed(1)} Cr
            </div>
          </div>
          <div className="h-7 w-px bg-slate-600/40" />
          <div>
            <div className="font-mono-tech text-[10px] tracking-[0.16em] text-slate-400 uppercase">
              Cargo
            </div>
            <div data-testid="hud-cargo" className="font-mono-tech text-sm font-bold text-slate-100">
              {hud.cargoUsed}/{hud.cargoCapacity}t
            </div>
          </div>
          <div className="h-7 w-px bg-slate-600/40" />
          <div>
            <div className="font-mono-tech text-[10px] tracking-[0.16em] text-slate-400 uppercase">
              Fuel
            </div>
            <div data-testid="hud-fuel" className="font-mono-tech text-sm font-bold text-emerald-300">
              {hud.fuel.toFixed(1)} LY
            </div>
          </div>
        </div>

        {/* Security Rating & Pilot Combat Rank Strip */}
        <div className="rounded-lg flex items-center justify-between gap-2 px-3 py-1 bg-[#090d16]/82 border border-slate-700/70 font-mono-tech text-[10px] uppercase tracking-wider">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">SEC:</span>
            <span
              data-testid="hud-security-level"
              className={`font-semibold ${
                hud.currentSystemSecurity === 'High Security'
                  ? 'text-emerald-300'
                  : hud.currentSystemSecurity === 'Anarchy'
                    ? 'text-rose-300'
                    : 'text-amber-300'
              }`}
            >
              {hud.currentSystemSecurity}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {hud.activePirateCount > 0 && (
              <span
                data-testid="hud-hostile-alert"
                className="rounded-sm px-1.5 py-0.5 bg-rose-500/20 border border-rose-400/60 text-rose-200 font-bold"
              >
                {hud.activePirateCount} HOSTILE
              </span>
            )}
            <span data-testid="hud-combat-rank" className="text-[var(--hud-accent-soft)] font-semibold">
              {hud.combatRank} ({hud.pirateKills})
            </span>
          </div>
        </div>

        {/* 4 Core Action Buttons on a Single Clean Row */}
        <div className="flex items-center gap-1.5" data-testid="hud-action-row">
          <button
            type="button"
            tabIndex={-1}
            data-testid="hud-cruise-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleCruise();
            }}
            aria-label="Toggle Cruise Drive (J)"
            className={`flex-1 rounded-md px-2 py-1.5 font-mono-tech text-[11px] uppercase tracking-wider border transition-colors cursor-pointer whitespace-nowrap ${
              hud.cruiseActive
                ? 'hud-btn-active font-bold'
                : hud.canEngageCruise
                  ? 'bg-[#090d16]/80 border-[var(--hud-border)] text-[var(--hud-accent-soft)] hud-btn-ghost'
                  : 'bg-[#090d16]/75 border-amber-500/45 text-amber-300/80'
            }`}
          >
            {hud.cruiseActive
              ? 'Cruise On'
              : hud.canEngageCruise
                ? 'Cruise'
                : 'Mass-Lock'}
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="hud-autodock-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleAutoDock();
            }}
            aria-label="Toggle Auto-Dock (C)"
            className={`flex-1 rounded-md px-2 py-1.5 font-mono-tech text-[11px] uppercase tracking-wider border transition-colors cursor-pointer whitespace-nowrap ${
              hud.autoDockActive
                ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
                : hud.canAutoDock
                  ? 'hud-btn-active'
                  : 'bg-[#090d16]/75 border-slate-600/45 text-slate-300 hud-btn-ghost'
            }`}
          >
            {hud.autoDockActive ? 'Docking' : 'Auto-Dock'}
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="hud-starmap-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleStarMap();
            }}
            aria-label="Open Star Map (M)"
            className="flex-1 rounded-md px-2 py-1.5 font-mono-tech text-[11px] uppercase tracking-wider bg-[#090d16]/80 border border-[var(--hud-border)] text-[var(--hud-accent-soft)] hud-btn-ghost transition-colors cursor-pointer whitespace-nowrap"
          >
            Star Map
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="hud-jump-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              onTriggerJump();
            }}
            aria-label="Hyperspace Jump (H)"
            className={`flex-1 rounded-md px-2 py-1.5 font-mono-tech text-[11px] uppercase tracking-wider border transition-colors cursor-pointer whitespace-nowrap truncate ${
              hud.canJumpSelected
                ? 'bg-amber-500/20 border-amber-400/70 text-amber-200 hover:bg-amber-500/35'
                : 'bg-[#090d16]/75 border-slate-500/40 text-slate-300 hud-btn-ghost'
            }`}
          >
            {hud.selectedJumpSystemName
              ? `Jump → ${hud.selectedJumpSystemName}`
              : 'Jump'}
          </button>
        </div>
      </div>

      {/* Top-Right Collapsible Target Info, Waypoint Selector & Docking Alignment Box */}
      <div
        data-testid="hud-target-panel"
        data-expanded={targetPanelExpanded ? 'true' : 'false'}
        className={`fixed z-30 top-4 right-4 rounded-lg bg-[#090d16]/90 border hud-panel pointer-events-auto transition-all ${
          targetPanelExpanded ? 'w-72 px-3.5 py-2.5' : 'w-auto min-w-[188px] px-3 py-2'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono-tech text-[10px] tracking-[0.2em] uppercase text-[var(--hud-accent-soft)] whitespace-nowrap">
            Target Lock
          </span>
          <div className="flex items-center gap-1.5">
            {targetPanelExpanded && (
              <button
                type="button"
                tabIndex={-1}
                data-testid="hud-cycle-target-btn"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onCycleTarget();
                }}
                className="rounded-md px-1.5 py-0.5 font-mono-tech text-[10px] uppercase tracking-wider border hud-btn-active cursor-pointer"
              >
                Cycle [T]
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              data-testid="hud-target-toggle-btn"
              aria-label={targetPanelExpanded ? 'Collapse Target Lock' : 'Expand Target Lock'}
              aria-expanded={targetPanelExpanded}
              onClick={(e) => {
                e.currentTarget.blur();
                setTargetPanelExpanded((prev) => !prev);
              }}
              className="rounded-md px-1.5 py-0.5 font-mono-tech text-[10px] uppercase tracking-wider bg-[#090d16] border border-slate-600/60 text-slate-300 hud-btn-ghost cursor-pointer transition-colors"
            >
              {targetPanelExpanded ? '[-]' : '[+]'}
            </button>
          </div>
        </div>

        {!targetPanelExpanded ? (
          showDockButton && !hud.autoDockActive ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onDockNow();
              }}
              className="pointer-events-auto mt-2 w-full rounded-md py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono-tech text-xs font-bold uppercase tracking-wider cursor-pointer"
            >
              Dock Now [F]
            </button>
          ) : null
        ) : (
          <>
            <div
              data-testid="hud-locked-target-name"
              className={`font-mono-tech text-sm font-semibold truncate mt-1 ${
                target?.kind === 'pirate' ? 'text-rose-300' : 'text-slate-100'
              }`}
            >
              {target ? target.name : 'NO TARGET'}
            </div>

            <div className="flex items-baseline justify-between mt-1">
              <span className="font-mono-tech text-xs text-slate-400">RANGE</span>
              <span
                data-testid="hud-locked-target-range"
                className="font-mono-tech text-sm font-bold text-[var(--hud-accent-soft)]"
              >
                {target ? formatDistance(target.distanceMeters) : '--'}
              </span>
            </div>

            {/* Hostile Pirate Shield / Hull / Bounty Readout */}
            {target?.kind === 'pirate' && (
              <div
                data-testid="hud-pirate-vitals"
                className="mt-2 pt-1.5 border-t border-rose-500/30 space-y-1 font-mono-tech text-[10px]"
              >
                <div className="flex justify-between text-sky-300">
                  <span>TARGET SHIELD</span>
                  <span>{target.shieldPct ?? 0}%</span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-400 rounded-full"
                    style={{ width: `${target.shieldPct ?? 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-rose-300 pt-0.5">
                  <span>TARGET HULL</span>
                  <span>{target.hullPct ?? 0}%</span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-rose-400 rounded-full"
                    style={{ width: `${target.hullPct ?? 0}%` }}
                  />
                </div>
                {typeof target.bountyCr === 'number' && (
                  <div className="flex justify-between text-amber-300 pt-0.5">
                    <span>BOUNTY</span>
                    <span className="font-bold">+{target.bountyCr} Cr</span>
                  </div>
                )}
              </div>
            )}

            {/* Clickable System Waypoints */}
            {hud.waypoints.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700/60">
                <div className="font-mono-tech text-[9px] tracking-[0.18em] uppercase text-slate-400 mb-1">
                  System Waypoints
                </div>
                <div className="flex flex-col gap-0.5 max-h-60 overflow-y-auto pr-0.5">
                  {hud.waypoints.map((wp) => {
                    const selected = wp.id === hud.lockedWaypointId;
                    const isPirate = wp.kind === 'pirate';
                    return (
                      <button
                        key={wp.id}
                        type="button"
                        tabIndex={-1}
                        data-testid={`waypoint-btn-${wp.id}`}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          onSelectWaypoint(wp.id);
                        }}
                        className={`w-full rounded-md flex items-center justify-between gap-2 px-2 py-1 text-left font-mono-tech text-[10px] border transition-colors cursor-pointer ${
                          selected
                            ? isPirate
                              ? 'bg-rose-500/25 border-rose-400/80 text-rose-100'
                              : 'hud-btn-active font-semibold'
                            : isPirate
                              ? 'bg-rose-950/35 border-rose-500/40 text-rose-200 hover:border-rose-400'
                              : 'bg-slate-900/50 border-transparent text-slate-300 hover:border-slate-600/70'
                        }`}
                      >
                        <span className="truncate">{wp.name.split('//')[0].trim()}</span>
                        <span
                          className={`shrink-0 ${
                            isPirate ? 'text-rose-300' : 'text-[var(--hud-accent-soft)]'
                          }`}
                        >
                          {formatDistance(wp.distanceMeters)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-2 pt-2 border-t border-slate-700/60">
              <div className="flex items-center justify-between text-[10px] font-mono-tech tracking-wider text-slate-400 uppercase mb-1">
                <span>Docking Bay</span>
                <span>{formatDistance(docking.distanceMeters)}</span>
              </div>
              <div
                className={`font-mono-tech text-[11px] font-semibold tracking-wide ${
                  hud.autoDockActive
                    ? 'text-emerald-300'
                    : docking.isReadyToDock
                      ? 'text-emerald-300'
                      : docking.isCorridorAligned
                        ? 'text-amber-300'
                        : 'text-[var(--hud-accent-bright)]/85'
                }`}
              >
                {hud.autoDockActive ? 'AUTOPILOT ALIGNING TO BAY' : docking.statusLabel}
              </div>

              {showDockButton && !hud.autoDockActive && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onDockNow();
                  }}
                  className="pointer-events-auto mt-2 w-full rounded-md py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono-tech text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  Dock Now [F]
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom-Center 3D Holographic Scanner */}
      <div className="fixed z-30 bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
        <div className="rounded-lg px-3 pt-1.5 pb-1 bg-[#090d16]/78 border hud-panel">
          <canvas
            ref={radarCanvasRef}
            data-testid="radar-canvas"
            className="w-[264px] h-[148px] block"
          />
          <div className="flex items-center justify-between font-mono-tech text-[9px] tracking-[0.08em] text-[var(--hud-accent-soft)]/80 uppercase mt-0.5 px-0.5 gap-1.5">
            <span className="text-sky-400">■ Stn</span>
            <span className="text-violet-300">● Plnt</span>
            <span className="text-rose-400">◆ Hostile</span>
            <span className="text-amber-300">◌ Belt</span>
            <span className="text-emerald-300">● Ore</span>
            <span className="text-yellow-300">★ Sun</span>
          </div>
        </div>
      </div>

      {/* Bottom-Left Collapsible Flight Controls Reference */}
      <div className="fixed z-30 bottom-4 left-4 pointer-events-auto">
        {showControls ? (
          <div
            data-testid="hud-controls-panel"
            className="rounded-lg bg-[#090d16]/85 border hud-panel px-3 py-2.5 w-[296px] max-w-[calc(100vw-2rem)]"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono-tech text-[10px] tracking-[0.18em] uppercase text-[var(--hud-accent-soft)]">
                Flight Controls
              </span>
              <button
                type="button"
                tabIndex={-1}
                data-testid="hud-controls-collapse-btn"
                onClick={(e) => {
                  e.currentTarget.blur();
                  setShowControls(false);
                }}
                aria-label="Collapse Flight Controls"
                className="rounded-md px-1.5 py-0.5 bg-[#090d16] border border-slate-600/60 font-mono-tech text-[10px] text-slate-300 hud-btn-ghost uppercase cursor-pointer transition-colors"
              >
                [-]
              </button>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono-tech text-[11px] text-slate-300 whitespace-nowrap">
              <span>Mouse / LMB</span>
              <span className="text-slate-400">Steer / Lasers</span>
              <span>W / S · A / D</span>
              <span className="text-slate-400">Pitch / Roll</span>
              <span>Q / E · V / G</span>
              <span className="text-slate-400">Yaw / Mouse·Cam</span>
              <span>Wheel / Shft·Ctrl</span>
              <span className="text-slate-400">Throttle ±</span>
              <span>J / T</span>
              <span className="text-slate-400">Cruise / Target</span>
              <span>Space / X</span>
              <span className="text-slate-400">Lasers / Stop</span>
              <span>C / F</span>
              <span className="text-slate-400">Auto-Dock / Dock</span>
              <span>M / H · Esc</span>
              <span className="text-slate-400">Map / Jump · Menu</span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            data-testid="hud-controls-toggle-btn"
            aria-label="Expand Flight Controls"
            aria-expanded={false}
            onClick={(e) => {
              e.currentTarget.blur();
              setShowControls(true);
            }}
            className="rounded-md px-3 py-1.5 bg-[#090d16]/82 border hud-panel font-mono-tech text-[11px] uppercase tracking-wider text-slate-200 hud-btn-ghost cursor-pointer transition-colors whitespace-nowrap"
          >
            Controls [+]
          </button>
        )}
      </div>
    </div>
  );
};
