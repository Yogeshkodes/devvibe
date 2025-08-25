// app/api/template/[id]/route.ts
import {
  readTemplateStructureFromJson,
  saveTemplateStructureToJson,
} from "@/features/playground/lib/path-to-json";
import { db } from "@/lib/db";
import { templatePaths } from "@/lib/template";
import { templateCache } from "@/lib/template-cache"; // Add this import
import path from "path";
import fs from "fs/promises";
import { NextRequest } from "next/server";

// Helper function to ensure valid JSON
function validateJsonStructure(data: unknown): boolean {
  try {
    JSON.parse(JSON.stringify(data)); // Ensures it's serializable
    return true;
  } catch (error) {
    console.error("Invalid JSON structure:", error);
    return false;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const param = await params;
  const id = param.id;

  if (!id) {
    return Response.json({ error: "Missing playground ID" }, { status: 400 });
  }

  // 🚀 NEW: Check cache first
  const cacheKey = `template-${id}`;
  const cachedData = templateCache.get(cacheKey);

  if (cachedData) {
    console.log(`✅ Cache hit for template ${id}`);
    return Response.json(cachedData, {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        "X-Cache": "HIT",
      },
    });
  }

  console.log(`🔄 Processing template ${id} - cache miss`);

  const playground = await db.playground.findUnique({
    where: { id },
  });

  if (!playground) {
    return Response.json({ error: "Playground not found" }, { status: 404 });
  }

  const templateKey = playground.template as keyof typeof templatePaths;
  const templatePath = templatePaths[templateKey];

  if (!templatePath) {
    return Response.json({ error: "Invalid template" }, { status: 404 });
  }

  try {
    const inputPath = path.join(process.cwd(), templatePath);
    const outputFile = path.join(process.cwd(), `output/${templateKey}.json`);

    console.log("Input Path:", inputPath);
    console.log("Output Path:", outputFile);

    // Save and read the template structure
    await saveTemplateStructureToJson(inputPath, outputFile);
    const result = await readTemplateStructureFromJson(outputFile);

    // Validate the JSON structure before saving
    if (!validateJsonStructure(result.items)) {
      return Response.json(
        { error: "Invalid JSON structure" },
        { status: 500 }
      );
    }

    // Clean up the output file
    await fs.unlink(outputFile);

    // 🚀 NEW: Prepare response data
    const responseData = { success: true, templateJson: result };

    // 🚀 NEW: Cache the result for 5 minutes
    templateCache.set(cacheKey, responseData, 5 * 60 * 1000);

    return Response.json(responseData, {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("❌ Error generating template JSON:", error);
    return Response.json(
      { error: "Failed to generate template" },
      { status: 500 }
    );
  }
}
