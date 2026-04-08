/**
 * Kolkata road name alias map.
 * Maps every known colloquial / abbreviated / alternate spelling
 * to a single canonical normalised form used for geocoding and deduplication.
 *
 * Format: alias (lowercase, trimmed) → canonical name
 */
export const roadAliases: Record<string, string> = {
  // EM Bypass / Eastern Metropolitan Bypass
  "em bypass": "EM Bypass",
  "e.m. bypass": "EM Bypass",
  "e.m bypass": "EM Bypass",
  "eastern metropolitan bypass": "EM Bypass",
  "eastern metro bypass": "EM Bypass",
  "bypass": "EM Bypass",           // contextual — scorer will weigh road match lower

  // VIP Road / Jessore Road outer section
  "vip road": "VIP Road",
  "v.i.p road": "VIP Road",
  "vip rd": "VIP Road",
  "viproad": "VIP Road",
  "jessore road": "Jessore Road",
  "jessore rd": "Jessore Road",
  "nsc bose road": "Netaji Subhas Chandra Bose Road",
  "nscb road": "Netaji Subhas Chandra Bose Road",

  // Rashbehari / Rashbehary
  "rashbehari": "Rashbehari Avenue",
  "rashbehary": "Rashbehari Avenue",
  "rash behari": "Rashbehari Avenue",
  "rash behari avenue": "Rashbehari Avenue",
  "rashbehari avenue": "Rashbehari Avenue",
  "rashbehari connector": "Rashbehari Connector",

  // Gariahat
  "gariahat": "Gariahat Road",
  "gariahat road": "Gariahat Road",
  "gariahat crossing": "Gariahat Crossing",
  "gariahata": "Gariahat Road",

  // Park Street / Mother Teresa Sarani
  "park street": "Park Street",
  "mother teresa sarani": "Park Street",
  "mother teresa sarani (park street)": "Park Street",
  "park circus": "Park Circus",
  "park circus connector": "Park Circus Connector",

  // Prince Anwar Shah Road
  "prince anwar shah road": "Prince Anwar Shah Road",
  "pas road": "Prince Anwar Shah Road",
  "anwar shah road": "Prince Anwar Shah Road",
  "anwar shah connector": "Prince Anwar Shah Connector",

  // Ballygunge
  "ballygunge": "Ballygunge",
  "ballygunge circular road": "Ballygunge Circular Road",
  "bcr": "Ballygunge Circular Road",
  "ballygunge phari": "Ballygunge Phari",

  // Deshapriya Park / Lake area
  "deshapriya park": "Deshapriya Park",
  "lake road": "Lake Road",
  "lake market": "Lake Market",
  "golpark": "Golpark",
  "gol park": "Golpark",

  // Jadavpur / Tollygunge
  "jadavpur": "Jadavpur",
  "jadavpur crossing": "Jadavpur Crossing",
  "tollygunge": "Tollygunge",
  "tolly": "Tollygunge",
  "tala park": "Tala Park",

  // Ultadanga / BT Road
  "ultadanga": "Ultadanga",
  "bt road": "BT Road",
  "b.t. road": "BT Road",
  "barrackpore trunk road": "BT Road",

  // Beliaghata / EW Corridor
  "beliaghata": "Beliaghata",
  "beliaghata main road": "Beliaghata Main Road",
  "ew corridor": "EW Corridor",
  "east west corridor": "EW Corridor",

  // Karunamoyee / Salt Lake
  "karunamoyee": "Karunamoyee",
  "salt lake": "Salt Lake",
  "bidhannagar": "Bidhannagar",
  "sector v": "Sector V",
  "sector 5": "Sector V",
  "tech city": "Sector V",

  // Rajarhat / New Town
  "rajarhat": "Rajarhat",
  "new town": "New Town",
  "newtown": "New Town",
  "eco park": "Eco Park",
  "action area": "Action Area",
  "action area 1": "Action Area 1",
  "action area 2": "Action Area 2",
  "aa1": "Action Area 1",
  "aa2": "Action Area 2",

  // Dunlop / Shyamnagar
  "dunlop": "Dunlop",
  "shyamnagar": "Shyamnagar",
  "shyam nagar": "Shyamnagar",

  // Howrah Bridge / Vidyasagar Setu
  "howrah bridge": "Howrah Bridge",
  "rabindra setu": "Howrah Bridge",
  "vidyasagar setu": "Vidyasagar Setu",
  "second hooghly bridge": "Vidyasagar Setu",
  "second bridge": "Vidyasagar Setu",

  // Strand Road / Circular Road
  "strand road": "Strand Road",
  "circular road": "Circular Road",
  "apc road": "APC Road",
  "a.p.c. road": "APC Road",
  "atul bose avenue": "Atul Bose Avenue",

  // Central Kolkata
  "esplanade": "Esplanade",
  "dharmatala": "Dharmatala",
  "dharamtala": "Dharmatala",
  "chowringhee": "Chowringhee Road",
  "chowringhee road": "Chowringhee Road",
  "ja nehru road": "Jawaharlal Nehru Road",
  "jl nehru road": "Jawaharlal Nehru Road",
  "jnr": "Jawaharlal Nehru Road",
  "maidan": "Maidan",
  "red road": "Red Road",

  // College Street / North Kolkata
  "college street": "College Street",
  "shyambazar": "Shyambazar",
  "shyam bazar": "Shyambazar",
  "shovabazar": "Shyambazar",
  "shobhabazar": "Shyambazar",
  "hatibagan": "Hatibagan",
  "hati bagan": "Hatibagan",
  "maniktala": "Maniktala",
  "manikatala": "Maniktala",
  "belgachia": "Belgachia",
  "belgachhia": "Belgachia",

  // Kasba / Santoshpur
  "kasba": "Kasba",
  "santoshpur": "Santoshpur",
  "mukundapur": "Mukundapur",
  "garia": "Garia",

  // Phool Bagan / Sealdah
  "phoolbagan": "Phool Bagan",
  "phool bagan": "Phool Bagan",
  "sealdah": "Sealdah",
  "sealda": "Sealdah",

  // Airport / Dum Dum
  "airport": "Netaji Subhas Chandra Bose International Airport",
  "nscbi airport": "Netaji Subhas Chandra Bose International Airport",
  "kolkata airport": "Netaji Subhas Chandra Bose International Airport",
  "dum dum": "Dum Dum",
  "dumdum": "Dum Dum",
  "airport gate 1": "Airport Gate 1",

  // Kona Expressway / NH-16
  "kona expressway": "Kona Expressway",
  "kona": "Kona Expressway",
  "nh 16": "NH-16",
  "nh-16": "NH-16",
  "national highway 16": "NH-16",
  "nh 6": "NH-6",
  "nh-6": "NH-6",
  "diamond harbour road": "Diamond Harbour Road",
  "dh road": "Diamond Harbour Road",

  // Taratala / Garden Reach
  "taratala": "Taratala Road",
  "taratala road": "Taratala Road",
  "garden reach": "Garden Reach",

  // Topsia / Tangra
  "topsia": "Topsia Road",
  "tangra": "Tangra",
  "chinatown": "Tangra",

  // Additional South Kolkata
  "behala": "Behala",
  "parnasree": "Parnasree",
  "james long sarani": "James Long Sarani",
  "james long": "James Long Sarani",

  // Additional connectors & flyovers
  "parama island": "Parama Island",
  "parama flyover": "Parama Flyover",
  "maa flyover": "MAA Flyover",
  "ma flyover": "MAA Flyover",
  "tallah bridge": "Tallah Bridge",
  "tala bridge": "Tallah Bridge",
  "ultadanga flyover": "Ultadanga Flyover",
  "beleghata flyover": "Beliaghata Flyover",
};

/**
 * Sorted alias list (longest first) for greedy matching in classifier.
 * Ensures "em bypass" matches before a shorter "bypass" overlap.
 */
export const sortedAliases: string[] = Object.keys(roadAliases).sort(
  (a, b) => b.length - a.length
);

/**
 * Look up a road name mention in article text.
 * Returns the canonical form or null.
 */
export function resolveRoadAlias(text: string): {
  alias: string;
  canonical: string;
} | null {
  const lower = text.toLowerCase();
  for (const alias of sortedAliases) {
    if (lower.includes(alias)) {
      return { alias, canonical: roadAliases[alias] };
    }
  }
  return null;
}
