type Icon = "group" | "cash" | "bell" | "arrow" | "plus" | "person" | "exit";

const paths: Record<Icon, string> = {
  group: "M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 8v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 5a3 3 0 0 1 0 6m2 2a4 4 0 0 1 3 4v2",
  cash: "M3 7h18v10H3zM3 10a3 3 0 0 0 3-3m12 0a3 3 0 0 0 3 3M3 14a3 3 0 0 1 3 3m12 0a3 3 0 0 1 3-3m-7-2a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  bell: "M5 16h14l-2-3V9a5 5 0 1 0-10 0v4zm5 3a2 2 0 0 0 4 0",
  arrow: "M6 12h12m-5-5 5 5-5 5",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1",
  exit: "M10 5H5v14h5m3-3 4-4-4-4m-5 4h9",
  plus: "M12 5v14M5 12h14",
};

export default function DashboardIcon({ name, className = "size-5" }: { name: Icon; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}
