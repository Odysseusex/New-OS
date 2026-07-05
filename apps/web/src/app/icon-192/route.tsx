import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#b6702f",
          color: "#ffffff",
          fontSize: 100,
          fontWeight: 600,
          fontFamily: "sans-serif",
        }}
      >
        Б
      </div>
    ),
    { width: 192, height: 192 },
  );
}
