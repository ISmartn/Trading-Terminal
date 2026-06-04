import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  loadAlertNotifyPrefs,
  requestBrowserNotifyPermission,
  saveAlertNotifyPrefs,
  type AlertNotifyPrefs,
} from "@/lib/alertNotify";
import {
  fetchPushStatus,
  isWebPushSupported,
  subscribeMobilePush,
  unsubscribeMobilePush,
  sendTestMobilePush,
  type PushStatus,
} from "@/lib/webPush";

export function useAlertNotifyPrefs() {
  const [prefs, setPrefs] = useState<AlertNotifyPrefs>(() => loadAlertNotifyPrefs());
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [mobilePushBusy, setMobilePushBusy] = useState(false);

  useEffect(() => {
    if (!isWebPushSupported()) return;
    fetchPushStatus().then(setPushStatus);
    if (loadAlertNotifyPrefs().mobilePush) {
      subscribeMobilePush()
        .then((r) => {
          if (!r.ok) saveAlertNotifyPrefs({ mobilePush: false });
        })
        .catch(() => saveAlertNotifyPrefs({ mobilePush: false }));
    }
  }, []);

  const setSound = useCallback((sound: boolean) => {
    setPrefs(saveAlertNotifyPrefs({ sound }));
  }, []);

  const setBrowser = useCallback(async (browser: boolean) => {
    if (browser) await requestBrowserNotifyPermission();
    setPrefs(saveAlertNotifyPrefs({ browser }));
  }, []);

  const setMobilePush = useCallback(async (mobilePush: boolean) => {
    setMobilePushBusy(true);
    try {
      if (mobilePush) {
        const result = await subscribeMobilePush();
        if (!result.ok) {
          toast.error(result.error || "Could not enable mobile push");
          setPrefs(saveAlertNotifyPrefs({ mobilePush: false }));
          return;
        }
        toast.success("Mobile push enabled — alerts work when the browser is closed");
        setPrefs(saveAlertNotifyPrefs({ mobilePush: true }));
      } else {
        await unsubscribeMobilePush();
        setPrefs(saveAlertNotifyPrefs({ mobilePush: false }));
        toast.info("Mobile push disabled");
      }
      const st = await fetchPushStatus();
      setPushStatus(st);
    } finally {
      setMobilePushBusy(false);
    }
  }, []);

  const testMobilePush = useCallback(async () => {
    const { sent, error } = await sendTestMobilePush();
    if (error) toast.error(error);
    else if (sent > 0) toast.success(`Test notification sent to ${sent} device(s)`);
    else toast.warning("No devices subscribed — enable Mobile push first");
  }, []);

  const requestPermission = useCallback(() => requestBrowserNotifyPermission(), []);

  return {
    prefs,
    pushStatus,
    mobilePushBusy,
    setSound,
    setBrowser,
    setMobilePush,
    testMobilePush,
    requestPermission,
    webPushSupported: isWebPushSupported(),
  };
}
