import { pgTable, text, serial, boolean, integer, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const gameSessions = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  pot: doublePrecision("pot").default(0).notNull(),
  currentBet: doublePrecision("currentBet").default(0).notNull(),
  phase: text("phase").default("lobby").notNull(), // lobby, betting, revealing, final
  revealedCards: integer("revealed_cards").array(),
  totalCards: integer("total_cards").default(4).notNull(),
});

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  balance: doublePrecision("balance").default(100).notNull(),
  isBot: boolean("is_bot").default(false).notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  lastBet: doublePrecision("last_bet").default(0).notNull(),
  finalScore: integer("final_score"),
  choice: text("choice"), // 'min' or 'max'
});

export const insertPlayerSchema = createInsertSchema(players).omit({ id: true });
export type Player = typeof players.$inferSelect;
export type GameSession = typeof gameSessions.$inferSelect;
