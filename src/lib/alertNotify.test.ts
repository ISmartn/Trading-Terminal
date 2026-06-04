import { describe, expect, it, beforeEach } from "vitest";
import { loadAlertNotifyPrefs, saveAlertNotifyPrefs } from "./alertNotify";

describe("alertNotify prefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults sound and browser on, mobile push off", () => {
    expect(loadAlertNotifyPrefs()).toEqual({ sound: true, browser: true, mobilePush: false });
  });

  it("persists partial updates", () => {
    saveAlertNotifyPrefs({ sound: false, mobilePush: true });
    expect(loadAlertNotifyPrefs()).toEqual({ sound: false, browser: true, mobilePush: true });
  });
});
