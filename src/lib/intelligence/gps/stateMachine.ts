import { VehicleState, GPSPing, StopProximity, StateTransition } from "./types";

/** Thresholds */
const SPEED_DEPARTING_KMH    = 3;
const SPEED_EN_ROUTE_KMH     = 8;
const SPEED_ARRIVED_AWAY_KMH = 5;
const SPEED_STOPPED_KMH      = 2;
const SPEED_RESUME_KMH       = 5;
const STOP_APPROACHING_M     = 150;
const STOP_ARRIVED_M         = 30;
const STOPPED_DURATION_MS    = 90 * 1000;   // 90 seconds
const OFFLINE_TIMEOUT_MS     = 3 * 60 * 1000; // 3 minutes
const RETURNING_BEARING_DEG  = 150;          // degrees difference = "opposite"
const EN_ROUTE_SUSTAINED_PINGS = 2;

interface VehicleContext {
  state: VehicleState;
  lastPingAt: Date;
  /** Count of consecutive high-speed pings in DEPARTING state */
  sustainedSpeedPings: number;
  /** Timestamp when speed first dropped below STOPPED threshold */
  slowSince: Date | null;
  /** Last bearing while EN_ROUTE, used to detect RETURNING */
  lastEnRouteBearing: number | null;
  /** Count of consecutive pings with reversed bearing */
  reversedBearingPings: number;
}

class VehicleStateMachine {
  private contexts = new Map<string, VehicleContext>();

  private getContext(vehicleId: string): VehicleContext {
    if (!this.contexts.has(vehicleId)) {
      this.contexts.set(vehicleId, {
        state: VehicleState.UNKNOWN,
        lastPingAt: new Date(0),
        sustainedSpeedPings: 0,
        slowSince: null,
        lastEnRouteBearing: null,
        reversedBearingPings: 0,
      });
    }
    return this.contexts.get(vehicleId)!;
  }

  getState(vehicleId: string): VehicleState {
    return this.getContext(vehicleId).state;
  }

  setState(vehicleId: string, state: VehicleState): void {
    const ctx = this.getContext(vehicleId);
    ctx.state = state;
  }

