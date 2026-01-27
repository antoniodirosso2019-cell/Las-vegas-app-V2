import { useState, useEffect, useCallback } from "react";
import { useFirebaseConnection } from "@/hooks/use-firebase-connection";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Trophy,
  History,
  FastForward,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type CardObj = { value: string; suit: string; color: string };

type GameState = {
  phase: "lobby" | "betting" | "revealing" | "final" | "results";
  pot: number;
  currentBet: number;
  revealedCards: CardObj[];
  totalCards: number; // cards on table
  handSize?: number; // cards in hand for each player
  adminId: string;
  dealerIndex: number;
  lastAction?: string;
  currentPlayerTurn?: string;
};

type Player = {
  id: string;
  username: string;
  balance: number;
  isAdmin: boolean;
  isBot: boolean;
  lastBet: number;
  finalScore?: number | null;
  choice?: "min" | "max" | null;
  position: number;
  hasActed: boolean;
  folded?: boolean;
  hand?: CardObj[] | null;
};

const SUITS = [
  { symbol: "♥", color: "red", name: "hearts" },
  { symbol: "♦", color: "red", name: "diamonds" },
  { symbol: "♣", color: "black", name: "clubs" },
  { symbol: "♠", color: "black", name: "spades" }
];

const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function buildDeck(): CardObj[] {
  const deck: CardObj[] = [];
  for (const v of VALUES) {
    for (const s of SUITS) {
      deck.push({ value: v, suit: s.symbol, color: s.color });
    }
  }
  return deck;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Home() {
  const { isConnected, isInitialized } = useFirebaseConnection();
  const { toast } = useToast();

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [localPlayerId, setLocalPlayerId] = useState<string | null>(localStorage.getItem("poker_player_id"));
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [betAmount, setBetAmount] = useState(0.10);
  const [finalScoreInput, setFinalScoreInput] = useState("");
  const [winHistory, setWinHistory] = useState<any[]>([]);
  const [usernameInput, setUsernameInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [tempName, setTempName] = useState("");

  const currentUser = localPlayerId ? players[localPlayerId] : null;

  useEffect(() => {
    if (!isConnected) return;
    const stateRef = db.ref("game/state");
    const playersRef = db.ref("game/players");
    const historyRef = db.ref("game/history");
    stateRef.on("value", (snapshot) => setGameState(snapshot.val()));
    playersRef.on("value", (snapshot) => {
      const p = snapshot.val() || {};
      setPlayers(p);
      if (localPlayerId && p[localPlayerId]?.isAdmin) {
        setIsAdminMode(true);
      }
    });
    historyRef.limitToLast(10).on("value", (snapshot) => {
      const val = snapshot.val();
      if (val) setWinHistory(Object.values(val).reverse());
      else setWinHistory([]);
    });
    return () => { stateRef.off(); playersRef.off(); historyRef.off(); };
  }, [isConnected, localPlayerId]);

  const getNextActivePlayerId = useCallback(() => {
    if (!gameState) return null;
    const playerList = Object.values(players)
      .filter(p => p && p.folded === false && p.balance > 0)
      .sort((a, b) => a.position - b.position);
    if (playerList.length <= 1) return null;

    const currentIndex = playerList.findIndex(p => p.id === gameState.currentPlayerTurn);
    if (currentIndex === -1) return playerList[0].id;

    const nextIndex = (currentIndex + 1) % playerList.length;
    return playerList[nextIndex].id;
  }, [gameState, players]);

  useEffect(() => {
    if (!gameState || !isConnected || !isAdminMode) return;
    const playerList = Object.values(players).filter(p => p && p.folded === false).sort((a, b) => a.position - b.position);
    if (playerList.length === 0) return;

    if (gameState.phase === "betting") {
      const allActed = playerList.every(p => p.hasActed);
      const allMatched = playerList.every(p => p.lastBet === gameState.currentBet);

      if (allActed && allMatched) {
        db.ref("game/state").update({ phase: "revealing" });
        return;
      }

      let currentTurnId = gameState.currentPlayerTurn;
      if (!currentTurnId) {
        const dealer = playerList[gameState.dealerIndex] || playerList[0];
        db.ref("game/state").update({ currentPlayerTurn: dealer.id });
        return;
      }

      const actingPlayer = players[currentTurnId];
      if (actingPlayer?.isBot) {
        const timeout = setTimeout(() => {
          const targetBet = Math.max(gameState.currentBet, 0.10);
          const diff = parseFloat((targetBet - actingPlayer.lastBet).toFixed(2));
          const updates: any = {};
          updates[`game/players/${actingPlayer.id}/lastBet`] = targetBet;
          updates[`game/players/${actingPlayer.id}/balance`] = parseFloat((actingPlayer.balance - diff).toFixed(2));
          updates[`game/players/${actingPlayer.id}/hasActed`] = true;

          const nextPlayerId = getNextActivePlayerId();

          db.ref().update(updates);
          db.ref("game/state").update({
            pot: parseFloat((gameState.pot + diff).toFixed(2)),
            currentBet: targetBet,
            lastAction: `${actingPlayer.username} punta`,
            currentPlayerTurn: nextPlayerId
          });
        }, 1200);
        return () => clearTimeout(timeout);
      }
    }

    if (gameState.phase === "revealing") {
      const timeout = setTimeout(() => revealNextCard(), 1500);
      return () => clearTimeout(timeout);
    }

    if (gameState.phase === "final") {
      const activePlayers = playerList.filter(p => p.username !== "");
      const declarations = activePlayers.filter(p => p.choice && p.finalScore !== undefined);

      const botsWithoutChoice = activePlayers.filter(p => p.isBot && !p.choice);
      if (botsWithoutChoice.length > 0) {
        const timeout = setTimeout(() => {
          const updates: any = {};
          botsWithoutChoice.forEach(bot => {
            updates[`game/players/${bot.id}/choice`] = Math.random() > 0.5 ? "max" : "min";
            updates[`game/players/${bot.id}/finalScore`] = Math.floor(Math.random() * 30) + 1;
          });
          db.ref().update(updates);
        }, 1000);
        return () => clearTimeout(timeout);
      }

      if (declarations.length === activePlayers.length && activePlayers.length > 0) {
        const timeout = setTimeout(() => calculateWinners(), 2000);
        return () => clearTimeout(timeout);
      }
    }
  }, [gameState, players, isConnected, isAdminMode, getNextActivePlayerId]);

  const joinGame = () => {
    if (!usernameInput.trim() || !budgetInput.trim()) return;
    const uniqueId = db.ref("game/players").push().key!;
    localStorage.setItem("poker_player_id", uniqueId);
    setLocalPlayerId(uniqueId);
    db.ref(`game/players/${uniqueId}`).set({
      id: uniqueId,
      username: usernameInput.trim(),
      balance: parseFloat(budgetInput),
      isAdmin: false,
      isBot: false,
      lastBet: 0,
      position: Object.keys(players).length,
      hasActed: false,
      folded: false,
      choice: null,
      finalScore: null,
      hand: null
    });
  };

  const isDiro = tempName.toLowerCase() === "diro";

  const handleAdminLogin = () => {
    if (adminPassword === "1234" && isDiro) {
      if (!budgetInput) return;
      const adminId = localStorage.getItem("poker_player_id") || db.ref("game/players").push().key!;
      localStorage.setItem("poker_player_id", adminId);
      setLocalPlayerId(adminId);
      setIsAdminMode(true);
      db.ref(`game/players/${adminId}`).set({
        id: adminId,
        username: "diro",
        balance: parseFloat(budgetInput),
        isAdmin: true,
        isBot: false,
        lastBet: 0,
        position: 0,
        hasActed: false,
        folded: false,
        choice: null,
        finalScore: null,
        hand: null
      });
    } else {
      toast({ title: "Errore", description: "Password errata o nome non autorizzato.", variant: "destructive" });
    }
  };

  // --- FIX LOGOUT: implement handleLogout to avoid runtime error ---
  const handleLogout = () => {
    localStorage.removeItem("poker_player_id");
    setLocalPlayerId(null);
    setIsAdminMode(false);
    // reload to reset in-memory state and listeners
    window.location.reload();
  };

  // Deal hands to all players and save to DB
  const dealHands = (handSize: number) => {
    const allPlayers = Object.values(players).filter(p => p && p.username && p.username !== "");
    if (allPlayers.length === 0) return;

    const deck = shuffle(buildDeck());
    const updates: any = {};
    let deckIndex = 0;

    allPlayers.forEach((p) => {
      const hand: CardObj[] = [];
      for (let i = 0; i < handSize; i++) {
        if (deckIndex >= deck.length) {
          deckIndex = 0;
        }
        hand.push(deck[deckIndex]);
        deckIndex++;
      }
      updates[`game/players/${p.id}/hand`] = hand;
    });

    updates["game/state/handSize"] = handSize;
    updates["game/state/lastAction"] = `Assegnate ${handSize} carte in mano`;
    db.ref().update(updates);
  };

  // Admin sets hand size (5,6,7) in DB and deals hands immediately
  const setHandSize = (n: number) => {
    db.ref("game/state").update({ handSize: n, lastAction: `Impostate ${n} carte in mano` });
    dealHands(n);
  };

  // startGame sets table cards (totalCards) and resets bets; will also ensure players' hands exist
  const startGame = (totalCards: number) => {
    const handSize = gameState?.handSize || 5;
    db.ref("game/state").set({
      phase: "betting",
      pot: 0,
      currentBet: 0,
      revealedCards: [],
      totalCards,
      handSize,
      adminId: localPlayerId || "admin",
      dealerIndex: 0,
      lastAction: `Inizio partita: ${totalCards} carte`,
      currentPlayerTurn: ""
    });
    const updates: any = {};
    Object.keys(players).forEach(id => {
      updates[`game/players/${id}/lastBet`] = 0;
      updates[`game/players/${id}/finalScore`] = null;
      updates[`game/players/${id}/choice`] = null;
      updates[`game/players/${id}/hasActed`] = false;
      updates[`game/players/${id}/folded`] = false;
    });
    db.ref().update(updates);

    dealHands(handSize);
  };

  const revealNextCard = () => {
    if (!gameState) return;
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    const value = VALUES[Math.floor(Math.random() * VALUES.length)];
    const nextCard = { value, suit: suit.symbol, color: suit.color };
    const nextRevealed = [...(gameState.revealedCards || []), nextCard];

    if (nextRevealed.length >= gameState.totalCards) {
      db.ref("game/state").update({ revealedCards: nextRevealed, phase: "final", currentBet: 0, lastAction: "Tutte le carte svelate!", currentPlayerTurn: "" });
    } else {
      db.ref("game/state").update({ revealedCards: nextRevealed, phase: "betting", currentBet: 0, lastAction: "Carta svelata!", currentPlayerTurn: "" });
    }

    const updates: any = {};
    Object.keys(players).forEach(id => {
      updates[`game/players/${id}/lastBet`] = 0;
      updates[`game/players/${id}/hasActed`] = false;
    });
    db.ref().update(updates);
    setBetAmount(0.10);
  };

  // --- FIX TASTO +BOT: add a single bot at a time ---
  const handleAddBot = () => {
    const r = db.ref("game/players").push();
    const botId = r.key!;
    const name = `Bot_${Math.floor(Math.random() * 1000)}`;
    const pos = Object.keys(players).length;
    r.set({ id: botId, username: name, balance: 100, isAdmin: false, isBot: true, lastBet: 0, position: pos, hasActed: false, folded: false, choice: null, finalScore: null, hand: null });
  };

  const handleBet = () => {
    if (!gameState || !currentUser || !localPlayerId) return;
    if (!isAdminMode && gameState.currentPlayerTurn !== localPlayerId) return;

    const betVal = parseFloat(betAmount.toFixed(2));
    const diff = parseFloat((betVal - (currentUser.lastBet || 0)).toFixed(2));
    if (diff > currentUser.balance) return;
    const updates: any = {};
    if (betVal > gameState.currentBet) { Object.keys(players).forEach(id => updates[`game/players/${id}/hasActed`] = id === localPlayerId); }
    else { updates[`game/players/${localPlayerId}/hasActed`] = true; }
    updates[`game/players/${localPlayerId}/balance`] = parseFloat((currentUser.balance - diff).toFixed(2));
    updates[`game/players/${localPlayerId}/lastBet`] = betVal;

    const nextPlayerId = getNextActivePlayerId();

    db.ref().update(updates);
    db.ref("game/state").update({
      pot: parseFloat((gameState.pot + diff).toFixed(2)),
      currentBet: betVal,
      lastAction: `${currentUser.username} punta ${betVal}€`,
      currentPlayerTurn: nextPlayerId || ""
    });
  };

  const handleCheck = () => {
    if (!gameState || !currentUser || !localPlayerId) return;
    if (!isAdminMode && gameState.currentPlayerTurn !== localPlayerId) return;

    if (currentUser.lastBet === gameState.currentBet) {
      const nextPlayerId = getNextActivePlayerId();
      db.ref(`game/players/${localPlayerId}`).update({ hasActed: true });
      db.ref("game/state").update({
        lastAction: `${currentUser.username} fa Check`,
        currentPlayerTurn: nextPlayerId || ""
      });
    }
  };

  const handleFold = () => {
    if (!gameState || !currentUser || !localPlayerId) return;
    if (!isAdminMode && gameState.currentPlayerTurn !== localPlayerId) return;

    const nextPlayerId = getNextActivePlayerId();
    db.ref(`game/players/${localPlayerId}`).update({ folded: true, hasActed: true });
    db.ref("game/state").update({
      lastAction: `${currentUser.username} Fold`,
      currentPlayerTurn: nextPlayerId || ""
    });
  };

  const submitFinal = (choice: "min" | "max") => {
    if (!currentUser || !finalScoreInput) return;
    db.ref(`game/players/${currentUser.id}`).update({ choice, finalScore: parseInt(finalScoreInput) });
  };

  const handleNextHand = () => {
    if (!isAdminMode) return;
    db.ref("game/state").update({ phase: "lobby", pot: 0, currentBet: 0, revealedCards: [] });
  };

  const calculateWinners = (specialWinnerId?: string) => {
    if (!gameState) return;
    const playerList = Object.values(players).filter(p => p && p.folded === false && p.choice && p.finalScore !== undefined);

    const pot = gameState.pot;
    const updates: any = {};
    const winnersInfo: string[] = [];

    if (specialWinnerId) {
      const winnerObj = players[specialWinnerId];
      if (winnerObj) {
        updates[`game/players/${winnerObj.id}/balance`] = parseFloat((players[winnerObj.id].balance + pot).toFixed(2));
        winnersInfo.push(`${winnerObj.username}: +${pot.toFixed(2)}€ (100%) [LAS VEGAS]`);
      }
    } else {
      if (playerList.length === 0) return;
      const processCategory = (category: "min" | "max", share: number) => {
        const candidates = playerList.filter(p => p.choice === category);
        if (candidates.length === 0) return 0;

        const bestScore = category === "min"
          ? Math.min(...candidates.map(p => p.finalScore!))
          : Math.max(...candidates.map(p => p.finalScore!));

        const winners = candidates.filter(p => p.finalScore === bestScore);
        const splitAmount = parseFloat((share / winners.length).toFixed(2));
        const percentage = Math.round((splitAmount / pot) * 100);

        winners.forEach(w => {
          updates[`game/players/${w.id}/balance`] = parseFloat((players[w.id].balance + splitAmount).toFixed(2));
          winnersInfo.push(`${w.username}: +${splitAmount}€ (${percentage}%) [${category.toUpperCase()}${winners.length > 1 ? ' Pareggio' : ''}]`);
        });

        return share;
      };

      const minCandidates = playerList.filter(p => p.choice === "min");
      const maxCandidates = playerList.filter(p => p.choice === "max");

      if (minCandidates.length > 0 && maxCandidates.length > 0) {
        processCategory("min", pot / 2);
        processCategory("max", pot / 2);
      } else if (minCandidates.length > 0) {
        processCategory("min", pot);
      } else if (maxCandidates.length > 0) {
        processCategory("max", pot);
      }
    }

    if (Object.keys(updates).length > 0) {
      db.ref().update(updates);
    }

    if (winnersInfo.length > 0) {
      db.ref("game/history").push({
        winners: winnersInfo.join(", "),
        pot: pot,
        timestamp: Date.now()
      });
    }

    db.ref("game/state").update({
      phase: "results",
      lastAction: specialWinnerId ? `LAS VEGAS: ${players[specialWinnerId]?.username} vince tutto!` : `Fine mano: ${winnersInfo.length} vincitori`
    });
  };

  const resetHand = () => {
    if (!gameState) return;
    db.ref("game/state").update({ phase: "betting", pot: 0, currentBet: 0, revealedCards: [], lastAction: "Mano resettata", currentPlayerTurn: "" });
    const updates: any = {};
    Object.keys(players).forEach(id => {
      updates[`game/players/${id}/lastBet`] = 0;
      updates[`game/players/${id}/finalScore`] = null;
      updates[`game/players/${id}/choice`] = null;
      updates[`game/players/${id}/hasActed`] = false;
      updates[`game/players/${id}/folded`] = false;
      updates[`game/players/${id}/hand`] = null;
    });
    db.ref().update(updates);
  };

  // delete players (except admin) and clear history and UI state
  const deletePlayersAndHistory = () => {
    if (!localPlayerId) return;
    const playersRef = db.ref("game/players");
    const historyRef = db.ref("game/history");
    const stateRef = db.ref("game/state");

    // Remove history from DB and UI
    historyRef.remove();
    setWinHistory([]);

    stateRef.update({
      phase: "lobby",
      pot: 0,
      currentBet: 0,
      revealedCards: [],
      totalCards: 5,
      lastAction: "Gioco e cronologia azzerati",
      history: null
    });

    playersRef.once("value", (snapshot) => {
      const allPlayers = snapshot.val() || {};
      const updates: any = {};
      let positionIndex = 0;
      Object.keys(allPlayers).forEach(id => {
        const player = allPlayers[id];
        if (id === localPlayerId) {
          // Reset admin player
          updates[id] = {
            ...player,
            balance: parseFloat(budgetInput) || player.balance,
            lastBet: 0,
            hasActed: false,
            choice: null,
            finalScore: null,
            position: positionIndex++,
            folded: false,
            hand: null
          };
        } else if (player.isBot) {
          // Reset bot balance to 100€ instead of deleting
          updates[id] = {
            ...player,
            balance: 100,
            lastBet: 0,
            hasActed: false,
            choice: null,
            finalScore: null,
            position: positionIndex++,
            folded: false,
            hand: null
          };
        } else {
          // Delete non-admin human players
          updates[id] = null;
        }
      });
      playersRef.update(updates);
    });
  };

  const systemWipe = () => { db.ref("game").remove(); localStorage.removeItem("poker_player_id"); setLocalPlayerId(null); setIsAdminMode(false); window.location.reload(); };
  const setManualDealer = (id: string) => { const p = players[id]; if (p) db.ref("game/state").update({ dealerIndex: p.position, currentPlayerTurn: p.id, lastAction: `Dealer forzato: ${p.username}` }); };

  if (!isInitialized) return <div className="min-h-screen bg-black flex items-center justify-center text-[#D4AF37] font-black italic text-4xl animate-pulse tracking-tighter">LAS VEGAS LIVE...</div>;

  // Helper: filtered current user's hand (Scarto Silenzioso)
  const filteredLocalHand = (() => {
    if (!currentUser?.hand || !gameState) return currentUser?.hand || [];
    const tableValues = new Set((gameState.revealedCards || []).map(c => c.value));
    // Scarto Silenzioso: hide cards that have same value as any revealed card
    return currentUser.hand.filter(c => !tableValues.has(c.value));
  })();

  return (
    <div className="min-h-screen bg-black text-white p-4 font-sans selection:bg-[#D4AF37] overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none opacity-20"><div className="w-[80vw] h-[80vh] bg-[#004225] rounded-[200px] blur-[120px] mx-auto mt-[10vh]" /></div>

      <AnimatePresence>
        {gameState?.phase === "results" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-black border-2 border-[#D4AF37] rounded-3xl w-full max-w-md overflow-hidden shadow-[0_0_50px_rgba(212,175,55,0.3)]">
              <div className="bg-[#D4AF37]/10 p-6 border-b border-[#D4AF37]/30 text-center"><h2 className="text-3xl font-black italic text-[#D4AF37] uppercase tracking-tighter">Resoconto Mano</h2></div>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {(() => {
                  const playerList = Object.values(players).filter(p => p && p.folded === false && p.choice && p.finalScore !== undefined);
                  const mins = [...playerList].sort((a,b) => (a.finalScore! - b.finalScore!));
                  const maxs = [...playerList].sort((a,b) => (b.finalScore! - a.finalScore!));
                  const minScore = mins[0]?.finalScore;
                  const maxScore = maxs[0]?.finalScore;
                  return Object.values(players).sort((a,b) => a.position - b.position).map(p => {
                    const isMinWinner = p.choice === "min" && p.finalScore === minScore;
                    const isMaxWinner = p.choice === "max" && p.finalScore === maxScore;
                    let winAmount = 0;
                    if (isMinWinner || isMaxWinner) {
                      const pot = gameState?.pot || 0;
                      const share = (minScore !== undefined && maxScore !== undefined) ? pot / 2 : pot;
                      const winnersInCategory = playerList.filter(pl => pl.choice === p.choice && pl.finalScore === p.finalScore).length;
                      winAmount = parseFloat((share / winnersInCategory).toFixed(2));
                    }
                    return (
                      <div key={p.id} className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex flex-col"><span className="font-black italic uppercase text-sm">{p.username} {p.folded ? '(FOLD)' : ''}</span><span className="text-[10px] text-white/50 uppercase font-bold">{p.choice || 'Nessuna scelta'}</span></div>
                        <div className="text-right"><span className="text-xl font-black italic text-white block leading-none">{p.finalScore ?? '-'}</span>{(isMinWinner || isMaxWinner) && <span className="text-[#50C878] text-[10px] font-black italic">+{winAmount.toFixed(2)}€</span>}</div>
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="p-6 bg-[#D4AF37]/5 border-t border-[#D4AF37]/30">
                {isAdminMode ? <Button onClick={handleNextHand} className="w-full h-14 bg-[#D4AF37] text-black font-black uppercase text-xl italic shadow-[0_6px_0_#996515] active:translate-y-1 active:shadow-none transition-all">Avanti</Button> : <p className="text-center text-[#D4AF37] font-black italic uppercase text-xs animate-pulse">In attesa dell'Admin...</p>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="max-w-7xl mx-auto flex justify-between items-center mb-6 relative z-10">
        <div className="flex items-center gap-3"><Trophy className="text-[#D4AF37] w-6 h-6 md:w-8 md:h-8" /><h1 className="text-2xl md:text-3xl font-black text-[#D4AF37] italic uppercase tracking-tighter">Las Vegas Live</h1></div>
        {currentUser && <Button variant="ghost" onClick={handleLogout} className="text-white/40 font-black h-8 hover:text-white transition-colors text-xs md:text-sm">ESCI</Button>}
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10 pb-20 px-2 sm:px-4 md:max-w-4xl lg:max-w-7xl">
        <div className="lg:col-span-3 space-y-4 w-full md:scale-90 origin-top-left transition-transform">
          {!currentUser && (
            <Card className="bg-black/95 border-[#D4AF37]/30 border-2 shadow-[0_0_20px_rgba(212,175,55,0.1)]">
              <CardContent className="space-y-4 pt-4 md:pt-6">
                <Input placeholder="NOME" className="h-10 md:h-12 bg-black/50 border-[#D4AF37]/30 text-center text-base md:text-sm font-black italic" value={tempName} onChange={e => {setTempName(e.target.value); setUsernameInput(e.target.value);}} />
                <Input type="password" placeholder="Password Admin" className="h-10 md:h-12 bg-black/50 border-[#D4AF37]/30 text-center text-base md:text-sm font-black italic" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} />
                <Input type="number" placeholder="Budget Gioco" className="h-10 md:h-12 bg-black/50 border-[#D4AF37]/30 text-center text-base md:text-sm font-black italic" value={budgetInput} onChange={e => setBudgetInput(e.target.value)} />
                {tempName.toLowerCase() === 'diro' ? <Button onClick={handleAdminLogin} className="w-full h-12 bg-[#D4AF37] text-black font-black uppercase text-xl italic shadow-[0_6px_0_#996515]">LOGIN BOSS</Button> : <Button onClick={joinGame} className="w-full h-12 bg-[#50C878] text-black font-black uppercase text-xl italic shadow-[0_6px_0_#004225]">GIOCA</Button>}
              </CardContent>
            </Card>
          )}

          {currentUser && (
            <div className="space-y-4">
              {isAdminMode && (
                <Card className="bg-black/95 border-[#D4AF37] border-2 shadow-2xl">
                  <CardContent className="p-3 space-y-3">
                    <div className="text-[9px] text-white/60 uppercase font-black mb-1">Carte in mano (per giocatore)</div>
                    <div className="grid grid-cols-3 gap-1 mb-2">
                      {[5,6,7].map(n => (
                        <Button
                          key={n}
                          onClick={() => setHandSize(n)}
                          variant="outline"
                          className={`h-7 text-[#50C878] text-[8px] font-black ${gameState?.handSize === n ? 'bg-[#50C878]/20' : ''}`}
                        >
                          {n} IN MANO
                        </Button>
                      ))}
                    </div>

                    <div className="text-[9px] text-white/60 uppercase font-black mb-1">Carte a terra</div>
                    <div className="grid grid-cols-3 gap-1">
                      {[4,5,6].map(n => (
                        <Button
                          key={n}
                          onClick={() => startGame(n)}
                          variant="outline"
                          className={`h-7 text-[#50C878] text-[8px] font-black ${gameState?.totalCards === n ? 'bg-[#50C878]/20' : ''}`}
                        >
                          {n} CARTE
                        </Button>
                      ))}
                    </div>

                    <div className="mt-3">
                      <Button onClick={revealNextCard} disabled={gameState?.phase !== 'betting'} className="w-full h-10 bg-[#D4AF37] text-black font-black text-[9px] shadow-[0_4px_0_#996515]"><FastForward className="w-3 h-3 mr-1" /> GIRA (FORZA)</Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <Button onClick={handleAddBot} variant="outline" className="h-8 border-[#D4AF37]/30 text-[#D4AF37] text-[8px] font-black">+BOT</Button>
                      <Button onClick={deletePlayersAndHistory} variant="outline" className="h-8 border-red-900/40 text-red-500 text-[8px] font-black uppercase">CANCELLA GIOCATORI</Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <Button onClick={resetHand} variant="outline" className="h-8 border-yellow-600/40 text-yellow-500 text-[8px] font-black uppercase">RESET MANO</Button>
                      <Button onClick={systemWipe} variant="destructive" className="h-8 text-[8px] font-black uppercase">SYSTEM WIPE</Button>
                    </div>

                    <div className="pt-2 border-t border-white/5 space-y-1">
                      <p className="text-[7px] text-white/30 text-center uppercase font-black">Assegna LAS VEGAS</p>
                      <div className="flex flex-wrap gap-1 justify-center">
                        {Object.values(players).map(p => <Button key={p.id} onClick={() => calculateWinners(p.id)} variant="ghost" className="h-5 px-1 text-[7px] uppercase font-bold text-yellow-500 hover:bg-yellow-500 hover:text-black">LAS VEGAS: {p.username}</Button>)}
                      </div>
                    </div>

                    <Button onClick={() => calculateWinners()} disabled={gameState?.phase !== 'final'} className="w-full h-10 bg-[#50C878] text-black font-black text-[9px] mt-3">FORZA CALCOLO</Button>

                    <div className="pt-2 border-t border-white/5 space-y-1">
                      <p className="text-[7px] text-white/30 text-center uppercase font-black">Sposta D</p>
                      <div className="flex flex-wrap gap-1 justify-center">
                        {Object.values(players).map(p => <Button key={p.id} onClick={() => setManualDealer(p.id)} variant="ghost" className="h-5 px-1 text-[7px] uppercase font-bold hover:bg-[#D4AF37] hover:text-black">{p.username}</Button>)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card className="bg-[#D4AF37]/10 border-[#D4AF37]/30 border-2 p-4 text-center"><h3 className="text-lg font-black italic text-[#D4AF37] uppercase">{currentUser?.username}</h3><p className="text-2xl font-black tabular-nums">{currentUser?.balance.toFixed(2)}€</p></Card>
            </div>
          )}
          <Card className="bg-[#004225]/40 border-[#50C878]/30 border-2 p-5 text-center shadow-[inset_0_0_30px_rgba(0,0,0,0.5)]">
            <span className="text-[#D4AF37] text-[10px] font-black uppercase block tracking-widest">Piatto Totale</span>
            <span className="text-4xl font-black italic tabular-nums text-white">{gameState?.pot?.toFixed(2) || "0.00"}€</span>
            <div className="mt-2 text-[9px] uppercase font-black italic text-[#50C878] tracking-[0.2em] border-t border-[#50C878]/20 pt-2">{gameState?.phase?.toUpperCase() || "LOBBY"}</div>
          </Card>

          <Card className="bg-black/95 border-[#D4AF37]/20 border overflow-hidden shadow-2xl">
            <CardHeader className="bg-[#D4AF37]/10 py-2 px-4 flex flex-row items-center gap-2 border-b border-white/5"><History className="w-3 h-3 text-[#D4AF37]" /><CardTitle className="text-[#D4AF37] text-[9px] font-black uppercase tracking-widest">🏆 Ultime Vincite</CardTitle></CardHeader>
            <CardContent className="p-0 max-h-[250px] overflow-y-auto custom-scrollbar bg-black/40">
              {winHistory.length > 0 ? winHistory.map((h, i) => (
                <div key={i} className="px-4 py-3 border-b border-white/5 flex justify-between items-center hover:bg-white/5 transition-colors">
                  <div className="flex flex-col gap-1"><span className="text-[10px] font-black uppercase text-white/90 leading-none">{h.winners}</span><span className="text-[8px] text-white/30 uppercase font-bold">{new Date(h.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>
                  <span className="text-[#D4AF37] font-black text-sm tabular-nums">+{h.pot.toFixed(2)}€</span>
                </div>
              )) : <div className="p-6 text-center text-white/20 text-[9px] uppercase font-black tracking-widest italic">Nessun dato registrato</div>}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-9 space-y-4 flex flex-col h-full md:scale-95 origin-top transition-transform">
          <div className="bg-[#004225] border-[10px] md:border-[14px] border-[#D4AF37]/30 rounded-[50px] md:rounded-[70px] p-4 md:p-8 min-h-[300px] md:min-h-[450px] flex items-center justify-center relative shadow-[inset_0_0_120px_rgba(0,0,0,0.9)] border-double">
            <div className="flex flex-wrap gap-2 md:gap-4 justify-center items-center w-full relative z-20">
              {Array.from({ length: gameState?.totalCards || 5 }).map((_, idx) => {
                const card = gameState?.revealedCards?.[idx];
                const rev = !!card;
                const isDuplicate = gameState?.revealedCards?.some((c, i) => i < idx && c.value === card?.value);
                if (rev && isDuplicate) return null; // hide duplicates silently
                return (
                  <div key={idx} className="w-12 h-20 md:w-20 md:h-32 relative perspective-1000">
                    <motion.div animate={{ rotateY: rev ? 0 : 180 }} transition={{ duration: 0.8, type: "spring" }} style={{ transformStyle: "preserve-3d" }} className="w-full h-full relative">
                      <div className="absolute inset-0 bg-white rounded-lg md:rounded-xl border-[2px] md:border-[4px] border-[#D4AF37] shadow-2xl backface-hidden flex flex-col items-center justify-between py-1 md:py-2 px-1">
                        <div className={`w-full flex justify-start pl-1 text-[10px] md:text-sm font-black italic leading-none ${card?.color === 'red' ? 'text-red-600' : 'text-black'}`}>{card?.value}{card?.suit}</div>
                        <div className={`text-xl md:text-3xl font-black ${card?.color === 'red' ? 'text-red-600' : 'text-black'}`}>{card?.suit}</div>
                        <div className={`w-full flex justify-end pr-1 text-[10px] md:text-sm font-black italic rotate-180 leading-none ${card?.color === 'red' ? 'text-red-600' : 'text-black'}`}>{card?.value}{card?.suit}</div>
                      </div>
                      <div style={{ transform: "rotateY(180deg)" }} className="absolute inset-0 bg-gradient-to-br from-black to-zinc-900 border-2 md:border-4 border-[#D4AF37]/40 rounded-lg md:rounded-xl flex items-center justify-center backface-hidden overflow-hidden shadow-xl">
                        <div className="w-full h-full bg-[radial-gradient(circle,rgba(212,175,55,0.1)_0%,transparent_70%)] absolute inset-0" /><Trophy className="w-4 h-4 md:w-8 md:h-8 text-[#D4AF37]/15 animate-pulse" />
                      </div>
                    </motion.div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Current player's hand (filtered by scarto silenzioso) - placed above the action menu */}
          {currentUser && (
            <div className="mx-auto w-full max-w-4xl">
              <div className="flex gap-3 justify-center items-center mb-3">
                {(filteredLocalHand || []).map((c, i) => (
                  <div key={i} className="w-10 h-16 md:w-14 md:h-20 relative perspective-1000">
                    <div className="absolute inset-0 bg-white rounded-lg md:rounded-xl border-2 border-[#D4AF37] flex flex-col items-center justify-between py-1 px-1">
                      <div className={`w-full flex justify-start pl-1 text-[10px] font-black italic ${c.color === 'red' ? 'text-red-600' : 'text-black'}`}>{c.value}{c.suit}</div>
                      <div className={`text-lg font-black ${c.color === 'red' ? 'text-red-600' : 'text-black'}`}>{c.suit}</div>
                      <div className={`w-full flex justify-end pr-1 text-[10px] font-black italic rotate-180 ${c.color === 'red' ? 'text-red-600' : 'text-black'}`}>{c.value}{c.suit}</div>
                    </div>
                  </div>
                ))}
                {(filteredLocalHand || []).length === 0 && (currentUser.hand && currentUser.hand.length > 0) && (
                  <div className="text-[10px] text-white/40 italic uppercase">Tutte le carte scartate</div>
                )}
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {(isAdminMode || (gameState?.phase === "betting" && currentUser && gameState.currentPlayerTurn === localPlayerId)) && (
              <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -50 }} className="relative z-50 my-8 bg-black/95 border-2 border-[#D4AF37] rounded-[30px] md:rounded-[50px] p-4 md:p-6 shadow-[0_0_50px_rgba(212,175,55,0.2)] mx-auto w-full max-w-4xl">
                <div className="flex flex-col md:flex-row gap-4 md:gap-8 items-center">
                  <div className="flex-1 w-full space-y-4">
                    <div className="flex justify-between items-end"><span className="text-3xl md:text-4xl font-black italic tabular-nums text-white">{betAmount.toFixed(2)}€</span><span className="text-base md:text-sm font-black italic text-[#50C878] truncate">Saldo: {currentUser ? (currentUser.balance - (betAmount - currentUser.lastBet)).toFixed(2) : "0.00"}€</span></div>
                    <Slider value={[betAmount]} onValueChange={v => setBetAmount(v[0])} min={0.10} max={2.00} step={0.1} className="py-2 md:py-4 [&_[role=slider]]:bg-[#D4AF37] [&_[role=slider]]:h-6 md:[&_[role=slider]]:h-8 [&_[role=slider]]:w-6 md:[&_[role=slider]]:w-8 [&_[role=slider]]:border-2 md:[&_[role=slider]]:border-4 [&_[role=slider]]:border-black [&_[role=slider]]:shadow-xl" />
                  </div>
                  <div className="flex gap-2 w-full md:w-auto">
                    <Button onClick={handleCheck} disabled={currentUser?.lastBet !== gameState?.currentBet && !isAdminMode} className="h-12 md:h-10 flex-1 md:py-1 md:px-3 bg-black border-2 border-[#D4AF37]/40 text-[#D4AF37] font-black text-lg md:text-[10px] italic rounded-xl uppercase break-words">CHECK</Button>
                    <Button onClick={handleBet} className="h-12 md:h-10 flex-1 md:py-1 md:px-3 bg-[#50C878] text-black font-black text-xl md:text-[10px] italic rounded-xl shadow-[0_4px_0_#004225] active:translate-y-1 active:shadow-none transition-all uppercase break-words">PUNTA</Button>
                    <Button onClick={handleFold} className="h-12 md:h-10 flex-1 md:py-1 md:px-3 bg-red-600 text-white font-black text-xl md:text-[10px] italic rounded-xl shadow-[0_4px_0_#7f1d1d] active:translate-y-1 active:shadow-none transition-all uppercase break-words">FOLD</Button>
                  </div>
                </div>
              </motion.div>
            )}
            {gameState?.phase === "final" && currentUser && !currentUser.choice && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-black/98 border-4 border-zinc-500 rounded-[60px] p-12 text-center space-y-8 mx-auto w-full max-w-2xl shadow-2xl">
                <h2 className="text-5xl font-black italic uppercase tracking-tighter text-white">DICHIARAZIONE FINALE</h2>
                <div className="space-y-2"><p className="text-[10px] text-white/40 font-black uppercase tracking-[0.3em]">Inserisci il tuo punteggio totale</p><Input type="number" className="h-24 text-center text-6xl font-black bg-black/50 border-4 border-zinc-500/40 text-white rounded-3xl" value={finalScoreInput} onChange={e => setFinalScoreInput(e.target.value)} placeholder="0" /></div>
                <div className="flex gap-6"><Button onClick={() => submitFinal("min")} className="flex-1 h-24 bg-zinc-700 text-white font-black text-3xl rounded-3xl shadow-[0_8px_0_#3f3f46] active:translate-y-2 active:shadow-none">MIN</Button><Button onClick={() => submitFinal("max")} className="flex-1 h-24 bg-zinc-700 text-white font-black text-3xl rounded-3xl shadow-[0_8px_0_#3f3f46] active:translate-y-2 active:shadow-none">MAX</Button></div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 w-full">
            {Object.values(players).sort((a,b) => a.position - b.position).map(p => (
              <motion.div key={p.id} layout className={`p-3 md:p-4 rounded-[30px] border-2 relative transition-all duration-500 shadow-xl ${p.id === localPlayerId ? 'border-[#D4AF37] bg-[#D4AF37]/15' : 'border-white/5 bg-black/70'} ${gameState?.currentPlayerTurn === p.id ? 'ring-2 ring-[#50C878] scale-105 z-30' : ''}`}>
                {gameState?.dealerIndex === p.position && <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-[#D4AF37] via-[#FFD700] to-[#996515] rounded-full flex items-center justify-center text-black font-black text-sm md:text-lg border-2 border-black/50 shadow-2xl z-40">D</div>}
                <div className="flex flex-col items-center text-center space-y-2 pt-2">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] md:text-xs font-black uppercase text-white/50 tracking-wider truncate w-full max-w-[100px] break-words">{p.username}</span>
                    {p.isAdmin && <Badge className="bg-[#D4AF37] text-black text-[7px] font-black h-3 px-1 border-none">BOSS</Badge>}
                  </div>

                  <div className="text-xl md:text-2xl font-black italic tabular-nums text-white">
                    {/* Privacy: show balance only for local player or during results */}
                    { (p.id === localPlayerId || gameState?.phase === 'results') ? `${p.balance.toFixed(2)}€` : (p.folded ? 'FOLDED' : (p.lastBet > 0 ? `Punta ${p.lastBet.toFixed(2)}€` : '')) }
                  </div>

                  <div className="h-12 md:h-14 flex flex-col justify-center items-center w-full gap-1">
                    {/* Show minimal last action (bet or fold) for privacy */}
                    {p.lastBet > 0 && <Badge className="bg-[#50C878]/10 text-[#50C878] text-[8px] md:text-[9px] font-black border-[#50C878]/30 uppercase px-2 py-0">Bet: {p.lastBet.toFixed(2)}€</Badge>}
                    {p.folded && <Badge className="bg-red-700 text-white text-[8px] md:text-[9px] font-black uppercase px-2 py-0">FOLD</Badge>}

                    {/* Show choice and finalScore only in results for everyone; local player can always see own declaration */}
                    {(((p.id === localPlayerId) && p.choice) || gameState?.phase === 'results') && p.choice && <Badge className={`w-full justify-center text-[9px] md:text-[10px] font-black italic rounded-lg ${gameState?.phase === 'results' ? (p.choice === 'min' ? 'bg-blue-600' : 'bg-red-600') : 'bg-zinc-800 text-[#D4AF37] border border-[#D4AF37]/30'} border-none uppercase py-0.5`}>{gameState?.phase === 'results' ? p.choice : 'DICHIARATO'}</Badge>}
                    {(gameState?.phase === 'results') && p.finalScore !== undefined && <span className="text-[10px] md:text-[11px] font-black text-[#D4AF37] mt-0.5">PUNTI: {p.finalScore}</span>}
                  </div>
                  {/* Admin button to set this player as dealer */}
                  {isAdminMode && gameState?.dealerIndex !== p.position && (
                    <Button onClick={() => setManualDealer(p.id)} variant="ghost" className="mt-2 h-6 px-2 text-[10px] text-[#D4AF37] hover:bg-[#D4AF37]/20 font-black uppercase border border-[#D4AF37]/30 rounded-full">D</Button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </main>

      <style>{` .perspective-1000 { perspective: 1000px; } .backface-hidden { backface-visibility: hidden; } .custom-scrollbar::-webkit-scrollbar { width: 5px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(212, 175, 55, 0.3); border-radius: 10px; } `}</style>
    </div>
  );
}