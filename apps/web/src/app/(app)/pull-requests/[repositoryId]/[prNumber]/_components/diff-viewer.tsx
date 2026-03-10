"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
    PullRequestFile,
    PullRequestSuggestion,
} from "@services/pull-requests";
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    ColumnsIcon,
    FileIcon,
    RowsIcon,
} from "lucide-react";
import { cn } from "src/core/utils/components";

import { useReviewStore } from "./review-store";
import { SuggestionCard } from "./suggestion-card";

const PierrePatchDiff = lazy(() =>
    import("./pierre-diff").then((m) => ({
        default: m.PierrePatchDiffComponent,
    })),
);

interface DiffViewerProps {
    patchFiles?: PullRequestFile[];
    patchesLoading?: boolean;
    patchesError?: Error | null;
}

export function DiffViewer({
    patchFiles,
    patchesLoading,
    patchesError,
}: DiffViewerProps) {
    const { state, dispatch, fileGroups, filePaths, navigateFile } =
        useReviewStore();
    const [diffStyle, setDiffStyle] = useState<"split" | "unified">("split");

    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-select first file if none selected
    useEffect(() => {
        if (!state.selectedFilePath && filePaths.length > 0) {
            dispatch({ type: "SELECT_FILE", path: filePaths[0] });
        }
    }, [state.selectedFilePath, filePaths, dispatch]);

    // Scroll to top when file changes
    useEffect(() => {
        scrollRef.current?.scrollTo(0, 0);
    }, [state.selectedFilePath]);

    const currentSuggestions = useMemo(() => {
        if (!state.selectedFilePath) return [];
        const suggestions = fileGroups.get(state.selectedFilePath) ?? [];
        return suggestions.filter((s) => {
            if (
                state.severityFilter &&
                s.severity?.toLowerCase() !==
                    state.severityFilter.toLowerCase()
            )
                return false;
            if (
                state.categoryFilter &&
                s.label?.toLowerCase() !== state.categoryFilter.toLowerCase()
            )
                return false;
            return true;
        });
    }, [
        state.selectedFilePath,
        state.severityFilter,
        state.categoryFilter,
        fileGroups,
    ]);

    // Find the patch for current file
    const currentPatch = useMemo(() => {
        if (!state.selectedFilePath || !patchFiles) return null;
        return patchFiles.find(
            (f) =>
                f.filename === state.selectedFilePath ||
                f.filename.endsWith(state.selectedFilePath!),
        );
    }, [state.selectedFilePath, patchFiles]);

    const currentFileIndex = state.selectedFilePath
        ? filePaths.indexOf(state.selectedFilePath)
        : -1;

    if (filePaths.length === 0 && (!patchFiles || patchFiles.length === 0)) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="text-center">
                    <FileIcon className="mx-auto mb-3 size-10 text-text-tertiary/40" />
                    <p className="text-sm text-text-tertiary">
                        No changed files found for this pull request.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            {/* File header */}
            <div className="border-card-lv2 flex items-center gap-3 border-b bg-card-lv1 px-4 py-2.5">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => navigateFile("prev")}
                        className="rounded p-1 text-text-tertiary transition-colors hover:bg-card-lv3 hover:text-text-primary"
                        title="Previous file (k)">
                        <ChevronLeftIcon className="size-4" />
                    </button>
                    <button
                        onClick={() => navigateFile("next")}
                        className="rounded p-1 text-text-tertiary transition-colors hover:bg-card-lv3 hover:text-text-primary"
                        title="Next file (j)">
                        <ChevronRightIcon className="size-4" />
                    </button>
                </div>

                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <FileIcon className="size-4 shrink-0 text-text-tertiary" />
                    <FileBreadcrumb path={state.selectedFilePath ?? ""} />
                    {currentPatch && (
                        <div className="ml-2 flex items-center gap-1.5 text-xs">
                            <span className="text-success tabular-nums">
                                +{currentPatch.additions}
                            </span>
                            <span className="text-danger tabular-nums">
                                -{currentPatch.deletions}
                            </span>
                        </div>
                    )}
                </div>

                {/* View mode toggle */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setDiffStyle("split")}
                        className={cn(
                            "rounded p-1.5 transition-colors",
                            diffStyle === "split"
                                ? "bg-card-lv3 text-text-primary"
                                : "text-text-tertiary hover:text-text-secondary",
                        )}
                        title="Split view">
                        <ColumnsIcon className="size-3.5" />
                    </button>
                    <button
                        onClick={() => setDiffStyle("unified")}
                        className={cn(
                            "rounded p-1.5 transition-colors",
                            diffStyle === "unified"
                                ? "bg-card-lv3 text-text-primary"
                                : "text-text-tertiary hover:text-text-secondary",
                        )}
                        title="Unified view">
                        <RowsIcon className="size-3.5" />
                    </button>
                </div>

                <span className="shrink-0 text-xs tabular-nums text-text-tertiary">
                    {currentFileIndex + 1} / {filePaths.length}
                </span>
            </div>

            {/* Content area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
                {/* Full file diff from Git provider */}
                {currentPatch?.patch ? (
                    <Suspense
                        fallback={
                            <div className="flex items-center justify-center py-12">
                                <div className="size-5 animate-spin rounded-full border-2 border-text-tertiary/30 border-t-text-tertiary" />
                            </div>
                        }>
                        <PierrePatchDiff
                            patch={currentPatch.patch}
                            filename={currentPatch.filename}
                            previousFilename={currentPatch.previous_filename}
                            diffStyle={diffStyle}
                        />
                    </Suspense>
                ) : patchesLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="flex flex-col items-center gap-2">
                            <div className="size-5 animate-spin rounded-full border-2 border-text-tertiary/30 border-t-text-tertiary" />
                            <span className="text-xs text-text-tertiary">
                                Loading diff...
                            </span>
                        </div>
                    </div>
                ) : patchesError ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="text-center">
                            <p className="text-xs text-red-400">
                                Failed to load file diff
                            </p>
                            <p className="mt-1 text-[10px] text-text-tertiary">
                                {patchesError.message}
                            </p>
                        </div>
                    </div>
                ) : null}

                {/* Suggestions for this file */}
                {currentSuggestions.length > 0 && (
                    <div className="border-card-lv2 border-t">
                        <div className="flex items-center gap-2 px-4 py-2.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                                Kody Suggestions
                            </span>
                            <span className="rounded-full bg-card-lv3 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-text-tertiary">
                                {currentSuggestions.length}
                            </span>
                        </div>
                        <div className="space-y-3 px-4 pb-4">
                            {currentSuggestions.map((suggestion, idx) => (
                                <SuggestionCard
                                    key={suggestion.id ?? idx}
                                    suggestion={suggestion}
                                    compact
                                    defaultExpanded={
                                        currentSuggestions.length <= 3
                                    }
                                />
                            ))}
                        </div>
                    </div>
                )}

                {!currentPatch?.patch &&
                    !patchesLoading &&
                    currentSuggestions.length === 0 && (
                        <div className="py-12 text-center text-sm text-text-tertiary">
                            No diff or suggestions available for this file.
                        </div>
                    )}
            </div>
        </div>
    );
}

function FileBreadcrumb({ path }: { path: string }) {
    const parts = path.split("/");
    const fileName = parts.pop();
    const dirPath = parts.join("/");

    return (
        <span className="truncate font-mono text-sm">
            {dirPath && (
                <span className="text-text-tertiary">{dirPath}/</span>
            )}
            <span className="font-medium text-text-primary">{fileName}</span>
        </span>
    );
}