  /**
   * Evaluate all transition rules for the incoming ping and return the
   * resulting StateTransition. The internal context is updated in place.
   */
  transition(
    vehicleId: string,
    ping: GPSPing,
    filteredSpeed: number,
    stopProximity: StopProximity | null,
    tripActive: boolean
  ): StateTransition {
    const ctx = this.getContext(vehicleId);
    const now = ping.capturedAt;
    const previous = ctx.state;

    // Helper: emit a transition
    const emit = (newState: VehicleState, reason: string): StateTransition => {
      ctx.state = newState;
      ctx.lastPingAt = now;
      return { previousState: previous, newState, reason, timestamp: now };
    };

    // Helper: no-change transition
    const unchanged = (reason: string): StateTransition => {
      ctx.lastPingAt = now;
      return { previousState: previous, newState: previous, reason, timestamp: now };
    };

    // -----------------------------------------------------------------------
    // Global rule: any → OFFLINE if last ping was > 3 minutes ago
    // (Only applies between pings; the current ping resets the clock after.)
    // -----------------------------------------------------------------------
    const msSinceLastPing = now.getTime() - ctx.lastPingAt.getTime();
    if (
      ctx.lastPingAt.getTime() > 0 &&
      msSinceLastPing > OFFLINE_TIMEOUT_MS &&
      previous !== VehicleState.OFFLINE
    ) {
      ctx.sustainedSpeedPings = 0;
      ctx.slowSince = null;
      ctx.reversedBearingPings = 0;
      return emit(VehicleState.OFFLINE, "no ping for 3+ minutes");
    }

    // -----------------------------------------------------------------------
    // Global rule: any → RETURNING if bearing consistently reversed
    // -----------------------------------------------------------------------
    if (
      ctx.lastEnRouteBearing !== null &&
      previous !== VehicleState.RETURNING &&
      previous !== VehicleState.OFFLINE
    ) {
      const diff = Math.abs(ping.bearing - ctx.lastEnRouteBearing);
      const normalised = diff > 180 ? 360 - diff : diff;
      if (normalised > RETURNING_BEARING_DEG) {
        ctx.reversedBearingPings++;
      } else {
        ctx.reversedBearingPings = 0;
      }
      if (ctx.reversedBearingPings >= 3) {
        return emit(VehicleState.RETURNING, "bearing consistently opposite to route direction");
      }
    }

    // -----------------------------------------------------------------------
    // State-specific transitions
    // -----------------------------------------------------------------------
    switch (previous) {

      case VehicleState.OFFLINE:
      case VehicleState.UNKNOWN: {
        if (tripActive) {
          return emit(VehicleState.IDLE, "trip became active");
        }
        return unchanged("offline, no active trip");
      }

      case VehicleState.IDLE: {
        if (filteredSpeed > SPEED_DEPARTING_KMH && tripActive) {
          ctx.sustainedSpeedPings = 1;
          return emit(VehicleState.DEPARTING, `speed ${filteredSpeed.toFixed(1)} km/h > ${SPEED_DEPARTING_KMH} km/h threshold`);
        }
        return unchanged("speed below departing threshold");
      }

      case VehicleState.DEPARTING: {
        if (filteredSpeed > SPEED_EN_ROUTE_KMH) {
          ctx.sustainedSpeedPings++;
          if (ctx.sustainedSpeedPings >= EN_ROUTE_SUSTAINED_PINGS) {
            ctx.lastEnRouteBearing = ping.bearing;
            ctx.slowSince = null;
            return emit(VehicleState.EN_ROUTE, `speed ${filteredSpeed.toFixed(1)} km/h sustained for ${ctx.sustainedSpeedPings} pings`);
          }
        } else {
          ctx.sustainedSpeedPings = 0;
        }
        return unchanged("building sustained speed");
      }

      case VehicleState.EN_ROUTE: {
        // Track bearing for RETURNING detection
        ctx.lastEnRouteBearing = ping.bearing;

        // Slow-stop tracking
        if (filteredSpeed < SPEED_STOPPED_KMH) {
          if (!ctx.slowSince) ctx.slowSince = now;
          const slowDuration = now.getTime() - ctx.slowSince.getTime();
          if (slowDuration >= STOPPED_DURATION_MS) {
            return emit(VehicleState.STOPPED, `speed < ${SPEED_STOPPED_KMH} km/h for ${Math.round(slowDuration / 1000)}s`);
          }
        } else {
          ctx.slowSince = null;
        }

        // Proximity-based transitions
        if (stopProximity) {
          if (stopProximity.distanceMetres < STOP_APPROACHING_M) {
            return emit(VehicleState.APPROACHING, `${stopProximity.distanceMetres.toFixed(0)}m from stop "${stopProximity.stopName}"`);
          }
        }

        return unchanged("en route");
      }

      case VehicleState.APPROACHING: {
        if (stopProximity && stopProximity.distanceMetres < STOP_ARRIVED_M) {
          return emit(VehicleState.ARRIVED, `within ${stopProximity.distanceMetres.toFixed(0)}m of stop "${stopProximity.stopName}"`);
        }
        // If somehow moved away from stop (e.g. wrong stop matched), fall back
        if (!stopProximity || stopProximity.distanceMetres > STOP_APPROACHING_M) {
          ctx.lastEnRouteBearing = ping.bearing;
          return emit(VehicleState.EN_ROUTE, "moved away from approaching stop");
        }
        return unchanged("approaching stop");
      }

      case VehicleState.ARRIVED: {
        if (filteredSpeed > SPEED_ARRIVED_AWAY_KMH) {
          ctx.slowSince = null;
          ctx.lastEnRouteBearing = ping.bearing;
          ctx.sustainedSpeedPings = 0;
          return emit(VehicleState.EN_ROUTE, `departed stop at ${filteredSpeed.toFixed(1)} km/h`);
        }
        return unchanged("at stop");
      }

      case VehicleState.STOPPED: {
        if (filteredSpeed > SPEED_RESUME_KMH) {
          ctx.slowSince = null;
          ctx.lastEnRouteBearing = ping.bearing;
          return emit(VehicleState.EN_ROUTE, `resumed from stop at ${filteredSpeed.toFixed(1)} km/h`);
        }
        return unchanged("still stopped");
      }

      case VehicleState.RETURNING: {
        // Once returning, only trip deactivation or manual reset moves it
        if (!tripActive) {
          return emit(VehicleState.IDLE, "trip no longer active");
        }
        return unchanged("returning");
      }

      default:
        return unchanged("unhandled state");
    }
  }
}

export const stateMachine = new VehicleStateMachine();
