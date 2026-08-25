/**
 * PRISM primitives.
 *
 * Elevation is layered transparency plus a 1px structural border, never a
 * shadow bloom. Corners are 0px throughout. Buttons change state tonally and
 * never lift, scale or bounce on hover.
 */

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Bare removes the surface fill so the panel reads as a region, not a card. */
  bare?: boolean;
}

export function Panel({ children, className, bare, ...rest }: PanelProps) {
  return (
    <div
      className={cx(
        "border border-line",
        bare ? "bg-transparent" : "bg-surface",
        "flex flex-col min-h-0",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-center justify-between gap-3 border-b border-line px-4 h-11 shrink-0",
        className,
      )}
    >
      <span className="text-label-xs uppercase text-ink-3 truncate">{title}</span>
      {children ? (
        <span className="flex items-center gap-1.5 shrink-0">{children}</span>
      ) : null}
    </div>
  );
}

export function PanelBody({
  children,
  className,
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <div className={cx("min-h-0 flex-1", pad && "p-4", className)}>{children}</div>
  );
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type Variant = "primary" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  /** Trailing glyph. Slides on hover; the button itself never moves. */
  trailing?: ReactNode;
  leading?: ReactNode;
  block?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink font-semibold hover:bg-[#5ff6ff] active:bg-accent-dim disabled:bg-line-strong disabled:text-ink-4",
  ghost:
    "bg-transparent text-ink border border-line hover:border-line-strong hover:bg-surface-2 active:bg-surface-3 disabled:text-ink-4 disabled:hover:bg-transparent",
  quiet:
    "bg-transparent text-ink-3 hover:text-ink hover:bg-surface-2 active:bg-surface-3",
  danger:
    "bg-transparent text-down border border-[#4a1c1c] hover:bg-[#1c0d0d] hover:border-[#6a2626]",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px]",
  md: "h-9 px-3.5 text-[13px]",
  lg: "h-11 px-5 text-[13px]",
};

