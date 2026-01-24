import { useState, useEffect, useMemo, useRef } from "react";
import { useFirebaseConnection } from "@/hooks/use-firebase-connection";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Trophy,
  History,
  Zap,
  ShieldCheck,
  Crown,
  Coins,
  Settings2,
  Target
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Types
 */
type CardType = {
  value: string;
  suit: string;
  color: string;
};

type GameState = {
  phase: "lobby" | "betting" | "revealing" | "declaring" | "final" | "results";
  pot: number;
  currentBet: number;
  revealedCards: CardType[];
  totalCards: number;
  handCardsCount: number;
  adminId: string;
  dealerIndex: number;
  lastAction?: string;
  currentPlayerTurn?: string;
  gameId?: string; // stable id for the current hand
  timestamp?: number;
};

type Player = {
  id: string;
  username: string;
  balance: number;
  isAdmin: boolean;
  isBot: boolean;
  lastBet: number;
  finalScore?: number;
  choice?: "min" | "max";
  position: number;
  hasActed: boolean;
  privateHand?: CardType[] | null;
  declaredCount?: number | null;
};

/**
 * Constants & Utilities
 */
const SUITS = [
  { symbol: "♥", color: "red", name: "hearts" },
  { symbol: "♦", color: "red", name: "diamonds" },
  { symbol: "♣", color: "black", name: "clubs" },
  { symbol: "♠", color: "black", name: "spades" }
];

const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function hashString(str: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    h = (h + (h << 5) + 0x9e3779b9) >>> 0;
  }
  return Math.abs(h >>> 0);
}
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic deck shuffle.
 * IMPORTANT: uses only the provided seedSource (no timestamp/random parts) so same seed => same deck.
 */
function generateShuffledDeck(seedSource: string | null) {
  const deck: { value: string; suit: { symbol: string; color: string } }[] = [];
  SUITS.forEach((s) => {
    VALUES.forEach((v) => deck.push({ value: v, suit: s }));
  });
  const seedBase = seedSource ? hashString(seedSource) : 0;
  const rng = mulberry32(seedBase >>> 0);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck.map((d) => ({ value: d.value, suit: d.suit.symbol, color: d.suit.color }));
}

