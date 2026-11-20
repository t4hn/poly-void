/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GalaxyMapModal } from './components/GalaxyMapModal';
import { GameHud } from './components/GameHud';
import { GameOverModal, PauseModal } from './components/StatusModals';
import { TitleOverlay } from './components/TitleOverlay';
import { TradingModal } from './components/TradingModal';
import { SpaceSimEngine } from './game/SpaceSimEngine';
import { MAX_JUMP_RANGE_LY, generateGalaxySector } from './game/galaxy';
import {
  buyCommodity,
  buyMaxCommodity,
  collectSalvageOre,
  createInitialTradingState,
  createStationMarket,
  getCargoUsed,
  refuelShip,
  repairHull,
  sellCommodity,
  upgradeCargoBay,
} from './game/trading';
import type { GamePhase, HudSnapshot, StarSystem, TradingState } from './game/types';

function createInitialHud(initialSystem: StarSystem): HudSnapshot {
  return {
    phase: 'title',
    isDocked: false,
    speedMps: 0,
    maxSpeedMps: 240,
    throttle: 0.18,
    hull: 100,
    maxHull: 100,
    shield: 100,
    maxShield: 100,
    weaponHeat: 0,
    credits: 100.0,
    cargoUsed: 0,
    cargoCapacity: 20,
    fuel: MAX_JUMP_RANGE_LY,
    maxFuel: MAX_JUMP_RANGE_LY,
    currentSystemId: initialSystem.id,
    currentSystemName: initialSystem.name,
    currentSystemEconomy: initialSystem.economy,
    selectedJumpSystemName: null,
    selectedJumpDistanceLY: null,
    canJumpSelected: false,
    autoDockActive: false,
    canAutoDock: true,
    hyperspaceCountdown: null,
    hyperspaceFlash: 0,
    asteroidsCleared: 0,
    distanceFlownKm: 0,
    invertPitch: false,
    cameraMode: 'cockpit',
    muted: false,
    target: null,
    docking: {
      distanceMeters: 680,
      speedMps: 0,
      lateralOffset: 0,
      facingAngleDeg: 0,
      corridorAngleDeg: 0,
      isSpeedSafe: true,
      isCorridorAligned: true,
      isOrientationAligned: true,
      isReadyToDock: false,
      isInsideBay: false,
      statusLabel: 'APPROACH CORRIDOR OPEN',
    },
    alertMessage: null,
  };
}

