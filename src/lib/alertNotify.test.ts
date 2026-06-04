import { describe, expect, it, beforeEach } from "vitest";
import { loadAlertNotifyPrefs, saveAlertNotifyPrefs } from "./alertNotify";

describe("alertNotify prefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults sound and browser on", () => {
    expect(loadAlertNotifyPrefs()).toEqual({ sound: true, browser: true });
  });

  it("persists partial updates", () => {
    saveAlertNotifyPrefs({ sound: false });
    expect(loadAlertNotifyPrefs()).toEqual({ sound: false, browser: true });
  });
});
