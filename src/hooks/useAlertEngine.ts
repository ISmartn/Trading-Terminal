import { useEffect, useRef, useCallback } from "react";
import { playAlertSound, type AlertTone } from "@/lib/alertNotify";

export type { AlertTone } from "@/lib/alertNotify";
export { playAlertSound } from "@/lib/alertNotify";

export interface AlertCondition {
  id: string;
  symbol: string;
  type: "price" | "oi_spike" | "iv_spike" | "pcr" | "vix";
  condition: "above" | "below";
  value: number;
  active: boolean;
  triggered: boolean;
  triggeredAt?: number;
  tone: AlertTone;
}

interface AlertCheckData {
  spotPrice?: number;
  vix?: number;
  pcr?: number;
  atmIV?: number;
  maxOIChange?: number;
}

export function checkAlerts(
  alerts: AlertCondition[],
  data: AlertCheckData
): AlertCondition[] {
  const now = Date.now();
  const cooldown = 60000;

  return alerts.map(alert => {
    if (!alert.active || (alert.triggered && alert.triggeredAt && now - alert.triggeredAt < cooldown)) {
      return alert;
    }

    let currentValue: number | undefined;
    switch (alert.type) {
      case "price": currentValue = data.spotPrice; break;
      case "vix": currentValue = data.vix; break;
      case "pcr": currentValue = data.pcr; break;
      case "iv_spike": currentValue = data.atmIV; break;
      case "oi_spike": currentValue = data.maxOIChange; break;
    }

    if (currentValue === undefined) return alert;

    const shouldTrigger =
      (alert.condition === "above" && currentValue > alert.value) ||
      (alert.condition === "below" && currentValue < alert.value);

    if (shouldTrigger && !alert.triggered) {
      return { ...alert, triggered: true, triggeredAt: now };
    }

    if (!shouldTrigger && alert.triggered) {
      return { ...alert, triggered: false, triggeredAt: undefined };
    }

    return alert;
  });
}

export function useAlertEngine(
  alerts: AlertCondition[],
  data: AlertCheckData,
  onTriggered: (alert: AlertCondition) => void,
  soundEnabled: boolean = true,
) {
  const prevTriggered = useRef<Set<string>>(new Set());

  const check = useCallback(() => {
    const updated = checkAlerts(alerts, data);
    updated.forEach(alert => {
      if (alert.triggered && !prevTriggered.current.has(alert.id)) {
        prevTriggered.current.add(alert.id);
        onTriggered(alert);
        if (soundEnabled) playAlertSound(alert.tone);
      }
      if (!alert.triggered && prevTriggered.current.has(alert.id)) {
        prevTriggered.current.delete(alert.id);
      }
    });
  }, [alerts, data, onTriggered, soundEnabled]);

  useEffect(() => {
    const interval = setInterval(check, 5000);
    check();
    return () => clearInterval(interval);
  }, [check]);
}
