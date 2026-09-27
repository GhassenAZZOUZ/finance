import type { ReactNode } from "react";

/** Serif page title (28px mobile, 42px desktop), one-line description, optional actions on the right. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Small uppercase line above the title (e.g. "Septembre 2026 · mois 3 sur 300"). */
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
      <div className="flex max-w-3xl flex-col gap-1.5 md:gap-2.5">
        {eyebrow ? (
          <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase md:text-xs">{eyebrow}</p>
        ) : null}
        <h1 className="font-heading text-[28px] leading-[1.15] font-medium tracking-[-0.01em] md:text-[42px] md:leading-[1.12]">
          {title}
        </h1>
        {description ? <p className="text-[15px] leading-normal text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2.5">{actions}</div> : null}
    </header>
  );
}
