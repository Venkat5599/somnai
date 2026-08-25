import { TerminalShell } from "@/components/shell";

export default function TerminalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TerminalShell>{children}</TerminalShell>;
}
