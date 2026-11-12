// The QR for https://ar-amir.com/app as crisp SVG modules (level H, so the logo may sit in the middle).
//   node tools/make-qr.js
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const qr = QRCode.create("https://ar-amir.com/app", { errorCorrectionLevel: "H" });
const n = qr.modules.size;
const data = qr.modules.data;
let d = "";
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (data[y * n + x]) d += `M${x} ${y}h1v1h-1z`;
const svg = (withLogo) => {
  // Logo plate: 7 of 29 modules wide ≈ 5.8 % of the area, well inside level H's reserve.
  const k = 7, o = (n - k) / 2;
  const logo = withLogo
    ? `<rect x="${o - 0.5}" y="${o - 0.5}" width="${k + 1}" height="${k + 1}" fill="#fff"/><image href="icon-192.png" x="${o}" y="${o}" width="${k}" height="${k}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#1f1712"/>${logo}</svg>\n`;
};
fs.writeFileSync(path.join(__dirname, "..", "assets", "qr-app.svg"), svg(true));
fs.writeFileSync(path.join(__dirname, "..", "assets", "qr-app-plain.svg"), svg(false));
console.log("QR modules:", n);
