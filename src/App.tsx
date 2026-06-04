import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import DashboardLayout from "@/components/DashboardLayout";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";

// Route-based code splitting for optimal initial load
const Index = lazy(() => import("./pages/Index"));
const OptionChain = lazy(() => import("./pages/OptionChain"));
const OIAnalysis = lazy(() => import("./pages/OIAnalysis"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const StrategyBuilder = lazy(() => import("./pages/StrategyBuilder"));
const TAScanner = lazy(() => import("./pages/TAScanner"));
const ThreeCandleScanner = lazy(() => import("./pages/ThreeCandleScanner"));
const FnoIntelligence = lazy(() => import("./pages/FnoIntelligence"));
const StrategyScanner = lazy(() => import("./pages/StrategyScanner"));
const IndexOptionInsights = lazy(() => import("./pages/IndexOptionInsights"));
const IndexMoveAlerts = lazy(() => import("./pages/IndexMoveAlerts"));
const SmallcapStockAlerts = lazy(() => import("./pages/SmallcapStockAlerts"));
const ChartPatternScanner = lazy(() => import("./pages/ChartPatternScanner"));
const PositionTracker = lazy(() => import("./pages/PositionTracker"));
const BrokerSettings = lazy(() => import("./pages/BrokerSettings"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <ErrorBoundary fallbackMessage="This page encountered an error. Try refreshing.">
        {children}
      </ErrorBoundary>
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<PageSuspense><Index /></PageSuspense>} />
            <Route path="/option-chain" element={<PageSuspense><OptionChain /></PageSuspense>} />
            <Route path="/oi-analysis" element={<PageSuspense><OIAnalysis /></PageSuspense>} />
            <Route path="/ta-scanner" element={<PageSuspense><TAScanner /></PageSuspense>} />
            <Route path="/three-candle-scanner" element={<PageSuspense><ThreeCandleScanner /></PageSuspense>} />
            <Route path="/chart-pattern-scanner" element={<PageSuspense><ChartPatternScanner /></PageSuspense>} />
            <Route path="/strategy-scanner" element={<PageSuspense><StrategyScanner /></PageSuspense>} />
            <Route path="/index-oi-insights" element={<PageSuspense><IndexOptionInsights /></PageSuspense>} />
            <Route path="/index-move-alerts" element={<PageSuspense><IndexMoveAlerts /></PageSuspense>} />
            <Route path="/smallcap-stock-alerts" element={<PageSuspense><SmallcapStockAlerts /></PageSuspense>} />
            <Route path="/fno-intelligence" element={<PageSuspense><FnoIntelligence /></PageSuspense>} />
            <Route path="/live-scanner" element={<PageSuspense><FnoIntelligence /></PageSuspense>} />
            <Route path="/watchlist" element={<PageSuspense><Watchlist /></PageSuspense>} />
            <Route path="/strategy-builder" element={<PageSuspense><StrategyBuilder /></PageSuspense>} />
            <Route path="/position-tracker" element={<PageSuspense><PositionTracker /></PageSuspense>} />
            <Route path="/broker-settings" element={<PageSuspense><BrokerSettings /></PageSuspense>} />
          </Route>
          <Route path="*" element={<Suspense fallback={null}><NotFound /></Suspense>} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