export function Button({
  variant = "ghost",
  size = "md",
  className,
  children,
  trailing,
  leading,
  block,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        "group relative inline-flex items-center justify-center gap-2 select-none",
        "uppercase tracking-[0.06em] whitespace-nowrap",
        "transition-colors duration-150 ease-out",
        "disabled:cursor-not-allowed",
        block && "w-full",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="truncate">{children}</span>
      {trailing ? (
        <span className="shrink-0 transition-transform duration-200 ease-out group-hover:translate-x-[3px]">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Chip                                                                */
/* ------------------------------------------------------------------ */

type Tone = "neutral" | "accent" | "up" | "down" | "warn";

const TONE: Record<Tone, string> = {
  neutral: "border-line text-ink-3",
  accent: "border-[#0b4d54] text-accent",
  up: "border-[#124c31] text-up",
  down: "border-[#4a1c1c] text-down",
  warn: "border-[#4d3b17] text-warn",
};

export function Chip({
  children,
  tone = "neutral",
  live,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 border px-1.5 h-[19px]",
        "text-label-xs uppercase leading-none whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {live ? (
        <span
          className={cx(
            "pip-live inline-block w-[5px] h-[5px] shrink-0",
            tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : "bg-accent",
          )}
        />
      ) : null}
      <span className="translate-y-[0.5px]">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Stat                                                                */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  sub,
  tone,
  align = "left",
  mono = true,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "up" | "down" | "accent";
  align?: "left" | "right";
  /** Off for word values: in the mono face a capital O reads as a zero. */
  mono?: boolean;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", align === "right" && "items-end")}>
      <span className="text-label-xs uppercase text-ink-3">{label}</span>
      <span
        className={cx(
          mono ? "num text-[17px] leading-[20px]" : "text-[17px] leading-[20px] font-medium",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "accent" && "text-accent",
          !tone && "text-ink",
        )}
      >
        {value}
      </span>
      {sub ? <span className="text-[12px] text-ink-3">{sub}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Key / value row                                                     */
/* ------------------------------------------------------------------ */

export function KV({
  k,
  v,
  tone,
  mono = true,
}: {
  k: ReactNode;
  v: ReactNode;
  tone?: "up" | "down" | "accent" | "muted";
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-line-soft last:border-b-0">
      <span className="text-[13px] text-ink-3">{k}</span>
      <span
        className={cx(
          mono && "num",
          "text-[13px] text-right",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "accent" && "text-accent",
          tone === "muted" && "text-ink-3",
          !tone && "text-ink",
        )}
      >
        {v}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                   */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  columns,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("grid gap-px bg-line border border-line")}
      style={{
        // minmax(max-content, 1fr) so a short label like "1H" still gets its
        // own padding instead of being squeezed against its neighbour.
        gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(max-content,1fr))`,
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-9 px-3.5 text-[12px] uppercase tracking-[0.05em] transition-colors duration-150",
              on
                ? "bg-[#04262a] text-accent"
                : "bg-surface text-ink-3 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table shell                                                         */
/* ------------------------------------------------------------------ */

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse min-w-[880px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cx(
        "text-label-xs uppercase text-ink-3 font-semibold",
        "px-3 h-9 border-b border-line whitespace-nowrap",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  mono,
  tone,
  className,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  mono?: boolean;
  tone?: "up" | "down" | "accent" | "muted";
  className?: string;
}) {
  return (
    <td
      className={cx(
        "px-3 h-10 text-[13px] whitespace-nowrap border-b border-line-soft",
        mono && "num",
        align === "right" && "text-right",
        align === "center" && "text-center",
        tone === "up" && "text-up",
        tone === "down" && "text-down",
        tone === "accent" && "text-accent",
        tone === "muted" && "text-ink-3",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cx("transition-colors duration-100 hover:bg-surface-2", className)}
      {...rest}
    >
      {children}
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Page header                                                         */
/* ------------------------------------------------------------------ */

export function PageHead({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-5 mb-5 border-b border-line">
      <div className="min-w-0">
        <h1 className="text-headline-md text-ink">{title}</h1>
        {lede ? <p className="text-[13px] text-ink-3 mt-1.5 max-w-[62ch]">{lede}</p> : null}
      </div>
      {children ? <div className="flex items-center gap-2 shrink-0">{children}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Demo data banner                                                    */
/* ------------------------------------------------------------------ */

/**
 * Marks a screen whose numbers are fixtures rather than venue state.
 *
 * PRISM reads real markets off Somnia Shannon, but positions, settlement,
 * roll history and the agent transcript are not yet wired to the chain. Those
 * screens keep their fixtures so the product is legible — but they say so,
 * plainly, at the top. A reader must never mistake a fixture for chain state.
 */
export function DemoData({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 border border-[#4d3b17] bg-[#1a1408] p-3 mb-5">
      <span
        aria-hidden
        className="shrink-0 mt-[3px] w-[6px] h-[6px] bg-warn"
      />
      <p className="text-[12px] leading-[17px] text-ink-2 min-w-0">
        <span className="uppercase tracking-[0.06em] font-semibold text-warn">
          Sample data
        </span>{" "}
        — {children}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Note                                                                */
/* ------------------------------------------------------------------ */

export function Note({
  icon,
  children,
  tone = "neutral",
}: {
  icon?: ReactNode;
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn";
}) {
  return (
    <div
      className={cx(
        "flex items-start gap-2.5 border p-3 text-[12px] leading-[17px]",
        tone === "accent" && "border-[#0b4d54] bg-[#04191c] text-ink-2",
        tone === "warn" && "border-[#4d3b17] bg-[#1a1408] text-ink-2",
        tone === "neutral" && "border-line bg-surface-2 text-ink-3",
      )}
    >
      {icon ? (
        <span
          className={cx(
            "shrink-0 mt-px",
            tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : "text-ink-4",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">{children}</span>
    </div>
  );
}
