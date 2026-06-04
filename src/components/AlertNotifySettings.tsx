import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { BellRing, Smartphone, Volume2 } from "lucide-react";
import { useAlertNotifyPrefs } from "@/hooks/useAlertNotifyPrefs";

/** Shared toggles: sound, in-tab browser notify, mobile Web Push (browser closed). */
export function AlertNotifySettings() {
  const {
    prefs,
    pushStatus,
    mobilePushBusy,
    setSound,
    setBrowser,
    setMobilePush,
    testMobilePush,
    requestPermission,
    webPushSupported,
  } = useAlertNotifyPrefs();

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <Switch id="alert-sound" checked={prefs.sound} onCheckedChange={setSound} />
        <Label htmlFor="alert-sound" className="flex items-center gap-1 text-xs">
          <Volume2 className="h-3.5 w-3.5" />
          Alert sound
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="alert-browser"
          checked={prefs.browser}
          onCheckedChange={async (v) => {
            await setBrowser(v);
            if (v) await requestPermission();
          }}
        />
        <Label htmlFor="alert-browser" className="flex items-center gap-1 text-xs">
          <BellRing className="h-3.5 w-3.5" />
          Tab background
        </Label>
      </div>
      {webPushSupported && (
        <div className="flex items-center gap-2">
          <Switch
            id="alert-mobile"
            checked={prefs.mobilePush}
            disabled={mobilePushBusy || pushStatus?.configured === false}
            onCheckedChange={(v) => void setMobilePush(v)}
          />
          <Label htmlFor="alert-mobile" className="flex items-center gap-1 text-xs">
            <Smartphone className="h-3.5 w-3.5" />
            Mobile push
          </Label>
          {prefs.mobilePush && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-2xs"
              onClick={() => void testMobilePush()}
            >
              Test
            </Button>
          )}
        </div>
      )}
      {webPushSupported && pushStatus && !pushStatus.configured && (
        <span className="text-2xs text-amber-600 dark:text-amber-400">
          Add VAPID keys to proxy .env for mobile push
        </span>
      )}
    </div>
  );
}
