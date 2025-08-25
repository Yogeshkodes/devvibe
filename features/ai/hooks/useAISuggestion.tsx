import { useState, useRef, useCallback } from "react";

interface AISuggestionsState {
  suggestion: string | null;
  isLoading: boolean;
  position: { line: number; column: number } | null;
  decoration: string[];
  isEnabled: boolean;
}

interface UseAISuggestionsReturn extends AISuggestionsState {
  toggleEnabled: () => void;
  fetchSuggestion: (type: string, editor: any) => Promise<void>;
  acceptSuggestion: (editor: any, monaco: any) => void;
  rejectSuggestion: (editor: any) => void;
  clearSuggestion: (editor: any) => void;
}

export const useAISuggestions = (): UseAISuggestionsReturn => {
  const [state, setState] = useState<AISuggestionsState>({
    suggestion: null,
    isLoading: false,
    position: null,
    decoration: [],
    isEnabled: true,
  });

  // Add a ref to track ongoing requests and prevent duplicates
  const pendingRequestRef = useRef<string | null>(null);
  const lastRequestContentRef = useRef<string>("");

  const toggleEnabled = useCallback(() => {
    console.log("Toggling AI suggestions");
    setState((prev) => ({ ...prev, isEnabled: !prev.isEnabled }));
  }, []);

  const fetchSuggestion = useCallback(async (type: string, editor: any) => {
    console.log("Fetching AI suggestion...");
    
    if (!state.isEnabled) {
      console.warn("AI suggestions are disabled.");
      return;
    }

    if (!editor) {
      console.warn("Editor instance is not available.");
      return;
    }

    const model = editor.getModel();
    const cursorPosition = editor.getPosition();

    if (!model || !cursorPosition) {
      console.warn("Editor model or cursor position is not available.");
      return;
    }

    // Create a unique request ID to prevent duplicate requests
    const currentContent = model.getValue();
    const requestKey = `${currentContent}_${cursorPosition.lineNumber}_${cursorPosition.column}_${type}`;
    
    // Prevent duplicate requests
    if (pendingRequestRef.current === requestKey || state.isLoading) {
      console.log("Duplicate request prevented");
      return;
    }

    // Also prevent if content hasn't changed significantly
    if (lastRequestContentRef.current === currentContent && state.suggestion) {
      console.log("Content hasn't changed, skipping request");
      return;
    }

    pendingRequestRef.current = requestKey;
    lastRequestContentRef.current = currentContent;

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const payload = {
        fileContent: currentContent,
        cursorLine: cursorPosition.lineNumber - 1,
        cursorColumn: cursorPosition.column - 1,
        suggestionType: type,
      };
      console.log("Request payload:", payload);

      const response = await fetch("/api/code-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const data = await response.json();
      console.log("API response:", data);

      // Only update state if this is still the current request
      if (pendingRequestRef.current === requestKey) {
        if (data.suggestion) {
          const suggestionText = data.suggestion.trim();
          setState((prev) => ({
            ...prev,
            suggestion: suggestionText,
            position: {
              line: cursorPosition.lineNumber,
              column: cursorPosition.column,
            },
            isLoading: false,
          }));
        } else {
          console.warn("No suggestion received from API.");
          setState((prev) => ({ ...prev, isLoading: false, suggestion: null }));
        }
      }
    } catch (error) {
      console.error("Error fetching code suggestion:", error);
      if (pendingRequestRef.current === requestKey) {
        setState((prev) => ({ ...prev, isLoading: false, suggestion: null }));
      }
    } finally {
      if (pendingRequestRef.current === requestKey) {
        pendingRequestRef.current = null;
      }
    }
  }, [state.isEnabled, state.isLoading, state.suggestion]);

  const acceptSuggestion = useCallback((editor: any, monaco: any) => {
    setState((currentState) => {
      if (
        !currentState.suggestion ||
        !currentState.position ||
        !editor ||
        !monaco
      ) {
        return currentState;
      }

      const { line, column } = currentState.position;
      const sanitizedSuggestion = currentState.suggestion.replace(
        /^\d+:\s*/gm,
        ""
      );

      // Check if the suggestion is already at the cursor position to prevent duplicates
      const model = editor.getModel();
      const currentPosition = editor.getPosition();
      const textAtCursor = model.getValueInRange(
        new monaco.Range(
          currentPosition.lineNumber,
          currentPosition.column,
          currentPosition.lineNumber,
          currentPosition.column + sanitizedSuggestion.length
        )
      );

      if (textAtCursor === sanitizedSuggestion) {
        console.log("Suggestion already exists at cursor, not inserting");
        return {
          ...currentState,
          suggestion: null,
          position: null,
          decoration: [],
        };
      }

      editor.executeEdits("ai-suggestion", [
        {
          range: new monaco.Range(
            currentPosition.lineNumber,
            currentPosition.column,
            currentPosition.lineNumber,
            currentPosition.column
          ),
          text: sanitizedSuggestion,
          forceMoveMarkers: true,
        },
      ]);

      // Clear decorations
      if (editor && currentState.decoration.length > 0) {
        editor.deltaDecorations(currentState.decoration, []);
      }

      // Clear the request tracking
      pendingRequestRef.current = null;
      lastRequestContentRef.current = model.getValue();

      return {
        ...currentState,
        suggestion: null,
        position: null,
        decoration: [],
      };
    });
  }, []);

  const rejectSuggestion = useCallback((editor: any) => {
    setState((currentState) => {
      if (editor && currentState.decoration.length > 0) {
        editor.deltaDecorations(currentState.decoration, []);
      }
      
      // Clear the request tracking
      pendingRequestRef.current = null;
      
      return {
        ...currentState,
        suggestion: null,
        position: null,
        decoration: [],
      };
    });
  }, []);

  const clearSuggestion = useCallback((editor: any) => {
    setState((currentState) => {
      if (editor && currentState.decoration.length > 0) {
        editor.deltaDecorations(currentState.decoration, []);
      }
      
      // Clear the request tracking
      pendingRequestRef.current = null;
      
      return {
        ...currentState,
        suggestion: null,
        position: null,
        decoration: [],
      };
    });
  }, []);

  return {
    ...state,
    toggleEnabled,
    fetchSuggestion,
    acceptSuggestion,
    rejectSuggestion,
    clearSuggestion,
  };
};