import { createLogger } from '@kodus/flow';
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SessionEventRepository } from '@libs/cli-review/infrastructure/repositories/session-event.repository';
import { ClassifySessionUseCase } from '@libs/cli-review/application/use-cases/classify-session.use-case';

const INACTIVITY_THRESHOLD_MINUTES = 30;
const BATCH_LIMIT = 10;
const CONCURRENCY = 3;

const API_CRON_CLASSIFY_ORPHANED_SESSIONS =
    process.env.API_CRON_CLASSIFY_ORPHANED_SESSIONS || '0 */15 * * * *';

@Injectable()
export class ClassifyOrphanedSessionsCronProvider {
    private readonly logger = createLogger(
        ClassifyOrphanedSessionsCronProvider.name,
    );

    constructor(
        private readonly sessionEventRepository: SessionEventRepository,
        private readonly classifySessionUseCase: ClassifySessionUseCase,
    ) {}

    @Cron(API_CRON_CLASSIFY_ORPHANED_SESSIONS, {
        name: 'Classify Orphaned Sessions',
        timeZone: 'America/Sao_Paulo',
    })
    async handleCron() {
        try {
            const orphaned =
                await this.sessionEventRepository.findOrphanedSessions(
                    INACTIVITY_THRESHOLD_MINUTES,
                    BATCH_LIMIT,
                );

            if (!orphaned.length) {
                return;
            }

            this.logger.log({
                message: `Found ${orphaned.length} orphaned session(s) to classify`,
                context: ClassifyOrphanedSessionsCronProvider.name,
                metadata: {
                    sessionIds: orphaned.map((s) => s.sessionId),
                },
            });

            let succeeded = 0;
            let failed = 0;

            // Process in chunks to balance throughput vs memory
            for (let i = 0; i < orphaned.length; i += CONCURRENCY) {
                const chunk = orphaned.slice(i, i + CONCURRENCY);
                const results = await Promise.allSettled(
                    chunk.map((session) =>
                        this.classifyOrphanedSession(session),
                    ),
                );

                for (const result of results) {
                    if (result.status === 'fulfilled') {
                        succeeded++;
                    } else {
                        failed++;
                        this.logger.error({
                            message: 'Failed to classify orphaned session',
                            context:
                                ClassifyOrphanedSessionsCronProvider.name,
                            error: result.reason,
                        });
                    }
                }
            }

            this.logger.log({
                message: 'Orphaned sessions classification completed',
                context: ClassifyOrphanedSessionsCronProvider.name,
                metadata: {
                    total: orphaned.length,
                    succeeded,
                    failed,
                },
            });
        } catch (error) {
            this.logger.error({
                message: 'Error in orphaned sessions classification cron',
                context: ClassifyOrphanedSessionsCronProvider.name,
                error,
            });
        }
    }

    private async classifyOrphanedSession(session: {
        sessionId: string;
        organizationId: string;
        teamId: string;
        branch: string;
        lastEventTimestamp: Date;
    }): Promise<void> {
        // Insert a synthetic session_end event so the classify pipeline works unchanged
        const syntheticEnd = await this.sessionEventRepository.create({
            organizationId: session.organizationId,
            teamId: session.teamId,
            sessionId: session.sessionId,
            type: 'session_end',
            branch: session.branch,
            eventTimestamp: session.lastEventTimestamp,
            payload: {
                synthetic: true,
                reason: 'orphaned_session_timeout',
                inactivityMinutes: INACTIVITY_THRESHOLD_MINUTES,
            },
        });

        await this.classifySessionUseCase.execute(syntheticEnd.uuid);
    }
}
