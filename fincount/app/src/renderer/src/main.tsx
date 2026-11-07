import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/sora/500.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "./styles.css";
import App from "./App";
import { connect } from "./api";
import { applyTheme, initialTheme } from "./theme";

applyTheme(initialTheme()); // before first paint, so there's no flash of the wrong theme

/** Shows "Starting TIDE…" until the back end answers, or a plain explanation if it can't start. */
function Startup() {
  const [state, setState] = useState<"starting" | "ready" | string>("starting");
  useEffect(() => {
    connect().then(
      (b) => setState(b.error ?? "ready"),
      (e: Error) => setState(e.message),
    );
    window.desktop.onBackendCrashed((msg) => setState(msg));
  }, []);
  if (state === "ready") return <App />;
  return (
    <div className="grid h-screen place-items-center bg-background text-foreground">
      <div className="max-w-xl px-8 text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-xl bg-gradient-ocean font-display text-2xl font-bold text-primary-foreground">
          T
        </div>
        {state === "starting" ? (
          <>
            <div className="font-display text-xl font-semibold">Starting TIDE…</div>
            <p className="mt-2 text-sm text-muted-foreground">This takes a few seconds.</p>
          </>
        ) : (
          <>
            <div className="font-display text-xl font-semibold">TIDE couldn't start</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Close the app and open it again. If it keeps happening, send this message to whoever set it up:
            </p>
            <pre className="mt-4 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-card p-4 text-left text-xs text-muted-foreground">
              {state}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Startup />
  </StrictMode>,
);
