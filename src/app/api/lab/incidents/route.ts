import { NextRequest } from "next/server";
import { requireLabAuth } from "../_auth";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  if (!requireLabAuth(request)) {
    return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;

  const active       = sp.get("active") !== "false";
  const type         = sp.get("type") ?? undefined;
  const minSeverity  = Number(sp.get("minSeverity") ?? 0);
  const minConf      = Number(sp.get("minConfidence") ?? 0);
  const roadName     = sp.get("roadName") ?? undefined;
  const source       = sp.get("source") ?? undefined;
  const language     = sp.get("language") ?? undefined;
  const from         = sp.get("from") ?? undefined;
  const to           = sp.get("to") ?? undefined;
  const rawLimit     = Number(sp.get("limit") ?? DEFAULT_LIMIT);
  const limit        = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
  const page         = Math.max(1, Number(sp.get("page") ?? 1));
  const skip         = (page - 1) * limit;

  const now = new Date();

  const where: Prisma.TrafficIncidentWhereInput = {
    ...(active ? { expiresAt: { gt: now } } : {}),
    ...(type ? { type } : {}),
    ...(minSeverity > 0 ? { severity: { gte: minSeverity } } : {}),
    ...(minConf > 0 ? { confidence: { gte: minConf } } : {}),
    ...(roadName ? { normalised: { contains: roadName.toLowerCase() } } : {}),
    ...(source ? { source } : {}),
    ...(from || to
      ? {
          reportedAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };

  try {
    const [incidents, total] = await Promise.all([
      prisma.trafficIncident.findMany({
        where,
        orderBy: { reportedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.trafficIncident.count({ where }),
    ]);

    // Compute lat/lng bounding box from geocoded incidents
    const geocoded = incidents.filter((i) => i.lat !== null && i.lng !== null);
    const bounds =
      geocoded.length > 0
        ? {
            minLat: Math.min(...geocoded.map((i) => i.lat!)),
            maxLat: Math.max(...geocoded.map((i) => i.lat!)),
            minLng: Math.min(...geocoded.map((i) => i.lng!)),
            maxLng: Math.max(...geocoded.map((i) => i.lng!)),
          }
        : null;

    return Response.json({ incidents, total, bounds });
  } catch (err) {
    console.error("[lab/incidents] GET error:", err);
    return Response.json({ error: "Failed to query incidents", code: "DB_ERROR" }, { status: 500 });
  }
}
