import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bakery OS — Платформа управления пекарней",
    short_name: "Bakery OS",
    description: "Единая платформа управления сетью пекарен",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f5f2",
    theme_color: "#b6702f",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png" },
      { src: "/icon-512", sizes: "512x512", type: "image/png" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
