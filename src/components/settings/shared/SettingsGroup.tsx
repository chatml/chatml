interface SettingsGroupProps {
  label?: string;
  children: React.ReactNode;
}

export function SettingsGroup({ label, children }: SettingsGroupProps) {
  return (
    <div className="mt-6 first:mt-0">
      {label && (
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {label}
        </h3>
      )}
      {children}
    </div>
  );
}
