import { NextRequest } from "next/server";
import { z } from "zod";
import { requireLabAuth } from "../../_auth";
import { prisma } from "@/lib/db/prisma";
import { kalmanFilter } from "@/lib/intelligence/gps/kalman";
import { stateMachine } from "@/lib/intelligence/gps/stateMachine";
import { findNearestStop } from "@/lib/intelligence/gps/stopDetector";
import { calculateETA } from "@/lib/intelligence/gps/eta";
import { GPSPing } from "@/lib/intelligence/gps/types";

const pingSchema = z.object({
  vehicleId:   z.string().min(1),
  lat:         z.number().min(-90).max(90),
  lng:         z.number().min(-180).max(180),
  speed:       z.number().min(0),
  accuracy:    z.number().min(0),
  bearing:     z.number().min(0).max(360),
  battery:     z.number().min(0).max(100).nullable().optional(),
  capturedAt:  z.string().datetime(),
  tripId:      z.string().optional(),
});

export async function POST(request: NextRequest) {
  if (!requireLabAuth(request)) {
    return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body", code: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = pingSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.flatten().formErrors[0] ?? "Validation error", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const capturedAt = new Date(data.capturedAt);

  const ping: GPSPing = {
    vehicleId:  data.vehicleId,
    lat:        data.lat,
    lng:        data.lng,
    speed:      data.speed,
    accuracy:   data.accuracy,
    bearing:    data.bearing,
    battery:    data.battery ?? null,
    capturedAt,
    tripId:     data.tripId,
  };

  try {
    // -----------------------------------------------------------------------
    // Step 1: Kalman filter
    // -----------------------------------------------------------------------
    const kalman = kalmanFilter.filter(data.vehicleId, ping);

    // -----------------------------------------------------------------------
    // Step 2: Resolve active trip
    // -----------------------------------------------------------------------
    let resolvedTripId = data.tripId;
    let activeTrip: { id: string; routeId: string } | null = null;

    if (resolvedTripId) {
      activeTrip = await prisma.trip.findFirst({
        where: { id: resolvedTripId, status: "in_progress" },
        select: { id: true, routeId: true },
      });
    } else {
      activeTrip = await prisma.trip.findFirst({
        where: { vehicleId: data.vehicleId, status: "in_progress" },
        select: { id: true, routeId: true },
        orderBy: { scheduledAt: "desc" },
      });
      resolvedTripId = activeTrip?.id;
    }

    const tripActive = activeTrip !== null;

    // -----------------------------------------------------------------------
    // Step 3: Load route stops if trip is active
    // -----------------------------------------------------------------------
    let stops: { id: string; name: string; lat: number; lng: number; order: number }[] = [];

    if (activeTrip) {
      stops = await prisma.stop.findMany({
        where: { routeId: activeTrip.routeId },
        orderBy: { order: "asc" },
        select: { id: true, name: true, lat: true, lng: true, order: true },
      });
    }

    // -----------------------------------------------------------------------
    // Step 4: Stop detection
    // -----------------------------------------------------------------------
    const stopProximity = kalman.rejected
      ? null
      : findNearestStop(kalman.lat, kalman.lng, stops);

    // -----------------------------------------------------------------------
    // Step 5: State machine transition
    // -----------------------------------------------------------------------
    const previousState = stateMachine.getState(data.vehicleId);
    const transition = stateMachine.transition(
      data.vehicleId,
      ping,
      kalman.speed,
      stopProximity,
      tripActive
    );

    // -----------------------------------------------------------------------
    // Step 6: ETA calculation
    // -----------------------------------------------------------------------
    let eta = undefined;

    if (activeTrip && !kalman.rejected && stops.length > 0) {
      // Remaining stops = stops whose order is greater than the nearest visited stop
      // Simple heuristic: stops ahead of nearest stop
      const nearestOrder = stopProximity?.order ?? 0;
      const remainingStops = stops.filter((s) => s.order > nearestOrder);

      if (remainingStops.length > 0) {
        const etaResult = await calculateETA(
          data.vehicleId,
          kalman.lat,
          kalman.lng,
          kalman.speed,
          remainingStops,
          activeTrip.routeId
        );
        eta = etaResult ?? undefined;
      }
    }

    // -----------------------------------------------------------------------
    // Step 7: Write GPSTrack
    // -----------------------------------------------------------------------
    if (!kalman.rejected) {
      await prisma.gPSTrack.create({
        data: {
          vehicleId: data.vehicleId,
          tripId:    resolvedTripId ?? null,
          lat:       kalman.lat,
          lng:       kalman.lng,
          speed:     kalman.speed,
          accuracy:  data.accuracy,
          bearing:   data.bearing,
          battery:   data.battery ?? null,
          capturedAt,
          provider:  "lab",
        },
      });
    }

    // -----------------------------------------------------------------------
    // Step 8: Update Vehicle
    // -----------------------------------------------------------------------
    await prisma.vehicle.update({
      where: { id: data.vehicleId },
      data: {
        lastLat:      kalman.rejected ? undefined : kalman.lat,
        lastLng:      kalman.rejected ? undefined : kalman.lng,
        lastPingAt:   capturedAt,
        batteryLevel: data.battery ?? undefined,
        state:        transition.newState,
      },
    });

    // -----------------------------------------------------------------------
    // Step 9: Return PipelineResult
    // -----------------------------------------------------------------------
    return Response.json({
      accepted:          !kalman.rejected,
      filteredLat:       kalman.lat,
      filteredLng:       kalman.lng,
      filteredSpeed:     kalman.speed,
      kalmanRejected:    kalman.rejected,
      previousState,
      newState:          transition.newState,
      stateChanged:      transition.previousState !== transition.newState,
      stateChangeReason: transition.previousState !== transition.newState
        ? transition.reason
        : undefined,
      stopDetected:      stopProximity ?? undefined,
      eta,
    });
  } catch (err) {
    console.error("[lab/gps/ping] POST error:", err);
    return Response.json({ error: "GPS pipeline failed", code: "PIPELINE_ERROR" }, { status: 500 });
  }
}
