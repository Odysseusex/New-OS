import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ArAmir OS — Платформа управления пекарней",
    short_name: "ArAmir OS",
    description: "Единая платформа управления пекарней Ar-Amir",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f5f2",
    theme_color: "#b6702f",
    icons: [
      { src: "/logo.png", sizes: "512x512", type: "image/png" },
      { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
