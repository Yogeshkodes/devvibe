// app/api/template/[id]/route.ts
import {
  readTemplateStructureFromJson,
  saveTemplateStructureToJson,
} from "@/features/playground/lib/path-to-json";
import { db } from "@/lib/db";
import { templatePaths } from "@/lib/template";
import { templateCache } from "@/lib/template-cache";
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

  try {
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

    // Database query with error handling
    const playground = await db.playground.findUnique({
      where: { id },
    });

    if (!playground) {
      console.error(`❌ Playground not found: ${id}`);
      return Response.json({ error: "Playground not found" }, { status: 404 });
    }

    const templateKey = playground.template as keyof typeof templatePaths;
    const templatePath = templatePaths[templateKey];

    if (!templatePath) {
      console.error(`❌ Invalid template key: ${templateKey}`);
      return Response.json({ error: "Invalid template" }, { status: 404 });
    }

    // 🚀 FIXED: Use /tmp directory for Vercel compatibility
    const inputPath = path.join(process.cwd(), templatePath);

    // Create unique filename to avoid conflicts in serverless environment
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const outputFile = path.join("/tmp", `${templateKey}-${uniqueId}.json`);

    console.log("Input Path:", inputPath);
    console.log("Output Path:", outputFile);

    // Check if input path exists
    try {
      await fs.access(inputPath);
    } catch (error) {
      console.error(`❌ Input path not accessible: ${inputPath}`, error);
      return Response.json(
        { error: "Template file not found" },
        { status: 404 }
      );
    }

    // Save and read the template structure
    await saveTemplateStructureToJson(inputPath, outputFile);
    const result = await readTemplateStructureFromJson(outputFile);

    // Validate the JSON structure before saving
    if (!validateJsonStructure(result.items)) {
      console.error("❌ Invalid JSON structure generated");
      return Response.json(
        { error: "Invalid JSON structure" },
        { status: 500 }
      );
    }

    // Clean up the output file (with error handling)
    try {
      await fs.unlink(outputFile);
    } catch (unlinkError) {
      console.warn("⚠️ Failed to cleanup temp file:", unlinkError);
      // Don't fail the request if cleanup fails
    }

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
    console.error("❌ Error in template API:", error);

    // More detailed error logging
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }

    return Response.json(
      {
        error: "Failed to generate template",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
