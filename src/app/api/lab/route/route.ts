import { NextRequest } from "next/server";
import { z } from "zod";
import { requireLabAuth } from "../_auth";
import { scoreRoute } from "@/lib/intelligence/patterns/scorer";

const stopSchema = z.object({
  id:   z.string().min(1),
  name: z.string().min(1),
  lat:  z.number().min(-90).max(90),
  lng:  z.number().min(-180).max(180),
});

const postSchema = z.object({
  stops:         z.array(stopSchema).min(2).max(50),
  departureTime: z.string().datetime().optional(),
  radiusKm:      z.number().min(0.1).max(5).optional().default(0.5),
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

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.flatten().formErrors[0] ?? "Validation error", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const { stops, departureTime } = parsed.data;
  const departure = departureTime ? new Date(departureTime) : new Date();

  try {
    const result = await scoreRoute(stops, departure);
    return Response.json(result);
  } catch (err) {
    console.error("[lab/route] POST error:", err);
    return Response.json({ error: "Route scoring failed", code: "SCORE_ERROR" }, { status: 500 });
  }
}
