/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GalaxyMapModal } from './components/GalaxyMapModal';
import { GameHud } from './components/GameHud';
import { EscapePodModal, GameOverModal, PauseModal } from './components/StatusModals';
import { TitleOverlay } from './components/TitleOverlay';
import { type SaleToast, TradingModal } from './components/TradingModal';
import { SpaceSimEngine } from './game/SpaceSimEngine';
import { getCombatRankProgress } from './game/combat';
import { generateGalaxySector } from './game/galaxy';
import {
  clearSavedGame,
  loadGameFromStorage,
  loadSettingsFromStorage,
  saveGameToStorage,
  saveSettingsToStorage,
  type PilotSettings,
} from './game/saveState';
import {
  applyEmergencyDistressJump,
  applyEscapePodEjection,
  awardPirateBounty,
  buyCommodity,
  buyMaxCommodity,
  collectSalvageOre,
  createDefaultUpgrades,
  createInitialTradingState,
  createStationMarket,
  getCargoUsed,
  purchaseCargoExtension,
  purchaseFuelScoop,
  purchasePulseLaserMk2,
  purchaseShieldBooster,
  refuelShip,
  repairHull,
  sellCommodity,
} from './game/trading';
import { applyHudThemeToDocument } from './game/themes';
import type { GamePhase, HudSnapshot, HudThemeId, StarSystem, TradingState } from './game/types';

function createInitialHud(
  initialSystem: StarSystem,
  initialTrading: TradingState,
  initialSettings: PilotSettings
): HudSnapshot {
  return {
    phase: 'title',
    isDocked: false,
    speedMps: 0,
    maxSpeedMps: 240,
    throttle: 0.18,
    cruiseActive: false,
    canEngageCruise: true,
    massLockBodyName: null,
    hull: initialTrading.hull,
    maxHull: initialTrading.maxHull,
    shield: initialTrading.maxHull,
    maxShield: initialTrading.maxHull,
    weaponHeat: 0,
    credits: initialTrading.credits,
    cargoUsed: getCargoUsed(initialTrading.cargo),
    cargoCapacity: initialTrading.cargoCapacity,
    fuel: initialTrading.fuel,
    maxFuel: initialTrading.maxFuel,
    currentSystemId: initialSystem.id,
    currentSystemName: initialSystem.name,
    currentSystemEconomy: initialSystem.economy,
    currentSystemSecurity: initialSystem.securityLevel,
    selectedJumpSystemName: null,
    selectedJumpDistanceLY: null,
    canJumpSelected: false,
    autoDockActive: false,
    canAutoDock: false,
    hyperspaceCountdown: null,
    hyperspaceFlash: 0,
    isScoopingFuel: false,
    sunDistanceMeters: 40000,
    upgrades: { ...initialTrading.upgrades },
    asteroidsCleared: 0,
    pirateKills: initialTrading.pirateKills,
    combatRank: getCombatRankProgress(initialTrading.pirateKills).rank,
    activePirateCount: 0,
    hostileMarkers: [],
    distanceFlownKm: 0,
    invertPitch: initialSettings.invertPitch,
    mouseSteerEnabled: initialSettings.mouseSteerEnabled,
    mouseSteerActive: false,
    gimbalLocked: false,
    cameraMode: initialSettings.cameraMode,
    muted: initialSettings.muted,
    volume: initialSettings.volume,
    voiceEnabled: initialSettings.voiceEnabled,
    target: null,
    waypoints: [],
    lockedWaypointId: 'station-bay',
    docking: {
      distanceMeters: 25000,
      speedMps: 0,
      lateralOffset: 0,
      facingAngleDeg: 0,
      corridorAngleDeg: 0,
      isSpeedSafe: true,
      isCorridorAligned: true,
      isOrientationAligned: true,
      isReadyToDock: false,
      isInsideBay: false,
      statusLabel: 'STANDBY — APPROACH BAY',
    },
    alertMessage: null,
  };
}

