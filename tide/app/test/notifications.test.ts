import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyDesktop } from "../src/renderer/src/notifications";

class FakeNotification {
  static last: FakeNotification;
  onclick: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    public title: string,
    public options: { body: string },
  ) {
    FakeNotification.last = this;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("notifyDesktop", () => {
  it("brings TIDE forward and runs the action only when it is clicked", () => {
    const focusWindow = vi.fn();
    const onClick = vi.fn();
    vi.stubGlobal("Notification", FakeNotification);
    vi.stubGlobal("window", { desktop: { focusWindow } });

    notifyDesktop("TIDE: counting finished", "a.mp4: 5 points", onClick);
    const shown = FakeNotification.last;
    expect([shown.title, shown.options.body]).toEqual(["TIDE: counting finished", "a.mp4: 5 points"]);
    expect(focusWindow).not.toHaveBeenCalled();

    shown.onclick?.();
    expect(focusWindow).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
