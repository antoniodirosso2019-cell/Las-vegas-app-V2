[file name]: Home.tsx
[file content begin]
import { useState, useEffect, useCallback, useRef } from "react";
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
  AlertCircle,
  Eye,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type CardObj = { value: string; suit: string; color: string };

type GameState = {
  phase: "lobby" | "betting" | "revealing" | "final" | "results";
  pot: number;
  currentBet: number;
  revealedCards: CardObj[];
  totalCards: number;
  handSize?: number;
  adminId: string;
  dealerIndex: number;
  lastAction?: string;
  currentPlayerTurn?: string;
  waitingForDealer?: boolean;
  isFirstHand?: boolean;
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
  totalBetThisHand?: number;
  originalHand?: CardObj[] | null;
  discardedCards?: CardObj[];
};

const SUITS = [
  { symbol: "♥", color: "red", name: "hearts" },
  { symbol: "♦", color: "red", name: "diamonds" },
  { symbol: "♣", color: "black", name: "clubs" },
  { symbol: "♠", color: "black", name: "spades" },
];

const VALUES = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

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

function calculateHandScore(hand: CardObj[], choice: "min" | "max"): number {
  if (!hand || hand.length === 0) return 0;

  return hand.reduce((total, card) => {
    let value = 0;

    if (card.value === "A") {
      value = choice === "max" ? 11 : 1;
    } else if (["J", "Q", "K"].includes(card.value)) {
      value = 10;
    } else {
      value = parseInt(card.value);
    }

    return total + value;
  }, 0);
}

function getFilteredHand(
  playerHand: CardObj[] | null | undefined,
  revealedCards: CardObj[] | null | undefined,
  debug: boolean = false,
): CardObj[] {
  if (!playerHand || playerHand.length === 0) {
    if (debug) console.log("🔍 getFilteredHand: playerHand vuota o null");
    return [];
  }

  if (!revealedCards || revealedCards.length === 0) {
    if (debug)
      console.log(
        "🔍 getFilteredHand: revealedCards vuota, restituisco tutta la mano",
        playerHand,
      );
    return playerHand;
  }

  const revealedValues = revealedCards.map((c) => c.value);
  if (debug) console.log("🔍 Valori rivelati:", revealedValues);

  const filtered = playerHand.filter((card) => {
    const isInRevealed = revealedValues.includes(card.value);
    if (debug && isInRevealed) {
      console.log(
        `🔍 Scarto carta: ${card.value}${card.suit} (valore presente nelle carte rivelate)`,
      );
    }
    return !isInRevealed;
  });

  if (debug) {
    console.log(
      "🔍 Mano originale:",
      playerHand.map((c) => `${c.value}${c.suit}`),
    );
    console.log(
      "🔍 Mano filtrata:",
      filtered.map((c) => `${c.value}${c.suit}`),
    );
    console.log("🔍 Carte scartate:", playerHand.length - filtered.length);
  }

  return filtered;
}

function getDiscardedCards(player: Player): CardObj[] {
  if (!player.originalHand || !player.hand) return [];

  const originalValues = player.originalHand.map((c) => `${c.value}${c.suit}`);
  const currentValues = player.hand.map((c) => `${c.value}${c.suit}`);

  return player.originalHand.filter(
    (card) => !currentValues.includes(`${card.value}${c.suit}`),
  );
}

