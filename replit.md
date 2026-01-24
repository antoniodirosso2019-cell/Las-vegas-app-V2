# Las Vegas Poker - Real-time Multiplayer Card Game

## Overview

This is a real-time multiplayer poker-style card game built with a React frontend and Express backend. The application uses Firebase Realtime Database for live game state synchronization between players, with PostgreSQL for persistent user data storage. The game features a neon/cyberpunk visual theme with smooth animations and supports multiple players including bot opponents.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight router)
- **State Management**: TanStack React Query for server state, React useState for local state
- **Styling**: Tailwind CSS with custom neon/cyberpunk theme, CSS variables for theming
- **UI Components**: shadcn/ui component library (Radix UI primitives)
- **Animations**: Framer Motion for smooth transitions and neon pulse effects
- **Real-time**: Firebase Realtime Database for live game synchronization
- **Build Tool**: Vite with hot module replacement

### Backend Architecture
- **Framework**: Express 5 on Node.js
- **Language**: TypeScript with ES Modules
- **Database ORM**: Drizzle ORM with PostgreSQL
- **API Style**: RESTful endpoints defined in shared routes

### Project Structure
```
client/           # React frontend application
  src/
    components/   # Reusable UI components
    pages/        # Route page components
    hooks/        # Custom React hooks
    lib/          # Utilities (firebase, query client)
server/           # Express backend
  index.ts        # Server entry point
  routes.ts       # API route definitions
  storage.ts      # Database access layer
  db.ts           # Database connection
shared/           # Shared code between client/server
  schema.ts       # Drizzle database schema
  routes.ts       # API route definitions
```

### Data Flow
1. Game state is stored in Firebase Realtime Database for instant synchronization
2. Player persistent data (users, balances) stored in PostgreSQL
3. Frontend subscribes to Firebase for live updates
4. Backend handles authentication and persistent operations

### Database Schema
- **gameSessions**: Stores game state (pot, current bet, phase, revealed cards)
- **players**: Stores player data (username, balance, bot status, admin status, bets, choices)

## External Dependencies

### Firebase Realtime Database
- **Purpose**: Real-time game state synchronization between players
- **Database URL**: `https://las-vegas-poker-f2d6a-default-rtdb.europe-west1.firebasedatabase.app`
- **Usage**: Stores live game state, player actions, and synchronizes updates instantly across all connected clients
- **Client SDK**: firebase/compat (compatibility mode)

### PostgreSQL Database
- **Purpose**: Persistent storage for user accounts and game history
- **Connection**: Via `DATABASE_URL` environment variable
- **ORM**: Drizzle ORM with drizzle-kit for migrations
- **Schema**: Defined in `shared/schema.ts`

### Key NPM Packages
- `@tanstack/react-query`: Server state management and caching
- `framer-motion`: Animation library for neon effects
- `wouter`: Lightweight client-side routing
- `drizzle-orm`: Type-safe database ORM
- `zod`: Runtime type validation
- Full shadcn/ui component suite (Radix UI primitives)

### Fonts
- Oxanium: Display font for headers
- Inter: Body text
- Loaded via Google Fonts CDN