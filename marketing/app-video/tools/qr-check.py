#!/usr/bin/env python3
"""Can a phone read the QR in these frames?  python3 tools/qr-check.py out/stills/*.png
Decodes every QR found (OpenCV), prints its text and width in pixels, and tries again on a
half-size, slightly blurred copy — roughly what a phone camera sees from a step back."""
import sys, cv2
det = cv2.QRCodeDetector()
bad = 0
for f in sys.argv[1:]:
    img = cv2.imread(f)
    if img is None: print(f, "unreadable file"); bad += 1; continue
    out = []
    for label, im in (("full", img), ("half+blur", cv2.GaussianBlur(cv2.resize(img, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA), (3, 3), 0))):
        try: ok, texts, pts, _ = det.detectAndDecodeMulti(im)
        except Exception: ok, texts, pts = False, [], None
        found = [(t, int(max(p[:, 0]) - min(p[:, 0]))) for t, p in zip(texts, pts)] if ok else []
        out.append(f"{label}: " + (", ".join(f"«{t}» {w}px" if t else f"(seen, not decoded) {w}px" for t, w in found) or "none"))
    print(f.split("/")[-1], "|", " | ".join(out))
sys.exit(0)
