// Reverse geocoding using OpenStreetMap Nominatim (free, no API key).
// Returns human-readable address parts. Fails gracefully.
export type ReverseGeocodeResult = {
  place_name?: string;
  area?: string;
  city?: string;
  district?: string;
  state?: string;
  country?: string;
  address?: string;
};

export async function reverseGeocode(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) return {};
    const j: any = await res.json();
    const a = j.address ?? {};
    const place_name: string | undefined =
      a.building ||
      a.amenity ||
      a.shop ||
      a.office ||
      a.tourism ||
      a.leisure ||
      a.industrial ||
      undefined;
    const area: string | undefined =
      a.neighbourhood ||
      a.suburb ||
      a.village ||
      a.hamlet ||
      a.residential ||
      a.quarter ||
      a.road ||
      undefined;
    const city: string | undefined =
      a.city || a.town || a.municipality || a.village || undefined;
    const district: string | undefined =
      a.county || a.state_district || a.district || undefined;
    const state: string | undefined = a.state || a.region || undefined;
    const country: string | undefined = a.country || undefined;
    const address: string | undefined = j.display_name || undefined;
    return { place_name, area, city, district, state, country, address };
  } catch {
    return {};
  }
}

export function formatAddress(loc: {
  place_name?: string | null;
  area?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  country?: string | null;
  address?: string | null;
}): string {
  const parts = [
    loc.place_name,
    loc.area,
    loc.city,
    loc.district,
    loc.state,
    loc.country,
  ].filter(Boolean) as string[];
  if (parts.length) return Array.from(new Set(parts)).join(", ");
  return loc.address ?? "";
}
