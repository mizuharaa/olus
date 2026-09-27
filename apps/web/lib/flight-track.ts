import type { LiveFlight } from "@/stores/simulation"
type Fix = Pick<LiveFlight,"lat"|"lon"|"last_contact"|"heading"|"velocity_kt">
export type FlightTrack = Fix & {trail:number[][]; fixes:Fix[]}
export function observeFlight(previous:FlightTrack|undefined, fix:Fix):FlightTrack {
  if(previous && fix.last_contact<=previous.last_contact) return previous
  return {...fix,trail:[...(previous?.trail||[]),[fix.lon,fix.lat]].slice(-120),fixes:[...(previous?.fixes||[]),fix].slice(-120)}
}
export function trackPosition(track:FlightTrack, now:number, reduced:boolean):[number,number] {
  if(reduced) return [track.lat,track.lon]
  // Buffer 30 seconds of observations: never extrapolate and then snap back.
  const time=now-30, fixes=track.fixes
  for(let i=1;i<fixes.length;i++) {
    const a=fixes[i-1],b=fixes[i]
    if(time<=b.last_contact) {
      const t=Math.max(0,Math.min(1,(time-a.last_contact)/(b.last_contact-a.last_contact)))
      const delta=((b.lon-a.lon+540)%360)-180
      return [a.lat+(b.lat-a.lat)*t,((a.lon+delta*t+540)%360)-180]
    }
  }
  return [track.lat,track.lon]
}

/** History ends at the same buffered sample as the marker, never at a future fix. */
export function observedTrail(track:FlightTrack, now:number, reduced:boolean):[number,number][] {
  const cutoff=reduced?now:now-30
  const points=track.fixes.filter(f=>f.last_contact<cutoff).map(f=>[f.lat,f.lon] as [number,number])
  points.push(trackPosition(track,now,reduced))
  // Keep an antimeridian crossing local instead of drawing across the world.
  for(let i=points.length-2;i>=0;i--)points[i][1]=points[i+1][1]+((points[i][1]-points[i+1][1]+540)%360)-180
  return points
}
