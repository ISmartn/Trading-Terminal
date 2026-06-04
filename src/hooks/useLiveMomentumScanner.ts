import { useQuery } from "@tanstack/react-query";
import {
  fetchLiveMomentumScan,
  type LiveMomentumScanResult,
  type LiveMomentumUniverse,
} from "@/lib/liveMomentumScanner";

export function useLiveMomentumScanner(universe: LiveMomentumUniverse = "popular", enabled = true) {
  return useQuery({
    queryKey: ["live-momentum-scanner", universe],
    queryFn: (): Promise<LiveMomentumScanResult> => fetchLiveMomentumScan(universe),
    enabled,
    refetchInterval: 2500,
    staleTime: 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
