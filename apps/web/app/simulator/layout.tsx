import type { ReactNode } from "react"
import { WorkspaceShell } from "@/components/workspace/workspace-shell"
export default function SimulatorLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell><div className="simulator-shell" style={{height:"100%",overflow:"auto"}}>{children}</div></WorkspaceShell>
}
