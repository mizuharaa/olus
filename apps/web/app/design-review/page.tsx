"use client"
import {useEffect,useRef,useState} from "react"
import {Tabs,TabsList,TabsTrigger,TabsContent} from "@/components/ui/tabs"
import {Button} from "@/components/ui/button"
import s from "./review.module.css"

const directions=[
 {id:"docked",name:"01 / Docked console",description:"Edge-aligned panels, plain list rows and restrained tabs. The map fills the workspace behind collapsible tools."},
 {id:"floating",name:"02 / Floating tools",description:"Selected direction. Separate, lightly rounded panels over the full map. Neutral selection states and a consistent 48px event list."},
 {id:"daylight",name:"03 / Daylight console",description:"White inspection panels for bright operations rooms. Dark text, quiet hairlines and the same full-screen map."},
] as const
const common=`
[aria-label="Cookie preferences"]{display:none!important}
[data-olus-console] .ae-event-new{color:var(--foreground)!important}
[data-olus-console] :is(aside,section){box-shadow:none}
[data-olus-console] aside{border-radius:8px;padding:20px;overflow:hidden}
[data-olus-console] [aria-label="Disruption controls"]{display:flex;flex-direction:column}
[data-olus-console] [aria-label="Disruption controls"]>div{min-height:0}
[data-olus-console] [cmdk-item]{min-height:48px!important;padding:12px!important;border-radius:0!important;box-shadow:none!important;font-size:14px!important}
[data-olus-console] [cmdk-item][data-selected=true]{background:var(--ae-surface-3)!important;outline:none!important}
[data-olus-console] [role=tab]{border-radius:0!important;box-shadow:none!important;font:500 14px Inter,sans-serif!important;text-transform:none!important;letter-spacing:normal!important}
[data-olus-console] button{transition:background 160ms ease,color 160ms ease;box-shadow:none}
[data-olus-console] button:focus-visible{outline:2px solid var(--recover);outline-offset:2px}
[data-olus-console] [aria-label="Flight inspector"]>section{min-height:0!important}
@media(prefers-reduced-motion:reduce){[data-olus-console] *{transition:none!important}}
`
const docked=`@media(min-width:1101px){[data-olus-console] [aria-label="Disruption controls"]{left:0;top:96px;bottom:76px;width:340px;border-radius:0;border-left:0}[data-olus-console] [aria-label="Flight inspector"]{right:0;top:96px;bottom:76px;width:380px;border-radius:0;border-right:0}[data-olus-console] [aria-label="Operations controls"]{top:0;left:0;right:160px;border-radius:0;border-top:0;box-shadow:none;min-height:76px}}`
const daylight=`[data-theme]>header{--foreground:#F4F2ED;--secondary:#9AA5B1;color:#F4F2ED!important}[data-theme]>header :is(a,button,summary){color:#F4F2ED!important}[data-theme]{--surface:#fff!important;--field:#F7F5F1!important;--foreground:#0A0E14!important;--secondary:#475569!important;--line:#D8D2C8!important;color-scheme:light!important}[data-olus-console]{--ae-surface-3:#ECE8E1;--ae-raised:#ECE8E1;--ae-teal-bg:#ECE8E1;--ae-amber-bg:#ECE8E1}[data-olus-console] [cmdk-item][data-selected-kind=true],[data-olus-console] button:hover{background:#ECE8E1!important;color:#0A0E14!important}`
export default function DesignReview(){
 const [choice,setChoice]=useState("floating"),[message,setMessage]=useState("")
 const frame=useRef<HTMLIFrameElement>(null)
 const apply=()=>{const doc=frame.current?.contentDocument;if(!doc)return;let style=doc.getElementById("olus-review-style");if(!style){style=doc.createElement("style");style.id="olus-review-style";doc.head.append(style)}style.textContent=common+(choice==="floating"?"":docked)+(choice==="daylight"?daylight:"")}
 useEffect(apply,[choice])
 const select=async()=>{const prompt=`$impeccable refine /app/overview using the ${directions.find(d=>d.id===choice)?.name} direction from /design-review. Apply it consistently to event controls, the flight inspector, recovery plans A/B/C/D, timeline and layers. Keep the fullscreen map, 3D aircraft and all existing operations. Remove decorative colored edges; retain semantic map colors and keyboard focus. Verify every control, narrow screens and reduced motion.`;try{await navigator.clipboard.writeText(prompt);setMessage("Selection copied. Paste it into the agent chat to apply this direction.")}catch{setMessage(prompt)}}
 return <main className={s.review}>
  <header><div><h1>Olus / Dashboard review</h1><p>Preview the real dashboard. Open Events, select an aircraft, and compare the treatments.</p></div><a href="/app/overview">Open dashboard &gt;</a></header>
  <Tabs value={choice} onValueChange={value=>{setChoice(value);setMessage("")}} className={s.tabs}>
   <div className={s.controls}><TabsList className={s.choices} aria-label="Design direction">{directions.map(d=><TabsTrigger value={d.id} key={d.id}>{d.name}</TabsTrigger>)}</TabsList><Button className={s.choose} onClick={select}>Choose this design - copy prompt</Button></div>
   <p className={s.description}>{directions.find(d=>d.id===choice)?.description}</p>
   <TabsContent value={choice} className={s.preview}><iframe ref={frame} src="/app/overview" title="Interactive dashboard design preview" onLoad={apply}/></TabsContent>
  </Tabs>
  <p role="status" className={s.status}>{message||"Preview only. Controls operate your local simulation; switching designs does not change simulation data."}</p>
  <details className={s.references}><summary>Reference screens and implementation command</summary><p>Mobbin references: <a href="https://mobbin.com/screens/a60c42b8-9aea-4d69-82eb-0b381b3fc9c4" target="_blank" rel="noreferrer">KAYAK flight list + map</a> ? <a href="https://mobbin.com/screens/95628ff8-7999-4c30-9820-5924b8fd9c59" target="_blank" rel="noreferrer">Asana list + detail drawer</a>. Layout studies, not measured animation timings or performance rankings.</p><p>For interactive element selection and alternatives, enter this in the agent chat:</p><code>$impeccable live apps/web/app/app/overview/page.tsx</code><p>Design choices use the existing shadcn Tabs and Button components. No new UI dependencies.</p></details>
 </main>
}
