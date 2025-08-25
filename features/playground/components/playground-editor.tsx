"use client";

import { useRef, useEffect, useCallback } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { TemplateFile } from "../types";
import {
  configureMonaco,
  defaultEditorOptions,
  getEditorLanguage,
} from "../lib/editor-config";

interface PlaygroundEditorProps {
  activeFile: TemplateFile | undefined;
  content: string;
  onContentChange: (value: string) => void;
  suggestion: string | null;
  suggestionLoading: boolean;
  suggestionPosition: { line: number; column: number } | null;
  onAcceptSuggestion: (editor: any, monaco: any) => void;
  onRejectSuggestion: (editor: any) => void;
  onTriggerSuggestion: (type: string, editor: any) => void;
}

export const PlaygroundEditor = ({
  activeFile,
  content,
  onContentChange,
  suggestion,
  suggestionLoading,
  suggestionPosition,
  onAcceptSuggestion,
  onRejectSuggestion,
  onTriggerSuggestion,
}: PlaygroundEditorProps) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const inlineCompletionProviderRef = useRef<any>(null);
  const currentSuggestionRef = useRef<{ text: string; id: string } | null>(
    null
  );
  const isAcceptingSuggestionRef = useRef(false);
  const suggestionAcceptedRef = useRef(false);
  const suggestionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Changed: Store disposables array instead of single command ref
  const disposablesRef = useRef<any[]>([]);
  const lastAcceptedSuggestionRef = useRef<string | null>(null);

  const generateSuggestionId = () =>
    `suggestion-${Date.now()}-${Math.random()}`;

  const createInlineCompletionProvider = useCallback(
    (monaco: Monaco) => ({
      provideInlineCompletions: () => {
        if (
          !suggestion ||
          isAcceptingSuggestionRef.current ||
          suggestionAcceptedRef.current
        ) {
          return { items: [] };
        }

        const suggestionId = generateSuggestionId();
        currentSuggestionRef.current = {
          text: suggestion,
          id: suggestionId,
        };

        const cleanSuggestion = suggestion.replace(/\r/g, "");

        return {
          items: [
            {
              insertText: cleanSuggestion,
              range: new monaco.Range(
                editorRef.current.getPosition().lineNumber,
                editorRef.current.getPosition().column,
                editorRef.current.getPosition().lineNumber,
                editorRef.current.getPosition().column
              ),
              kind: monaco.languages.CompletionItemKind.Snippet,
              label: "AI Suggestion",
              detail: "AI-generated suggestion",
              documentation: "Press Tab to accept",
              sortText: "0000",
              filterText: "",
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.KeepWhitespace,
            },
          ],
        };
      },
      freeInlineCompletions: () => {},
    }),
    [suggestion]
  );

  const clearCurrentSuggestion = useCallback(() => {
    currentSuggestionRef.current = null;
    suggestionAcceptedRef.current = false;
    if (editorRef.current) {
      editorRef.current.trigger("ai", "editor.action.inlineSuggest.hide", null);
    }
  }, []);

  const acceptCurrentSuggestion = useCallback(() => {
    if (
      !editorRef.current ||
      !monacoRef.current ||
      !currentSuggestionRef.current
    )
      return false;

    // Prevent duplicate acceptance
    if (isAcceptingSuggestionRef.current || suggestionAcceptedRef.current)
      return false;

    const suggestionText = currentSuggestionRef.current.text.replace(/\r/g, "");

    // Check if this suggestion was just accepted
    if (lastAcceptedSuggestionRef.current === suggestionText) {
      console.log("Suggestion already recently accepted, skipping");
      return false;
    }

    isAcceptingSuggestionRef.current = true;
    suggestionAcceptedRef.current = true;
    lastAcceptedSuggestionRef.current = suggestionText;

    try {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      const position = editor.getPosition();

      // Safety check: Prevent duplicate if already inserted
      const currentLineText = editor
        .getModel()
        .getLineContent(position.lineNumber);
      const textAfterCursor = currentLineText.substring(position.column - 1);

      if (textAfterCursor.startsWith(suggestionText)) {
        console.log("Suggestion already present at cursor position");
        clearCurrentSuggestion();
        return false;
      }

      // Check if suggestion is already in the model at cursor
      const modelTextAtCursor = editor
        .getModel()
        .getValueInRange(
          new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            Math.min(
              position.column + suggestionText.length,
              currentLineText.length + 1
            )
          )
        );

      if (modelTextAtCursor === suggestionText) {
        console.log("Suggestion already inserted at cursor");
        clearCurrentSuggestion();
        return false;
      }

      const range = new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column
      );

      // Use executeEdits with a unique source
      const editId = `ai-suggestion-${Date.now()}`;
      editor.executeEdits(editId, [
        { range, text: suggestionText, forceMoveMarkers: true },
      ]);

      // Calculate new cursor position
      const lines = suggestionText.split("\n");
      const endLine = position.lineNumber + lines.length - 1;
      const endColumn =
        lines.length === 1
          ? position.column + suggestionText.length
          : lines[lines.length - 1].length + 1;

      editor.setPosition({ lineNumber: endLine, column: endColumn });

      clearCurrentSuggestion();
      onAcceptSuggestion(editor, monaco);

      // Clear the last accepted reference after a delay
      setTimeout(() => {
        lastAcceptedSuggestionRef.current = null;
      }, 2000);

      return true;
    } catch (e) {
      console.error("Error accepting suggestion", e);
      return false;
    } finally {
      isAcceptingSuggestionRef.current = false;
      // Keep suggestionAcceptedRef true for longer to prevent immediate re-acceptance
      setTimeout(() => {
        suggestionAcceptedRef.current = false;
      }, 1500);
    }
  }, [onAcceptSuggestion, clearCurrentSuggestion]);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;

    // Clean up previous provider
    if (inlineCompletionProviderRef.current) {
      inlineCompletionProviderRef.current.dispose();
      inlineCompletionProviderRef.current = null;
    }

    currentSuggestionRef.current = null;

    if (suggestion) {
      const language = getEditorLanguage(activeFile?.fileExtension || "");
      const provider = createInlineCompletionProvider(monacoRef.current);

      inlineCompletionProviderRef.current =
        monacoRef.current.languages.registerInlineCompletionsProvider(
          language,
          provider
        );

      // Trigger inline suggestion with a slight delay
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.trigger(
            "ai",
            "editor.action.inlineSuggest.trigger",
            null
          );
        }
      }, 100);
    }

    return () => {
      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose();
        inlineCompletionProviderRef.current = null;
      }
    };
  }, [suggestion, activeFile, createInlineCompletionProvider]);

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    configureMonaco(monaco);

    editor.updateOptions({
      ...defaultEditorOptions,
      inlineSuggest: {
        enabled: true,
        showToolbar: "onHover",
      },
      suggest: {
        preview: false,
        showInlineDetails: true,
      },
      quickSuggestions: { other: true, comments: false, strings: false },
      cursorSmoothCaretAnimation: "on",
    });

    // Clear previous disposables
    disposablesRef.current.forEach((disposable) => {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    });
    disposablesRef.current = [];

    // Override Tab key behavior - addCommand returns a disposable
    const tabCommand = editor.addCommand(
      monaco.KeyCode.Tab,
      () => {
        // If we're already accepting a suggestion, ignore
        if (isAcceptingSuggestionRef.current) {
          return;
        }

        // If there's a current suggestion, try to accept it
        if (currentSuggestionRef.current && !suggestionAcceptedRef.current) {
          const accepted = acceptCurrentSuggestion();
          if (accepted) {
            return; // Don't execute default tab behavior
          }
        }

        // Default tab behavior
        editor.trigger("keyboard", "tab", null);
      },
      // Override default tab behavior when we have suggestions
      "acceptSuggestion"
    );

    // Escape key to reject suggestion
    const escapeCommand = editor.addCommand(monaco.KeyCode.Escape, () => {
      if (currentSuggestionRef.current) {
        onRejectSuggestion(editor);
        clearCurrentSuggestion();
      }
    });

    // Store disposables (Monaco commands are typically disposable objects)
    if (tabCommand && typeof tabCommand.dispose === "function") {
      disposablesRef.current.push(tabCommand);
    }
    if (escapeCommand && typeof escapeCommand.dispose === "function") {
      disposablesRef.current.push(escapeCommand);
    }

    // Cursor position change handler
    const cursorPositionDisposable = editor.onDidChangeCursorPosition(() => {
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current);
      }

      if (
        !isAcceptingSuggestionRef.current &&
        !suggestionLoading &&
        !currentSuggestionRef.current
      ) {
        suggestionTimeoutRef.current = setTimeout(() => {
          onTriggerSuggestion("completion", editor);
        }, 300);
      }
    });

    // Content change handler
    const contentChangeDisposable = editor.onDidChangeModelContent((e: any) => {
      // Ignore changes we're making ourselves
      if (isAcceptingSuggestionRef.current) return;

      // Clear suggestions on manual edits (unless it's our suggestion being applied)
      if (
        currentSuggestionRef.current &&
        !suggestionAcceptedRef.current &&
        e.changes.length > 0
      ) {
        const change = e.changes[0];
        const changeText = change.text.replace(/\r/g, "");
        const suggestionText = currentSuggestionRef.current.text.replace(
          /\r/g,
          ""
        );

        // If the change matches our suggestion, don't clear it
        if (
          changeText === suggestionText ||
          changeText === suggestionText.substring(0, changeText.length)
        ) {
          return;
        }

        clearCurrentSuggestion();
      }

      // Trigger new suggestions on certain characters
      const triggers = ["\n", "{", ".", "=", "(", ",", ":", ";"];
      if (e.changes.length > 0 && triggers.includes(e.changes[0].text)) {
        setTimeout(() => {
          if (
            editorRef.current &&
            !currentSuggestionRef.current &&
            !suggestionLoading
          ) {
            onTriggerSuggestion("completion", editorRef.current);
          }
        }, 150);
      }
    });

    // Store event disposables
    disposablesRef.current.push(
      cursorPositionDisposable,
      contentChangeDisposable
    );

    updateEditorLanguage();
  };

  const updateEditorLanguage = () => {
    if (!activeFile || !editorRef.current || !monacoRef.current) return;
    const language = getEditorLanguage(activeFile.fileExtension || "");
    try {
      monacoRef.current.editor.setModelLanguage(
        editorRef.current.getModel(),
        language
      );
    } catch (e) {
      console.warn("Failed to switch language", e);
    }
  };

  useEffect(() => {
    updateEditorLanguage();
  }, [activeFile]);

  // Fixed cleanup effect
  useEffect(() => {
    return () => {
      // Clear timeout
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current);
      }

      // Dispose inline completion provider
      if (inlineCompletionProviderRef.current) {
        try {
          inlineCompletionProviderRef.current.dispose();
        } catch (e) {
          console.warn("Error disposing inline completion provider:", e);
        }
      }

      // Dispose all stored disposables
      disposablesRef.current.forEach((disposable) => {
        if (disposable && typeof disposable.dispose === "function") {
          try {
            disposable.dispose();
          } catch (e) {
            console.warn("Error disposing editor resource:", e);
          }
        }
      });
      disposablesRef.current = [];
    };
  }, []);

  return (
    <div className="h-full relative">
      {suggestionLoading && (
        <div className="absolute top-2 right-2 z-10 bg-red-100 dark:bg-red-900 px-2 py-1 rounded text-xs text-red-700 dark:text-red-300 flex items-center gap-1">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
          AI thinking...
        </div>
      )}

      {currentSuggestionRef.current && !suggestionLoading && (
        <div className="absolute top-2 right-2 z-10 bg-green-100 dark:bg-green-900 px-2 py-1 rounded text-xs text-green-700 dark:text-green-300 flex items-center gap-1">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          Press Tab to accept AI suggestion
        </div>
      )}

      <Editor
        height="100%"
        value={content}
        onChange={(value) => onContentChange(value || "")}
        onMount={handleEditorDidMount}
        language={
          activeFile
            ? getEditorLanguage(activeFile.fileExtension || "")
            : "plaintext"
        }
        options={defaultEditorOptions}
      />
    </div>
  );
};
