// Keeps track of every video's count, wherever staff are in the app: what is being counted right now,
// and a desktop notification when a count finishes or fails.
import { useEffect, useRef, useState } from "react";
import type { CountStatus } from "../../shared/api";
import { api } from "./api";

export const isCounting = (state: string) => state === "queued" || state === "running";

/** Counts that were going last time we checked and have now finished or failed. */
export function countsThatEnded(before: Map<number, string>, now: CountStatus[]): CountStatus[] {
  return now.filter((c) => isCounting(before.get(c.videoId) ?? "") && (c.state === "done" || c.state === "failed"));
}

function notifyEnded(c: CountStatus) {
  new Notification(c.state === "done" ? "TIDE: counting finished" : "TIDE: counting failed", {
    body: `${c.fileName}: ${c.detail}`,
  });
}

export function useCounts(notify: boolean): CountStatus[] {
  const [counts, setCounts] = useState<CountStatus[]>([]);
  const before = useRef<Map<number, string> | null>(null); // null until the first check
  const notifyNow = useRef(notify);
  notifyNow.current = notify;

  // Counting runs in the back end and carries on whichever screen is open, so check every 3 seconds.
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const now = await api.counts.list();
        if (stopped) return;
        setCounts(now);
        if (before.current && notifyNow.current) countsThatEnded(before.current, now).forEach(notifyEnded);
        before.current = new Map(now.map((c) => [c.videoId, c.state]));
      } catch {
        // The back end is restarting or busy: try again at the next check.
      }
    };
    void check();
    const timer = setInterval(() => void check(), 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  // Electron needs to know this so closing TIDE in the middle of a count can warn first.
  const active = counts.filter((c) => isCounting(c.state)).length;
  useEffect(() => {
    window.desktop.setCounting(active);
  }, [active]);

  return counts;
}
