import { useEffect, useState } from "react";

interface SakuraBackgroundProps {
  intensity?: "low" | "medium" | "high";
  children?: React.ReactNode;
}

interface Petal {
  id: number;
  left: number;
  delay: number;
  duration: number;
  size: number;
}

export function SakuraBackground({ intensity = "medium", children }: SakuraBackgroundProps) {
  const [petals, setPetals] = useState<Petal[]>([]);

  useEffect(() => {
    const petalCount = intensity === "high" ? 30 : intensity === "medium" ? 15 : 5;
    const newPetals = Array.from({ length: petalCount }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 5,
      duration: 3 + Math.random() * 4,
      size: 8 + Math.random() * 8,
    }));
    setPetals(newPetals);
  }, [intensity]);

  return (
    <div className="relative">
      {/* Falling petals overlay */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-50" aria-hidden="true">
        {petals.map((petal) => (
          <div
            key={petal.id}
            className="absolute sakura-particle"
            style={{
              left: `${petal.left}%`,
              animationDelay: `${petal.delay}s`,
              animationDuration: `${petal.duration}s`,
              width: `${petal.size}px`,
              height: `${petal.size}px`,
            }}
          />
        ))}
      </div>
      {children}
    </div>
  );
}
