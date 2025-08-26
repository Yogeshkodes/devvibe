// app/api/template/[id]/route.ts
import {
  readTemplateStructureFromJson,
  saveTemplateStructureToJson,
} from "@/features/playground/lib/path-to-json";
import { db } from "@/lib/db";
import { getTemplatePath } from "@/lib/template";
import { templateCache } from "@/lib/template-cache";
import path from "path";
import os from "os";
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";

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
    return NextResponse.json(
      { error: "Missing playground ID" },
      { status: 400 }
    );
  }

  try {
    // Check cache first
    const cacheKey = `template-${id}`;
    const cachedData = templateCache.get(cacheKey);

    if (cachedData) {
      console.log(`✅ Cache hit for template ${id}`);
      return NextResponse.json(cachedData, {
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
      return NextResponse.json(
        { error: "Playground not found" },
        { status: 404 }
      );
    }

    const templateKey = playground.template as keyof typeof templatePaths;
    const templatePath = getTemplatePath(templateKey);

    // Ensure template directory exists
    try {
      await fs.access(templatePath);
    } catch (error) {
      console.error(`❌ Template path not accessible: ${templatePath}`, error);
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    // Generate temporary file path
    const tmpDir = process.env.VERCEL ? "/tmp" : os.tmpdir();
    const outputFile = path.join(tmpDir, `${id}-${Date.now()}.json`);

    console.log("Template Path:", templatePath);
    console.log("Output File:", outputFile);

    // Save and read the template structure
    await saveTemplateStructureToJson(templatePath, outputFile);
    const result = await readTemplateStructureFromJson(outputFile);

    // Validate the JSON structure before saving
    if (!validateJsonStructure(result.items)) {
      console.error("❌ Invalid JSON structure generated");
      return NextResponse.json(
        { error: "Invalid JSON structure" },
        { status: 500 }
      );
    }

    // Cleanup temp file
    try {
      await fs.unlink(outputFile);
    } catch (error) {
      console.warn("⚠️ Failed to cleanup temp file:", error);
    }

    // 🚀 NEW: Prepare response data
    const responseData = { success: true, templateJson: result };

    // 🚀 NEW: Cache the result for 5 minutes
    templateCache.set(cacheKey, responseData, 5 * 60 * 1000);

    return NextResponse.json(responseData, {
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

    return NextResponse.json(
      {
        error: "Failed to generate template",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
