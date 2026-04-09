import { GPSPing, KalmanState } from "./types";

const PROCESS_NOISE_Q = 0.001;
const MAX_ACCURACY_METRES = 65;
const MAX_JUMP_METRES = 500;
const MAX_JUMP_SECONDS = 10;

/** Haversine distance in metres — local copy to avoid circular import with stopDetector */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

class KalmanFilter {
  private states = new Map<string, KalmanState>();

  /**
   * Apply 1-D Kalman filter independently to lat and lng.
   * Speed is smoothed with a simple exponential moving average (α = 0.3).
   *
   * Returns the filtered position and speed, plus a rejected flag.
   * If rejected = true the caller should discard this ping entirely.
   */
  filter(
    vehicleId: string,
    ping: GPSPing
  ): { lat: number; lng: number; speed: number; rejected: boolean } {
    // --- Rejection gate ---
    if (ping.accuracy > MAX_ACCURACY_METRES) {
      return {
        lat: ping.lat,
        lng: ping.lng,
        speed: ping.speed,
        rejected: true,
      };
    }

    const prev = this.states.get(vehicleId);

    if (prev) {
      const elapsedSeconds =
        (ping.capturedAt.getTime() - prev.lastUpdated.getTime()) / 1000;
      const jumpMetres = haversine(prev.lat, prev.lng, ping.lat, ping.lng);

      if (elapsedSeconds < MAX_JUMP_SECONDS && jumpMetres > MAX_JUMP_METRES) {
        return {
          lat: prev.lat,
          lng: prev.lng,
          speed: prev.speed,
          rejected: true,
        };
      }
    }

    // --- Kalman update ---
    const R = ping.accuracy / 100; // measurement noise scales with reported accuracy

    if (!prev) {
      // First ping for this vehicle — initialise state
      const initial: KalmanState = {
        lat: ping.lat,
        lng: ping.lng,
        speed: ping.speed,
        variance: R,
        lastUpdated: ping.capturedAt,
      };
      this.states.set(vehicleId, initial);
      return { lat: ping.lat, lng: ping.lng, speed: ping.speed, rejected: false };
    }

    // Predicted variance after process noise
    const predictedVariance = prev.variance + PROCESS_NOISE_Q;

    // Kalman gain
    const K = predictedVariance / (predictedVariance + R);

    // Updated estimates (applied identically to lat and lng)
    const filteredLat = prev.lat + K * (ping.lat - prev.lat);
    const filteredLng = prev.lng + K * (ping.lng - prev.lng);
    const updatedVariance = (1 - K) * predictedVariance;

    // Speed: exponential moving average (α = 0.3)
    const filteredSpeed = prev.speed * 0.7 + ping.speed * 0.3;

    const next: KalmanState = {
      lat: filteredLat,
      lng: filteredLng,
      speed: filteredSpeed,
      variance: updatedVariance,
      lastUpdated: ping.capturedAt,
    };
    this.states.set(vehicleId, next);

    return { lat: filteredLat, lng: filteredLng, speed: filteredSpeed, rejected: false };
  }

  /** Remove state for a vehicle — call at trip start to avoid stale-state jumps. */
  resetFilter(vehicleId: string): void {
    this.states.delete(vehicleId);
  }

  /** Expose current state for debugging/inspection. */
  getState(vehicleId: string): KalmanState | null {
    return this.states.get(vehicleId) ?? null;
  }
}

export const kalmanFilter = new KalmanFilter();
