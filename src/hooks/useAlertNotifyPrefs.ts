import { useCallback, useState } from "react";
import {
  loadAlertNotifyPrefs,
  requestBrowserNotifyPermission,
  saveAlertNotifyPrefs,
  type AlertNotifyPrefs,
} from "@/lib/alertNotify";

export function useAlertNotifyPrefs() {
  const [prefs, setPrefs] = useState<AlertNotifyPrefs>(() => loadAlertNotifyPrefs());

  const setSound = useCallback((sound: boolean) => {
    setPrefs(saveAlertNotifyPrefs({ sound }));
  }, []);

  const setBrowser = useCallback(async (browser: boolean) => {
    if (browser) await requestBrowserNotifyPermission();
    setPrefs(saveAlertNotifyPrefs({ browser }));
  }, []);

  const requestPermission = useCallback(() => requestBrowserNotifyPermission(), []);

  return { prefs, setSound, setBrowser, requestPermission };
}
