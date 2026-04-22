export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type BYOKConfig = {
    model: string;
    apiKey: string;
    provider: string;
    baseURL?: string;
    temperature?: number;
    maxInputTokens?: number;
    maxConcurrentRequests?: number;
    maxOutputTokens?: number;
    reasoningEffort?: ReasoningEffort;
    /** Raw JSON override for provider-specific reasoning config.
     *  When set, takes precedence over reasoningEffort preset.
     *  Format: provider options object (e.g. {"budget_tokens": 25000}). */
    reasoningConfigOverride?: string;
    /** Pin OpenRouter requests to specific upstream providers (in order).
     *  Ignored when provider !== 'openrouter'. */
    openrouterProviderOrder?: string[];
    /** Allow OpenRouter to fall back to other upstreams when the preferred
     *  order is unavailable. Defaults to OpenRouter's default (true) when
     *  undefined; set to false to hard-fail if pinned providers are down. */
    openrouterAllowFallbacks?: boolean;
};
