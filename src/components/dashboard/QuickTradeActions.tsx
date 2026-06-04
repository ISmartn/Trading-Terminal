import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { TableProperties, BarChart3, Star, Settings } from "lucide-react";

const actions = [
  {
    label: "Option Chain",
    icon: TableProperties,
    path: "/option-chain",
    desc: "NIFTY / BNIFTY chain",
    accent: "text-primary border-primary/20 bg-primary/[0.045] hover:border-primary/35",
  },
  {
    label: "OI Analysis",
    icon: BarChart3,
    path: "/oi-analysis",
    desc: "Call/Put OI trends",
    accent: "text-bullish border-bullish/20 bg-bullish/[0.045] hover:border-bullish/35",
  },
  {
    label: "Watchlist",
    icon: Star,
    path: "/watchlist",
    desc: "Track your scripts",
    accent: "text-warning border-warning/20 bg-warning/[0.045] hover:border-warning/35",
  },
  {
    label: "Broker API",
    icon: Settings,
    path: "/broker-settings",
    desc: "Connect your broker",
    accent: "text-primary border-border bg-card hover:border-primary/25",
  },
];

export function QuickTradeActions() {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {actions.map((a) => (
        <Card
          key={a.path}
          className={`group relative min-h-[106px] cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover ${a.accent}`}
          onClick={() => navigate(a.path)}
        >
          <CardContent className="relative z-10 flex h-full flex-col items-center justify-center gap-2.5 p-4 text-center">
            <div className="rounded-lg border border-border/60 bg-background/45 p-2 transition-colors duration-200 group-hover:border-current/25">
              <a.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-bold leading-tight">{a.label}</p>
              <p className="mt-1 hidden text-[11px] font-semibold uppercase leading-tight tracking-[0.04em] text-muted-foreground sm:block">
                {a.desc}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
