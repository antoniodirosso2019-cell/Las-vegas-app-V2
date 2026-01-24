import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface NeonCardProps {
  children: React.ReactNode;
  className?: string;
  color?: "primary" | "secondary" | "accent";
  delay?: number;
}

export function NeonCard({ children, className, color = "primary", delay = 0 }: NeonCardProps) {
  const shadowColor = {
    primary: "shadow-primary/20",
    secondary: "shadow-secondary/20",
    accent: "shadow-accent/20"
  }[color];

  const borderColor = {
    primary: "border-primary/50",
    secondary: "border-secondary/50",
    accent: "border-accent/50"
  }[color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={cn(
        "relative rounded-2xl p-6 glass-panel overflow-hidden",
        "border transition-all duration-300",
        "hover:shadow-2xl hover:-translate-y-1",
        borderColor,
        shadowColor,
        "shadow-xl",
        className
      )}
    >
      <div className={cn(
        "absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-current to-transparent opacity-50",
        color === "primary" && "text-primary",
        color === "secondary" && "text-secondary",
        color === "accent" && "text-accent",
      )} />
      {children}
    </motion.div>
  );
}
