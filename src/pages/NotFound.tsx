import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft, SearchX } from "lucide-react";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-[80vh] items-center justify-center relative overflow-hidden">
      {/* Background Ornaments */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[100px] -z-10 pointer-events-none" />
      <div className="absolute top-[30%] left-[40%] w-32 h-32 bg-primary/10 rounded-full blur-[40px] animate-pulse -z-10 pointer-events-none" />

      <div className="text-center space-y-8 max-w-md mx-auto px-6 animate-in slide-in-from-bottom-4 fade-in duration-700 relative z-10">
        
        {/* Animated Icon & 404 text */}
        <div className="relative group cursor-default">
          <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
          <h1 className="text-[140px] font-black leading-none tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-foreground/80 via-muted-foreground/30 to-muted-foreground/5 select-none animate-float">
            404
          </h1>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-20 w-20 rounded-2xl bg-background/50 backdrop-blur-md border border-primary/30 flex items-center justify-center shadow-[0_0_30px_rgba(0,183,211,0.2)] group-hover:shadow-[0_0_50px_rgba(0,183,211,0.4)] transition-all duration-500 hover:scale-110">
              <SearchX className="h-10 w-10 text-primary" />
            </div>
          </div>
        </div>

        {/* Message */}
        <div className="space-y-3">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Out of Bounds</h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed max-w-sm mx-auto">
            The endpoint <code className="bg-primary/10 border border-primary/20 px-2 py-0.5 rounded text-[13px] font-mono text-primary shadow-sm">{location.pathname}</code> could not be located in the terminal registry.
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <Button onClick={() => navigate(-1)} variant="outline" className="gap-2 h-10 px-5 hover:text-primary hover:border-primary/50 transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>
          <Button onClick={() => navigate("/")} className="gap-2 h-10 px-5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(0,183,211,0.3)] hover:shadow-[0_0_30px_rgba(0,183,211,0.5)] transition-all">
            <Home className="h-4 w-4" />
            Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
