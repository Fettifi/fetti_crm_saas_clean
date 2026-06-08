// Address verification + standardization. Uses the free US Census Geocoder
// (no API key, no billing) to confirm a real, standardized US address, with an
// OpenStreetMap (Nominatim) fallback for anything it can't match. Returns a
// Google Maps link so addresses can be viewed on a map ("Google Earth"-style).

export type AddressResult = {
  verified: boolean;
  source?: "census" | "osm";
  standardized?: string;
  lat?: number;
  lng?: number;
  city?: string;
  state?: string;
  zip?: string;
  mapsUrl: string;
  query: string;
};

export const mapsUrl = (addr: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;

export async function verifyAddress(input: string): Promise<AddressResult> {
  const query = String(input || "").trim();
  const base: AddressResult = { verified: false, query, mapsUrl: mapsUrl(query) };
  if (query.length < 5) return base;

  // 1) US Census Geocoder — free, authoritative for US addresses.
  try {
    const u = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`;
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = await r.json();
      const m = j?.result?.addressMatches?.[0];
      if (m) {
        const c = m.addressComponents || {};
        return {
          verified: true, source: "census",
          standardized: m.matchedAddress,
          lat: m.coordinates?.y, lng: m.coordinates?.x,
          city: c.city, state: c.state, zip: c.zip,
          mapsUrl: mapsUrl(m.matchedAddress), query,
        };
      }
    }
  } catch { /* fall through */ }

  // 2) OpenStreetMap Nominatim — global fallback.
  try {
    const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=1`;
    const r = await fetch(u, { headers: { "User-Agent": "FettiCRM/1.0 (https://app.fettifi.com)" }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = await r.json();
      const a = Array.isArray(j) ? j[0] : null;
      if (a) {
        const ad = a.address || {};
        return {
          verified: true, source: "osm",
          standardized: a.display_name,
          lat: Number(a.lat), lng: Number(a.lon),
          city: ad.city || ad.town || ad.village, state: ad.state, zip: ad.postcode,
          mapsUrl: mapsUrl(a.display_name), query,
        };
      }
    }
  } catch { /* fall through */ }

  return base;
}