export default function Home() {
  const { isConnected, isInitialized } = useFirebaseConnection();
  const { toast } = useToast();

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [localPlayerId, setLocalPlayerId] = useState<string | null>(
    localStorage.getItem("poker_player_id"),
  );
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [betAmount, setBetAmount] = useState(0.1);
  const [finalScoreInput, setFinalScoreInput] = useState("");
  const [winHistory, setWinHistory] = useState<any[]>([]);
  const [usernameInput, setUsernameInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [tempName, setTempName] = useState("");
  const [validationError, setValidationError] = useState("");
  const [handSizeSelection, setHandSizeSelection] = useState<number | null>(
    null,
  );
  const [totalCardsSelection, setTotalCardsSelection] = useState<number | null>(
    null,
  );
  const [dealerSelectedForNextHand, setDealerSelectedForNextHand] =
    useState<boolean>(false);
  const [showDebugPopup, setShowDebugPopup] = useState(false);

  const currentUser = localPlayerId ? players[localPlayerId] : null;

  const notifiedPlayersRef = useRef<Set<string>>(new Set());
  const gameStartAttemptedRef = useRef<boolean>(false);
  const botActionBlockedRef = useRef<boolean>(false);
  const debugScartoRef = useRef<boolean>(false);

  const getNextActivePlayerId = useCallback(() => {
    if (!gameState) return null;
    const playerList = Object.values(players)
      .filter((p) => p && p.folded === false && p.balance > 0)
      .sort((a, b) => a.position - b.position);
    if (playerList.length <= 1) return null;

    const currentIndex = playerList.findIndex(
      (p) => p.id === gameState.currentPlayerTurn,
    );
    if (currentIndex === -1) return playerList[0].id;

    const nextIndex = (currentIndex + 1) % playerList.length;
    return playerList[nextIndex].id;
  }, [gameState, players]);

  // NOTIFICA LAS VEGAS
  useEffect(() => {
    if (!gameState || !isAdminMode) return;

    Object.entries(players).forEach(([id, player]) => {
      if (
        player &&
        !player.folded &&
        Array.isArray(player.hand) &&
        player.hand.length === 0
      ) {
        const notificationKey = `${id}-zero-cards`;

        if (!notifiedPlayersRef.current.has(notificationKey)) {
          toast({
            title: "⚠️ LAS VEGAS RILEVATO",
            description: `Il giocatore ${player.username} ha 0 carte. Assegna il Las Vegas!`,
            duration: 5000,
            position: "top-center",
          });
          notifiedPlayersRef.current.add(notificationKey);
        }
      } else {
        const notificationKey = `${id}-zero-cards`;
        if (player.hand && player.hand.length > 0) {
          notifiedPlayersRef.current.delete(notificationKey);
        }
      }
    });
  }, [players, gameState, isAdminMode, toast]);

  useEffect(() => {
    if (!isConnected) return;
    const stateRef = db.ref("game/state");
    const playersRef = db.ref("game/players");
    const historyRef = db.ref("game/history");

    stateRef.on("value", (snapshot) => {
      const data = snapshot.val();
      setGameState(data);

      if (data && data.phase === "betting") {
        gameStartAttemptedRef.current = false;
      }

      if (data && data.waitingForDealer) {
        botActionBlockedRef.current = true;
      } else {
        botActionBlockedRef.current = false;
      }
    });

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

    return () => {
      stateRef.off();
      playersRef.off();
      historyRef.off();
    };
  }, [isConnected, localPlayerId]);

  // EFFETTO PER DEBUG SCARTO SILENZIOSO
  useEffect(() => {
    if (debugScartoRef.current && currentUser && gameState) {
      const filteredHand = getFilteredHand(
        currentUser.hand,
        gameState.revealedCards,
        true,
      );
      console.log("=== DEBUG SCARTO SILENZIOSO ===");
      console.log("Giocatore:", currentUser.username);
      console.log(
        "Mano originale:",
        currentUser.hand?.map((c) => `${c.value}${c.suit}`),
      );
      console.log(
        "Carte rivelate:",
        gameState.revealedCards?.map((c) => `${c.value}${c.suit}`),
      );
      console.log(
        "Mano filtrata:",
        filteredHand.map((c) => `${c.value}${c.suit}`),
      );
      console.log("=============================");
    }
  }, [currentUser, gameState]);

  // LOGICA BOT MIGLIORATA CON BLOCCAGGIO DURANTE WAITING FOR DEALER
  useEffect(() => {
    if (
      !gameState ||
      !isConnected ||
      gameState.phase !== "betting" ||
      gameState.waitingForDealer
    ) {
      return;
    }

    const currentTurnId = gameState.currentPlayerTurn;
    if (!currentTurnId) return;

    const currentPlayer = players[currentTurnId];
    if (!currentPlayer || !currentPlayer.isBot) return;

    if (botActionBlockedRef.current) {
      return;
    }

    const timeout = setTimeout(
      () => {
        const currentBet = gameState.currentBet || 0;
        const lastBet = currentPlayer.lastBet || 0;
        const balance = currentPlayer.balance || 0;

        const diff = Math.max(0, parseFloat((currentBet - lastBet).toFixed(2)));

        if (currentBet === 0 || currentBet <= lastBet) {
          db.ref(`game/players/${currentTurnId}`).update({
            hasActed: true,
            lastBet: currentBet,
          });

          db.ref("game/state").update({
            lastAction: `${currentPlayer.username} fa Check`,
            currentPlayerTurn: getNextActivePlayerId() || "",
          });
        } else if (diff > balance) {
          db.ref(`game/players/${currentTurnId}`).update({
            folded: true,
            hasActed: true,
          });

          db.ref("game/state").update({
            lastAction: `${currentPlayer.username} Fold (saldo insufficiente)`,
            currentPlayerTurn: getNextActivePlayerId() || "",
          });
        } else {
          const updates: any = {};
          updates[`game/players/${currentTurnId}/balance`] = parseFloat(
            (balance - diff).toFixed(2),
          );
          updates[`game/players/${currentTurnId}/lastBet`] = currentBet;
          updates[`game/players/${currentTurnId}/hasActed`] = true;
          updates[`game/players/${currentTurnId}/totalBetThisHand`] =
            (currentPlayer.totalBetThisHand || 0) + diff;

          const nextPlayerId = getNextActivePlayerId();

          db.ref("game/state").update({
            pot: parseFloat(((gameState.pot || 0) + diff).toFixed(2)),
            lastAction: `${currentPlayer.username} punta ${diff.toFixed(2)}€`,
            currentPlayerTurn: nextPlayerId || "",
          });

          db.ref().update(updates);
        }
      },
      1500 + Math.random() * 1000,
    );

    return () => clearTimeout(timeout);
  }, [gameState, players, isConnected, getNextActivePlayerId]);

  // LOGICA ADMIN MIGLIORATA
  useEffect(() => {
    if (!gameState || !isConnected || !isAdminMode) return;

    if (gameState.waitingForDealer) {
      return;
    }

    const playerList = Object.values(players)
      .filter((p) => p && p.folded === false)
      .sort((a, b) => a.position - b.position);
    if (playerList.length === 0) return;

    if (gameState.phase === "betting") {
      const allActed = playerList.every((p) => p.hasActed);
      const allMatched = playerList.every(
        (p) => p.lastBet === gameState.currentBet,
      );

      if (allActed && allMatched) {
        db.ref("game/state").update({ phase: "revealing" });
        return;
      }

      let currentTurnId = gameState.currentPlayerTurn;
      if (!currentTurnId) {
        const dealerPlayer =
          playerList.find((p) => p.position === gameState.dealerIndex) ||
          playerList[0];

        db.ref("game/state").update({
          currentPlayerTurn: dealerPlayer.id,
        });
        return;
      }

      const actingPlayer = players[currentTurnId];
      if (actingPlayer?.isBot) {
        return;
      }
    }

    if (gameState.phase === "revealing") {
      const timeout = setTimeout(() => revealNextCard(), 1500);
      return () => clearTimeout(timeout);
    }

    if (gameState.phase === "final") {
      const activePlayers = playerList.filter((p) => p.username !== "");
      const declarations = activePlayers.filter(
        (p) => p.choice && p.finalScore !== undefined,
      );

      const botsWithoutChoice = activePlayers.filter(
        (p) => p.isBot && !p.choice,
      );
      if (botsWithoutChoice.length > 0) {
        const timeout = setTimeout(() => {
          const updates: any = {};
          botsWithoutChoice.forEach((bot) => {
            const choice = Math.random() > 0.5 ? "max" : "min";

            const filteredHand = getFilteredHand(
              bot.hand,
              gameState?.revealedCards,
            );
            const finalScore = calculateHandScore(filteredHand, choice);

            updates[`game/players/${bot.id}/choice`] = choice;
            updates[`game/players/${bot.id}/finalScore`] = finalScore;
          });
          db.ref().update(updates);
        }, 1000);
        return () => clearTimeout(timeout);
      }

      if (
        declarations.length === activePlayers.length &&
        activePlayers.length > 0
      ) {
        const timeout = setTimeout(() => calculateWinners(), 2000);
        return () => clearTimeout(timeout);
      }
    }
  }, [gameState, players, isConnected, isAdminMode, getNextActivePlayerId]);

  // FUNZIONE JOIN GAME CON CONTROLLO NOMI DUPLICATI COMPLETO
  const joinGame = () => {
    if (!usernameInput.trim() || !budgetInput.trim()) {
      toast({
        title: "Campi mancanti",
        description: "Inserisci nome e budget per giocare",
        variant: "destructive",
      });
      return;
    }

    const username = usernameInput.trim();
    const budget = parseFloat(budgetInput);

    if (budget <= 0) {
      toast({
        title: "Budget non valido",
        description: "Il budget deve essere maggiore di 0",
        variant: "destructive",
      });
      return;
    }

    // CONTROLLO UNICITÀ DEL NOME (case-insensitive)
    const existingPlayers = Object.values(players);
    const usernameExists = existingPlayers.some(
      (p) =>
        p &&
        p.username.toLowerCase() === username.toLowerCase() &&
        !p.folded
    );

    if (usernameExists) {
      toast({
        title: "Nome già in uso",
        description: "Un giocatore con questo nome è già presente nella partita.",
        variant: "destructive",
      });
      return;
    }

    const uniqueId = db.ref("game/players").push().key!;
    localStorage.setItem("poker_player_id", uniqueId);
    setLocalPlayerId(uniqueId);
    db.ref(`game/players/${uniqueId}`).set({
      id: uniqueId,
      username: username,
      balance: budget,
      isAdmin: false,
      isBot: false,
      lastBet: 0,
      position: Object.keys(players).length,
      hasActed: false,
      folded: false,
      choice: null,
      finalScore: null,
      hand: null,
      originalHand: null,
      totalBetThisHand: 0,
      discardedCards: [],
    });

    toast({
      title: "Benvenuto!",
      description: `${username} è entrato nel gioco con ${budget}€`,
    });
  };

  const isDiro = tempName.toLowerCase() === "diro";

  // FUNZIONE ADMIN LOGIN CON CONTROLLO NOMI DUPLICATI
  const handleAdminLogin = () => {
    if (adminPassword !== "1234" || !isDiro) {
      toast({
        title: "Errore",
        description: "Password errata o nome non autorizzato.",
        variant: "destructive",
      });
      return;
    }

    if (!budgetInput) {
      toast({
        title: "Budget mancante",
        description: "Inserisci un budget per l'admin",
        variant: "destructive",
      });
      return;
    }

    const budget = parseFloat(budgetInput);
    if (budget <= 0) {
      toast({
        title: "Budget non valido",
        description: "Il budget deve essere maggiore di 0",
        variant: "destructive",
      });
      return;
    }

    // CONTROLLO UNICITÀ DEL NOME "diro"
    const existingPlayers = Object.values(players);
    const diroExists = existingPlayers.some(
      (p) =>
        p &&
        p.username.toLowerCase() === "diro" &&
        !p.folded
    );

    if (diroExists) {
      toast({
        title: "Admin già presente",
        description: "L'admin 'diro' è già nel gioco",
        variant: "destructive",
      });
      return;
    }

    const adminId =
      localStorage.getItem("poker_player_id") ||
      db.ref("game/players").push().key!;
    localStorage.setItem("poker_player_id", adminId);
    setLocalPlayerId(adminId);
    setIsAdminMode(true);
    db.ref(`game/players/${adminId}`).set({
      id: adminId,
      username: "diro",
      balance: budget,
      isAdmin: true,
      isBot: false,
      lastBet: 0,
      position: 0,
      hasActed: false,
      folded: false,
      choice: null,
      finalScore: null,
      hand: null,
      originalHand: null,
      totalBetThisHand: 0,
      discardedCards: [],
    });

    toast({
      title: "Accesso Admin",
      description: "Accesso come diro completato",
    });
  };

  const handleLogout = () => {
    localStorage.removeItem("poker_player_id");
    setLocalPlayerId(null);
    setIsAdminMode(false);
    window.location.reload();
  };

  const dealHands = (handSize: number) => {
    const allPlayers = Object.values(players).filter(
      (p) => p && p.username && p.username !== "",
    );
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
      updates[`game/players/${p.id}/originalHand`] = hand;
      updates[`game/players/${p.id}/discardedCards`] = [];
    });

    updates["game/state/handSize"] = handSize;
    updates["game/state/lastAction"] = `Assegnate ${handSize} carte in mano`;
    db.ref().update(updates);
  };

  // FUNZIONE CORRETTA PER SCARTO SILENZIOSO - SCARTA SOLO DALLE MANI, MAI DAL TAVOLO
  const applySilentDiscard = () => {
    if (!gameState || !players) return;

    const lastRevealedCard =
      gameState.revealedCards?.[gameState.revealedCards.length - 1];
    if (!lastRevealedCard) return;

    const updates: any = {};
    let anyDiscard = false;

    Object.keys(players).forEach((id) => {
      const player = players[id];
      if (!player || !player.hand || player.hand.length === 0) return;

      // Trova tutte le carte nella mano del giocatore che hanno lo stesso valore di quella rivelata
      const cardsToDiscard = player.hand.filter(
        (card) => card.value === lastRevealedCard.value,
      );

      if (cardsToDiscard.length > 0) {
        anyDiscard = true;

        // Rimuovi solo dalla mano del giocatore
        const newHand = player.hand.filter(
          (card) => card.value !== lastRevealedCard.value,
        );

        updates[`game/players/${id}/hand`] = newHand;

        // Aggiungi le carte scartate all'array discardedCards
        const currentDiscarded = player.discardedCards || [];
        const updatedDiscarded = [...currentDiscarded, ...cardsToDiscard];
        
        // Rimuovi eventuali duplicati mantenendo l'ordine
        const uniqueDiscarded = updatedDiscarded.filter((card, index, self) =>
          index === self.findIndex((c) => 
            c.value === card.value && c.suit === card.suit
          )
        );
        
        updates[`game/players/${id}/discardedCards`] = uniqueDiscarded;

        console.log(`🔄 Scarto silenzioso per ${player.username}:`);
        console.log(
          `   Carta rivelata sul tavolo: ${lastRevealedCard.value}${lastRevealedCard.suit}`,
        );
        console.log(
          `   Carte scartate dalla mano: ${cardsToDiscard.map((c) => `${c.value}${c.suit}`).join(", ")}`,
        );
        console.log(
          `   Nuova mano: ${newHand.map((c) => `${c.value}${c.suit}`).join(", ")}`,
        );

        if (newHand.length === 0 && !player.folded) {
          console.log(
            `🚨 LAS VEGAS per ${player.username}! Ha 0 carte in mano.`,
          );
        }
      }
    });

    if (anyDiscard) {
      db.ref().update(updates);
      console.log("✅ Scarto silenzioso applicato con successo");
    }
  };

  const setHandSize = (n: number) => {
    setHandSizeSelection(n);
    db.ref("game/state").update({
      handSize: n,
      lastAction: `Impostate ${n} carte in mano`,
    });
  };

  // FUNZIONE START GAME MIGLIORATA
  const startGame = (totalCards: number) => {
    setTotalCardsSelection(totalCards);

    if (!handSizeSelection && !gameState?.handSize) {
      toast({
        title: "Selezione incompleta",
        description:
          "Devi selezionare il numero di carte in mano prima di iniziare!",
        variant: "destructive",
        duration: 3000,
      });
      gameStartAttemptedRef.current = true;
      return;
    }

    if (!totalCards) {
      toast({
        title: "Selezione incompleta",
        description:
          "Devi selezionare il numero di carte a terra prima di iniziare!",
        variant: "destructive",
        duration: 3000,
      });
      gameStartAttemptedRef.current = true;
      return;
    }

    gameStartAttemptedRef.current = false;

    const handSize = handSizeSelection || gameState?.handSize || 5;

    const adminPlayer = Object.values(players).find((p) => p.isAdmin);
    let dealerIndex = 0;

    if (adminPlayer) {
      dealerIndex = adminPlayer.position;
    } else {
      const firstPlayer = Object.values(players).sort(
        (a, b) => a.position - b.position,
      )[0];
      if (firstPlayer) {
        dealerIndex = firstPlayer.position;
      }
    }

    db.ref("game/state").set({
      phase: "betting",
      pot: 0,
      currentBet: 0,
      revealedCards: [],
      totalCards,
      handSize,
      adminId: localPlayerId || "admin",
      dealerIndex,
      lastAction: `Inizio partita: ${handSize} carte in mano, ${totalCards} carte a terra. Seleziona il dealer e clicca AVANTI.`,
      currentPlayerTurn: "",
      waitingForDealer: true, // IMPORTANTE: blocca tutto finché il dealer non viene impostato
      isFirstHand: true,
    });

    const updates: any = {};
    Object.keys(players).forEach((id) => {
      updates[`game/players/${id}/lastBet`] = 0;
      updates[`game/players/${id}/finalScore`] = null;
      updates[`game/players/${id}/choice`] = null;
      updates[`game/players/${id}/hasActed`] = false;
      updates[`game/players/${id}/folded`] = false;
      updates[`game/players/${id}/totalBetThisHand`] = 0;
      updates[`game/players/${id}/hand`] = null;
      updates[`game/players/${id}/originalHand`] = null;
      updates[`game/players/${id}/discardedCards`] = [];
    });

    db.ref().update(updates);

    setTimeout(() => {
      dealHands(handSize);
    }, 500);

    toast({
      title: "Partita pronta",
      description: "Seleziona il dealer e clicca AVANTI per iniziare.",
      duration: 3000,
    });
  };

  // FUNZIONE MIGLIORATA: Svela carta con valori UNICI sul tavolo
  const revealNextCard = () => {
    if (!gameState) return;

    // Ottieni i valori già rivelati sul tavolo
    const revealedValues = gameState.revealedCards?.map((c) => c.value) || [];

    // Filtra i valori disponibili (non ancora usati sul tavolo)
    const availableValues = VALUES.filter((v) => !revealedValues.includes(v));

    if (availableValues.length === 0) {
      toast({
        title: "Errore",
        description: "Non ci sono più valori unici disponibili per il tavolo!",
        variant: "destructive",
      });
      return;
    }

    // Scegli un valore casuale tra quelli disponibili
    const randomValueIndex = Math.floor(Math.random() * availableValues.length);
    const value = availableValues[randomValueIndex];

    // Scegli un seme casuale
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    const nextCard = { value, suit: suit.symbol, color: suit.color };

    const currentRevealed = gameState.revealedCards || [];
    const nextRevealed = [...currentRevealed, nextCard];

    console.log(`🎴 Svelo nuova carta UNICA: ${value}${suit.symbol}`);

    if (nextRevealed.length >= gameState.totalCards) {
      db.ref("game/state").update({
        revealedCards: nextRevealed,
        phase: "final",
        currentBet: 0,
        lastAction: "Tutte le carte svelate!",
        currentPlayerTurn: "",
        waitingForDealer: false,
        isFirstHand: false,
      });
    } else {
      db.ref("game/state").update({
        revealedCards: nextRevealed,
        lastAction: `Carta svelata: ${value}${suit.symbol}`,
      });

      setTimeout(() => {
        // Applica scarto silenzioso SOLO dalle mani dei giocatori
        applySilentDiscard();

        db.ref("game/state").update({
          phase: "betting",
          currentBet: 0,
          currentPlayerTurn: "",
          waitingForDealer: true, // IMPORTANTE: blocca tutto finché il dealer non viene impostato
          isFirstHand: false,
          lastAction: `Carta svelata: ${value}${suit.symbol}. Seleziona il dealer per il nuovo giro.`,
        });
      }, 100);
    }

    const updates: any = {};
    Object.keys(players).forEach((id) => {
      updates[`game/players/${id}/lastBet`] = 0;
      updates[`game/players/${id}/hasActed`] = false;
    });

    db.ref().update(updates);
    setBetAmount(0.1);
  };

  // FUNZIONE MIGLIORATA: Conferma dealer
  const confirmDealerAndContinue = () => {
    if (!gameState) return;

    const dealerPlayer = Object.values(players).find(
      (p) => p.position === gameState.dealerIndex,
    );
    if (!dealerPlayer) {
      toast({
        title: "Errore",
        description: "Dealer non trovato. Seleziona un dealer valido.",
        variant: "destructive",
      });
      return;
    }

    db.ref("game/state").update({
      waitingForDealer: false,
      currentPlayerTurn: dealerPlayer.id,
      lastAction: `Dealer: ${dealerPlayer.username} (parla per primo)`,
      isFirstHand: false,
    });

    botActionBlockedRef.current = false;

    toast({
      title: "Dealer confermato",
      description: `Dealer: ${dealerPlayer.username}. Il dealer parla per primo.`,
      duration: 2000,
    });
  };

  const handleAddBot = () => {
    // Genera un nome unico per il bot
    const botNames = ["Bot_Alpha", "Bot_Beta", "Bot_Gamma", "Bot_Delta", "Bot_Epsilon"];
    const usedNames = Object.values(players).map(p => p.username);
    const availableNames = botNames.filter(name => !usedNames.includes(name));
    
    const name = availableNames.length > 0 
      ? availableNames[0] 
      : `Bot_${Math.floor(Math.random() * 1000)}`;
    
    const pos = Object.keys(players).length;
    const botId = db.ref("game/players").push().key!;
    
    db.ref(`game/players/${botId}`).set({
      id: botId,
      username: name,
      balance: 100,
      isAdmin: false,
      isBot: true,
      lastBet: 0,
      position: pos,
      hasActed: false,
      folded: false,
      choice: null,
      finalScore: null,
      hand: null,
      originalHand: null,
      totalBetThisHand: 0,
      discardedCards: [],
    });

    toast({
      title: "Bot aggiunto",
      description: `Bot ${name} aggiunto al gioco`,
    });
  };

  // FUNZIONE PUNTATA MIGLIORATA CON DYNAMIC MINIMUM BET
  const handleBet = () => {
    if (
      !gameState ||
      !currentUser ||
      !localPlayerId ||
      gameState.waitingForDealer
    ) {
      toast({
        title: "Azione bloccata",
        description: "Attendi che l'admin confermi il dealer.",
        variant: "destructive",
      });
      return;
    }

    if (!isAdminMode && gameState.currentPlayerTurn !== localPlayerId) {
      toast({
        title: "Non è il tuo turno",
        description: "Attendi il tuo turno per puntare",
        variant: "destructive",
      });
      return;
    }

    let betVal = parseFloat(betAmount.toFixed(2));

    // CONTROLLO SICUREZZA: Limita la puntata a massimo 2.00€
    if (betVal > 2.00) {
      betVal = 2.00;
      setBetAmount(2.00);
      toast({
        title: "Limite di puntata",
        description: "La puntata massima consentita è 2.00€",
        variant: "default",
        duration: 2000,
      });
    }

    // DYNAMIC MINIMUM BET: Non puoi puntare meno del currentBet
    const minBet = gameState.currentBet || 0.1;
    if (betVal < minBet) {
      toast({
        title: "Puntata non valida",
        description: `Devi puntare almeno ${minBet.toFixed(2)}€ (current bet)`,
        variant: "destructive",
      });
      return;
    }

    const lastBet = currentUser.lastBet || 0;

    const diff = Math.max(0, parseFloat((betVal - lastBet).toFixed(2)));

    if (diff > currentUser.balance) {
      toast({
        title: "Saldo insufficiente",
        description: `Non hai abbastanza fondi per puntare ${betVal}€`,
        variant: "destructive",
      });
      return;
    }

    const updates: any = {};

    if (betVal > gameState.currentBet) {
      Object.keys(players).forEach((id) => {
        if (id !== localPlayerId) {
          updates[`game/players/${id}/hasActed`] = false;
        }
      });
    }

    updates[`game/players/${localPlayerId}/balance`] = parseFloat(
      (currentUser.balance - diff).toFixed(2),
    );
    updates[`game/players/${localPlayerId}/lastBet`] = betVal;
    updates[`game/players/${localPlayerId}/hasActed`] = true;
    updates[`game/players/${localPlayerId}/totalBetThisHand`] =
      (currentUser.totalBetThisHand || 0) + diff;

    const nextPlayerId = getNextActivePlayerId();

    db.ref("game/state").update({
      pot: parseFloat(((gameState.pot || 0) + diff).toFixed(2)),
      currentBet: betVal,
      lastAction: `${currentUser.username} punta ${betVal}€ (diff: ${diff}€)`,
      currentPlayerTurn: nextPlayerId || "",
    });

    db.ref().update(updates);
  };

  const handleCheck = () => {
    if (
      !gameState ||
      !currentUser ||
      !localPlayerId ||
      gameState.waitingForDealer
    ) {
      toast({
        title: "Azione bloccata",
        description: "Attendi che l'admin confermi il dealer.",
        variant: "destructive",
      });
      return;
    }

    if (!isAdminMode && gameState.currentPlayerTurn !== localPlayerId) {
      toast({
        title: "Non è il tuo turno",
        description: "Attendi il tuo turno per fare check",
        variant: "destructive",
      });
      return;
    }

    if (currentUser.lastBet === gameState.currentBet) {
      const nextPlayerId = getNextActivePlayerId();
      db.ref(`game/players/${localPlayerId}`).update({ hasActed: true });
      db.ref("game/state").update({
        lastAction: `${currentUser.username} fa Check`,
        currentPlayerTurn: nextPlayerId || "",
      });
    } else {
      toast({
        title: "Check non consentito",
        description: `Devi pareggiare la puntata (${gameState.currentBet.toFixed(2)}€) per fare check`,
        variant: "destructive",
      });
    }
  };

  const handleFold = () => {
    if (
      !gameState ||
      !currentUser ||
      !localPlayerId ||
      gameState.waitingForDealer
    ) {
      toast({
        title: "Azione bloccata",
        description: "Attendi che l'admin confermi il dealer.",
        variant: "destructive",
      });
      return;
    }

    if (!isAdminMode && gameState.currentPlayerTurn !== localPlayerId) {
      toast({
        title: "Non è il tuo turno",
        description: "Attendi il tuo turno per foldare",
        variant: "destructive",
      });
      return;
    }

    const nextPlayerId = getNextActivePlayerId();
    db.ref(`game/players/${localPlayerId}`).update({
      folded: true,
      hasActed: true,
    });
    db.ref("game/state").update({
      lastAction: `${currentUser.username} Fold`,
      currentPlayerTurn: nextPlayerId || "",
    });
  };

  // FUNZIONE MIGLIORATA: Validazione punteggio
  const submitFinal = (choice: "min" | "max") => {
    if (!currentUser || !finalScoreInput || !gameState) return;

    const declaredScore = parseInt(finalScoreInput);
    if (isNaN(declaredScore)) {
      setValidationError("Inserisci un punteggio valido");
      return;
    }

    console.log("=== DEBUG DICHIARAZIONE ===");
    console.log("Giocatore:", currentUser.username);
    console.log(
      "Mano originale:",
      currentUser.originalHand?.map((c) => `${c.value}${c.suit}`),
    );
    console.log(
      "Mano corrente:",
      currentUser.hand?.map((c) => `${c.value}${c.suit}`),
    );
    console.log(
      "Carte rivelate:",
      gameState.revealedCards?.map((c) => `${c.value}${c.suit}`),
    );

    const filteredHand = getFilteredHand(
      currentUser.hand,
      gameState.revealedCards,
      true,
    );

    const correctScore = calculateHandScore(filteredHand, choice);

    console.log("Scelta:", choice);
    console.log("Punteggio dichiarato:", declaredScore);
    console.log("Punteggio corretto:", correctScore);
    console.log("==========================");

    if (declaredScore !== correctScore) {
      setValidationError(
        `Punteggio errato! ${choice === "max" ? "Massimo" : "Minimo"} calcolato: ${correctScore} (Asso = ${choice === "max" ? "11" : "1"})`,
      );
      toast({
        title: "Errore di dichiarazione",
        description: `Il punteggio dichiarato (${declaredScore}) non corrisponde al punteggio ${choice === "max" ? "massimo" : "minimo"} reale (${correctScore})`,
        variant: "destructive",
      });
      return;
    }

    setValidationError("");
    db.ref(`game/players/${currentUser.id}`).update({
      choice,
      finalScore: declaredScore,
    });
    toast({
      title: "Dichiarazione registrata",
      description: `Punteggio ${choice === "max" ? "massimo" : "minimo"} di ${declaredScore} punti confermato`,
    });
  };

  const handleNextHand = () => {
    if (!isAdminMode) return;

    db.ref("game/state").update({
      phase: "lobby",
      pot: 0,
      currentBet: 0,
      revealedCards: [],
      waitingForDealer: true,
      isFirstHand: false,
      lastAction: "Seleziona il dealer per la prossima mano",
    });
  };

  // FUNZIONE MIGLIORATA: Calcolo vincitori
  const calculateWinners = (specialWinnerId?: string) => {
    if (!gameState) return;

    const pot = gameState.pot || 0;
    const updates: any = {};
    const winnersInfo: string[] = [];

    if (specialWinnerId) {
      const winnerObj = players[specialWinnerId];
      if (winnerObj) {
        updates[`game/players/${winnerObj.id}/balance`] = parseFloat(
          (winnerObj.balance + pot).toFixed(2),
        );
        winnersInfo.push(
          `${winnerObj.username}: +${pot.toFixed(2)}€ (100%) [LAS VEGAS]`,
        );
      }
    } else {
      const playerList = Object.values(players).filter(
        (p) =>
          p &&
          p.folded === false &&
          p.choice &&
          p.finalScore !== undefined &&
          p.finalScore !== null,
      );

      if (playerList.length === 0) {
        toast({
          title: "Nessun vincitore",
          description: "Nessun giocatore ha dichiarato il punteggio",
          variant: "destructive",
        });
        return;
      }

      const minPlayers = playerList.filter((p) => p.choice === "min");
      const maxPlayers = playerList.filter((p) => p.choice === "max");

      if (minPlayers.length > 0) {
        const minScores = minPlayers.map((p) => p.finalScore!);
        const minBestScore = Math.min(...minScores);
        const minWinners = minPlayers.filter(
          (p) => p.finalScore === minBestScore,
        );

        const share =
          minPlayers.length > 0 && maxPlayers.length > 0 ? pot / 2 : pot;
        const splitAmount = parseFloat((share / minWinners.length).toFixed(2));

        minWinners.forEach((w) => {
          updates[`game/players/${w.id}/balance`] = parseFloat(
            (w.balance + splitAmount).toFixed(2),
          );
          winnersInfo.push(
            `${w.username}: +${splitAmount}€ (MIN${minWinners.length > 1 ? " Pareggio" : ""})`,
          );
        });
      }

      if (maxPlayers.length > 0) {
        const maxScores = maxPlayers.map((p) => p.finalScore!);
        const maxBestScore = Math.max(...maxScores);
        const maxWinners = maxPlayers.filter(
          (p) => p.finalScore === maxBestScore,
        );

        const share =
          minPlayers.length > 0 && maxPlayers.length > 0 ? pot / 2 : pot;
        const splitAmount = parseFloat((share / maxWinners.length).toFixed(2));

        maxWinners.forEach((w) => {
          updates[`game/players/${w.id}/balance`] = parseFloat(
            (w.balance + splitAmount).toFixed(2),
          );
          winnersInfo.push(
            `${w.username}: +${splitAmount}€ (MAX${maxWinners.length > 1 ? " Pareggio" : ""})`,
          );
        });
      }
    }

    if (Object.keys(updates).length > 0) {
      db.ref().update(updates);
    }

    if (winnersInfo.length > 0) {
      db.ref("game/history").push({
        winners: winnersInfo.join(", "),
        pot: pot,
        timestamp: Date.now(),
      });
    }

    db.ref("game/state").update({
      phase: "results",
      lastAction: specialWinnerId
        ? `LAS VEGAS: ${players[specialWinnerId]?.username} vince tutto!`
        : `Fine mano: ${winnersInfo.length} vincitori`,
      isFirstHand: false,
    });
  };

  // FUNZIONE RESET MANO
  const resetHand = () => {
    if (!gameState) return;

    const updates: any = {};
    let totalRefund = 0;

    Object.keys(players).forEach((id) => {
      const player = players[id];
      const betThisHand = player.totalBetThisHand || 0;

      if (betThisHand > 0) {
        updates[`game/players/${id}/balance`] = parseFloat(
          (player.balance + betThisHand).toFixed(2),
        );
        totalRefund += betThisHand;
      }

      updates[`game/players/${id}/lastBet`] = 0;
      updates[`game/players/${id}/finalScore`] = null;
      updates[`game/players/${id}/choice`] = null;
      updates[`game/players/${id}/hasActed`] = false;
      updates[`game/players/${id}/folded`] = false;
      updates[`game/players/${id}/hand`] = null;
      updates[`game/players/${id}/originalHand`] = null;
      updates[`game/players/${id}/discardedCards`] = [];
      updates[`game/players/${id}/totalBetThisHand`] = 0;
    });

    db.ref().update(updates);

    db.ref("game/state").update({
      phase: "betting",
      pot: 0,
      currentBet: 0,
      revealedCards: [],
      lastAction: `Mano resettata. Rimborsati ${totalRefund.toFixed(2)}€ a tutti i giocatori`,
      currentPlayerTurn: "",
      waitingForDealer: true, // IMPORTANTE: blocca tutto finché il dealer non viene impostato
      isFirstHand: false,
    });

    toast({
      title: "Mano resettata",
      description: `Rimborsati ${totalRefund.toFixed(2)}€ a tutti i giocatori`,
    });
  };

  // CANCELLA GIOCATORI FIX DEFINITIVO
  const deletePlayersSoft = () => {
    if (!localPlayerId) return;

    const playersRef = db.ref("game/players");
    playersRef.once("value", (snapshot) => {
      const allPlayers = snapshot.val() || {};
      const updates: any = {};
      let positionIndex = 0;

      Object.keys(allPlayers).forEach((id) => {
        const player = allPlayers[id] as Player;

        if (id === localPlayerId) {
          updates[id] = {
            ...player,
            lastBet: 0,
            hasActed: false,
            choice: null,
            finalScore: null,
            position: positionIndex++,
            folded: false,
            hand: null,
            originalHand: null,
            discardedCards: [],
            totalBetThisHand: 0,
          };
        } else if (player.isBot) {
          updates[id] = {
            ...player,
            balance: 100,
            lastBet: 0,
            hasActed: false,
            choice: null,
            finalScore: null,
            position: positionIndex++,
            folded: false,
            hand: null,
            originalHand: null,
            discardedCards: [],
            totalBetThisHand: 0,
          };
        } else {
          updates[id] = null;
        }
      });

      playersRef.update(updates);
    });

    const stateRef = db.ref("game/state");
    stateRef.update({
      phase: "lobby",
      pot: 0,
      currentBet: 0,
      revealedCards: [],
      totalCards: 5,
      handSize: 5,
      lastAction:
        "Tutti i giocatori umani eliminati tranne te. Bot resettati a 100€.",
      waitingForDealer: true, // IMPORTANTE: blocca tutto finché il dealer non viene impostato
      currentPlayerTurn: "",
      dealerIndex: 0,
      isFirstHand: true,
    });

    const historyRef = db.ref("game/history");
    historyRef.remove();
    setWinHistory([]);

    toast({
      title: "Giocatori eliminati",
      description:
        "Tutti i giocatori umani eliminati tranne te. Bot resettati a 100€.",
    });
  };

  const systemWipe = () => {
    db.ref("game").remove();
    localStorage.removeItem("poker_player_id");
    setLocalPlayerId(null);
    setIsAdminMode(false);
    window.location.reload();
  };

  // FUNZIONE ROBUSTA: Imposta dealer con reset precedente
  const setManualDealer = (id: string) => {
    const p = players[id];
    if (p) {
      // Aggiorna in modo atomico il dealerIndex nello stato del gioco
      // Questo garantisce che ci sia un solo dealer
      db.ref("game/state").update({
        dealerIndex: p.position,
        lastAction: `Dealer selezionato: ${p.username}. Clicca AVANTI per continuare.`,
      });
      setDealerSelectedForNextHand(true);

      toast({
        title: "Dealer selezionato",
        description: `Dealer: ${p.username}. Clicca AVANTI per iniziare.`,
        duration: 2000,
      });
    }
  };

  // FUNZIONE DEBUG
  const toggleDebugScarto = () => {
    debugScartoRef.current = !debugScartoRef.current;
    toast({
      title: debugScartoRef.current ? "Debug attivato" : "Debug disattivato",
      description: debugScartoRef.current
        ? "Il debug dello scarto silenzioso è attivo. Controlla la console."
        : "Debug disattivato.",
      duration: 2000,
    });
  };

  // Ottieni lista giocatori ordinata con dealer come primo
  const getPlayersSortedByDealer = () => {
    if (!gameState) return Object.values(players);

    return Object.values(players).sort((a, b) => {
      if (a.position === gameState.dealerIndex) return -1;
      if (b.position === gameState.dealerIndex) return 1;
      return a.position - b.position;
    });
  };

  if (!isInitialized)
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-[#D4AF37] font-black italic text-4xl animate-pulse tracking-tighter">
        LAS VEGAS LIVE...
      </div>
    );

  const filteredLocalHand = getFilteredHand(
    currentUser?.hand,
    gameState?.revealedCards,
  );

  return (
    <div className="min-h-screen bg-black text-white p-4 font-sans selection:bg-[#D4AF37] overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none opacity-20">
        <div className="w-[80vw] h-[80vh] bg-[#004225] rounded-[200px] blur-[120px] mx-auto mt-[10vh]" />
      </div>

      <AnimatePresence>
        {/* POPUP DEBUG SCARTI - Mostra TUTTE le carte scartate dall'inizio */}
        {showDebugPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-black border-2 border-[#D4AF37] rounded-3xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-[0_0_50px_rgba(212,175,55,0.5)]"
            >
              <div className="bg-[#D4AF37]/10 p-6 border-b border-[#D4AF37]/30 flex justify-between items-center">
                <h2 className="text-2xl font-black italic text-[#D4AF37] uppercase tracking-tighter">
                  🃏 Debug Carte Scartate (Tutte)
                </h2>
                <Button
                  onClick={() => setShowDebugPopup(false)}
                  variant="ghost"
                  className="text-white/60 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {getPlayersSortedByDealer().map((player) => {
                  const discardedCards = player.discardedCards || [];
                  const isDealer = gameState?.dealerIndex === player.position;

                  return (
                    <div
                      key={player.id}
                      className="p-4 rounded-xl bg-white/5 border border-white/10"
                    >
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-black italic uppercase text-[#D4AF37]">
                            {player.username}
                          </span>
                          {isDealer && (
                            <Badge className="bg-[#D4AF37] text-black text-[10px] font-black px-2 py-0">
                              DEALER
                            </Badge>
                          )}
                          {player.isBot && (
                            <Badge className="bg-gray-600 text-white text-[10px] font-black px-2 py-0">
                              BOT
                            </Badge>
                          )}
                          {player.hand?.length === 0 && (
                            <Badge className="bg-red-600 text-white text-[10px] font-black px-2 py-0">
                              LAS VEGAS!
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-white/40">
                          {discardedCards.length} carte scartate totali
                        </span>
                      </div>

                      {discardedCards.length > 0 ? (
                        <div className="space-y-3">
                          <p className="text-[10px] text-white/60 uppercase font-bold">
                            Carte scartate dall'inizio della mano:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {discardedCards.map((card, idx) => (
                              <div
                                key={idx}
                                className="w-10 h-14 bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 flex flex-col items-center justify-center p-1"
                              >
                                <div
                                  className={`text-xs font-black ${card.color === "red" ? "text-red-500" : "text-gray-300"}`}
                                >
                                  {card.value}
                                </div>
                                <div
                                  className={`text-lg font-black ${card.color === "red" ? "text-red-500" : "text-gray-300"}`}
                                >
                                  {card.suit}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-4 text-white/30 text-sm italic">
                          Nessuna carta scartata
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="mt-6 pt-4 border-t border-[#D4AF37]/30">
                  <p className="text-[10px] text-[#D4AF37] font-bold uppercase mb-2">
                    ℹ️ Informazioni Debug
                  </p>
                  <p className="text-[9px] text-white/60">
                    Questo popup mostra TUTTE le carte scartate dall'inizio della mano corrente.
                    Le carte vengono automaticamente scartate quando viene rivelata 
                    una carta con lo stesso valore sul tavolo (scarto silenzioso).
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* POPUP IMPOSTA DEALER - Blocca tutto finché non viene impostato */}
        {gameState?.waitingForDealer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-black border-2 border-[#D4AF37] rounded-3xl w-full max-w-md overflow-hidden shadow-[0_0_50px_rgba(212,175,55,0.3)]"
            >
              <div className="bg-[#D4AF37]/10 p-6 border-b border-[#D4AF37]/30 text-center">
                <h2 className="text-2xl font-black italic text-[#D4AF37] uppercase tracking-tighter">
                  {isAdminMode ? "Imposta Dealer" : "In Attesa"}
                </h2>
                <p className="text-sm text-white/60 mt-2">
                  {gameState?.isFirstHand
                    ? "Prima mano: seleziona il dealer"
                    : "Nuovo giro: seleziona il dealer"}
                </p>
                <p className="text-xs text-white/40 mt-1">
                  Il dealer parla per primo. Tutte le azioni sono bloccate finché il dealer non viene impostato.
                </p>
              </div>
              <div className="p-6 space-y-4">
                {isAdminMode ? (
                  <>
                    <p className="text-center text-white/60 text-sm">
                      Seleziona il dealer per questa mano cliccando "D"
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.values(players)
                        .sort((a, b) => a.position - b.position)
                        .map((p) => (
                          <Button
                            key={p.id}
                            onClick={() => setManualDealer(p.id)}
                            variant={
                              gameState?.dealerIndex === p.position
                                ? "default"
                                : "outline"
                            }
                            className={`h-12 font-black uppercase text-sm ${gameState?.dealerIndex === p.position ? "bg-[#D4AF37] text-black" : "border-[#D4AF37]/30 text-[#D4AF37]"}`}
                          >
                            D - {p.username}
                          </Button>
                        ))}
                    </div>
                    <Button
                      onClick={confirmDealerAndContinue}
                      className="w-full h-14 bg-[#50C878] text-black font-black uppercase text-xl italic shadow-[0_6px_0_#004225] active:translate-y-1 active:shadow-none transition-all mt-4"
                    >
                      AVANTI (Dealer parla per primo)
                    </Button>
                  </>
                ) : (
                  <p className="text-center text-[#D4AF37] font-black italic uppercase text-sm animate-pulse py-8">
                    In attesa che l'admin imposti il dealer di mano...
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}

        {gameState?.phase === "results" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-black border-2 border-[#D4AF37] rounded-3xl w-full max-w-md overflow-hidden shadow-[0_0_50px_rgba(212,175,55,0.3)]"
            >
              <div className="bg-[#D4AF37]/10 p-6 border-b border-[#D4AF37]/30 text-center">
                <h2 className="text-3xl font-black italic text-[#D4AF37] uppercase tracking-tighter">
                  Resoconto Mano
                </h2>
              </div>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {(() => {
                  const playerList = Object.values(players).filter(
                    (p) =>
                      p &&
                      p.folded === false &&
                      p.choice &&
                      p.finalScore !== undefined,
                  );

                  const minPlayers = playerList.filter(
                    (p) => p.choice === "min",
                  );
                  const minWinners =
                    minPlayers.length > 0
                      ? minPlayers.filter(
                          (p) =>
                            p.finalScore ===
                            Math.min(...minPlayers.map((p) => p.finalScore!)),
                        )
                      : [];

                  const maxPlayers = playerList.filter(
                    (p) => p.choice === "max",
                  );
                  const maxWinners =
                    maxPlayers.length > 0
                      ? maxPlayers.filter(
                          (p) =>
                            p.finalScore ===
                            Math.max(...maxPlayers.map((p) => p.finalScore!)),
                        )
                      : [];

                  return Object.values(players)
                    .sort((a, b) => a.position - b.position)
                    .map((p) => {
                      const isMinWinner = minWinners.some((w) => w.id === p.id);
                      const isMaxWinner = maxWinners.some((w) => w.id === p.id);
                      const isWinner = isMinWinner || isMaxWinner;

                      let winAmount = 0;
                      if (isWinner) {
                        const pot = gameState?.pot || 0;
                        const share =
                          minPlayers.length > 0 && maxPlayers.length > 0
                            ? pot / 2
                            : pot;
                        const winnersCount = isMinWinner
                          ? minWinners.length
                          : maxWinners.length;
                        winAmount = parseFloat(
                          (share / winnersCount).toFixed(2),
                        );
                      }

                      return (
                        <div
                          key={p.id}
                          className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/10"
                        >
                          <div className="flex flex-col">
                            <span className="font-black italic uppercase text-sm">
                              {p.username} {p.folded ? "(FOLD)" : ""}
                            </span>
                            <span className="text-[10px] text-white/50 uppercase font-bold">
                              {p.choice
                                ? `${p.choice.toUpperCase()}`
                                : "Nessuna scelta"}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-xl font-black italic text-white block leading-none">
                              {p.finalScore !== undefined &&
                              p.finalScore !== null
                                ? p.finalScore
                                : "-"}
                            </span>
                            {isWinner && (
                              <span className="text-[#50C878] text-[10px] font-black italic">
                                +{winAmount.toFixed(2)}€
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    });
                })()}
              </div>
              <div className="p-6 bg-[#D4AF37]/5 border-t border-[#D4AF37]/30">
                {isAdminMode ? (
                  <Button
                    onClick={handleNextHand}
                    className="w-full h-14 bg-[#D4AF37] text-black font-black uppercase text-xl italic shadow-[0_6px_0_#996515] active:translate-y-1 active:shadow-none transition-all"
                  >
                    Avanti
                  </Button>
                ) : (
                  <p className="text-center text-[#D4AF37] font-black italic uppercase text-xs animate-pulse">
                    In attesa dell'Admin...
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="max-w-7xl mx-auto flex justify-between items-center mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <Trophy className="text-[#D4AF37] w-6 h-6 md:w-8 md:h-8" />
          <h1 className="text-2xl md:text-3xl font-black text-[#D4AF37] italic uppercase tracking-tighter">
            Las Vegas Live
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowDebugPopup(true)}
            variant="outline"
            size="sm"
            className="text-[10px] font-black border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
          >
            <Eye className="w-3 h-3 mr-1" /> DEBUG SCARTI
          </Button>

          {currentUser && (
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="text-white/40 font-black h-8 hover:text-white transition-colors text-xs md:text-sm"
            >
              ESCI
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10 pb-20 px-2 sm:px-4 md:max-w-4xl lg:max-w-7xl">
        <div className="lg:col-span-3 space-y-4 w-full md:scale-90 origin-top-left transition-transform">
          {!currentUser && (
            <Card className="bg-black/95 border-[#D4AF37]/30 border-2 shadow-[0_0_20px_rgba(212,175,55,0.1)]">
              <CardContent className="space-y-4 pt-4 md:pt-6">
                <Input
                  placeholder="NOME"
                  className="h-10 md:h-12 bg-black/50 border-[#D4AF37]/30 text-center text-base md:text-sm font-black italic"
                  value={tempName}
                  onChange={(e) => {
                    setTempName(e.target.value);
                    setUsernameInput(e.target.value);
                  }}
                />
                <Input
                  type="password"
                  placeholder="Password Admin"
                  className="h-10 md:h-12 bg-black/50 border-[#D4AF37]/30 text-center text-base md:text-sm font-black italic"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Budget Gioco"
                  className="h-10 md:h-12 bg-black/50 border-[#D4AF37]/30 text-center text-base md:text-sm font-black italic"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                />
                {tempName.toLowerCase() === "diro" ? (
                  <Button
                    onClick={handleAdminLogin}
                    className="w-full h-12 bg-[#D4AF37] text-black font-black uppercase text-xl italic shadow-[0_6px_0_#996515]"
                  >
                    LOGIN BOSS
                  </Button>
                ) : (
                  <Button
                    onClick={joinGame}
                    className="w-full h-12 bg-[#50C878] text-black font-black uppercase text-xl italic shadow-[0_6px_0_#004225]"
                  >
                    GIOCA
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {currentUser && (
            <div className="space-y-4">
              {isAdminMode && (
                <Card className="bg-black/95 border-[#D4AF37] border-2 shadow-2xl">
                  <CardContent className="p-3 space-y-3">
                    <div className="text-[9px] text-white/60 uppercase font-black mb-1">
                      Carte in mano (per giocatore)
                    </div>
                    <div className="grid grid-cols-3 gap-1 mb-2">
                      {[5, 6, 7].map((n) => (
                        <Button
                          key={n}
                          onClick={() => setHandSize(n)}
                          variant="outline"
                          className={`h-7 text-[#50C878] text-[8px] font-black ${handSizeSelection === n || gameState?.handSize === n ? "bg-[#50C878]/20" : ""}`}
                        >
                          {n} IN MANO
                        </Button>
                      ))}
                    </div>

                    <div className="text-[9px] text-white/60 uppercase font-black mb-1">
                      Carte a terra
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[4, 5, 6].map((n) => (
                        <Button
                          key={n}
                          onClick={() => startGame(n)}
                          variant="outline"
                          className={`h-7 text-[#50C878] text-[8px] font-black ${totalCardsSelection === n ? "bg-[#50C878]/20" : ""}`}
                        >
                          {n} CARTE
                        </Button>
                      ))}
                    </div>

                    {gameStartAttemptedRef.current &&
                      (!handSizeSelection || !totalCardsSelection) && (
                        <div className="p-2 bg-red-900/30 border border-red-700 rounded-lg">
                          <p className="text-red-400 text-[8px] font-black uppercase text-center flex items-center justify-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            SELEZIONA ENTRAMBE LE OPZIONI!
                          </p>
                        </div>
                      )}

                    <div className="mt-3">
                      <Button
                        onClick={revealNextCard}
                        disabled={
                          gameState?.phase !== "betting" ||
                          gameState?.waitingForDealer
                        }
                        className="w-full h-10 bg-[#D4AF37] text-black font-black text-[9px] shadow-[0_4px_0_#996515]"
                      >
                        <FastForward className="w-3 h-3 mr-1" /> GIRA (FORZA)
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <Button
                        onClick={handleAddBot}
                        variant="outline"
                        className="h-8 border-[#D4AF37]/30 text-[#D4AF37] text-[8px] font-black"
                      >
                        +BOT
                      </Button>
                      <Button
                        onClick={deletePlayersSoft}
                        variant="outline"
                        className="h-8 border-red-900/40 text-red-500 text-[8px] font-black uppercase"
                      >
                        CANCELLA GIOCATORI
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <Button
                        onClick={resetHand}
                        variant="outline"
                        className="h-8 border-yellow-600/40 text-yellow-500 text-[8px] font-black uppercase"
                      >
                        RESET MANO
                      </Button>
                      <Button
                        onClick={systemWipe}
                        variant="destructive"
                        className="h-8 text-[8px] font-black uppercase"
                      >
                        SYSTEM WIPE
                      </Button>
                    </div>

                    <div className="pt-2 border-t border-white/5 space-y-1">
                      <p className="text-[7px] text-white/30 text-center uppercase font-black">
                        Assegna LAS VEGAS
                      </p>
                      <div className="flex flex-wrap gap-1 justify-center">
                        {Object.values(players).map((p) => (
                          <Button
                            key={p.id}
                            onClick={() => calculateWinners(p.id)}
                            variant="ghost"
                            className="h-5 px-1 text-[7px] uppercase font-bold text-yellow-500 hover:bg-yellow-500 hover:text-black"
                          >
                            LAS VEGAS: {p.username}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <Button
                      onClick={() => calculateWinners()}
                      disabled={gameState?.phase !== "final"}
                      className="w-full h-10 bg-[#50C878] text-black font-black text-[9px] mt-3"
                    >
                      FORZA CALCOLO
                    </Button>

                    <div className="pt-2 border-t border-white/5 space-y-1">
                      <p className="text-[7px] text-white/30 text-center uppercase font-black">
                        Gestione Dealer
                      </p>
                      <div className="flex flex-wrap gap-1 justify-center">
                        {Object.values(players).map((p) => (
                          <Button
                            key={p.id}
                            onClick={() => setManualDealer(p.id)}
                            variant="ghost"
                            className="h-5 px-1 text-[7px] uppercase font-bold hover:bg-[#D4AF37] hover:text-black"
                          >
                            D: {p.username}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card className="bg-[#D4AF37]/10 border-[#D4AF37]/30 border-2 p-4 text-center">
                <h3 className="text-lg font-black italic text-[#D4AF37] uppercase">
                  {currentUser?.username}
                </h3>
                <p className="text-2xl font-black tabular-nums">
                  {currentUser?.balance.toFixed(2)}€
                </p>
                {currentUser?.totalBetThisHand &&
                  currentUser.totalBetThisHand > 0 && (
                    <p className="text-[10px] text-white/60 mt-1">
                      Puntato questa mano:{" "}
                      {currentUser.totalBetThisHand.toFixed(2)}€
                    </p>
                  )}
                {debugScartoRef.current && currentUser?.originalHand && (
                  <p className="text-[8px] text-yellow-400 mt-1">
                    Mano originale:{" "}
                    {currentUser.originalHand
                      .map((c) => `${c.value}${c.suit}`)
                      .join(", ")}
                  </p>
                )}
              </Card>
            </div>
          )}
          <Card className="bg-[#004225]/40 border-[#50C878]/30 border-2 p-5 text-center shadow-[inset_0_0_30px_rgba(0,0,0,0.5)]">
            <span className="text-[#D4AF37] text-[10px] font-black uppercase block tracking-widest">
              Piatto Totale
            </span>
            <span className="text-4xl font-black italic tabular-nums text-white">
              {(gameState?.pot || 0).toFixed(2)}€
            </span>
            <div className="mt-2 text-[9px] uppercase font-black italic text-[#50C878] tracking-[0.2em] border-t border-[#50C878]/20 pt-2">
              {gameState?.phase?.toUpperCase() || "LOBBY"}
            </div>
          </Card>

          <Card className="bg-black/95 border-[#D4AF37]/20 border overflow-hidden shadow-2xl">
            <CardHeader className="bg-[#D4AF37]/10 py-2 px-4 flex flex-row items-center gap-2 border-b border-white/5">
              <History className="w-3 h-3 text-[#D4AF37]" />
              <CardTitle className="text-[#D4AF37] text-[9px] font-black uppercase tracking-widest">
                🏆 Ultime Vincite
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 max-h-[250px] overflow-y-auto custom-scrollbar bg-black/40">
              {winHistory.length > 0 ? (
                winHistory.map((h, i) => (
                  <div
                    key={i}
                    className="px-4 py-3 border-b border-white/5 flex justify-between items-center hover:bg-white/5 transition-colors"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-black uppercase text-white/90 leading-none">
                        {h.winners}
                      </span>
                      <span className="text-[8px] text-white/30 uppercase font-bold">
                        {new Date(h.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <span className="text-[#D4AF37] font-black text-sm tabular-nums">
                      +{h.pot.toFixed(2)}€
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-white/20 text-[9px] uppercase font-black tracking-widest italic">
                  Nessun dato registrato
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-9 space-y-4 flex flex-col h-full md:scale-95 origin-top transition-transform">
          <div className="bg-[#004225] border-[10px] md:border-[14px] border-[#D4AF37]/30 rounded-[50px] md:rounded-[70px] p-4 md:p-8 min-h-[300px] md:min-h-[450px] flex items-center justify-center relative shadow-[inset_0_0_120px_rgba(0,0,0,0.9)] border-double">
            <div className="flex flex-wrap gap-2 md:gap-4 justify-center items-center w-full relative z-20">
              {Array.from({ length: gameState?.totalCards || 5 }).map(
                (_, idx) => {
                  const card = (gameState?.revealedCards || [])[idx];
                  const rev = !!card;
                  return (
                    <div
                      key={idx}
                      className="w-12 h-20 md:w-20 md:h-32 relative perspective-1000"
                    >
                      <motion.div
                        animate={{ rotateY: rev ? 0 : 180 }}
                        transition={{ duration: 0.8, type: "spring" }}
                        style={{ transformStyle: "preserve-3d" }}
                        className="w-full h-full relative"
                      >
                        <div className="absolute inset-0 bg-white rounded-lg md:rounded-xl border-[2px] md:border-[4px] border-[#D4AF37] shadow-2xl backface-hidden flex flex-col items-center justify-between py-1 md:py-2 px-1">
                          <div
                            className={`w-full flex justify-start pl-1 text-[10px] md:text-sm font-black italic leading-none ${card?.color === "red" ? "text-red-600" : "text-black"}`}
                          >
                            {card?.value}
                            {card?.suit}
                          </div>
                          <div
                            className={`text-xl md:text-3xl font-black ${card?.color === "red" ? "text-red-600" : "text-black"}`}
                          >
                            {card?.suit}
                          </div>
                          <div
                            className={`w-full flex justify-end pr-1 text-[10px] md:text-sm font-black italic rotate-180 leading-none ${card?.color === "red" ? "text-red-600" : "text-black"}`}
                          >
                            {card?.value}
                            {card?.suit}
                          </div>
                        </div>
                        <div
                          style={{ transform: "rotateY(180deg)" }}
                          className="absolute inset-0 bg-gradient-to-br from-black to-zinc-900 border-2 md:border-4 border-[#D4AF37]/40 rounded-lg md:rounded-xl flex items-center justify-center backface-hidden overflow-hidden shadow-xl"
                        >
                          <div className="w-full h-full bg-[radial-gradient(circle,rgba(212,175,55,0.1)_0%,transparent_70%)] absolute inset-0" />
                          <Trophy className="w-4 h-4 md:w-8 md:h-8 text-[#D4AF37]/15 animate-pulse" />
                        </div>
                      </motion.div>
                    </div>
                  );
                },
              )}
            </div>
          </div>

          {currentUser && (
            <div className="mx-auto w-full max-w-4xl">
              <div className="flex gap-3 justify-center items-center mb-3">
                {filteredLocalHand.map((c, i) => (
                  <div
                    key={i}
                    className="w-10 h-16 md:w-14 md:h-20 relative perspective-1000"
                  >
                    <div className="absolute inset-0 bg-white rounded-lg md:rounded-xl border-2 border-[#D4AF37] flex flex-col items-center justify-between py-1 px-1">
                      <div
                        className={`w-full flex justify-start pl-1 text-[10px] font-black italic ${c.color === "red" ? "text-red-600" : "text-black"}`}
                      >
                        {c.value}
                        {c.suit}
                      </div>
                      <div
                        className={`text-lg font-black ${c.color === "red" ? "text-red-600" : "text-black"}`}
                      >
                        {c.suit}
                      </div>
                      <div
                        className={`w-full flex justify-end pr-1 text-[10px] font-black italic rotate-180 ${c.color === "red" ? "text-red-600" : "text-black"}`}
                      >
                        {c.value}
                        {c.suit}
                      </div>
                    </div>
                  </div>
                ))}
                {filteredLocalHand.length === 0 &&
                  currentUser.hand &&
                  currentUser.hand.length > 0 && (
                    <div className="text-[10px] text-white/40 italic uppercase">
                      Tutte le carte scartate (punteggio: 0)
                    </div>
                  )}
              </div>
            </div>
          )}

          <AnimatePresence>
            {(isAdminMode ||
              (gameState?.phase === "betting" &&
                currentUser &&
                gameState.currentPlayerTurn === localPlayerId)) &&
              !gameState?.waitingForDealer && (
                <motion.div
                  key="betting-panel"
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -50 }}
                  className="relative z-50 my-8 bg-black/95 border-2 border-[#D4AF37] rounded-[30px] md:rounded-[50px] p-4 md:p-6 shadow-[0_0_50px_rgba(212,175,55,0.2)] mx-auto w-full max-w-4xl"
                >
                  <div className="flex flex-col md:flex-row gap-4 md:gap-8 items-center">
                    <div className="flex-1 w-full space-y-4">
                      <div className="flex justify-between items-end">
                        <span className="text-3xl md:text-4xl font-black italic tabular-nums text-white">
                          {betAmount.toFixed(2)}€
                        </span>
                        <span className="text-base md:text-sm font-black italic text-[#50C878] truncate">
                          Saldo:{" "}
                          {currentUser
                            ? (
                                currentUser.balance -
                                Math.max(
                                  0,
                                  betAmount - (currentUser.lastBet || 0),
                                )
                              ).toFixed(2)
                            : "0.00"}
                          €
                        </span>
                      </div>
                      <Slider
                        value={[betAmount]}
                        onValueChange={(v) => setBetAmount(v[0])}
                        // DYNAMIC MINIMUM BET: il minimo è il currentBet (ma almeno 0.1)
                        min={Math.max(0.1, gameState?.currentBet || 0.1)}
                        // Massimo: 2.00€ o il saldo disponibile
                        max={Math.min(2.0, currentUser?.balance || 2.0)}
                        step={0.1}
                        className="py-2 md:py-4 [&_[role=slider]]:bg-[#D4AF37] [&_[role=slider]]:h-6 md:[&_[role=slider]]:h-8 [&_[role=slider]]:w-6 md:[&_[role=slider]]:w-8 [&_[role=slider]]:border-2 md:[&_[role=slider]]:border-4 [&_[role=slider]]:border-black [&_[role=slider]]:shadow-xl"
                      />
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                      <Button
                        onClick={handleCheck}
                        disabled={
                          currentUser?.lastBet !== gameState?.currentBet &&
                          !isAdminMode
                        }
                        className="h-12 md:h-10 flex-1 md:py-1 md:px-3 bg-black border-2 border-[#D4AF37]/40 text-[#D4AF37] font-black text-lg md:text-[10px] italic rounded-xl uppercase break-words"
                      >
                        CHECK
                      </Button>
                      <Button
                        onClick={handleBet}
                        className="h-12 md:h-10 flex-1 md:py-1 md:px-3 bg-[#50C878] text-black font-black text-xl md:text-[10px] italic rounded-xl shadow-[0_4px_0_#004225] active:translate-y-1 active:shadow-none transition-all uppercase break-words"
                      >
                        PUNTA
                      </Button>
                      <Button
                        onClick={handleFold}
                        className="h-12 md:h-10 flex-1 md:py-1 md:px-3 bg-red-600 text-white font-black text-xl md:text-[10px] italic rounded-xl shadow-[0_4px_0_#7f1d1d] active:translate-y-1 active:shadow-none transition-all uppercase break-words"
                      >
                        FOLD
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            {gameState?.phase === "final" &&
              currentUser &&
              !currentUser.choice && (
                <motion.div
                  key="final-declaration"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-black/98 border-4 border-zinc-500 rounded-[60px] p-12 text-center space-y-8 mx-auto w-full max-w-2xl shadow-2xl"
                >
                  <h2 className="text-lg md:text-xl font-black italic uppercase tracking-tighter text-white">
                    DICHIARAZIONE FINALE
                  </h2>
                  {validationError && (
                    <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
                      <p className="text-red-400 text-sm font-black uppercase">
                        {validationError}
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <p className="text-[10px] text-white/40 font-black uppercase tracking-[0.3em]">
                      Inserisci il punteggio delle carte visibili sopra
                    </p>
                    <p className="text-[10px] text-[#D4AF37] font-black uppercase tracking-[0.2em]">
                      Asso = 11 per MAX, 1 per MIN | Figure = 10 | Numeriche =
                      valore nominale
                    </p>
                    <Input
                      type="number"
                      className="h-24 text-center text-6xl font-black bg-black/50 border-4 border-zinc-500/40 text-white rounded-3xl"
                      value={finalScoreInput}
                      onChange={(e) => {
                        setFinalScoreInput(e.target.value);
                        setValidationError("");
                      }}
                      placeholder="0"
                    />
                  </div>
                  <div className="flex gap-6">
                    <Button
                      onClick={() => submitFinal("min")}
                      className="flex-1 h-24 bg-zinc-700 text-white font-black text-3xl rounded-3xl shadow-[0_8px_0_#3f3f46] active:translate-y-2 active:shadow-none"
                    >
                      <span className="text-[10px] uppercase font-black">
                        MIN (Asso=1)
                      </span>
                    </Button>
                    <Button
                      onClick={() => submitFinal("max")}
                      className="flex-1 h-24 bg-zinc-700 text-white font-black text-3xl rounded-3xl shadow-[0_8px_0_#3f3f46] active:translate-y-2 active:shadow-none"
                    >
                      <span className="text-[10px] uppercase font-black">
                        MAX (Asso=11)
                      </span>
                    </Button>
                  </div>
                </motion.div>
              )}
          </AnimatePresence>

          <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 w-full">
            {Object.values(players)
              .sort((a, b) => a.position - b.position)
              .map((p) => (
                <motion.div
                  key={p.id}
                  layout
                  className={`p-3 md:p-4 rounded-[30px] border-2 relative transition-all duration-500 shadow-xl ${p.id === localPlayerId ? "border-[#D4AF37] bg-[#D4AF37]/15" : "border-white/5 bg-black/70"} ${gameState?.currentPlayerTurn === p.id ? "ring-2 ring-[#50C878] scale-105 z-30" : ""}`}
                >
                  {gameState?.dealerIndex === p.position && (
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-[#D4AF37] via-[#FFD700] to-[#996515] rounded-full flex items-center justify-center text-black font-black text-sm md:text-lg border-2 border-black/50 shadow-2xl z-40">
                      D
                    </div>
                  )}
                  <div className="flex flex-col items-center text-center space-y-2 pt-2">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] md:text-xs font-black uppercase text-white/50 tracking-wider truncate w-full max-w-[100px] break-words">
                        {p.username}
                      </span>
                      {p.isAdmin && (
                        <Badge className="bg-[#D4AF37] text-black text-[7px] font-black h-3 px-1 border-none">
                          BOSS
                        </Badge>
                      )}
                    </div>

                    <div className="text-xl md:text-2xl font-black italic tabular-nums text-white">
                      {p.balance.toFixed(2)}€
                    </div>

                    <div className="h-12 md:h-14 flex flex-col justify-center items-center w-full gap-1">
                      {p.lastBet > 0 && (
                        <Badge className="bg-[#50C878]/10 text-[#50C878] text-[8px] md:text-[9px] font-black border-[#50C878]/30 uppercase px-2 py-0">
                          Bet: {p.lastBet.toFixed(2)}€
                        </Badge>
                      )}
                      {p.folded && (
                        <Badge className="bg-red-700 text-white text-[8px] md:text-[9px] font-black uppercase px-2 py-0">
                          FOLD
                        </Badge>
                      )}

                      {((p.id === localPlayerId && p.choice) ||
                        gameState?.phase === "results") &&
                        p.choice && (
                          <Badge
                            className={`w-full justify-center text-[9px] md:text-[10px] font-black italic rounded-lg ${gameState?.phase === "results" ? (p.choice === "min" ? "bg-blue-600" : "bg-red-600") : "bg-zinc-800 text-[#D4AF37] border border-[#D4AF37]/30"} border-none uppercase py-0.5`}
                          >
                            {gameState?.phase === "results"
                              ? p.choice
                              : "DICHIARATO"}
                          </Badge>
                        )}
                      {gameState?.phase === "results" &&
                        p.finalScore !== undefined && (
                          <span className="text-[10px] md:text-[11px] font-black text-[#D4AF37] mt-0.5">
                            PUNTI: {p.finalScore}
                          </span>
                        )}
                    </div>
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
[file content end]
