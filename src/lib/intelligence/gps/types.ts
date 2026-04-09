export enum VehicleState {
  OFFLINE     = "OFFLINE",
  IDLE        = "IDLE",
  DEPARTING   = "DEPARTING",
  EN_ROUTE    = "EN_ROUTE",
  APPROACHING = "APPROACHING",
  ARRIVED     = "ARRIVED",
  STOPPED     = "STOPPED",
  RETURNING   = "RETURNING",
  UNKNOWN     = "UNKNOWN",
}

export interface GPSPing {
  vehicleId: string;
  lat: number;
  lng: number;
  speed: number;
  accuracy: number;
  bearing: number;
  battery: number | null;
  capturedAt: Date;
  tripId?: string;
}

export interface KalmanState {
  lat: number;
  lng: number;
  speed: number;
  variance: number;
  lastUpdated: Date;
}

export interface StopProximity {
  stopId: string;
  stopName: string;
  distanceMetres: number;
  order: number;
}

export interface ETAResult {
  nextStopId: string;
  nextStopName: string;
  etaMinutes: number;
  etaSeconds: number;
  distanceMetres: number;
  confidence: number;
  correctionFactorApplied: number;
}

export interface StateTransition {
  previousState: VehicleState;
  newState: VehicleState;
  reason: string;
  timestamp: Date;
}

export interface PipelineResult {
  accepted: boolean;
  filteredLat: number;
  filteredLng: number;
  filteredSpeed: number;
  kalmanRejected: boolean;
  previousState: VehicleState;
  newState: VehicleState;
  stateChanged: boolean;
  stateChangeReason?: string;
  stopDetected?: StopProximity;
  eta?: ETAResult;
}
