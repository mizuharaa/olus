"use client"
import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import styles from "./workspace.module.css"
export default function AircraftPreview() {
  const host=useRef<HTMLDivElement>(null), pause=useRef(false)
  const [paused,setPaused]=useState(false), [error,setError]=useState(false)
  useEffect(()=>{
    const node=host.current!, scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(35,1,.1,100)
    let renderer: THREE.WebGLRenderer
    try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"low-power"}) } catch {setError(true);return}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));node.prepend(renderer.domElement)
    camera.position.set(4,2.4,4)
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableZoom=false;controls.enablePan=false;controls.enableDamping=true;controls.autoRotateSpeed=.5
    const reduced=matchMedia("(prefers-reduced-motion: reduce)");pause.current=reduced.matches;setPaused(reduced.matches)
    const tokens=getComputedStyle(node), white=tokens.getPropertyValue("--text-hi").trim(), ink=tokens.getPropertyValue("--ink-500").trim()
    scene.add(new THREE.HemisphereLight(white,ink,2.5))
    const light=new THREE.DirectionalLight(white,4);light.position.set(3,5,2);scene.add(light)
    let disposed=false, contextAvailable=true, dirty=true, lastFrame=0
    const invalidate=()=>{dirty=true};controls.addEventListener("change",invalidate)
    const dispose=(object:THREE.Object3D)=>object.traverse(child=>{if(child instanceof THREE.Mesh){child.geometry.dispose();const materials=Array.isArray(child.material)?child.material:[child.material];materials.forEach(m=>{m.map?.dispose();m.dispose()})}})
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load("/models/olus-airliner.glb",gltf=>{
      if(disposed){dispose(gltf.scene);return}
      dirty=true
      const model=gltf.scene, box=new THREE.Box3().setFromObject(model), size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3())
      model.position.sub(center);const group=new THREE.Group();group.add(model);group.scale.setScalar(4.6/Math.max(size.x,size.y,size.z));scene.add(group)
      model.traverse(child=>{if(child instanceof THREE.Mesh){const mats=Array.isArray(child.material)?child.material:[child.material];mats.forEach(m=>{m.map?.dispose();m.dispose()});child.material=new THREE.MeshStandardMaterial({color:white,metalness:.18,roughness:.42})}})
    },undefined,()=>{if(!disposed){contextAvailable=false;renderer.setAnimationLoop(null);setError(true)}})
    const resize=new ResizeObserver(()=>{if(!node.clientWidth||!node.clientHeight)return;dirty=true;camera.aspect=node.clientWidth/node.clientHeight;camera.updateProjectionMatrix();renderer.setSize(node.clientWidth,node.clientHeight) });resize.observe(node)
    const render=(time:number)=>{if(time-lastFrame<1000/30)return;lastFrame=time;controls.autoRotate=!pause.current&&!reduced.matches;controls.update();if(dirty||controls.autoRotate){renderer.render(scene,camera);dirty=false}}
    const visibility=()=>{dirty=true;renderer.setAnimationLoop(document.hidden||!contextAvailable?null:render)}
    const contextLost=(event:Event)=>{event.preventDefault();contextAvailable=false;renderer.setAnimationLoop(null);if(!disposed)setError(true)}
    const motion=()=>{if(reduced.matches){pause.current=true;setPaused(true)}dirty=true}
    document.addEventListener("visibilitychange",visibility);reduced.addEventListener("change",motion);renderer.domElement.addEventListener("webglcontextlost",contextLost);visibility()
    return()=>{disposed=true;document.removeEventListener("visibilitychange",visibility);reduced.removeEventListener("change",motion);renderer.domElement.removeEventListener("webglcontextlost",contextLost);resize.disconnect();renderer.setAnimationLoop(null);controls.removeEventListener("change",invalidate);controls.dispose();dispose(scene);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove()}
  },[])
  return <div ref={host} className={styles.airframe} role="group" aria-label="Interactive Olus airliner model, not the selected aircraft type">{error?<p>Aircraft preview unavailable.</p>:<button onClick={()=>{pause.current=!pause.current;setPaused(pause.current)}}>{paused?"Rotate":"Pause rotation"}</button>}</div>
}
