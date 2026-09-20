"use client"
/**
 * Single GSAP entry for the landing — plugins registered once, everything
 * imports from here so ScrollTrigger/SplitText never double-register.
 */
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { SplitText } from "gsap/SplitText"
import { Flip } from "gsap/Flip"
import { MotionPathPlugin } from "gsap/MotionPathPlugin"

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, SplitText, Flip, MotionPathPlugin)
}

export { gsap, ScrollTrigger, SplitText, Flip }
