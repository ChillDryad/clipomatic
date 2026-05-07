import { useInfiniteQuery } from "@tanstack/react-query";
import { listProjects } from "../api";
import type { VideoProject } from "../api";

interface UseInfiniteProjectsOptions {
  teamId?: string | null;
  pageSize?: number;
  enabled?: boolean;
}

interface UseInfiniteProjectsResult {
  allProjects: VideoProject[];
  total: number;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useInfiniteProjects(
  options?: UseInfiniteProjectsOptions,
): UseInfiniteProjectsResult {
  const { teamId = null, pageSize = 20, enabled = true } = options ?? {};

  const query = useInfiniteQuery({
    queryKey: ["projects", teamId],
    queryFn: ({ pageParam = 0 }) =>
      listProjects(teamId || undefined, pageSize, pageParam as number),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      return lastPage.has_more ? lastPage.offset + lastPage.limit : undefined;
    },
    enabled,
  });

  return {
    allProjects: query.data?.pages.flatMap((page) => page.projects) ?? [],
    total: query.data?.pages[0]?.total ?? 0,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
