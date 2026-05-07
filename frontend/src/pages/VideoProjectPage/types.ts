import type { Clip } from "../../types";

export interface VideoProject {
  id: string;
  owner_id: string;
  team_id: string | null;
  source_path: string;
  original_source: string | null;
  original_filename: string;
  duration: number | null;
  status: "pending" | "processing" | "complete" | "failed";
  created_at: number;
  updated_at: number;
  owner?: { id: string; display_name: string | null; email: string };
  team?: { id: string; name: string } | null;
  clips?: Clip[];
}

export interface TeamMember {
  id: string;
  user_id: string;
  user: { id: string; display_name: string | null; email: string };
  role: "owner" | "admin" | "editor" | "viewer";
}
