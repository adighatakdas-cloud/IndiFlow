export interface PatternKey {
  roadNormalised: string;
  hour: number;
  dayOfWeek: number;
}

export interface PatternResult {
  roadNormalised: string;
  hour: number;
  dayOfWeek: number;
  incidentProbability: number;
  avgSeverity: number;
  sampleCount: number;
}

export interface NearbyIncident {
  roadName: string;
  type: string;
  severity: number;
  distanceKm: number;
  headline: string;
  reportedAt: Date;
}

export interface StopScore {
  stopId: string;
  stopName: string;
  lat: number;
  lng: number;
  incidentCount: number;
  maxSeverity: number;
  patternSeverity: number;
  combinedScore: number;
  nearbyIncidents: NearbyIncident[];
}

export interface RouteScore {
  overallSeverity: number;
  recommendation: string;
  stops: StopScore[];
  estimatedDelayMinutes: number;
}
