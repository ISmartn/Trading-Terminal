import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchLiveIntelligence,
  fetchPlaybook,
  type LiveIntelligenceResult,
  type PlaybookResult,
} from "@/lib/fnoIntelligence";

export function useFnoLiveIntelligence(universe = "all", enabled = true) {
  return useQuery({
    queryKey: ["fno-intelligence-live", universe],
    queryFn: (): Promise<LiveIntelligenceResult> => fetchLiveIntelligence(universe),
    enabled,
    refetchInterval: (q) => (q.state.data?.marketOpen ? 2500 : 30000),
    staleTime: 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useFnoPlaybook(universe = "popular") {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["fno-intelligence-playbook", universe],
    queryFn: (): Promise<PlaybookResult> => fetchPlaybook(false, universe),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const generate = useMutation({
    mutationFn: () => fetchPlaybook(true, universe),
    onSuccess: (data) => {
      qc.setQueryData(["fno-intelligence-playbook", universe], data);
    },
  });

  return { ...query, generatePlaybook: generate };
}
