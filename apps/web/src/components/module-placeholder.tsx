import type { LucideIcon } from "lucide-react";

export function ModulePlaceholder({
  icon: Icon,
  title,
  description,
  upcoming,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  upcoming: string[];
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-24 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted text-accent">
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted">{description}</p>

      <div className="mt-6 w-full rounded-2xl border border-border bg-surface p-5 text-left shadow-card">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          В этом модуле будет
        </p>
        <ul className="space-y-2">
          {upcoming.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-foreground">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-6 text-xs text-muted">Модуль в разработке — появится на следующем этапе</p>
    </div>
  );
}
