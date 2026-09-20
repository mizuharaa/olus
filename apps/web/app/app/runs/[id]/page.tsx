import { RunMonitor } from "@/components/workspace/run-monitor"
export default async function RunPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <RunMonitor id={id}/>}
