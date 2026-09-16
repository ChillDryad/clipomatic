import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/ui/Button";
import { ProjectList } from "../components/projects/ProjectList";
import { useInfiniteProjects } from "../hooks/useInfiniteProjects";

interface Team {
  id: string;
  name: string;
  owner_id: string;
  member_count?: number;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);

  // Load teams on mount
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login", { replace: true });
      return;
    }
    const loadTeams = async () => {
      try {
        const teamsRes = await fetch("/api/teams", { credentials: "include" });
        if (teamsRes.ok) {
          const teamsData = await teamsRes.json();
          setTeams(teamsData.teams || []);
        }
      } catch (err) {
        console.error("Failed to load teams:", err);
      }
    };
    loadTeams();
  }, [isAuthenticated, navigate]);

  // Projects data for Quick Stats
  const { allProjects, total: totalProjects } = useInfiniteProjects({
    teamId: selectedTeam,
  });

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            {/* User avatar */}
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--ctp-mauve)] to-[var(--ctp-blue)] flex items-center justify-center text-white font-bold text-lg shadow-lg">
              {(user?.display_name || user?.email || "U")[0].toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-bold text-[var(--ctp-text)]">
                Dashboard
              </h1>
              <p className="text-sm text-[var(--ctp-subtext)]">
                Welcome back,{" "}
                <span className="font-medium text-[var(--ctp-text)]">
                  {user?.display_name || user?.email?.split("@")[0]}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/clip-studio"
              className="btn-primary inline-flex items-center gap-2"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              New Project
            </Link>
            <Button
              onClick={handleLogout}
              variant="secondary"
              size="sm"
              className="hidden sm:inline-flex"
            >
              Logout
            </Button>
          </div>
        </div>
      </div>

      {/* Team Switcher */}
      {teams.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-[var(--ctp-mauve)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <h2 className="text-sm font-semibold text-[var(--ctp-text)]">
                Viewing
              </h2>
            </div>
            <div className="relative">
              <button
                onClick={() => setTeamDropdownOpen(!teamDropdownOpen)}
                className="btn-secondary text-sm flex items-center gap-2 py-2 px-4 hover:border-[var(--ctp-mauve)] transition-colors"
                aria-expanded={teamDropdownOpen}
                aria-haspopup="listbox"
              >
                <span className="max-w-[150px] truncate">
                  {selectedTeam
                    ? teams.find((t) => t.id === selectedTeam)?.name
                    : "All Projects"}
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${teamDropdownOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {teamDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setTeamDropdownOpen(false)}
                  />
                  <div
                    className="absolute right-0 mt-2 w-56 glass-card py-1 z-50 animate-fadeIn shadow-xl"
                    role="listbox"
                  >
                    <button
                      onClick={() => {
                        setSelectedTeam(null);
                        setTeamDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-3 ${!selectedTeam ? "bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)]" : "text-[var(--ctp-text)] hover:bg-[var(--ctp-surface-1)]"}`}
                      role="option"
                      aria-selected={!selectedTeam}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                        />
                      </svg>
                      All Projects
                    </button>
                    {teams.map((team) => (
                      <button
                        key={team.id}
                        onClick={() => {
                          setSelectedTeam(team.id);
                          setTeamDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-3 ${selectedTeam === team.id ? "bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)]" : "text-[var(--ctp-text)] hover:bg-[var(--ctp-surface-1)]"}`}
                        role="option"
                        aria-selected={selectedTeam === team.id}
                      >
                        <div className="w-4 h-4 rounded-full bg-[var(--ctp-mauve)]/20 flex items-center justify-center">
                          {selectedTeam === team.id && (
                            <svg
                              className="w-3 h-3 text-[var(--ctp-mauve)]"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          )}
                        </div>
                        {team.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Projects */}
      <ProjectList
        teamId={selectedTeam}
        title={
          selectedTeam
            ? `${teams.find((t) => t.id === selectedTeam)?.name} Projects`
            : "My Projects"
        }
        autoLoad
      />

      {/* TODO: move to container + componentize the card. keep it simple. */}
      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-5 group hover:border-[var(--ctp-mauve)] transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--ctp-mauve-20)] to-[var(--ctp-mauve-30)] flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg
                className="w-5 h-5 text-[var(--ctp-mauve)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <div className="text-2xl font-bold text-[var(--ctp-mauve)]">
              {totalProjects}
            </div>
          </div>
          <div className="text-xs text-[var(--ctp-subtext)] font-medium">
            Total Projects
          </div>
        </div>
        <div className="glass-card p-5 group hover:border-[var(--ctp-green)] transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--ctp-green-20)] to-[var(--ctp-green-30)] flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg
                className="w-5 h-5 text-[var(--ctp-green)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="text-2xl font-bold text-[var(--ctp-green)]">
              {allProjects.filter((p) => p.status === "complete").length}
            </div>
          </div>
          <div className="text-xs text-[var(--ctp-subtext)] font-medium">
            Completed
          </div>
        </div>
        <div className="glass-card p-5 group hover:border-[var(--ctp-blue)] transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--ctp-blue-20)] to-[var(--ctp-blue-30)] flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg
                className="w-5 h-5 text-[var(--ctp-blue)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div className="text-2xl font-bold text-[var(--ctp-blue)]">
              {allProjects.filter((p) => p.status === "processing").length}
            </div>
          </div>
          <div className="text-xs text-[var(--ctp-subtext)] font-medium">
            Processing
          </div>
        </div>
        <div className="glass-card p-5 group hover:border-[var(--ctp-yellow)] transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--ctp-yellow-20)] to-[var(--ctp-yellow-30)] flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg
                className="w-5 h-5 text-[var(--ctp-yellow)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <div className="text-2xl font-bold text-[var(--ctp-yellow)]">
              {teams.length}
            </div>
          </div>
          <div className="text-xs text-[var(--ctp-subtext)] font-medium">
            Teams
          </div>
        </div>
      </div>
    </div>
  );
}
