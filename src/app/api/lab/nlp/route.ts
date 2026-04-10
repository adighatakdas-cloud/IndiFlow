import { NextRequest } from "next/server";
import { z } from "zod";
import { requireLabAuth } from "../_auth";
import { classify } from "@/lib/intelligence/nlp/classifier";
import { resolveRoadName } from "@/lib/intelligence/geo/matcher";

const postSchema = z.object({
  text: z.string().min(3).max(500),
  language: z.enum(["en", "bn", "auto"]).optional().default("auto"),
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

  const { text, language } = parsed.data;

  try {
    const classification = classify({
      id: `lab-nlp-${Date.now()}`,
      text,
      publishedAt: new Date().toISOString(),
      source: "lab",
      language: language === "auto" ? undefined : language,
    });

    let geo = null;
    if (classification.roadName) {
      try {
        geo = await resolveRoadName(classification.roadName);
      } catch {
        // geo resolution failure is non-fatal in lab context
      }
    }

    return Response.json({
      input: text,
      language: language === "auto" ? classification.detectedLanguage : language,
      classification,
      geo,
    });
  } catch (err) {
    console.error("[lab/nlp] POST error:", err);
    return Response.json({ error: "Classification failed", code: "NLP_ERROR" }, { status: 500 });
  }
}
