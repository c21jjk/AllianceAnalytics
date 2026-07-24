import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes Alliance Social installable to the iOS/Android home
 * screen ("Add to Home Screen" in Safari share sheet). `display: standalone`
 * launches full-screen without browser chrome, which is also the
 * prerequisite for Web Push on iOS (16.4+ only delivers push to installed
 * PWAs). Served automatically by Next at /manifest.webmanifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alliance Social — Century 21 Alliance",
    short_name: "Alliance Social",
    description:
      "Create, publish, and track Century 21 Alliance social posts on the go.",
    start_url: "/",
    display: "standalone",
    background_color: "#121212",
    theme_color: "#FCFCFB",
    orientation: "portrait",
    icons: [
      {
        src: "/brand/app-icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/app-icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/brand/app-icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
