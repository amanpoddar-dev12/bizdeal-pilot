// Reverse geocoding. Prefers Google Maps if VITE_GOOGLE_MAPS_API_KEY is set
// (best coverage in India), otherwise falls back to OpenStreetMap Nominatim.
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

const GOOGLE_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as
  | string
  | undefined;

export async function reverseGeocode(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult> {
  if (GOOGLE_KEY) {
    const g = await googleReverse(latitude, longitude, signal);
    if (g) return g;
  }
  return nominatimReverse(latitude, longitude, signal);
}

async function googleReverse(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${GOOGLE_KEY}&result_type=street_address|premise|subpremise|neighborhood|sublocality|route|point_of_interest`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const j: any = await res.json();
    if (j.status !== "OK" || !Array.isArray(j.results) || !j.results.length) return null;

    // Best specific result first (Google orders most-specific → least).
    const best = j.results[0];
    const pick = (type: string) => {
      for (const r of j.results) {
        for (const c of r.address_components ?? []) {
          if ((c.types ?? []).includes(type)) return c.long_name as string;
        }
      }
      return undefined;
    };
    const road = pick("route");
    const house = pick("street_number");
    const neighborhood =
      pick("neighborhood") ||
      pick("sublocality_level_2") ||
      pick("sublocality_level_1") ||
      pick("sublocality");
    const poi =
      (best.types ?? []).includes("point_of_interest") ||
      (best.types ?? []).includes("premise") ||
      (best.types ?? []).includes("establishment")
        ? best.formatted_address?.split(",")[0]
        : undefined;

    const place_name = poi || [house, road].filter(Boolean).join(" ") || undefined;
    const area = neighborhood;
    const city =
      pick("locality") ||
      pick("postal_town") ||
      pick("administrative_area_level_3");
    const district = pick("administrative_area_level_2");
    const state = pick("administrative_area_level_1");
    const country = pick("country");
    return {
      place_name,
      area,
      city,
      district,
      state,
      country,
      address: best.formatted_address,
    };
  } catch {
    return null;
  }
}

async function nominatimReverse(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1&namedetails=1&extratags=1`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) return {};
    const j: any = await res.json();
    const a = j.address ?? {};

    // Business/building name.
    const place_name: string | undefined =
      j.namedetails?.name ||
      a.building ||
      a.amenity ||
      a.shop ||
      a.office ||
      a.tourism ||
      a.leisure ||
      a.industrial ||
      undefined;

    // Street/locality — combine house + road + neighbourhood so we never
    // collapse to just the city.
    const streetParts = [a.house_number, a.road].filter(Boolean);
    const street = streetParts.length ? streetParts.join(" ") : undefined;
    const locality =
      a.neighbourhood ||
      a.suburb ||
      a.quarter ||
      a.residential ||
      a.hamlet ||
      a.village ||
      undefined;

    // Keep both street and locality when present.
    const area = [street, locality].filter(Boolean).join(", ") || undefined;

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
