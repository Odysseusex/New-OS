export interface GeoPoint {
  lat: number;
  lng: number;
}

// Projects real lat/lng onto a percentage-based canvas (0-100), suitable for
// absolutely-positioned markers over a stylized (non-tile) map background.
export function projectToPercent<T extends GeoPoint>(points: T[], paddingPct = 12) {
  if (points.length === 0) return [];

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 0.01;
  const lngSpan = maxLng - minLng || 0.01;
  const usable = 100 - paddingPct * 2;

  return points.map((p) => ({
    ...p,
    xPct: paddingPct + ((p.lng - minLng) / lngSpan) * usable,
    yPct: paddingPct + ((maxLat - p.lat) / latSpan) * usable,
  }));
}
