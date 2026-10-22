import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Catalog, Member, Progress, Project, ProjectDetail } from "./types";

export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => api.get<Project[]>("/projects"), staleTime: 60_000 });
export const useCatalog = () => useQuery({ queryKey: ["catalog"], queryFn: () => api.get<Catalog>("/catalog"), staleTime: 10 * 60_000 });
export const useMembers = (projectId: string | null | undefined) => useQuery({
  queryKey: ["members", projectId], enabled: !!projectId, staleTime: 60_000,
  queryFn: () => api.get<Member[]>(`/projects/${projectId}/members`),
});
export const useProject = (id: string | undefined) => useQuery({
  queryKey: ["project", id], enabled: !!id, queryFn: () => api.get<ProjectDetail>(`/projects/${id}`),
});
export const useProgress = (id: string | undefined) => useQuery({
  queryKey: ["progress", id], enabled: !!id, queryFn: () => api.get<Progress>(`/projects/${id}/progress`),
});
