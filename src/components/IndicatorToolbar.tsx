import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings2 } from "lucide-react";
import { INDICATOR_META, type IndicatorId } from "@/lib/taCompute";

const DEFAULT_SELECTED: IndicatorId[] = ["ema", "bbands"];

interface IndicatorToolbarProps {
  selected: IndicatorId[];
  onChange: (ids: IndicatorId[]) => void;
  oscillatorPane: "rsi" | "macd" | "stoch" | "none";
  onOscillatorChange: (pane: "rsi" | "macd" | "stoch" | "none") => void;
  showVolume?: boolean;
  onShowVolumeChange?: (show: boolean) => void;
}

const ALL_IDS = Object.keys(INDICATOR_META) as IndicatorId[];

export function IndicatorToolbar({
  selected,
  onChange,
  oscillatorPane,
  onOscillatorChange,
  showVolume = true,
  onShowVolumeChange,
}: IndicatorToolbarProps) {
  const toggle = (id: IndicatorId) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
    const meta = INDICATOR_META[id];
    if (meta.pane === "rsi" || meta.pane === "macd" || meta.pane === "stoch") {
      onOscillatorChange(meta.pane);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-2xs text-muted-foreground mr-1">Indicators:</span>
      {(["rsi", "macd", "bbands", "ema", "vwap"] as IndicatorId[]).map((id) => (
        <Button
          key={id}
          type="button"
          variant={selected.includes(id) ? "default" : "outline"}
          size="sm"
          className="h-6 text-2xs px-2"
          onClick={() => toggle(id)}
        >
          {INDICATOR_META[id].label}
        </Button>
      ))}
      <Button
        type="button"
        variant={showVolume ? "default" : "outline"}
        size="sm"
        className="h-6 text-2xs px-2"
        onClick={() => onShowVolumeChange?.(!showVolume)}
      >
        Volume
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-6 text-2xs px-2 gap-1">
            <Settings2 className="h-3 w-3" />
            More
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3" align="start">
          <p className="text-xs font-medium mb-2">TA-Lib indicators</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {ALL_IDS.map((id) => (
              <div key={id} className="flex items-start gap-2">
                <Checkbox
                  id={`ind-${id}`}
                  checked={selected.includes(id)}
                  onCheckedChange={() => toggle(id)}
                />
                <Label htmlFor={`ind-${id}`} className="text-xs leading-tight cursor-pointer">
                  {INDICATOR_META[id].label}
                  <span className="block text-2xs text-muted-foreground font-normal">
                    {INDICATOR_META[id].description}
                  </span>
                </Label>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {oscillatorPane !== "none" && (
        <Badge variant="secondary" className="text-2xs h-5">
          Pane: {oscillatorPane.toUpperCase()}
        </Badge>
      )}
    </div>
  );
}
