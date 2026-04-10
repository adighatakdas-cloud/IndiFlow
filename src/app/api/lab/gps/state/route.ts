import { NextRequest } from "next/server";
import { requireLabAuth } from "../../_auth";
import { prisma } from "@/lib/db/prisma";

const RECENT_PING_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(request: NextRequest) {
  if (!requireLabAuth(request)) {
    return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const vehicleId = sp.get("vehicleId") ?? undefined;
  const tripId    = sp.get("tripId") ?? undefined;

  try {
    if (vehicleId) {
      // Single vehicle
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: {
          id: true, name: true, state: true,
          lastLat: true, lastLng: true, lastPingAt: true, batteryLevel: true,
        },
      });

      if (!vehicle) {
        return Response.json({ error: "Vehicle not found", code: "NOT_FOUND" }, { status: 404 });
      }

      const activeTrip = await getActiveTripInfo(vehicleId);

      return Response.json({
        vehicleId:  vehicle.id,
        vehicleName: vehicle.name,
        state:      vehicle.state,
        lat:        vehicle.lastLat,
        lng:        vehicle.lastLng,
        lastPingAt: vehicle.lastPingAt,
        battery:    vehicle.batteryLevel,
        activeTrip,
      });
    }

    if (tripId) {
      // All vehicles on a specific trip
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: { vehicleId: true, routeId: true },
      });

      if (!trip) {
        return Response.json({ error: "Trip not found", code: "NOT_FOUND" }, { status: 404 });
      }

      const vehicle = await prisma.vehicle.findUnique({
        where: { id: trip.vehicleId },
        select: {
          id: true, name: true, state: true,
          lastLat: true, lastLng: true, lastPingAt: true, batteryLevel: true,
        },
      });

      if (!vehicle) {
        return Response.json({ error: "Vehicle not found", code: "NOT_FOUND" }, { status: 404 });
      }

      const activeTrip = await getActiveTripInfo(vehicle.id);

      return Response.json([{
        vehicleId:   vehicle.id,
        vehicleName: vehicle.name,
        state:       vehicle.state,
        lat:         vehicle.lastLat,
        lng:         vehicle.lastLng,
        lastPingAt:  vehicle.lastPingAt,
        battery:     vehicle.batteryLevel,
        activeTrip,
      }]);
    }

    // All vehicles that pinged in the last 10 minutes
    const since = new Date(Date.now() - RECENT_PING_WINDOW_MS);
    const vehicles = await prisma.vehicle.findMany({
      where: { lastPingAt: { gte: since } },
      select: {
        id: true, name: true, state: true,
        lastLat: true, lastLng: true, lastPingAt: true, batteryLevel: true,
      },
    });

    const results = await Promise.all(
      vehicles.map(async (v) => {
        const activeTrip = await getActiveTripInfo(v.id);
        return {
          vehicleId:   v.id,
          vehicleName: v.name,
          state:       v.state,
          lat:         v.lastLat,
          lng:         v.lastLng,
          lastPingAt:  v.lastPingAt,
          battery:     v.batteryLevel,
          activeTrip,
        };
      })
    );

    return Response.json(results);
  } catch (err) {
    console.error("[lab/gps/state] GET error:", err);
    return Response.json({ error: "Failed to query vehicle state", code: "DB_ERROR" }, { status: 500 });
  }
}

async function getActiveTripInfo(vehicleId: string) {
  const trip = await prisma.trip.findFirst({
    where: { vehicleId, status: "in_progress" },
    select: {
      id: true,
      routeId: true,
      route: { select: { name: true } },
    },
    orderBy: { scheduledAt: "desc" },
  });

  if (!trip) return null;

  // Stops visited = GPSTracks near stop positions for this trip
  // Simplified: use stop count from route vs remaining
  const allStops = await prisma.stop.count({
    where: { routeId: trip.routeId },
  });

  // Last known GPS position to estimate visited stops
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { lastLat: true, lastLng: true },
  });

  // Approximate stopsVisited by checking GPSTrack count near any stop
  const tracksOnTrip = await prisma.gPSTrack.count({
    where: { tripId: trip.id },
  });

  const stopsVisited = Math.min(
    allStops,
    tracksOnTrip > 0 ? Math.floor(tracksOnTrip / 5) : 0
  );
  const stopsRemaining = Math.max(0, allStops - stopsVisited);

  // Current ETA from most recent GPSTrack
  const lastTrack = await prisma.gPSTrack.findFirst({
    where: { tripId: trip.id },
    orderBy: { capturedAt: "desc" },
    select: { speed: true },
  });

  return {
    tripId:             trip.id,
    routeId:            trip.routeId,
    routeName:          trip.route.name,
    stopsVisited,
    stopsRemaining,
    currentEtaMinutes:  null as number | null, // populated by ETA engine on next ping
  };
}