export default function App() {
  const galaxySector = useMemo(() => generateGalaxySector(1984), []);
  const initialSystem = galaxySector[0];

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SpaceSimEngine | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(() => createInitialHud(initialSystem));
  const [trading, setTrading] = useState<TradingState>(() =>
    createInitialTradingState(initialSystem)
  );
  const [tradeFeedback, setTradeFeedback] = useState<string | null>(null);
  const [starMapOpen, setStarMapOpen] = useState(false);
  const [selectedJumpSystemId, setSelectedJumpSystemId] = useState<string | null>(null);

  const marketSeedRef = useRef(1);
  const tradingRef = useRef(trading);
  tradingRef.current = trading;

  const currentSystem = useMemo(
    () => galaxySector.find((s) => s.id === trading.systemId) ?? initialSystem,
    [galaxySector, initialSystem, trading.systemId]
  );

  const selectedJumpSystem = useMemo(
    () =>
      selectedJumpSystemId
        ? galaxySector.find((s) => s.id === selectedJumpSystemId) ?? null
        : null,
    [galaxySector, selectedJumpSystemId]
  );

  const syncEngineTrading = useCallback(
    (next: TradingState) => {
      const sys = galaxySector.find((s) => s.id === next.systemId) ?? initialSystem;
      engineRef.current?.syncTradingMeta({
        credits: next.credits,
        cargoUsed: getCargoUsed(next.cargo),
        cargoCapacity: next.cargoCapacity,
        fuel: next.fuel,
        maxFuel: next.maxFuel,
        hull: next.hull,
        system: sys,
      });
    },
    [galaxySector, initialSystem]
  );

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    document.body.dataset.state = 'title';

    const engine = new SpaceSimEngine(mount, initialSystem, {
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
      },
      onPhaseChange: (phase: GamePhase) => {
        document.body.dataset.state = phase;
      },
      onDockRequested: () => {
        marketSeedRef.current += 1;
        setStarMapOpen(false);
        setTradeFeedback(null);
        setTrading((prev) => {
          const sys = galaxySector.find((s) => s.id === prev.systemId) ?? initialSystem;
          return {
            ...prev,
            market: createStationMarket(sys, marketSeedRef.current),
          };
        });
      },
      onCanisterCollected: (commodityId) => {
        setTrading((prev) => {
          const res = collectSalvageOre(prev, commodityId, 1, 12.0);
          syncEngineTrading(res.state);
          return res.state;
        });
      },
      onToggleStarMap: () => {
        setStarMapOpen((prev) => !prev);
      },
      onHyperspaceComplete: (destination, fuelUsedLY) => {
        setStarMapOpen(false);
        setSelectedJumpSystemId(null);
        setTradeFeedback(null);
        setTrading((prev) => {
          const nextState: TradingState = {
            ...prev,
            fuel: Math.max(0, Math.round((prev.fuel - fuelUsedLY) * 10) / 10),
            systemId: destination.id,
            systemName: destination.name,
            economy: destination.economy,
            techLevel: destination.techLevel,
            market: createStationMarket(destination, 1),
          };
          syncEngineTrading(nextState);
          return nextState;
        });
      },
    });

    engineRef.current = engine;
    syncEngineTrading(tradingRef.current);

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      engine.launch(false);
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [galaxySector, initialSystem, syncEngineTrading]);

  // Sync Star Map open state and selected jump system into engine
  useEffect(() => {
    engineRef.current?.setStarMapOpen(starMapOpen);
  }, [starMapOpen]);

  useEffect(() => {
    engineRef.current?.setSelectedJumpSystem(selectedJumpSystem);
  }, [selectedJumpSystem]);

  useEffect(() => {
    if (hud.hyperspaceCountdown !== null && starMapOpen) {
      setStarMapOpen(false);
    }
  }, [hud.hyperspaceCountdown, starMapOpen]);

  // Keep Trading hull synced with latest live HUD hull on docking
  useEffect(() => {
    if (hud.isDocked) {
      setTrading((prev) =>
        Math.round(prev.hull) === Math.round(hud.hull)
          ? prev
          : { ...prev, hull: Math.round(hud.hull) }
      );
    }
  }, [hud.isDocked, hud.hull]);

  // Attach RadarHUD canvas whenever playing HUD mounts
  useEffect(() => {
    if (hud.phase === 'playing') {
      engineRef.current?.attachRadarCanvas(radarCanvasRef.current);
    } else {
      engineRef.current?.attachRadarCanvas(null);
    }
  }, [hud.phase]);

  // Global Title / Pause / StarMap keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (hud.phase === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        engineRef.current?.launch();
        return;
      }
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
        if (starMapOpen) {
          e.preventDefault();
          setStarMapOpen(false);
          return;
        }
        if (hud.phase === 'playing') {
          e.preventDefault();
          engineRef.current?.pause();
        } else if (hud.phase === 'paused' && !hud.isDocked) {
          e.preventDefault();
          engineRef.current?.resume();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hud.phase, hud.isDocked, starMapOpen]);

  const handleLaunch = () => {
    engineRef.current?.launch();
  };

  const handleToggleInvertPitch = () => {
    engineRef.current?.setInvertPitch(!hud.invertPitch);
  };

  const handleRestart = (autoPlay: boolean) => {
    const freshTrading = createInitialTradingState(initialSystem);
    setTrading(freshTrading);
    setTradeFeedback(null);
    setStarMapOpen(false);
    setSelectedJumpSystemId(null);
    engineRef.current?.restart(initialSystem, autoPlay);
    syncEngineTrading(freshTrading);
  };

  const handleBuy = (commodityId: string, qty: number) => {
    const res = buyCommodity(trading, commodityId, qty);
    if (res.ok) {
      engineRef.current?.audio.playTrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      const itemName = trading.market.find((m) => m.id === commodityId)?.name ?? commodityId;
      setTradeFeedback(`Purchased ${qty}t ${itemName}`);
    } else if (res.error) {
      setTradeFeedback(res.error);
    }
  };

  const handleBuyMax = (commodityId: string) => {
    const res = buyMaxCommodity(trading, commodityId);
    if (res.ok) {
      engineRef.current?.audio.playTrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      const itemName = trading.market.find((m) => m.id === commodityId)?.name ?? commodityId;
      setTradeFeedback(`Purchased ${res.quantityBought}t ${itemName} (Max)`);
    } else if (res.error) {
      setTradeFeedback(res.error);
    }
  };

  const handleSell = (commodityId: string, qty: number) => {
    const res = sellCommodity(trading, commodityId, qty);
    if (res.ok) {
      engineRef.current?.audio.playTrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      const itemName = trading.market.find((m) => m.id === commodityId)?.name ?? commodityId;
      setTradeFeedback(`Sold ${qty}t ${itemName}`);
    } else if (res.error) {
      setTradeFeedback(res.error);
    }
  };

  const handleRefuel = () => {
    const res = refuelShip(trading);
    if (res.ok) {
      engineRef.current?.audio.playTrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      setTradeFeedback(`Refueled +${res.addedLY.toFixed(1)} LY for ${res.cost.toFixed(1)} Cr`);
    }
  };

  const handleRepairHull = () => {
    const res = repairHull(trading);
    if (res.ok) {
      engineRef.current?.audio.playTrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      setTradeFeedback(`Hull repaired for ${res.cost.toFixed(1)} Cr`);
    }
  };

  const handleUpgradeCargo = () => {
    const res = upgradeCargoBay(trading);
    if (res.ok) {
      engineRef.current?.audio.playTrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      setTradeFeedback(`Cargo rack expanded to ${res.state.cargoCapacity}t`);
    }
  };

  const handleUndock = () => {
    setTradeFeedback(null);
    engineRef.current?.undock();
  };

  const handleInitiateJump = () => {
    setStarMapOpen(false);
    engineRef.current?.triggerHyperspaceJump();
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#090d16]">
      <div
        ref={canvasMountRef}
        data-testid="space-viewport"
        className="fixed inset-0 w-full h-full"
      />

      {hud.phase === 'title' && (
        <TitleOverlay
          invertPitch={hud.invertPitch}
          onToggleInvertPitch={handleToggleInvertPitch}
          onLaunch={handleLaunch}
        />
      )}

      {hud.phase === 'playing' && (
        <GameHud
          hud={hud}
          radarCanvasRef={radarCanvasRef}
          onToggleInvertPitch={handleToggleInvertPitch}
          onToggleCamera={() => engineRef.current?.toggleCameraMode()}
          onToggleMute={() => engineRef.current?.toggleMute()}
          onPause={() => engineRef.current?.pause()}
          onDockNow={() => engineRef.current?.triggerManualDockIfReady()}
          onToggleAutoDock={() => engineRef.current?.toggleAutoDock()}
          onToggleStarMap={() => setStarMapOpen((prev) => !prev)}
          onTriggerJump={() => engineRef.current?.triggerHyperspaceJump()}
        />
      )}

      {starMapOpen && hud.phase === 'playing' && !hud.isDocked && (
        <GalaxyMapModal
          systems={galaxySector}
          currentSystem={currentSystem}
          selectedSystem={selectedJumpSystem}
          fuel={trading.fuel}
          maxFuel={trading.maxFuel}
          isDocked={hud.isDocked}
          onSelectSystem={(sys) => setSelectedJumpSystemId(sys.id)}
          onInitiateJump={handleInitiateJump}
          onClose={() => setStarMapOpen(false)}
        />
      )}

      {hud.phase === 'paused' && hud.isDocked && (
        <TradingModal
          trading={trading}
          tradeFeedback={tradeFeedback}
          onBuy={handleBuy}
          onBuyMax={handleBuyMax}
          onSell={handleSell}
          onRefuel={handleRefuel}
          onRepairHull={handleRepairHull}
          onUpgradeCargo={handleUpgradeCargo}
          onUndock={handleUndock}
        />
      )}

      {hud.phase === 'paused' && !hud.isDocked && (
        <PauseModal
          onResume={() => engineRef.current?.resume()}
          onRestart={() => handleRestart(true)}
          onTitle={() => handleRestart(false)}
        />
      )}

      {hud.phase === 'gameover' && (
        <GameOverModal
          hud={hud}
          onTryAgain={() => handleRestart(true)}
          onTitle={() => handleRestart(false)}
        />
      )}
    </main>
  );
}
