import { cn } from "@/lib/utils";
import { Wifi, WifiOff } from "lucide-react";

interface StatusBadgeProps {
  connected: boolean;
}

export function StatusBadge({ connected }: StatusBadgeProps) {
  return (
    <div className={cn(
      "inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border",
      connected 
        ? "bg-green-500/10 text-green-400 border-green-500/30 shadow-[0_0_10px_-3px_rgba(74,222,128,0.5)]" 
        : "bg-red-500/10 text-red-400 border-red-500/30 shadow-[0_0_10px_-3px_rgba(248,113,113,0.5)]"
    )}>
      {connected ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          Live
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3" />
          Offline
        </>
      )}
    </div>
  );
}
