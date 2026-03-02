import { fetchTaskContext } from '@libs/agents/skills/capabilities/task-context-read';
import {
    SkillCapabilityRuntimeConfig,
    ToolCaller,
} from '@libs/agents/skills/runtime/skill-runtime.types';

function createCapabilityRuntime(providerType = 'external'): SkillCapabilityRuntimeConfig {
    return {
        capabilities: ['task.context.read'],
        allowedTools: ['searchTasks', 'getIssue', 'editTask'],
        capabilityToolMap: {
            'task.context.read': ['searchTasks', 'getIssue'],
        },
        fetcherPolicy: {
            toolMode: 'any',
            allowWithoutTools: false,
        },
        providerType,
        allProviderTypes: [providerType],
    };
}

function createBaseParams() {
    return {
        skillName: 'business-rules-validation',
        organizationId: 'org-1',
        teamId: 'team-1',
        userQuestion: '@kody TASK-1',
        pullRequestDescription: 'Related to TASK-1',
        prBody: 'PR text TASK-1',
        taskContextResolutionMode: 'cache_first' as const,
        enableAgenticFallback: true,
    };
}

describe('fetchTaskContext capability', () => {
    it('resolves context deterministically and respects seeded boundary', async () => {
        const callTool = jest.fn<ToolCaller['callTool']>().mockResolvedValue({
            result: {
                data: {
                    key: 'TASK-1',
                    fields: {
                        summary: 'Task title',
                        description: 'Task description',
                    },
                },
            },
        });

        const toolCaller: ToolCaller = {
            callTool,
            getRegisteredTools: () => [
                { name: 'searchTasks' },
                { name: 'editTask' },
            ],
            getToolsForLLM: () => [
                {
                    name: 'searchTasks',
                    parameters: {
                        required: ['query'],
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Search query',
                            },
                        },
                    },
                },
            ],
        };

        const hooks = {
            getSeedTaskContextTools: jest.fn(async () => ['searchTasks']),
            getCachedTaskContextTools: jest.fn(async () => []),
            saveCachedTaskContextTools: jest.fn(async () => undefined),
            resolvePreferredTool: jest.fn(async () => undefined),
            recordExecution: jest.fn(async () => undefined),
        };

        const result = await fetchTaskContext(
            toolCaller,
            createCapabilityRuntime('linear'),
            createBaseParams(),
            hooks,
        );

        expect(result.normalized).toMatchObject({
            id: 'TASK-1',
            title: 'Task title',
            description: 'Task description',
            sourceProvider: 'linear',
        });
        expect(result.traces.some((trace) => trace.status === 'success')).toBe(
            true,
        );
        expect(callTool).toHaveBeenCalled();
        expect(
            callTool.mock.calls.some(([toolName]) => toolName === 'editTask'),
        ).toBe(false);
    });

    it('falls back to agent when deterministic candidates are empty', async () => {
        const callAgent = jest
            .fn<ToolCaller['callAgent']>()
            .mockResolvedValue({
                result: JSON.stringify({
                    taskContext: 'Agent context',
                    title: 'Agent title',
                    id: 'AG-1',
                    toolsUsed: ['search'],
                }),
            });

        const toolCaller: ToolCaller = {
            callTool: jest.fn(),
            callAgent,
            getRegisteredTools: () => [{ name: 'searchTasks' }],
            getToolsForLLM: () => [],
        };

        const hooks = {
            getSeedTaskContextTools: jest.fn(async () => []),
            getCachedTaskContextTools: jest.fn(async () => []),
            saveCachedTaskContextTools: jest.fn(async () => undefined),
            resolvePreferredTool: jest.fn(async () => undefined),
            recordExecution: jest.fn(async () => undefined),
        };

        const result = await fetchTaskContext(
            toolCaller,
            createCapabilityRuntime('notion'),
            {
                ...createBaseParams(),
                taskContextResolutionMode: 'agent_first',
            },
            hooks,
        );

        expect(result.normalized).toMatchObject({
            id: 'AG-1',
            title: 'Agent title',
            description: 'Agent context',
            sourceProvider: 'notion',
        });
        expect(callAgent).toHaveBeenCalled();
        expect(
            result.traces.some(
                (trace) => trace.mode === 'agentic' && trace.status === 'success',
            ),
        ).toBe(true);
    });

    it('skips when no deterministic candidates and agent fallback disabled', async () => {
        const toolCaller: ToolCaller = {
            callTool: jest.fn(),
            getRegisteredTools: () => [{ name: 'searchTasks' }],
            getToolsForLLM: () => [],
        };

        const hooks = {
            getSeedTaskContextTools: jest.fn(async () => []),
            getCachedTaskContextTools: jest.fn(async () => []),
            saveCachedTaskContextTools: jest.fn(async () => undefined),
            resolvePreferredTool: jest.fn(async () => undefined),
            recordExecution: jest.fn(async () => undefined),
        };

        const result = await fetchTaskContext(
            toolCaller,
            createCapabilityRuntime(),
            {
                ...createBaseParams(),
                enableAgenticFallback: false,
            },
            hooks,
        );

        expect(result.normalized).toBeUndefined();
        expect(result.traces).toHaveLength(1);
        expect(result.traces[0]).toMatchObject({
            status: 'skipped',
            reason: 'no_candidate_tools',
            capability: 'task.context.read',
        });
    });

    it('avoids deterministic execution when required schema is non-string and uses agent fallback', async () => {
        const callTool = jest.fn<ToolCaller['callTool']>();
        const callAgent = jest
            .fn<ToolCaller['callAgent']>()
            .mockResolvedValue({
                result: JSON.stringify({
                    taskContext: 'Fallback context',
                    toolsUsed: ['search'],
                }),
            });

        const toolCaller: ToolCaller = {
            callTool,
            callAgent,
            getRegisteredTools: () => [{ name: 'searchTasks' }],
            getToolsForLLM: () => [
                {
                    name: 'searchTasks',
                    parameters: {
                        required: ['issue'],
                        properties: {
                            issue: {
                                type: 'object',
                                description: 'Complex object payload',
                            },
                        },
                    },
                },
            ],
        };

        const hooks = {
            getSeedTaskContextTools: jest.fn(async () => ['searchTasks']),
            getCachedTaskContextTools: jest.fn(async () => []),
            saveCachedTaskContextTools: jest.fn(async () => undefined),
            resolvePreferredTool: jest.fn(async () => undefined),
            recordExecution: jest.fn(async () => undefined),
        };

        const result = await fetchTaskContext(
            toolCaller,
            createCapabilityRuntime('clickup'),
            createBaseParams(),
            hooks,
        );

        expect(callTool).not.toHaveBeenCalled();
        expect(callAgent).toHaveBeenCalled();
        expect(result.normalized?.description).toBe('Fallback context');
    });

    it('extracts task context from provider payload embedded as JSON text content', async () => {
        const callTool = jest.fn<ToolCaller['callTool']>().mockResolvedValue({
            result: {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            id: 'PAGE-42',
                            properties: {
                                Name: {
                                    title: [{ plain_text: 'Notion Task Title' }],
                                },
                                'Acceptance Criteria': {
                                    rich_text: [{ plain_text: 'Must support flow X' }],
                                },
                            },
                            description: {
                                rich_text: [{ plain_text: 'Detailed context from provider' }],
                            },
                            url: 'https://example.notion.site/PAGE-42',
                        }),
                    },
                ],
            },
        });

        const toolCaller: ToolCaller = {
            callTool,
            getRegisteredTools: () => [{ name: 'searchTasks' }],
            getToolsForLLM: () => [
                {
                    name: 'searchTasks',
                    parameters: {
                        required: ['query'],
                        properties: {
                            query: { type: 'string', description: 'Search query' },
                        },
                    },
                },
            ],
        };

        const hooks = {
            getSeedTaskContextTools: jest.fn(async () => ['searchTasks']),
            getCachedTaskContextTools: jest.fn(async () => []),
            saveCachedTaskContextTools: jest.fn(async () => undefined),
            resolvePreferredTool: jest.fn(async () => undefined),
            recordExecution: jest.fn(async () => undefined),
        };

        const result = await fetchTaskContext(
            toolCaller,
            createCapabilityRuntime('notion'),
            createBaseParams(),
            hooks,
        );

        expect(result.normalized).toMatchObject({
            id: 'PAGE-42',
            title: 'Notion Task Title',
            description: 'Detailed context from provider',
            acceptanceCriteria: ['Must support flow X'],
            sourceProvider: 'notion',
        });
    });

    it('does not crash when provider payload contains empty objects in text fields', async () => {
        const callTool = jest.fn<ToolCaller['callTool']>().mockResolvedValue({
            result: {
                data: {
                    key: 'TASK-2',
                    fields: {
                        summary: 'Task title',
                        description: {},
                    },
                },
            },
        });

        const toolCaller: ToolCaller = {
            callTool,
            getRegisteredTools: () => [{ name: 'searchTasks' }],
            getToolsForLLM: () => [
                {
                    name: 'searchTasks',
                    parameters: {
                        required: ['query'],
                        properties: {
                            query: { type: 'string', description: 'Search query' },
                        },
                    },
                },
            ],
        };

        const hooks = {
            getSeedTaskContextTools: jest.fn(async () => ['searchTasks']),
            getCachedTaskContextTools: jest.fn(async () => []),
            saveCachedTaskContextTools: jest.fn(async () => undefined),
            resolvePreferredTool: jest.fn(async () => undefined),
            recordExecution: jest.fn(async () => undefined),
        };

        const result = await fetchTaskContext(
            toolCaller,
            createCapabilityRuntime('linear'),
            createBaseParams(),
            hooks,
        );

        expect(result.normalized).toMatchObject({
            id: 'TASK-2',
            title: 'Task title',
            sourceProvider: 'linear',
        });
    });

    it('continues to the next deterministic tool when Jira issue details only contain smart-link metadata', async () => {
        const callTool = jest
            .fn<ToolCaller['callTool']>()
            .mockImplementation((toolName: string) => {
                if (toolName === 'getJiraIssue') {
                    return Promise.resolve({
                        result: {
                            data: {
                                key: 'KC-1441',
                                fields: {
                                    summary: 'Extension application link',
                                    description: {
                                        type: 'doc',
                                        version: 1,
                                        content: [
                                            {
                                                type: 'paragraph',
                                                content: [
                                                    {
                                                        type: 'inlineCard',
                                                        attrs: {
                                                            url: 'https://example.atlassian.net/wiki/spaces/EXT/pages/123',
                                                        },
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    });
                }

                if (toolName === 'search') {
                    return Promise.resolve({
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify({
                                        id: 'KC-1441',
                                        title: 'Extension application link',
                                        description:
                                            'The extension must open the Atlassian app link in a webview and validate unsupported hosts.',
                                        acceptanceCriteria: [
                                            'Open supported Atlassian links inside the extension',
                                            'Reject unsupported hosts with a clear message',
                                        ],
                                    }),
                                },
                            ],
                        },
                    });
                }

                return Promise.resolve({ result: {} });
            });

        const toolCaller: ToolCaller = {
            callTool,
            getRegisteredTools: () => [
                { name: 'getJiraIssue' },
                { name: 'search' },
            ],
            getToolsForLLM: () => [
                {
                    name: 'getJiraIssue',
                    parameters: {
                        required: ['cloudId', 'issueIdOrKey'],
                        properties: {
                            cloudId: {
                                type: 'string',
                                description: 'Cloud ID or site URL',
                            },
                            issueIdOrKey: {
                                type: 'string',
                                description: 'Issue ID or key',
                            },
                        },
                    },
                },
                {
                    name: 'search',
                    parameters: {
                        required: ['query'],
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Search query',
                            },
                        },
                    },
                },
            ],
        };

        const hooks = {
            getSeedTaskContextTools: jest.fn(async () => [
                'getJiraIssue',
                'search',
            ]),
            getCachedTaskContextTools: jest.fn(async () => []),
            saveCachedTaskContextTools: jest.fn(async () => undefined),
            resolvePreferredTool: jest.fn(async () => undefined),
            recordExecution: jest.fn(async () => undefined),
        };

        const result = await fetchTaskContext(
            toolCaller,
            createCapabilityRuntime('jira'),
            {
                ...createBaseParams(),
                userQuestion:
                    '@kody -v business-logic https://kodustech.atlassian.net/jira/software/c/projects/KC/boards/2?selectedIssue=KC-1441',
                pullRequestDescription:
                    'Related to https://kodustech.atlassian.net/jira/software/c/projects/KC/boards/2?selectedIssue=KC-1441',
            },
            hooks,
        );

        const calledTools = callTool.mock.calls.map(([toolName]) => toolName);
        expect(calledTools[0]).toBe('getJiraIssue');
        expect(calledTools).toContain('search');
        expect(result.normalized).toMatchObject({
            id: 'KC-1441',
            title: 'Extension application link',
            description:
                'The extension must open the Atlassian app link in a webview and validate unsupported hosts.',
            acceptanceCriteria: [
                'Open supported Atlassian links inside the extension',
                'Reject unsupported hosts with a clear message',
            ],
            sourceProvider: 'jira',
        });
    });
});
