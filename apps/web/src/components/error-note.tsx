export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-4 border-l-4 border-magenta pl-3 text-sm">
      {children}
    </p>
  );
}
