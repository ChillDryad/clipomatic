interface BloomIndicatorProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

function getBloom(score: number): string {
  if (score >= 80) return "🌸🌸🌸";
  if (score >= 50) return "🌸🌸░";
  return "🌸░░░";
}

function getGlowClass(score: number): string {
  if (score >= 80) return "bloom-glow-high";
  if (score >= 50) return "bloom-glow-mid";
  return "";
}

const sizeClasses: Record<string, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export function BloomIndicator({ score, size = "sm" }: BloomIndicatorProps) {
  return (
    <span
      className={`bloom-indicator ${getGlowClass(score)} ${sizeClasses[size]}`}
      title={`Virality: ${score}/100`}
      aria-label={`Virality score ${score} out of 100`}
    >
      {getBloom(score)}
      <span className="ml-1 font-medium text-[var(--ctp-subtext)]">
        {score}
      </span>
    </span>
  );
}
