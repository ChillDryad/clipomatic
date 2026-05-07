import { Link } from "react-router-dom";

export function MomijiLogo() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2 group hover:opacity-90 transition-opacity"
      aria-label="Momiji Clipper — Home"
    >
      {/* Sakura Leaf Icon */}
      <div className="relative w-6 h-6">
        <svg
          className="w-6 h-6 text-momiji-sakura animate-pulse-slow"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 2C9.5 2 7 4.5 7 7c0 1.5.5 2.5 1.5 3.5C7 11.5 4 14 4 17c0 2.5 2 4 4.5 4S13 19.5 13 17c0-1-.5-2-1-2.5 1 .5 2.5.5 3.5 0C15 15 14.5 16 14.5 17c0 2.5 2 4 4.5 4s4.5-1.5 4.5-4c0-3-3-5.5-4.5-6.5C20 9.5 20.5 8.5 20.5 7c0-2.5-2.5-5-5-5S13 4.5 13 7c0 1 .5 2 1 2.5-1-.5-2.5-.5-3.5 0C11 9 11.5 8 11.5 7c0-2.5-2-5-4.5-5z" />
        </svg>
        {/* Glow effect */}
        <div className="absolute inset-0 bg-momiji-sakura blur-md opacity-30 group-hover:opacity-60 transition-opacity" />
      </div>

      {/* Gradient Wordmark */}
      <span className="text-lg font-bold bg-gradient-to-r from-momiji-sakura to-momiji-neon-pink bg-clip-text text-transparent">
        Momiji Clipper
      </span>
    </Link>
  );
}
