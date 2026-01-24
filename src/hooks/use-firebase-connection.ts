import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";

export function useFirebaseConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    const connectedRef = db.ref(".info/connected");
    
    const handleValue = (snap: any) => {
      const connected = snap.val() === true;
      setIsConnected(connected);
      setIsInitialized(true);
      setLastChecked(new Date());
    };

    connectedRef.on("value", handleValue);

    return () => {
      connectedRef.off("value", handleValue);
    };
  }, []);

  return { isConnected, isInitialized, lastChecked };
}
