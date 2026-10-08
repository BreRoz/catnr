import { TABS } from "./types";

export default function MainNav({ tab, onChange }: { tab: string; onChange: (tab: string) => void }) {
  return (
    <nav aria-label="Main">
      {TABS.map(([id, icon, label]) => (
        <button
          type="button"
          key={id}
          className={tab === id ? "active" : ""}
          aria-current={tab === id ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          <span aria-hidden="true">{icon}</span>
          {label}
        </button>
      ))}
    </nav>
  );
}
