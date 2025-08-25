// Replace your entire usePlayground hook with this fixed version:

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { TemplateFolder } from "../lib/path-to-json";
import { getPlaygroundById, SaveUpdatedCode } from "../action";

interface PlaygroundData {
  id: string;
  title?: string;
  [key: string]: any;
}

interface UsePlaygroundReturn {
  playgroundData: PlaygroundData | null;
  templateData: TemplateFolder | null;
  isLoading: boolean;
  error: string | null;
  loadPlayground: () => Promise<void>;
  saveTemplateData: (data: TemplateFolder) => Promise<void>;
}

export const usePlayground = (id: string): UsePlaygroundReturn => {
  const [playgroundData, setPlaygroundData] = useState<PlaygroundData | null>(
    null
  );
  const [templateData, setTemplateData] = useState<TemplateFolder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get session status to wait for auth before loading
  const { data: session, status: sessionStatus } = useSession({
    required: false,
    refetchInterval: 0,
    refetchOnWindowFocus: false,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const hasLoadedRef = useRef(false);

  const loadPlayground = useCallback(async () => {
    // Don't load if we don't have an ID
    if (!id) {
      setError("No playground ID provided");
      setIsLoading(false);
      return;
    }

    // Wait for auth to be determined before loading
    if (sessionStatus === "loading") {
      console.log("⏳ Waiting for auth to complete...");
      return;
    }

    // Prevent duplicate loads
    if (hasLoadedRef.current) {
      console.log("🚫 Already loaded, skipping...");
      return;
    }

    console.log("🚀 Starting playground load for ID:", id);

    // Cancel any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      setIsLoading(true);
      setError(null);

      console.log("📡 Fetching playground data...");
      const data = await getPlaygroundById(id);

      if (abortController.signal.aborted) {
        console.log("🚫 Request aborted");
        return;
      }

      if (!data) {
        throw new Error("No playground data found");
      }

      console.log("✅ Playground data loaded:", data);
      setPlaygroundData(data);

      // Try to get template data from the playground data first
      const rawContent = data?.templateFiles?.[0]?.content;

      if (typeof rawContent === "string") {
        try {
          const parsedContent = JSON.parse(rawContent);
          console.log(
            "✅ Template data parsed from playground:",
            parsedContent
          );
          setTemplateData(parsedContent);
          hasLoadedRef.current = true;
          toast.success("Playground loaded successfully");
          return;
        } catch (parseError) {
          console.warn("⚠️ Failed to parse template content:", parseError);
        }
      }

      // Fallback to API if no template data in playground
      console.log("📡 Fetching template from API...");
      const res = await fetch(`/api/template/${id}`, {
        signal: abortController.signal,
        headers: {
          "Cache-Control": "no-cache",
        },
      });

      if (abortController.signal.aborted) {
        console.log("🚫 Template request aborted");
        return;
      }

      if (!res.ok) {
        throw new Error(
          `Failed to load template: ${res.status} ${res.statusText}`
        );
      }

      const templateRes = await res.json();
      console.log("📡 Template API response:", templateRes);

      let finalTemplateData;

      if (templateRes.templateJson && Array.isArray(templateRes.templateJson)) {
        finalTemplateData = {
          folderName: "Root",
          items: templateRes.templateJson,
        };
      } else {
        finalTemplateData = templateRes.templateJson || {
          folderName: "Root",
          items: [],
        };
      }

      if (!abortController.signal.aborted) {
        console.log("✅ Final template data:", finalTemplateData);
        setTemplateData(finalTemplateData);
        hasLoadedRef.current = true;
        toast.success("Template loaded successfully");
      }
    } catch (error: any) {
      if (!abortController.signal.aborted && error.name !== "AbortError") {
        console.error("❌ Error loading playground:", error);
        const errorMessage = error.message || "Failed to load playground data";
        setError(errorMessage);
        toast.error(errorMessage);
      }
    } finally {
      if (!abortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [id, sessionStatus]);

  const saveTemplateData = useCallback(
    async (data: TemplateFolder) => {
      if (!id) {
        toast.error("No playground ID available");
        return;
      }

      try {
        console.log("💾 Saving template data:", data);
        await SaveUpdatedCode(id, data);
        setTemplateData(data);
        toast.success("Changes saved successfully");
      } catch (error) {
        console.error("❌ Error saving template data:", error);
        toast.error("Failed to save changes");
        throw error;
      }
    },
    [id]
  );

  // Effect to load playground when auth is ready
  useEffect(() => {
    // Reset loading state when ID changes
    if (id) {
      hasLoadedRef.current = false;
      setIsLoading(true);
      setError(null);
    }

    loadPlayground();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [id, sessionStatus]); // Include sessionStatus in dependencies

  return {
    playgroundData,
    templateData,
    isLoading,
    error,
    loadPlayground,
    saveTemplateData,
  };
};
