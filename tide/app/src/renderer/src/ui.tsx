// Small building blocks shared by every screen.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { STATUS_LABEL, type SpeciesStatus } from "../../shared/survey";

export const btn =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40 disabled:cursor-not-allowed";
export const btnPrimary = `${btn} bg-gradient-ocean text-primary-foreground shadow-glow hover:brightness-110`;
export const btnGhost = `${btn} border border-border bg-card hover:bg-secondary`;
export const btnLink = "text-sm text-primary hover:underline focus-visible:underline outline-none disabled:opacity-40";

export function Header({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6 border-b border-border px-10 py-7">
      <div>
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</div>}
        <h1 className="mt-1.5 font-display text-3xl font-semibold">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </label>
  );
}

export function Alert({
  tone,
  icon,
  title,
  action,
  children,
}: {
  tone: "danger" | "warning" | "info" | "success";
  icon: string;
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const styles = {
    danger: ["border-destructive/40 bg-destructive/10", "bg-destructive text-destructive-foreground"],
    warning: ["border-warning/50 bg-warning/10", "bg-warning text-warning-foreground"],
    info: ["border-primary/40 bg-primary/10", "bg-primary text-primary-foreground"],
    success: ["border-success/40 bg-success/10", "bg-success text-success-foreground"],
  }[tone];
  return (
    <div className={`flex items-center gap-4 rounded-2xl border px-6 py-4 ${styles[0]}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-bold ${styles[1]}`} aria-hidden>
        {icon}
      </span>
      <div className="flex-1 text-sm">
        <div className="font-semibold">{title}</div>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "danger";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`mt-2 font-display text-4xl font-semibold ${tone === "danger" && value ? "text-destructive" : ""}`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Certainty({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const [word, cls] =
    value >= 0.8
      ? ["Very sure", "text-success"]
      : value >= 0.6
        ? ["Fairly sure", "text-foreground"]
        : ["Unsure", "text-warning-ink"];
  return (
    <span className={`text-sm ${cls}`}>
      {word} <span className="text-xs text-muted-foreground">({pct}%)</span>
    </span>
  );
}

/** Status chips always pair an icon with text, never colour alone. */
export type ChipTone = "done" | "review" | "failed" | "skipped" | "working" | "waiting" | "info";
const CHIP: Record<ChipTone, [string, string]> = {
  done: ["✓", "border-success/40 bg-success/10 text-success"],
  review: ["⚠", "border-warning/50 bg-warning/10 text-warning-ink"],
  failed: ["✕", "border-destructive/40 bg-destructive/10 text-destructive"],
  skipped: ["–", "border-border bg-secondary text-muted-foreground"],
  working: ["↻", "border-primary/40 bg-primary/10 text-primary"],
  waiting: ["○", "border-border bg-card text-muted-foreground"],
  info: ["•", "border-border bg-secondary text-foreground"],
};
export function Chip({ tone, children, icon }: { tone: ChipTone; children: ReactNode; icon?: string }) {
  const [defIcon, cls] = CHIP[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      <span aria-hidden>{icon ?? defIcon}</span>
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: SpeciesStatus }) {
  const tone: ChipTone = status === "invasive" ? "failed" : status === "unusual" ? "review" : "done";
  const icon = status === "invasive" ? "!" : status === "unusual" ? "↑" : "✓";
  return (
    <Chip tone={tone} icon={icon}>
      {STATUS_LABEL[status]}
    </Chip>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid min-w-5 place-items-center rounded border border-border bg-secondary px-1 font-mono text-[11px] leading-5 text-muted-foreground">
      {children}
    </kbd>
  );
}

/** A dialog box. Esc or clicking outside closes it. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean | "xl" | "full"; // true: medium-wide; "xl": large (Species Registry); "full": nearly the whole window
}) {
  const box = useRef<HTMLDivElement>(null);
  const full = wide === "full";
  // When the dialog closes, put keyboard focus back on whatever opened it (for example a card).
  // This must run before the effect below moves focus into the dialog, so it remembers the opener.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  // Esc closes the dialog, but only the top one when a dialog opens on top of another
  // (for example "Are you sure?" over the species dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (e.key === "Escape" && dialogs[dialogs.length - 1] === box.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    box.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className={`fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 print:hidden ${full ? "backdrop-blur-sm" : ""}`}
      onMouseDown={onClose}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-full ${full ? "max-h-[94vh] max-w-[min(96vw,110rem)]" : `max-h-[85vh] ${wide === "xl" ? "max-w-4xl" : wide ? "max-w-2xl" : "max-w-md"}`} overflow-auto rounded-2xl border border-border bg-card p-6 shadow-2xl`}
      >
        <div className="mb-4 font-display text-lg font-semibold">{title}</div>
        {children}
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** An in-app "Are you sure?" box (friendlier than a system pop-up). */
export function useConfirm() {
  const [ask, setAsk] = useState<{ text: string; yes: string; run: () => void } | null>(null);
  const node = ask && (
    <Modal
      title="Are you sure?"
      onClose={() => setAsk(null)}
      footer={
        <>
          <button className={btnGhost} onClick={() => setAsk(null)}>
            Cancel
          </button>
          <button
            className={btnPrimary}
            onClick={() => {
              ask.run();
              setAsk(null);
            }}
          >
            {ask.yes}
          </button>
        </>
      }
    >
      <p>{ask.text}</p>
    </Modal>
  );
  return [node, (text: string, yes: string, run: () => void) => setAsk({ text, yes, run })] as const;
}

/** "Show more" toggle, so detail is one click away instead of always on screen. */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
  className = "",
}: {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
      >
        <span className={`inline-block transition ${open ? "rotate-90" : ""}`} aria-hidden>
          ▸
        </span>
        {label}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function formatBytes(n: number) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
}

/** Today on this computer as YYYY-MM-DD: the latest date anything can have been filmed. */
export function today() {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
export const FUTURE_DATE_MESSAGE = "Filmed date can't be in the future";

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