function generateGameId() {
  return `g_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * Main component
 */
export default function Home() {
  const { isConnected, isInitialized } = useFirebaseConnection();
  const { toast } = useToast();

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [localPlayerId, setLocalPlayerId] = useState<string | null>(localStorage.getItem("poker_player_id"));
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [betAmount, setBetAmount] = useState(0.1);
  const [finalScoreInput, setFinalScoreInput] = useState("");
  const [declareCountInput, setDeclareCountInput] = useState<number | "">("");
  const [winHistory, setWinHistory] = useState<any[]>([]);
  const [usernameInput, setUsernameInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [tempName, setTempName] = useState("");

  const prevRevealedRef = useRef<number>(0);

  const currentUser = localPlayerId ? players[localPlayerId] : null;

  /**
   * FIX: myPrivateHand must remain fixed for the whole hand.
   * - seed depends ONLY on localPlayerId and gameState.gameId.
   * - Use gameState?.timestamp only as a safety guard to avoid early toString/undefined issues during load.
   */
  const myPrivateHand = useMemo(() => {
    if (!gameState || !localPlayerId) return [];
    // safety: ensure the state has loaded sufficiently (timestamp prevents early crashes)
    if (!gameState.timestamp || !gameState.gameId) return [];
    const count = gameState.handCardsCount || 5;
    const p = players[localPlayerId];
    if (p?.privateHand && Array.isArray(p.privateHand) && p.privateHand.length >= count) {
      return p.privateHand.slice(0, count);
    }
    const seed = `${localPlayerId}-${gameState.gameId}`;
    const deck = generateShuffledDeck(seed);
    return deck.slice(0, count).map((c) => ({ value: c.value, suit: c.suit, color: c.color }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.handCardsCount, gameState?.gameId, gameState?.timestamp, localPlayerId, players]);

  /**
   * Firebase listeners
   */
  useEffect(() => {
    if (!isConnected) return;
    const stateRef = db.ref("game/state");
    const playersRef = db.ref("game/players");
    const historyRef = db.ref("game/history");

    stateRef.on("value", (snap) => {
      const data = snap.val();
      if (data) setGameState(data);
    });

    playersRef.on("value", (snap) => {
      const p = snap.val() || {};
      setPlayers(p);
      if (localPlayerId && p[localPlayerId]?.isAdmin) setIsAdminMode(true);
      else setIsAdminMode(false);
    });

    historyRef.limitToLast(20).on("value", (snap) => {
      const val = snap.val();
      if (val) setWinHistory(Object.values(val).reverse());
      else setWinHistory([]);
    });

    return () => {
      stateRef.off();
      playersRef.off();
      historyRef.off();
    };
  }, [isConnected, localPlayerId]);

  /**
   * When revealedCards change -> discard ALL matching-value cards from players' hands.
   * This implements multi-discard: if a player has multiple cards of that value, all are removed.
   */
  useEffect(() => {
    if (!gameState) return;
    const revealed = gameState.revealedCards || [];
    const prevLen = prevRevealedRef.current;
    if (revealed.length !== prevLen) {
      // run full-scan discard based on all currently revealed values
      discardMatchingCardsAgainstTable();
    }
    prevRevealedRef.current = revealed.length;
  }, [gameState?.revealedCards]); // trigger when revealedCards array changes

  /**
   * Join / Admin login
   */
  const joinGame = () => {
    if (!usernameInput.trim() || !budgetInput.trim()) {
      toast({ title: "Attenzione", description: "Inserisci nome e budget." });
      return;
    }
    const uniqueId = db.ref("game/players").push().key!;
    localStorage.setItem("poker_player_id", uniqueId);
    setLocalPlayerId(uniqueId);
    db.ref(`game/players/${uniqueId}`).set({
      id: uniqueId,
      username: usernameInput.trim().toUpperCase(),
      balance: parseFloat(budgetInput),
      isAdmin: false,
      isBot: false,
      lastBet: 0,
      position: Object.keys(players).length,
      hasActed: false,
      privateHand: null,
      declaredCount: null,
    });
  };

  const handleAdminLogin = () => {
    if (adminPassword === "1234" && tempName.toLowerCase() === "diro") {
      if (!budgetInput) return;
      const adminId = localPlayerId || db.ref("game/players").push().key!;
      localStorage.setItem("poker_player_id", adminId);
      setLocalPlayerId(adminId);
      setIsAdminMode(true);
      db.ref(`game/players/${adminId}`).set({
        id: adminId,
        username: "DIRO",
        balance: parseFloat(budgetInput),
        isAdmin: true,
        isBot: false,
        lastBet: 0,
        position: 0,
        hasActed: false,
        privateHand: null,
        declaredCount: null,
      });
    } else {
      toast({ title: "Sistema Protetto", description: "Password errata.", variant: "destructive" });
    }
  };

  /**
   * Admin actions: delete players and history
   */
  const deletePlayersAndHistory = () => {
    db.ref("game/players").remove();
    db.ref("game/history").remove();
    db.ref("game/state").update({
      phase: "lobby",
      pot: 0,
      currentBet: 0,
      revealedCards: [],
      totalCards: 5,
      handCardsCount: 5,
      lastAction: "CANCELLA GIOCATORI E CRONOLOGIA",
      gameId: undefined,
      timestamp: Date.now(),
    });
    setPlayers({});
    setWinHistory([]);
    toast({ title: "Sistema", description: "Giocatori e cronologia cancellati." });
  };

  const addBot = (name?: string) => {
    const r = db.ref("game/players").push();
    const pos = Object.keys(players).length;
    r.set({
      id: r.key,
      username: name || `BOT_${Math.floor(Math.random() * 9000) + 1000}`,
      balance: 200,
      isBot: true,
      isAdmin: false,
      lastBet: 0,
      position: pos,
      hasActed: false,
      privateHand: null,
      declaredCount: null,
    });
  };

  const setManualDealer = (id: string) => {
    const p = players[id];
    if (p) db.ref("game/state").update({ dealerIndex: p.position, currentPlayerTurn: p.id, lastAction: `Dealer impostato su ${p.username}`, timestamp: Date.now() });
  };

  /**
   * Assign Las Vegas: assign entire pot to player and reset pot
   */
  const assignLasVegas = (playerId: string) => {
    if (!gameState) return;
    const pot = gameState.pot || 0;
    if (pot <= 0) {
      toast({ title: "Nessun piatto", description: "Il piatto è vuoto." });
      return;
    }
    const p = players[playerId];
    if (!p) return;
    const updates: any = {};
    updates[`game/players/${p.id}/balance`] = parseFloat((p.balance + pot).toFixed(2));
    db.ref().update(updates);
    db.ref("game/history").push({ winners: `${p.username} (LAS VEGAS)`, pot, timestamp: Date.now() });
    db.ref("game/state").update({ pot: 0, lastAction: `ASSEGNA LAS VEGAS a ${p.username}`, timestamp: Date.now() });
    toast({ title: "Assegnato", description: `${pot.toFixed(2)}€ accreditati a ${p.username}` });
  };

  /**
   * Start game: assign private hands to players and set gameId (stable per hand)
   */
  const startGame = (totalCards: number, handCards: number) => {
    const gameId = generateGameId();
    const now = Date.now();
    db.ref("game/state").set({
      phase: "betting",
      pot: 0,
      currentBet: 0,
      revealedCards: [],
      totalCards,
      handCardsCount: handCards,
      adminId: localPlayerId || "admin",
      dealerIndex: 0,
      lastAction: `Nuova Mano: ${handCards} in mano, ${totalCards} a terra`,
      currentPlayerTurn: "",
      gameId,
      timestamp: now,
    });
    const updates: any = {};
    Object.keys(players).forEach((id) => {
      updates[`game/players/${id}/lastBet`] = 0;
      updates[`game/players/${id}/finalScore`] = null;
      updates[`game/players/${id}/choice`] = null;
      updates[`game/players/${id}/hasActed`] = false;
      updates[`game/players/${id}/declaredCount`] = null;
      const seed = `${id}-${gameId}`; // stable per hand
      const deck = generateShuffledDeck(seed);
      updates[`game/players/${id}/privateHand`] = deck.slice(0, handCards);
    });
    db.ref().update(updates);
  };

  const initRound = (commonCards: 3 | 5) => {
    const handCardsDefault = gameState?.handCardsCount || 5;
    startGame(commonCards, handCardsDefault);
  };

  /**
   * Discard: remove any cards in players' privateHand whose value appears on the table (revealedCards).
   * This removes multiple duplicates as requested.
   */
  const discardMatchingCardsAgainstTable = () => {
    if (!gameState) return;
    const revealed = gameState.revealedCards || [];
    const revealedValues = new Set(revealed.map((c) => c.value));
    if (revealedValues.size === 0) return;

    const updates: any = {};
    Object.values(players).forEach((p) => {
      const hand = p.privateHand || [];
      const filtered = hand.filter((c) => !revealedValues.has(c.value));
      if (filtered.length !== hand.length) {
        updates[`game/players/${p.id}/privateHand`] = filtered;
        if (p.declaredCount !== undefined && p.declaredCount !== null && p.declaredCount > filtered.length) {
          updates[`game/players/${p.id}/declaredCount`] = filtered.length;
        }
      }
    });

    if (Object.keys(updates).length > 0) {
      db.ref().update(updates);
      db.ref("game/state").update({ lastAction: `Scarto automatico per valori: ${Array.from(revealedValues).join(", ")}`, timestamp: Date.now() });
    }
  };

  /**
   * Reveal next card
   */
  const revealNextCard = () => {
    if (!gameState) return;
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    const value = VALUES[Math.floor(Math.random() * VALUES.length)];
    const nextCard: CardType = { value, suit: suit.symbol, color: suit.color };
    const nextRevealed = [...(gameState.revealedCards || []), nextCard];
    const playerList = Object.values(players).sort((a, b) => a.position - b.position);

    db.ref("game/state").update({
      revealedCards: nextRevealed,
      phase: nextRevealed.length >= gameState.totalCards ? "declaring" : "betting",
      currentBet: 0,
      dealerIndex: (gameState.dealerIndex + 1) % Math.max(1, playerList.length),
      currentPlayerTurn: "",
      lastAction: `Carta rivelata: ${value}${suit.symbol}`,
      timestamp: Date.now(),
    });

    // apply discard based on the full table values
    // (the effect above will also trigger discardMatchingCardsAgainstTable via listener; this ensures immediate reaction)
    discardMatchingCardsAgainstTable();

    const updates: any = {};
    Object.keys(players).forEach((id) => {
      updates[`game/players/${id}/lastBet`] = 0;
      updates[`game/players/${id}/hasActed`] = false;
    });
    db.ref().update(updates);
    setBetAmount(0.1);
  };

  /**
   * Reset hand admin:
   * - clear pot and revealedCards
   * - generate a new gameId so next hand yields new private hands
   * - do NOT delete players
   */
  const resetHandAdmin = () => {
    const newGameId = generateGameId();
    db.ref("game/state").update({
      pot: 0,
      revealedCards: [],
      currentBet: 0,
      phase: "lobby",
      gameId: newGameId,
      lastAction: "RESET MANO (pot e carte azzerati) - nuovo gameId generato",
      timestamp: Date.now(),
    });
    const updates: any = {};
    Object.keys(players).forEach((id) => {
      updates[`game/players/${id}/lastBet`] = 0;
      updates[`game/players/${id}/hasActed`] = false;
      updates[`game/players/${id}/declaredCount`] = null;
      updates[`game/players/${id}/privateHand`] = null; // cleared so startGame will reassign based on new gameId
    });
    db.ref().update(updates);
    toast({ title: "Reset mano", description: "Piatto e carte a terra azzerati. Nuovo gameId creato." });
  };

  /**
   * Bets and checks
   */
  const handleBet = () => {
    if (!gameState || !currentUser || gameState.currentPlayerTurn !== localPlayerId) return;
    const betVal = parseFloat(Math.max(0.1, Math.min(2.0, betAmount)).toFixed(2));
    const diff = parseFloat((betVal - currentUser.lastBet).toFixed(2));
    if (diff > currentUser.balance) {
      toast({ title: "Fiches insufficienti!" });
      return;
    }
    const updates: any = {};
    if (betVal > gameState.currentBet) {
      Object.keys(players).forEach((id) => (updates[`game/players/${id}/hasActed`] = id === localPlayerId));
    } else {
      updates[`game/players/${localPlayerId}/hasActed`] = true;
    }
    updates[`game/players/${localPlayerId}/balance`] = parseFloat((currentUser.balance - diff).toFixed(2));
    updates[`game/players/${localPlayerId}/lastBet`] = betVal;

    const playerList = Object.values(players).sort((a, b) => a.position - b.position);
    const currentIndex = playerList.findIndex((p) => p.id === localPlayerId);
    if (currentIndex === -1) {
      db.ref().update(updates);
      db.ref("game/state").update({ pot: parseFloat((gameState.pot + diff).toFixed(2)), currentBet: betVal, timestamp: Date.now() });
      return;
    }
    const nextIndex = (currentIndex + 1) % playerList.length;
    db.ref().update(updates);
    db.ref("game/state").update({
      pot: parseFloat((gameState.pot + diff).toFixed(2)),
      currentBet: betVal,
      currentPlayerTurn: playerList[nextIndex].id,
      timestamp: Date.now(),
    });
  };

  const handleCheck = () => {
    if (!gameState || !currentUser || gameState.currentPlayerTurn !== localPlayerId) return;
    const playerList = Object.values(players).sort((a, b) => a.position - b.position);
    const nextIndex = (playerList.findIndex((p) => p.id === localPlayerId) + 1) % playerList.length;
    db.ref(`game/players/${localPlayerId}`).update({ hasActed: true });
    db.ref("game/state").update({ currentPlayerTurn: playerList[nextIndex].id, timestamp: Date.now() });
  };

  /**
   * Declaration
   */
  const submitDeclaration = (count: number) => {
    if (!currentUser) return;
    const c = Math.max(0, Math.min(gameState?.handCardsCount || 5, Math.floor(count)));
    db.ref(`game/players/${currentUser.id}`).update({ declaredCount: c });
    setDeclareCountInput("");
  };

  /**
   * Scoring: K/Q/J/10 = 10, 2-9 numeric, Ace dynamic.
   */
  function cardValueForChoice(val: string, choice: "min" | "max") {
    if (val === "A") return choice === "min" ? 1 : 11;
    if (val === "K" || val === "Q" || val === "J" || val === "10") return 10;
    const num = parseInt(val, 10);
    return Number.isNaN(num) ? 0 : num;
  }
  function computeFinalScoreFromHandArray(hand: CardType[] = [], choice: "min" | "max") {
    return hand.reduce((acc, c) => acc + cardValueForChoice(c.value, choice), 0);
  }
  const submitFinal = (choice: "min" | "max") => {
    if (!currentUser) return;
    const hand = currentUser.privateHand || myPrivateHand;
    const score = computeFinalScoreFromHandArray(hand, choice);
    db.ref(`game/players/${currentUser.id}`).update({ choice, finalScore: score });
  };

  /**
   * Calculate winners
   */
  const calculateWinners = (specialWinnerId?: string) => {
    if (!gameState) return;
    const updates: any = {};
    Object.values(players).forEach((p) => {
      if (p.choice && (p.finalScore === undefined || p.finalScore === null)) {
        const sc = computeFinalScoreFromHandArray(p.privateHand || [], p.choice);
        updates[`game/players/${p.id}/finalScore`] = sc;
      }
    });
    if (Object.keys(updates).length > 0) db.ref().update(updates);

    const playerList = Object.values(players).filter((p) => p.choice && p.finalScore !== undefined);
    const pot = gameState.pot;
    const winnerUpdates: any = {};
    const winnersInfo: string[] = [];

    if (specialWinnerId) {
      const w = players[specialWinnerId];
      if (w) {
        winnerUpdates[`game/players/${w.id}/balance`] = parseFloat((players[w.id].balance + pot).toFixed(2));
        winnersInfo.push(`${w.username} [JACKPOT]`);
      }
    } else {
      const runCategory = (cat: "min" | "max", potShare: number) => {
        const eligible = playerList.filter((p) => p.choice === cat);
        if (eligible.length === 0) return;
        const bestVal = cat === "min" ? Math.min(...eligible.map((p) => p.finalScore!)) : Math.max(...eligible.map((p) => p.finalScore!));
        const winners = eligible.filter((p) => p.finalScore === bestVal);
        winners.forEach((winner) => {
          const split = parseFloat((potShare / winners.length).toFixed(2));
          winnerUpdates[`game/players/${winner.id}/balance`] = parseFloat((players[winner.id].balance + split).toFixed(2));
          winnersInfo.push(`${winner.username} (${cat})`);
        });
      };
      const hasMin = playerList.some((p) => p.choice === "min");
      const hasMax = playerList.some((p) => p.choice === "max");
      if (hasMin && hasMax) {
        runCategory("min", pot / 2);
        runCategory("max", pot / 2);
      } else if (hasMin) {
        runCategory("min", pot);
      } else if (hasMax) {
        runCategory("max", pot);
      }
    }

    if (Object.keys(winnerUpdates).length > 0) db.ref().update(winnerUpdates);
    if (winnersInfo.length > 0) db.ref("game/history").push({ winners: winnersInfo.join(", "), pot, timestamp: Date.now() });
    db.ref("game/state").update({ phase: "results", timestamp: Date.now() });
  };

  /**
   * Helpers
   */
  const setClampedBet = (val: number) => {
    const clamped = parseFloat(Math.max(0.1, Math.min(2.0, val)).toFixed(2));
    setBetAmount(clamped);
  };

  const handleLogout = () => {
    if (localPlayerId) db.ref(`game/players/${localPlayerId}`).remove();
    localStorage.removeItem("poker_player_id");
    setLocalPlayerId(null);
    setIsAdminMode(false);
  };

  const returnToLobby = () => db.ref("game/state").update({ phase: "lobby" });

  /**
   * Render
   * - Cards (table & hand) use white background with clear black/red text.
   * - Players list box contains only: Name, Balance, optional 'PRONTO' badge and LAS VEGAS button.
   * - RESET MANO exists and creates a new gameId and clears table/pot but keeps players.
   */
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center space-y-6">
        <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ repeat: Infinity, duration: 2, repeatType: "reverse" }}>
          <Trophy className="w-20 h-20 text-[#D4AF37]" />
        </motion.div>
        <div className="text-[#D4AF37] font-black italic text-4xl uppercase tracking-tighter">Inizializzazione Tavolo...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 font-sans selection:bg-[#D4AF37] overflow-x-hidden relative">
      {/* background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#004225] rounded-full blur-[150px] opacity-20" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#D4AF37] rounded-full blur-[150px] opacity-10" />
      </div>

      {/* header */}
      <header className="max-w-7xl mx-auto flex justify-between items-center mb-10 relative z-10 border-b border-white/5 pb-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-gradient-to-br from-[#D4AF37] to-[#996515] rounded-2xl flex items-center justify-center shadow-xl rotate-3">
            <Trophy className="text-black w-8 h-8" />
          </div>
          <div>
            <h1 className="text-4xl md:text-5xl font-black text-white italic uppercase tracking-tighter flex items-center gap-2">
              LAS VEGAS <span className="text-[#D4AF37]">LIVE</span>
            </h1>
            <div className="flex items-center gap-2 text-[10px] text-white/40 font-bold uppercase tracking-[0.3em]">
              <ShieldCheck className="w-3 h-3 text-[#50C878]" /> Server Sicuro: Criptato
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end">
            <span className="text-[10px] text-white/20 font-black uppercase">Stato Connessione</span>
            <span className="text-[#50C878] text-xs font-black uppercase flex items-center gap-1">
              <span className="w-2 h-2 bg-[#50C878] rounded-full animate-pulse" /> Online
            </span>
          </div>
          {currentUser && (
            <Button variant="outline" onClick={() => { if (localPlayerId) db.ref(`game/players/${localPlayerId}`).remove(); handleLogout(); }} className="border-red-900/30 text-red-500 hover:bg-red-500 hover:text-white font-black rounded-xl px-6 transition-all">
              ESCI
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        {/* left column */}
        <div className="lg:col-span-3 space-y-6">
          {/* login */}
          {!currentUser && (
            <Card className="bg-zinc-900/80 border-[#D4AF37]/20 border-2 backdrop-blur-xl shadow-2xl overflow-hidden rounded-[30px]">
              <div className="p-8 space-y-5">
                <div className="text-center space-y-1">
                  <h2 className="text-2xl font-black italic uppercase text-white">BENVENUTO</h2>
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Inserisci i tuoi dati</p>
                </div>
                <Input placeholder="IL TUO NICKNAME" className="h-14 bg-black/40 border-white/5 text-center font-black italic text-xl rounded-2xl" value={tempName} onChange={e => setTempName((e.target as HTMLInputElement).value)} />
                <Input type="password" placeholder="PASSWORD" className="h-14 bg-black/40 border-white/5 text-center text-xl rounded-2xl" value={adminPassword} onChange={e => setAdminPassword((e.target as HTMLInputElement).value)} />
                <Input type="number" placeholder="BUDGET €" className="h-14 bg-black/40 border-white/5 text-center text-xl font-black rounded-2xl" value={budgetInput} onChange={e => setBudgetInput((e.target as HTMLInputElement).value)} />
                <Button onClick={tempName.toLowerCase() === 'diro' ? handleAdminLogin : joinGame} className={`w-full h-16 ${tempName.toLowerCase() === 'diro' ? 'bg-[#D4AF37]' : 'bg-[#50C878]'} text-black font-black rounded-2xl text-lg`}>
                  {tempName.toLowerCase() === 'diro' ? 'ACCEDI COME BOSS' : 'GIOCA ORA'}
                </Button>
              </div>
            </Card>
          )}

          {/* admin panel */}
          {isAdminMode && (
            <Card className="bg-black/90 border-[#D4AF37] border-2 shadow-[0_0_50px_rgba(212,175,55,0.1)] p-5 rounded-[30px]">
              <div className="flex items-center gap-2 mb-6 border-b border-[#D4AF37]/20 pb-4">
                <Settings2 className="w-5 h-5 text-[#D4AF37]" />
                <span className="font-black text-xs uppercase italic text-[#D4AF37]">Pannello di Controllo Boss</span>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-[9px] text-white/30 font-black uppercase ml-1">Configurazione Round</label>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {[5,6,7].map(n => (
                      <Button key={n} onClick={() => startGame(gameState?.totalCards || 5, n)} className={`h-10 text-[10px] font-black rounded-lg ${gameState?.handCardsCount === n ? 'bg-[#D4AF37] text-black' : 'bg-white/5'}`}>
                        {n} CARTE
                      </Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {[3,4,5].map(n => (
                      <Button key={n} onClick={() => startGame(n, gameState?.handCardsCount || 5)} className={`h-10 text-[10px] font-black rounded-lg ${gameState?.totalCards === n ? 'bg-[#D4AF37] text-black' : 'bg-white/5'}`}>
                        {n} A TERRA
                      </Button>
                    ))}
                  </div>
                </div>

                <Button onClick={revealNextCard} disabled={gameState?.phase !== 'betting'} className="w-full h-14 bg-gradient-to-r from-[#D4AF37] to-[#996515] text-black font-black text-sm uppercase italic rounded-xl">
                  PROSSIMA CARTA
                </Button>

                <div className="pt-4 space-y-2">
                  <p className="text-[8px] text-white/20 text-center uppercase font-black">Assegna Dealer</p>
                  <div className="flex flex-wrap gap-1 justify-center">
                    {Object.values(players).map(p => (
                      <Button key={p.id} onClick={() => setManualDealer(p.id)} variant="ghost" className="h-6 px-3 text-[9px] font-bold border border-white/5 rounded-full">
                        {p.username}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="pt-6">
                  <Button onClick={resetHandAdmin} className="h-12 w-full bg-[#D4AF37] text-black font-black uppercase mb-2">RESET MANO</Button>
                  <Button onClick={deletePlayersAndHistory} variant="destructive" className="h-12 w-full text-white font-black uppercase">CANCELLA GIOCATORI</Button>
                </div>
              </div>
            </Card>
          )}

          {/* wallet / pot / history */}
          <div className="bg-gradient-to-br from-zinc-800 to-black p-6 rounded-[35px] border border-white/10 shadow-2xl relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#D4AF37] rounded-full blur-[60px] opacity-10 group-hover:opacity-20 transition-opacity" />
            <div className="relative z-10 flex flex-col items-center">
              <span className="text-[10px] font-black uppercase text-[#D4AF37] tracking-[0.4em] mb-2">Il Tuo Saldo</span>
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-black italic text-white tabular-nums">{currentUser?.balance?.toFixed(2) || "0.00"}</span>
                <span className="text-2xl font-black text-[#D4AF37]">€</span>
              </div>
              <div className="mt-4 flex gap-2">
                <Badge className="bg-[#50C878]/10 text-[#50C878] border-[#50C878]/20 font-black text-[9px]">ATTIVO</Badge>
                <Badge className="bg-white/5 text-white/40 border-white/10 font-black text-[9px]">ID: {localPlayerId?.slice(0,5)}</Badge>
              </div>
            </div>
          </div>

          <div className="bg-[#004225] p-8 rounded-[40px] border-b-8 border-black/40 shadow-inner flex flex-col items-center relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/felt.png')] opacity-20" />
            <Coins className="w-8 h-8 text-[#D4AF37]/30 mb-2" />
            <span className="text-[#D4AF37] text-[10px] font-black uppercase tracking-[0.5em] mb-1">PIATTO ATTUALE</span>
            <span className="text-5xl font-black italic text-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]">{gameState?.pot?.toFixed(2) || "0.00"}€</span>
          </div>

          <Card className="bg-black/40 border-white/5 border rounded-[30px] overflow-hidden">
            <div className="p-5 border-b border-white/5 flex items-center gap-2">
              <History className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-xs font-black uppercase tracking-widest text-white/80">Ultime Mani</span>
            </div>
            <div className="max-h-[250px] overflow-y-auto custom-scrollbar">
              {winHistory.length > 0 ? winHistory.map((h, i) => (
                <div key={i} className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black uppercase text-white leading-tight">{h.winners}</span>
                    <span className="text-[8px] text-white/20 font-bold">{new Date(h.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <span className="text-[#D4AF37] font-black italic text-lg tabular-nums">+{h.pot.toFixed(2)}€</span>
                </div>
              )) : (
                <div className="p-10 text-center text-white/10 text-[9px] font-black uppercase italic tracking-widest">Nessuna vincita ancora</div>
              )}
            </div>
          </Card>
        </div>

        {/* center column: table */}
        <div className="lg:col-span-9 space-y-8">
          <div className="bg-[#014d2e] border-[15px] border-[#251a12] rounded-[100px] p-12 min-h-[500px] flex items-center justify-center relative shadow-[0_30px_100px_rgba(0,0,0,0.9),inset_0_0_150px_rgba(0,0,0,0.6)]">
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/felt.png')] opacity-20 pointer-events-none" />
            <div className="absolute inset-8 border-2 border-white/10 rounded-[85px] pointer-events-none" />

            {/* common cards center - white background */}
            <div className="flex flex-wrap gap-6 justify-center items-center relative z-20 mb-28">
              {Array.from({ length: gameState?.totalCards || 5 }).map((_, idx) => {
                const card = gameState?.revealedCards?.[idx];
                const isRevealed = !!card;
                return (
                  <div key={idx} className="w-24 h-36 md:w-32 md:h-44 relative perspective-1000">
                    <motion.div animate={{ rotateY: isRevealed ? 0 : 180 }} transition={{ duration: 0.8, type: "spring" }} style={{ transformStyle: "preserve-3d" }} className="w-full h-full relative">
                      {/* FRONT: white rectangle with clear text */}
                      <div className="absolute inset-0 bg-white rounded-2xl border-4 border-[#D4AF37] flex flex-col items-center justify-between py-4 px-2 backface-hidden shadow-2xl">
                        <div className={`w-full text-lg font-black italic ${card?.color === 'red' ? 'text-red-600' : 'text-black'}`}>{card?.value}{card?.suit}</div>
                        <div className={`text-6xl font-black ${card?.color === 'red' ? 'text-red-600' : 'text-black'}`}>{card?.suit}</div>
                        <div className={`w-full text-lg font-black italic rotate-180 ${card?.color === 'red' ? 'text-red-600' : 'text-black'}`}>{card?.value}{card?.suit}</div>
                      </div>
                      {/* BACK */}
                      <div style={{ transform: "rotateY(180deg)" }} className="absolute inset-0 bg-zinc-900 border-4 border-[#D4AF37]/50 rounded-2xl flex items-center justify-center backface-hidden shadow-inner">
                        <div className="absolute inset-0 bg-[radial-gradient(circle,#D4AF37_1px,transparent_1px)] bg-[size:15px_15px] opacity-10" />
                        <Target className="w-12 h-12 text-[#D4AF37]/20" />
                      </div>
                    </motion.div>
                  </div>
                );
              })}
            </div>

            {/* player's private cards: white rectangles with black/red text; stable per gameId */}
            {myPrivateHand.length > 0 && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-30 pointer-events-none">
                <div className="flex items-end -space-x-3">
                  {myPrivateHand.map((card, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ delay: i * 0.06 }}
                      className="w-12 h-18 md:w-14 md:h-20 bg-white rounded-md flex flex-col items-center justify-between py-1 px-1 shadow-2xl border border-zinc-300 relative"
                      style={{ zIndex: 40 + i }}
                    >
                      <span className={`text-[9px] font-black leading-none ${card.color === 'red' ? 'text-red-600' : 'text-black'}`}>{card.value}</span>
                      <span className={`text-base leading-none ${card.color === 'red' ? 'text-red-600' : 'text-black'}`}>{card.suit}</span>
                      <span className={`text-[9px] font-black leading-none rotate-180 ${card.color === 'red' ? 'text-red-600' : 'text-black'}`}>{card.value}</span>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* phase indicator */}
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md px-8 py-2 rounded-full border border-white/10 z-20">
              <span className="text-[10px] font-black uppercase text-[#D4AF37] tracking-[0.5em] italic">Fase: {gameState?.phase || 'Lobby'}</span>
            </div>
          </div>

          {/* actions area */}
          <AnimatePresence mode="wait">
            {gameState?.phase === "betting" && currentUser && gameState.currentPlayerTurn === localPlayerId && (
              <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-zinc-900 border-2 border-[#D4AF37] rounded-[50px] p-10 shadow-2xl relative">
                <div className="absolute top-0 right-0 p-4"><Zap className="w-10 h-10 text-[#D4AF37] opacity-10 animate-pulse" /></div>
                <div className="flex flex-col md:flex-row gap-12 items-center">
                  <div className="flex-1 w-full space-y-8">
                    <div className="flex justify-between items-end">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-black uppercase text-[#D4AF37] tracking-[0.4em]">Stai Puntando</span>
                        <span className="text-6xl font-black italic text-white tabular-nums">{betAmount.toFixed(2)}€</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] font-black uppercase text-white/30 block mb-1">Budget dopo puntata</span>
                        <span className="text-2xl font-black italic text-[#50C878]">{(currentUser.balance - (betAmount - currentUser.lastBet)).toFixed(2)}€</span>
                      </div>
                    </div>
                    <Slider value={[betAmount]} onValueChange={v => setClampedBet(v[0])} min={0.10} max={2.00} step={0.10} className="py-8" />
                  </div>
                  <div className="flex gap-4 w-full md:w-auto">
                    <Button onClick={handleCheck} disabled={currentUser.lastBet !== gameState.currentBet} className="h-24 flex-1 px-12 bg-black/50 border-2 border-white/10 text-white font-black italic uppercase rounded-3xl">CHECK</Button>
                    <Button onClick={handleBet} className="h-24 flex-1 px-12 bg-[#50C878] text-black font-black italic uppercase rounded-3xl shadow-2xl text-3xl">PUNTA</Button>
                  </div>
                </div>
              </motion.div>
            )}

            {gameState?.phase === "declaring" && currentUser && (currentUser.declaredCount === undefined || currentUser.declaredCount === null) && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-zinc-900 border-2 border-[#D4AF37] rounded-[40px] p-8 shadow-2xl text-center">
                <h3 className="text-2xl font-black text-white uppercase mb-2">DICHIARA LE CARTE</h3>
                <p className="text-sm text-white/40 mb-4">Inserisci quante carte hai (dopo gli scarti automatici)</p>
                <div className="flex items-center justify-center gap-4">
                  <Input type="number" min={0} max={gameState?.handCardsCount || 5} value={declareCountInput as any} onChange={e => setDeclareCountInput(e.target.value === "" ? "" : Math.max(0, Math.min(gameState?.handCardsCount || 5, parseInt((e.target as HTMLInputElement).value))))} className="h-14 w-40 text-center text-xl font-black" />
                  <Button onClick={() => typeof declareCountInput === "number" && submitDeclaration(declareCountInput)} className="h-14 bg-[#D4AF37] text-black font-black px-6 rounded-lg">DICHIARA</Button>
                </div>
              </motion.div>
            )}

            {gameState?.phase === "final" && currentUser && !currentUser.choice && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-zinc-900 border-4 border-zinc-800 rounded-[60px] p-12 text-center space-y-10 mx-auto w-full max-w-3xl">
                <div className="space-y-2">
                  <h2 className="text-6xl font-black italic uppercase tracking-tighter text-white">SCEGLI MIN O MAX</h2>
                  <p className="text-xs text-white/40 font-black uppercase tracking-[0.5em]">L'Asso vale 1 per MIN e 11 per MAX</p>
                </div>
                <div className="flex gap-8 justify-center">
                  <Button onClick={() => submitFinal("min")} className="flex-1 h-20 bg-zinc-800 text-white font-black text-2xl rounded-[30px] hover:bg-zinc-700">MIN</Button>
                  <Button onClick={() => submitFinal("max")} className="flex-1 h-20 bg-zinc-800 text-white font-black text-2xl rounded-[30px] hover:bg-zinc-700">MAX</Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* players list - cleaned: only Name, Balance, optional PRONTO badge, LAS VEGAS button */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 w-full pb-20">
            {Object.values(players).sort((a, b) => a.position - b.position).map((p) => {
              const isMe = p.id === localPlayerId;
              return (
                <motion.div key={p.id} layout className={`p-6 rounded-[40px] border-2 relative transition-all duration-500 ${isMe ? 'border-[#D4AF37] bg-[#D4AF37]/5' : 'border-white/5 bg-black/20'}`}>
                  {/* dealer indicator */}
                  {gameState?.dealerIndex === p.position && (
                    <div className="absolute -top-3 -left-3 w-14 h-14 bg-gradient-to-br from-[#D4AF37] to-[#996515] rounded-2xl flex items-center justify-center text-black font-black text-2xl shadow-xl">D</div>
                  )}

                  <div className="flex flex-col items-center text-center space-y-4">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-2">
                        {p.isAdmin && <Crown className="w-4 h-4 text-[#D4AF37]" />}
                        <span className="text-xs font-black uppercase text-white/50 tracking-widest">{p.username}</span>
                      </div>

                      <div className="text-3xl font-black italic tabular-nums text-white">{p.balance.toFixed(2)}€</div>

                      {p.hasActed === false && (
                        <Badge className="bg-[#50C878]/10 text-[#50C878] border-[#50C878]/20 font-black text-[9px] uppercase">PRONTO</Badge>
                      )}
                    </div>

                    {/* we intentionally do NOT show any card icons here (clean UI) */}

                    <div className="w-full flex justify-center mt-3">
                      <Button onClick={() => assignLasVegas(p.id)} disabled={!isAdminMode} className="h-9 text-[11px] px-3 font-black uppercase">
                        LAS VEGAS
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </main>

      {/* results overlay */}
      <AnimatePresence>
        {gameState?.phase === "results" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-2xl p-4">
            <motion.div initial={{ scale: 0.8, y: 50 }} animate={{ scale: 1, y: 0 }} className="bg-zinc-950 border-2 border-[#D4AF37] rounded-[60px] w-full max-w-2xl overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.8)]">
              <div className="bg-gradient-to-b from-[#D4AF37]/20 to-transparent p-12 text-center border-b border-[#D4AF37]/20">
                <Trophy className="w-20 h-20 text-[#D4AF37] mx-auto mb-4" />
                <h2 className="text-6xl font-black italic text-[#D4AF37] uppercase tracking-tighter">RISULTATI MANO</h2>
              </div>
              <div className="p-10 space-y-4 max-h-[45vh] overflow-y-auto custom-scrollbar">
                {Object.values(players).sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0)).map((p, idx) => (
                  <div key={p.id} className="flex justify-between items-center p-6 rounded-[30px] bg-white/[0.03] border border-white/5">
                    <div className="flex items-center gap-4">
                      <span className="text-2xl font-black text-white/20 italic">#{idx+1}</span>
                      <div className="flex flex-col">
                        <span className="font-black italic uppercase text-xl text-white">{p.username}</span>
                        <span className={`text-xs font-bold uppercase tracking-widest ${p.choice === 'min' ? 'text-blue-400' : 'text-red-400'}`}>{p.choice || 'NO CHOICE'}</span>
                      </div>
                    </div>
                    <div className="text-4xl font-black italic text-[#D4AF37]">{p.finalScore ?? '—'}</div>
                  </div>
                ))}
              </div>
              <div className="p-10 bg-black/50">
                {isAdminMode ? (
                  <Button onClick={returnToLobby} className="w-full h-20 bg-[#D4AF37] text-black font-black uppercase text-2xl italic shadow-2xl hover:brightness-110 active:scale-95 transition-all rounded-xl">
                    AVVIA NUOVA MANO
                  </Button>
                ) : (
                  <div className="flex items-center justify-center gap-4 text-[#D4AF37] font-black italic text-xl animate-pulse">
                    <Zap className="w-6 h-6" /> IN ATTESA DEL BOSS DIRO...
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* footer */}
      <footer className="max-w-7xl mx-auto py-20 border-t border-white/5 text-center relative z-10">
        <div className="flex flex-col items-center gap-4 opacity-30">
          <Trophy className="w-6 h-6" />
          <p className="text-[10px] font-black uppercase tracking-[1em]">Las Vegas Live Private System v4.0.2</p>
          <p className="text-[9px] font-bold">Antonio & Diro Partnership © 2026</p>
        </div>
      </footer>

      {/* styles */}
      <style>{`
        .perspective-1000 { perspective: 1000px; }
        .backface-hidden { backface-visibility: hidden; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #D4AF37; border-radius: 10px; }
        input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      `}</style>
    </div>
  );
}