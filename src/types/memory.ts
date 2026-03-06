export type DecisionType =
    | 'architectural_decision'
    | 'business_rule'
    | 'tradeoff'
    | 'deferral'
    | 'task'
    | 'convention';

export interface DecisionEntry {
    id: string;
    type: DecisionType;
    title: string;
    rationale: string;
    scope: {
        files: string[];
        modules: string[];
    };
    source: {
        agent: string;
        event: string;
        session?: string;
        sha?: string;
        branch: string;
    };
    createdAt: string;
}

export interface TranscriptSignals {
    sessionId?: string;
    turnId?: string;
    prompt?: string;
    assistantMessage?: string;
    modifiedFiles: string[];
    toolUses: ToolUseSignal[];
}

export interface ToolUseSignal {
    tool: string;
    filePath?: string;
    summary?: string;
}

export interface PrMemoryMeta {
    branch: string;
    createdAt: string;
    updatedAt: string;
    lastSha: string;
    agent: string;
    sessionCount: number;
}

export interface ModuleConfig {
    id: string;
    name: string;
    paths: string[];
    memoryFile: string;
}

export interface ModulesYml {
    version: number;
    modules: ModuleConfig[];
}

export interface MemoryCaptureInput {
    repoRoot: string;
    headSha: string | null;
    agent: string;
    event: string;
    branch: string;
    payload?: unknown;
    summary?: string;
}

export interface MemoryCaptureApiRequest {
    branch: string;
    sha: string | null;
    orgRepo: string | null;
    agent: string;
    event: string;
    signals: {
        sessionId?: string;
        turnId?: string;
        prompt?: string;
        assistantMessage?: string;
        modifiedFiles: string[];
        toolUses: Array<{ tool: string; filePath?: string; summary?: string }>;
    };
    summary?: string;
    capturedAt: string;
}

export interface MemoryCaptureApiResponse {
    id: string;
    accepted: boolean;
}