export default function App() {
  const galaxySector = useMemo(() => generateGalaxySector(1984), []);
  const defaultSystem = galaxySector[0];

  const initialSession = useMemo(() => {
    const params =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    if (params?.get('reset') === '1') {
      clearSavedGame();
    }
    const restored = loadGameFromStorage(galaxySector);
    if (restored) {
      return {
        trading: restored.trading,
        system: restored.system,
        savedAt: restored.savedAt,
        hasSavedLog: true,
      };
    }
    return {
      trading: createInitialTradingState(defaultSystem),
      system: defaultSystem,
      savedAt: null as number | null,
      hasSavedLog: false,
    };
  }, [galaxySector, defaultSystem]);

  const initialSettings = useMemo(() => loadSettingsFromStorage(), []);

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SpaceSimEngine | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [trading, setTrading] = useState<TradingState>(() => initialSession.trading);
  const [hud, setHud] = useState<HudSnapshot>(() =>
    createInitialHud(initialSession.system, initialSession.trading, initialSettings)
  );
  const [hudTheme, setHudTheme] = useState<HudThemeId>(() => initialSettings.hudTheme);
  const [tradeFeedback, setTradeFeedback] = useState<string | null>(null);
  const [saleToast, setSaleToast] = useState<SaleToast | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initialSession.savedAt);
  const [hasSavedLog, setHasSavedLog] = useState<boolean>(initialSession.hasSavedLog);
  const [starMapOpen, setStarMapOpen] = useState(false);
  const [selectedJumpSystemId, setSelectedJumpSystemId] = useState<string | null>(null);
  const [escapePodSummary, setEscapePodSummary] = useState<{
    systemName: string;
    lostCargoTons: number;
  } | null>(null);

  const marketSeedRef = useRef(1);
  const tradingRef = useRef(trading);
  tradingRef.current = trading;

  const currentSystem = useMemo(
    () => galaxySector.find((s) => s.id === trading.systemId) ?? defaultSystem,
    [galaxySector, defaultSystem, trading.systemId]
  );

  const selectedJumpSystem = useMemo(
    () =>
      selectedJumpSystemId
        ? galaxySector.find((s) => s.id === selectedJumpSystemId) ?? null
        : null,
    [galaxySector, selectedJumpSystemId]
  );

  const persistSave = useCallback(
    (nextState: TradingState) => {
      const sys = galaxySector.find((s) => s.id === nextState.systemId) ?? defaultSystem;
      const saved = saveGameToStorage(nextState, sys);
      if (saved) {
        setLastSavedAt(saved.savedAt);
        setHasSavedLog(true);
      }
    },
    [galaxySector, defaultSystem]
  );

  const syncEngineTrading = useCallback(
    (next: TradingState) => {
      const sys = galaxySector.find((s) => s.id === next.systemId) ?? defaultSystem;
      engineRef.current?.syncTradingMeta({
        credits: next.credits,
        cargoUsed: getCargoUsed(next.cargo),
        cargoCapacity: next.cargoCapacity,
        fuel: next.fuel,
        maxFuel: next.maxFuel,
        hull: next.hull,
        pirateKills: next.pirateKills,
        upgrades: next.upgrades ?? createDefaultUpgrades(),
        system: sys,
      });
    },
    [galaxySector, defaultSystem]
  );

  const showSaleToast = useCallback((toast: Omit<SaleToast, 'id'>) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    const id = Date.now();
    setSaleToast({ ...toast, id });
    toastTimerRef.current = window.setTimeout(() => {
      setSaleToast((cur) => (cur?.id === id ? null : cur));
    }, 4500);
  }, []);

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    document.body.dataset.state = 'title';

    const engine = new SpaceSimEngine(
      mount,
      initialSession.system,
      {
        onHudUpdate: (snapshot) => {
          setHud(snapshot);
        },
      onPhaseChange: (phase: GamePhase) => {
        document.body.dataset.state = phase;
        if (phase !== 'paused') {
          setSaveFeedback(null);
        }
      },
      onDockRequested: () => {
        marketSeedRef.current += 1;
        setStarMapOpen(false);
        setTradeFeedback(null);
        setTrading((prev) => {
          const sys = galaxySector.find((s) => s.id === prev.systemId) ?? defaultSystem;
          const nextState: TradingState = {
            ...prev,
            market: createStationMarket(sys, marketSeedRef.current),
          };
          persistSave(nextState);
          return nextState;
        });
      },
      onCanisterCollected: (commodityId, units, bountyCredits) => {
        setTrading((prev) => {
          const res = collectSalvageOre(prev, commodityId, units, bountyCredits);
          syncEngineTrading(res.state);
          return res.state;
        });
      },
      onPirateDestroyed: (_pirateName, bountyCr) => {
        setTrading((prev) => {
          const res = awardPirateBounty(prev, bountyCr);
          engineRef.current?.audio.playBountyChime(res.promoted);
          syncEngineTrading(res.state);
          persistSave(res.state);
          return res.state;
        });
      },
      onEscapePodEjected: () => {
        setStarMapOpen(false);
        setTradeFeedback(null);
        setTrading((prev) => {
          const sys = galaxySector.find((s) => s.id === prev.systemId) ?? defaultSystem;
          const res = applyEscapePodEjection(prev);
          const nextState: TradingState = {
            ...res.state,
            market: createStationMarket(sys, ++marketSeedRef.current),
          };
          syncEngineTrading(nextState);
          persistSave(nextState);
          setEscapePodSummary({
            systemName: sys.name,
            lostCargoTons: res.lostCargoTons,
          });
          return nextState;
        });
      },
      onToggleStarMap: () => {
        engineRef.current?.audio.playUiBlip('tab');
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
          persistSave(nextState);
          return nextState;
        });
      },
      onFuelScooped: (newFuelLY) => {
        setTrading((prev) => {
          if (Math.abs(prev.fuel - newFuelLY) < 0.05) return prev;
          return { ...prev, fuel: newFuelLY };
        });
      },
    },
    initialSettings
    );

    engineRef.current = engine;
    syncEngineTrading(tradingRef.current);

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      engine.launch(false);
    }

    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, [galaxySector, defaultSystem, initialSession.system, initialSettings, persistSave, syncEngineTrading]);

  // Apply active HUD theme CSS variables & radar tint, and persist pilot settings
  useEffect(() => {
    const def = applyHudThemeToDocument(hudTheme);
    engineRef.current?.setHudThemeRgb(def.accentRgb);
  }, [hudTheme]);

  useEffect(() => {
    saveSettingsToStorage({
      muted: hud.muted,
      volume: hud.volume,
      voiceEnabled: hud.voiceEnabled,
      mouseSteerEnabled: hud.mouseSteerEnabled,
      invertPitch: hud.invertPitch,
      cameraMode: hud.cameraMode,
      hudTheme,
    });
  }, [
    hud.muted,
    hud.volume,
    hud.voiceEnabled,
    hud.mouseSteerEnabled,
    hud.invertPitch,
    hud.cameraMode,
    hudTheme,
  ]);

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
      setTrading((prev) => {
        const rounded = Math.round(hud.hull);
        if (Math.round(prev.hull) === rounded) return prev;
        const next = { ...prev, hull: rounded };
        persistSave(next);
        return next;
      });
    }
  }, [hud.isDocked, hud.hull, persistSave]);

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

  const handleRestartSector = (autoPlay: boolean) => {
    clearSavedGame();
    const freshTrading = createInitialTradingState(defaultSystem);
    setTrading(freshTrading);
    setTradeFeedback(null);
    setSaleToast(null);
    setSaveFeedback(null);
    setLastSavedAt(null);
    setHasSavedLog(false);
    setStarMapOpen(false);
    setSelectedJumpSystemId(null);
    setEscapePodSummary(null);
    engineRef.current?.restart(defaultSystem, autoPlay);
    syncEngineTrading(freshTrading);
  };

  const handleManualSave = () => {
    const nextSnapshot: TradingState = {
      ...tradingRef.current,
      hull: Math.round(hud.hull),
      fuel: Math.round(hud.fuel * 10) / 10,
    };
    setTrading(nextSnapshot);
    persistSave(nextSnapshot);
    engineRef.current?.audio.playTrade();
    setTradeFeedback('Progress saved to commander log');
    setSaveFeedback('Commander progress saved');
  };

  const handleResetSave = () => {
    handleRestartSector(hud.phase !== 'title');
  };

  const handleBuy = (commodityId: string, qty: number) => {
    const res = buyCommodity(trading, commodityId, qty);
    if (res.ok) {
      engineRef.current?.audio.playTrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      persistSave(res.state);
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
      persistSave(res.state);
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
      persistSave(res.state);
      const itemName = trading.market.find((m) => m.id === commodityId)?.name ?? commodityId;
      setTradeFeedback(`Sold ${qty}t ${itemName} for +${res.revenue.toFixed(1)} Cr`);
      showSaleToast({
        commodityName: itemName,
        quantity: qty,
        revenue: res.revenue,
        netProfit: res.netProfit,
      });
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
      persistSave(res.state);
      setTradeFeedback(`Refueled +${res.addedLY.toFixed(1)} LY for ${res.cost.toFixed(1)} Cr`);
    }
  };

  const handleRepairHull = () => {
    const res = repairHull(trading);
    if (res.ok) {
      engineRef.current?.audio.playTrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      persistSave(res.state);
      setTradeFeedback(`Hull repaired for ${res.cost.toFixed(1)} Cr`);
    }
  };

  const handleUpgradeCargo = () => {
    const res = purchaseCargoExtension(trading);
    if (res.ok) {
      engineRef.current?.audio.playUpgrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      persistSave(res.state);
      setTradeFeedback(`Cargo Bay expanded to ${res.state.cargoCapacity}t`);
    } else if (res.error) {
      setTradeFeedback(res.error);
    }
  };

  const handleUpgradePulseLaser = () => {
    const res = purchasePulseLaserMk2(trading);
    if (res.ok) {
      engineRef.current?.audio.playUpgrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      persistSave(res.state);
      setTradeFeedback('Pulse Laser Mk II installed');
    } else if (res.error) {
      setTradeFeedback(res.error);
    }
  };

  const handleUpgradeShieldBooster = () => {
    const res = purchaseShieldBooster(trading);
    if (res.ok) {
      engineRef.current?.audio.playUpgrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      persistSave(res.state);
      setTradeFeedback('Shield Booster installed (+50% capacity)');
    } else if (res.error) {
      setTradeFeedback(res.error);
    }
  };

  const handleUpgradeFuelScoop = () => {
    const res = purchaseFuelScoop(trading);
    if (res.ok) {
      engineRef.current?.audio.playUpgrade();
      setTrading(res.state);
      syncEngineTrading(res.state);
      persistSave(res.state);
      setTradeFeedback('Solar Fuel Scoop installed');
    } else if (res.error) {
      setTradeFeedback(res.error);
    }
  };

  const handleDistressJump = (rescueSystem: StarSystem) => {
    const res = applyEmergencyDistressJump(trading, rescueSystem);
    setStarMapOpen(false);
    setSelectedJumpSystemId(null);
    setTrading(res.state);
    syncEngineTrading(res.state);
    persistSave(res.state);
    engineRef.current?.triggerDistressJump(rescueSystem);
  };

  const handleUndock = () => {
    setTradeFeedback(null);
    setSaleToast(null);
    persistSave(trading);
    engineRef.current?.undock();
  };

  const handleInitiateJump = () => {
    setStarMapOpen(false);
    engineRef.current?.triggerHyperspaceJump();
  };

  const savedSummary = hasSavedLog
    ? {
        systemName: trading.systemName,
        credits: trading.credits,
        cargoUsed: getCargoUsed(trading.cargo),
      }
    : null;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#090d16]">
      <div
        ref={canvasMountRef}
        data-testid="space-viewport"
        className={`fixed inset-0 w-full h-full ${
          hud.phase === 'playing' && !starMapOpen && !hud.isDocked ? 'cursor-crosshair' : ''
        }`}
      />

      {hud.phase === 'title' && (
        <TitleOverlay
          invertPitch={hud.invertPitch}
          savedSummary={savedSummary}
          onToggleInvertPitch={handleToggleInvertPitch}
          onResetSave={() => handleRestartSector(false)}
          onLaunch={handleLaunch}
        />
      )}

      {hud.phase === 'playing' && (
        <GameHud
          hud={hud}
          uiOverlayOpen={starMapOpen || Boolean(escapePodSummary)}
          radarCanvasRef={radarCanvasRef}
          onDockNow={() => engineRef.current?.triggerManualDockIfReady()}
          onToggleAutoDock={() => engineRef.current?.toggleAutoDock()}
          onToggleCruise={() => engineRef.current?.toggleCruiseDrive()}
          onCycleTarget={() => engineRef.current?.cycleTargetWaypoint()}
          onSelectWaypoint={(id) => engineRef.current?.selectWaypoint(id)}
          onSelectTarget={(id) => engineRef.current?.selectTarget(id)}
          onToggleStarMap={() => {
            engineRef.current?.audio.unlock();
            engineRef.current?.audio.playUiBlip('tab');
            setStarMapOpen((prev) => !prev);
          }}
          onTriggerJump={() => engineRef.current?.triggerHyperspaceJump()}
        />
      )}

      <GalaxyMapModal
        open={starMapOpen && hud.phase === 'playing' && !hud.isDocked}
        systems={galaxySector}
        currentSystem={currentSystem}
        selectedSystem={selectedJumpSystem}
        fuel={trading.fuel}
        maxFuel={trading.maxFuel}
        credits={trading.credits}
        cargo={trading.cargo}
        avgCostBasis={trading.avgCostBasis}
        isDocked={hud.isDocked}
        onSelectSystem={(sys) => {
          engineRef.current?.audio.unlock();
          engineRef.current?.audio.playUiBlip('select');
          setSelectedJumpSystemId(sys.id);
        }}
        onInitiateJump={handleInitiateJump}
        onDistressJump={handleDistressJump}
        onClose={() => {
          engineRef.current?.audio.playUiBlip('tab');
          setStarMapOpen(false);
        }}
      />

      <TradingModal
        open={hud.phase === 'paused' && hud.isDocked && !escapePodSummary}
        trading={trading}
        tradeFeedback={tradeFeedback}
        saleToast={saleToast}
        lastSavedAt={lastSavedAt}
        onTabSwitch={() => engineRef.current?.audio.playUiBlip('tab')}
        onBuy={handleBuy}
        onBuyMax={handleBuyMax}
        onSell={handleSell}
        onRefuel={handleRefuel}
        onRepairHull={handleRepairHull}
        onUpgradeCargo={handleUpgradeCargo}
        onUpgradePulseLaser={handleUpgradePulseLaser}
        onUpgradeShieldBooster={handleUpgradeShieldBooster}
        onUpgradeFuelScoop={handleUpgradeFuelScoop}
        onSaveGame={handleManualSave}
        onResetGame={() => handleRestartSector(true)}
        onUndock={handleUndock}
      />

      {escapePodSummary && (
        <EscapePodModal
          systemName={escapePodSummary.systemName}
          lostCargoTons={escapePodSummary.lostCargoTons}
          credits={trading.credits}
          combatRank={getCombatRankProgress(trading.pirateKills).rank}
          onContinue={() => setEscapePodSummary(null)}
        />
      )}

      {hud.phase === 'paused' && !hud.isDocked && (
        <PauseModal
          hud={hud}
          hudTheme={hudTheme}
          saveFeedback={saveFeedback}
          onChangeHudTheme={setHudTheme}
          onToggleMute={() => engineRef.current?.toggleMute()}
          onChangeVolume={(vol) => engineRef.current?.setVolume(vol)}
          onToggleVoice={() => engineRef.current?.toggleVoice()}
          onToggleMouseSteer={() => engineRef.current?.toggleMouseSteer()}
          onToggleInvertPitch={handleToggleInvertPitch}
          onToggleCamera={() => engineRef.current?.toggleCameraMode()}
          onResume={() => engineRef.current?.resume()}
          onSaveGame={handleManualSave}
          onRestart={() => handleRestartSector(true)}
          onResetSave={handleResetSave}
          onTitle={() => {
            engineRef.current?.restart(currentSystem, false);
            syncEngineTrading(tradingRef.current);
          }}
        />
      )}

      {hud.phase === 'gameover' && (
        <GameOverModal
          hud={hud}
          onTryAgain={() => handleRestartSector(true)}
          onTitle={() => handleRestartSector(false)}
        />
      )}
    </main>
  );
}
