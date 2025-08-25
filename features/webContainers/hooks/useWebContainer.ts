import { useState, useEffect, useCallback, useRef } from "react";
import { WebContainer } from "@webcontainer/api";
import { TemplateFolder } from "@/features/playground/types";

interface UseWebContainerProps {
  templateData: TemplateFolder;
}

interface UseWebContainerReturn {
  serverUrl: string | null;
  isLoading: boolean;
  error: string | null;
  instance: WebContainer | null;
  writeFileSync: (path: string, content: string) => Promise<void>;
  destroy: () => void;
  restart: () => Promise<void>; // Add restart functionality
}

// Global singleton to ensure only one WebContainer instance
let globalWebContainerInstance: WebContainer | null = null;
let initializationPromise: Promise<WebContainer> | null = null;

export const useWebContainer = ({
  templateData,
}: UseWebContainerProps): UseWebContainerReturn => {
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [instance, setInstance] = useState<WebContainer | null>(null);

  // Use ref to store the actual instance for cleanup
  const instanceRef = useRef<WebContainer | null>(null);

  // Add restart functionality
  const restart = useCallback(async () => {
    // Clear current state
    setServerUrl(null);
    setError(null);
    setIsLoading(true);

    // Reset global state
    if (globalWebContainerInstance) {
      try {
        await globalWebContainerInstance.teardown();
      } catch (err) {
        console.warn("Error during teardown:", err);
      }
    }

    globalWebContainerInstance = null;
    initializationPromise = null;
    instanceRef.current = null;
    setInstance(null);

    // Reinitialize
    await initializeWebContainer();
  }, []);

  const initializeWebContainer = useCallback(async () => {
    try {
      // If we already have a global instance, use it
      if (globalWebContainerInstance) {
        setInstance(globalWebContainerInstance);
        instanceRef.current = globalWebContainerInstance;
        setIsLoading(false);
        return;
      }

      // If initialization is already in progress, wait for it
      if (initializationPromise) {
        const webcontainerInstance = await initializationPromise;
        setInstance(webcontainerInstance);
        instanceRef.current = webcontainerInstance;
        setIsLoading(false);
        return;
      }

      // Start new initialization
      initializationPromise = WebContainer.boot({
        // Add memory optimization
        coep: "credentialless",
      });

      const webcontainerInstance = await initializationPromise;

      // Store globally to prevent multiple instances
      globalWebContainerInstance = webcontainerInstance;

      setInstance(webcontainerInstance);
      instanceRef.current = webcontainerInstance;
      setIsLoading(false);
    } catch (err) {
      console.error("Failed to initialize WebContainer:", err);

      // Reset global state on error
      globalWebContainerInstance = null;
      initializationPromise = null;

      setError(
        err instanceof Error ? err.message : "Failed to initialize WebContainer"
      );
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initializeWebContainer();

    // Cleanup on unmount only if this is the last component using it
    return () => {
      instanceRef.current = null;
    };
  }, [initializeWebContainer]);

  const writeFileSync = useCallback(
    async (path: string, content: string): Promise<void> => {
      const currentInstance = instanceRef.current || instance;
      if (!currentInstance) {
        throw new Error("WebContainer instance is not available");
      }

      try {
        // Ensure the folder structure exists
        const pathParts = path.split("/");
        const folderPath = pathParts.slice(0, -1).join("/");

        if (folderPath) {
          await currentInstance.fs.mkdir(folderPath, { recursive: true });
        }

        // Write the file
        await currentInstance.fs.writeFile(path, content);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to write file";
        console.error(`Failed to write file at ${path}:`, err);
        throw new Error(`Failed to write file at ${path}: ${errorMessage}`);
      }
    },
    [instance]
  );

  // Modified destroy function - only call this when you really want to cleanup
  const destroy = useCallback(() => {
    const currentInstance = instanceRef.current || instance;
    if (currentInstance) {
      try {
        currentInstance.teardown();
      } catch (err) {
        console.error("Error during WebContainer teardown:", err);
      }

      // Reset all state
      globalWebContainerInstance = null;
      initializationPromise = null;
      instanceRef.current = null;
      setInstance(null);
      setServerUrl(null);
      setError(null);
      setIsLoading(true);
    }
  }, [instance]);

  return {
    serverUrl,
    isLoading,
    error,
    instance,
    writeFileSync,
    destroy,
    restart,
  };
};
