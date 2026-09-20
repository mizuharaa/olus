import type { MetadataRoute } from "next"
export default function manifest(): MetadataRoute.Manifest {
  return { name: "Olus", short_name: "Olus", description: "Airline disruption recovery simulation", start_url: "/", display: "standalone", background_color: "#05070A", theme_color: "#05070A", icons: [{ src: "/brand/olus-512.png", sizes: "512x512", type: "image/png" }] }
}
