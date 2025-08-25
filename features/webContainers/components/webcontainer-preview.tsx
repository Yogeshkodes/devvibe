"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { transformToWebContainerFormat } from "../hooks/transformer";
import { CheckCircle, Loader2, XCircle, RotateCcw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import TerminalComponent from "./terminal";
import { WebContainer } from "@webcontainer/api";
import { TemplateFolder } from "@/features/playground/types";

interface WebContainerPreviewProps {
  templateData: TemplateFolder;
  serverUrl: string;
  isLoading: boolean;
  error: string | null;
  instance: WebContainer | null;
  writeFileSync: (path: string, content: string) => Promise<void>;
  forceResetup?: boolean;
  restart?: () => Promise<void>; // Add restart prop
}

const WebContainerPreview: React.FC<WebContainerPreviewProps> = ({
  templateData,
  error,
  instance,
  isLoading,
  serverUrl,
  writeFileSync,
  forceResetup = false,
  restart,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [loadingState, setLoadingState] = useState({
    transforming: false,
    mounting: false,
    installing: false,
    starting: false,
    ready: false,
  });
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = 4;
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [isSetupInProgress, setIsSetupInProgress] = useState(false);

  // Ref to access terminal methods
  const terminalRef = useRef<any>(null);

  // Track server processes to prevent multiple startups
  const serverProcessRef = useRef<any>(null);
  const installProcessRef = useRef<any>(null);

  // Reset setup state when forceResetup changes
  useEffect(() => {
    if (forceResetup) {
      resetSetupState();
    }
  }, [forceResetup]);

  const resetSetupState = useCallback(() => {
    setIsSetupComplete(false);
    setIsSetupInProgress(false);
    setPreviewUrl("");
    setCurrentStep(0);
    setSetupError(null);
    setLoadingState({
      transforming: false,
      mounting: false,
      installing: false,
      starting: false,
      ready: false,
    });

    // Kill existing processes
    if (serverProcessRef.current) {
      try {
        serverProcessRef.current.kill();
      } catch (e) {
        console.warn("Error killing server process:", e);
      }
      serverProcessRef.current = null;
    }

    if (installProcessRef.current) {
      try {
        installProcessRef.current.kill();
      } catch (e) {
        console.warn("Error killing install process:", e);
      }
      installProcessRef.current = null;
    }
  }, []);

  const writeToTerminal = useCallback((message: string) => {
    if (terminalRef.current?.writeToTerminal) {
      terminalRef.current.writeToTerminal(message);
    }
  }, []);

  const checkExistingSetup = useCallback(
    async (instance: WebContainer) => {
      try {
        // Check if package.json exists
        const packageJson = await instance.fs.readFile("package.json", "utf8");
        const packageData = JSON.parse(packageJson);

        // Check if node_modules exists
        try {
          const nodeModulesStats = await instance.fs.readdir("node_modules");
          if (nodeModulesStats.length > 0) {
            writeToTerminal(
              "🔄 Found existing setup, checking server status...\r\n"
            );
            return { hasFiles: true, hasNodeModules: true, packageData };
          }
        } catch (e) {
          // node_modules doesn't exist
        }

        return { hasFiles: true, hasNodeModules: false, packageData };
      } catch (e) {
        return { hasFiles: false, hasNodeModules: false, packageData: null };
      }
    },
    [writeToTerminal]
  );

  const optimizePackageJson = useCallback(
    async (instance: WebContainer, packageData: any) => {
      // Optimize React startup by modifying package.json
      if (
        packageData?.scripts?.start &&
        !packageData.scripts.start.includes("--host")
      ) {
        const optimizedPackageData = {
          ...packageData,
          scripts: {
            ...packageData.scripts,
            start: packageData.scripts.start.includes("react-scripts")
              ? `${packageData.scripts.start} --host 0.0.0.0`
              : packageData.scripts.start,
          },
        };

        await instance.fs.writeFile(
          "package.json",
          JSON.stringify(optimizedPackageData, null, 2)
        );

        writeToTerminal("⚡ Optimized package.json for faster startup\r\n");
      }
    },
    [writeToTerminal]
  );

  useEffect(() => {
    async function setupContainer() {
      if (!instance || isSetupComplete || isSetupInProgress) return;

      try {
        setIsSetupInProgress(true);
        setSetupError(null);

        // Check existing setup
        const { hasFiles, hasNodeModules, packageData } =
          await checkExistingSetup(instance);

        if (hasFiles && hasNodeModules) {
          writeToTerminal("🚀 Reconnecting to existing project...\r\n");

          // Optimize existing package.json
          await optimizePackageJson(instance, packageData);

          // Try to start server directly
          setCurrentStep(4);
          setLoadingState((prev) => ({ ...prev, starting: true }));

          // Listen for server ready
          const serverReadyHandler = (port: number, url: string) => {
            writeToTerminal(`🌐 Server ready at ${url}\r\n`);
            setPreviewUrl(url);
            setLoadingState((prev) => ({
              ...prev,
              starting: false,
              ready: true,
            }));
            setIsSetupComplete(true);
            setIsSetupInProgress(false);
          };

          instance.on("server-ready", serverReadyHandler);

          // Start server
          try {
            const startProcess = await instance.spawn("npm", ["run", "start"]);
            serverProcessRef.current = startProcess;

            // Stream output
            startProcess.output.pipeTo(
              new WritableStream({
                write(data) {
                  writeToTerminal(data);
                },
              })
            );

            // If server doesn't start in 10 seconds, show error
            setTimeout(() => {
              if (!isSetupComplete) {
                setSetupError(
                  "Server taking too long to start. Try restarting."
                );
                setIsSetupInProgress(false);
              }
            }, 10000);
          } catch (e) {
            console.error("Failed to start existing server:", e);
            // Fall through to full setup
          }
        }

        if (!hasFiles) {
          // Full setup process

          // Step 1: Transform data
          setLoadingState((prev) => ({ ...prev, transforming: true }));
          setCurrentStep(1);
          writeToTerminal("📦 Transforming template data...\r\n");

          // @ts-ignore
          const files = transformToWebContainerFormat(templateData);

          setLoadingState((prev) => ({
            ...prev,
            transforming: false,
            mounting: true,
          }));
          setCurrentStep(2);

          // Step 2: Mount files
          writeToTerminal("📁 Mounting files to WebContainer...\r\n");
          await instance.mount(files);
          writeToTerminal("✅ Files mounted successfully\r\n");

          // Optimize package.json after mounting
          try {
            const packageJson = await instance.fs.readFile(
              "package.json",
              "utf8"
            );
            const packageData = JSON.parse(packageJson);
            await optimizePackageJson(instance, packageData);
          } catch (e) {
            console.warn("Could not optimize package.json:", e);
          }

          setLoadingState((prev) => ({
            ...prev,
            mounting: false,
            installing: true,
          }));
          setCurrentStep(3);

          // Step 3: Install dependencies with optimizations
          writeToTerminal(
            "📦 Installing dependencies (this may take a moment)...\r\n"
          );

          // Use npm ci for faster installs if package-lock.json exists
          let installCmd = "install";
          try {
            await instance.fs.readFile("package-lock.json", "utf8");
            installCmd = "ci";
            writeToTerminal("🔧 Using npm ci for faster installation...\r\n");
          } catch (e) {
            // package-lock.json doesn't exist, use regular install
          }

          const installProcess = await instance.spawn("npm", [
            installCmd,
            "--silent",
          ]);
          installProcessRef.current = installProcess;

          // Stream install output
          installProcess.output.pipeTo(
            new WritableStream({
              write(data) {
                writeToTerminal(data);
              },
            })
          );

          const installExitCode = await installProcess.exit;
          installProcessRef.current = null;

          if (installExitCode !== 0) {
            throw new Error(
              `Failed to install dependencies. Exit code: ${installExitCode}`
            );
          }

          writeToTerminal("✅ Dependencies installed successfully\r\n");
        }

        // Start server if not already started
        if (!previewUrl) {
          setLoadingState((prev) => ({
            ...prev,
            installing: false,
            starting: true,
          }));
          setCurrentStep(4);

          writeToTerminal("🚀 Starting development server...\r\n");

          // Listen for server ready
          const serverReadyHandler = (port: number, url: string) => {
            writeToTerminal(`🌐 Server ready at ${url}\r\n`);
            setPreviewUrl(url);
            setLoadingState((prev) => ({
              ...prev,
              starting: false,
              ready: true,
            }));
            setIsSetupComplete(true);
            setIsSetupInProgress(false);
          };

          instance.on("server-ready", serverReadyHandler);

          const startProcess = await instance.spawn("npm", ["run", "start"]);
          serverProcessRef.current = startProcess;

          // Stream output
          startProcess.output.pipeTo(
            new WritableStream({
              write(data) {
                writeToTerminal(data);
              },
            })
          );
        }
      } catch (err) {
        console.error("Error setting up container:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        writeToTerminal(`❌ Error: ${errorMessage}\r\n`);
        setSetupError(errorMessage);
        setIsSetupInProgress(false);
        setLoadingState({
          transforming: false,
          mounting: false,
          installing: false,
          starting: false,
          ready: false,
        });
      }
    }

    setupContainer();
  }, [
    instance,
    templateData,
    isSetupComplete,
    isSetupInProgress,
    checkExistingSetup,
    optimizePackageJson,
    writeToTerminal,
  ]);

  // Cleanup processes on unmount
  useEffect(() => {
    return () => {
      // Clean up processes but don't kill WebContainer
      if (serverProcessRef.current) {
        try {
          serverProcessRef.current.kill();
        } catch (e) {
          console.warn("Error killing server process on unmount:", e);
        }
      }
      if (installProcessRef.current) {
        try {
          installProcessRef.current.kill();
        } catch (e) {
          console.warn("Error killing install process on unmount:", e);
        }
      }
    };
  }, []);

  const handleRestart = useCallback(async () => {
    resetSetupState();
    if (restart) {
      await restart();
    }
  }, [resetSetupState, restart]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md p-6 rounded-lg bg-gray-50 dark:bg-gray-900">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <h3 className="text-lg font-medium">Initializing WebContainer</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Setting up the environment for your project...
          </p>
        </div>
      </div>
    );
  }

  if (error || setupError) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-6 rounded-lg max-w-md">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="h-5 w-5" />
            <h3 className="font-semibold">Error</h3>
          </div>
          <p className="text-sm mb-4">{error || setupError}</p>
          {restart && (
            <Button onClick={handleRestart} variant="outline" size="sm">
              <RotateCcw className="h-4 w-4 mr-2" />
              Restart Container
            </Button>
          )}
        </div>
      </div>
    );
  }

  const getStepIcon = (stepIndex: number) => {
    if (stepIndex < currentStep) {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    } else if (stepIndex === currentStep) {
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    } else {
      return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
    }
  };

  const getStepText = (stepIndex: number, label: string) => {
    const isActive = stepIndex === currentStep;
    const isComplete = stepIndex < currentStep;

    return (
      <span
        className={`text-sm font-medium ${
          isComplete
            ? "text-green-600"
            : isActive
            ? "text-blue-600"
            : "text-gray-500"
        }`}
      >
        {label}
      </span>
    );
  };

  return (
    <div className="h-full w-full flex flex-col">
      {!previewUrl ? (
        <div className="h-full flex flex-col">
          <div className="w-full max-w-md p-6 m-5 rounded-lg bg-white dark:bg-zinc-800 shadow-sm mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">Setting up project</h3>
              {restart && (
                <Button onClick={handleRestart} variant="ghost" size="sm">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
            </div>

            <Progress
              value={(currentStep / totalSteps) * 100}
              className="h-2 mb-6"
            />

            <div className="space-y-4 mb-6">
              <div className="flex items-center gap-3">
                {getStepIcon(1)}
                {getStepText(1, "Transforming template data")}
              </div>
              <div className="flex items-center gap-3">
                {getStepIcon(2)}
                {getStepText(2, "Mounting files")}
              </div>
              <div className="flex items-center gap-3">
                {getStepIcon(3)}
                {getStepText(3, "Installing dependencies")}
              </div>
              <div className="flex items-center gap-3">
                {getStepIcon(4)}
                {getStepText(4, "Starting development server")}
              </div>
            </div>
          </div>

          <div className="flex-1 p-4">
            <TerminalComponent
              ref={terminalRef}
              webContainerInstance={instance}
              theme="dark"
              className="h-full"
            />
          </div>
        </div>
      ) : (
        <div className="h-full flex flex-col">
          <div className="flex-1">
            <iframe
              src={previewUrl}
              className="w-full h-full border-none"
              title="WebContainer Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            />
          </div>

          <div className="h-64 border-t">
            <TerminalComponent
              ref={terminalRef}
              webContainerInstance={instance}
              theme="dark"
              className="h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default WebContainerPreview;
