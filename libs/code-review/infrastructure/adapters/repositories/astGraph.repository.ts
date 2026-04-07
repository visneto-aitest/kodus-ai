import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { AstNodeModel } from './schemas/astNode.model';
import { AstEdgeModel } from './schemas/astEdge.model';

// ---------------------------------------------------------------------------
// JSON interfaces matching kodus-graph's GraphInputSchema (snake_case)
// ---------------------------------------------------------------------------

export interface GraphNodeJson {
    kind: string;
    name: string;
    qualified_name: string;
    file_path: string;
    line_start: number;
    line_end: number;
    language: string;
    is_test: boolean;
    file_hash: string;
    parent_name?: string;
    params?: string;
    return_type?: string;
    modifiers?: string;
}

export interface GraphEdgeJson {
    kind: string;
    source_qualified: string;
    target_qualified: string;
    file_path: string;
    line: number;
    confidence?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BULK_CHUNK_SIZE = 1000;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class AstGraphRepository {
    constructor(
        @InjectRepository(AstNodeModel)
        private readonly nodeRepo: Repository<AstNodeModel>,
        @InjectRepository(AstEdgeModel)
        private readonly edgeRepo: Repository<AstEdgeModel>,
        private readonly dataSource: DataSource,
    ) {}

    // -----------------------------------------------------------------------
    // Delete helpers
    // -----------------------------------------------------------------------

    /**
     * Delete all nodes and edges for a repository.
     */
    async deleteAll(repoId: string): Promise<void> {
        await this.edgeRepo.delete({ repoId });
        await this.nodeRepo.delete({ repoId });
    }

    /**
     * Delete nodes and edges for specific file paths within a repository.
     */
    async deleteByFiles(
        repoId: string,
        filePaths: string[],
    ): Promise<void> {
        if (filePaths.length === 0) return;

        await this.edgeRepo.delete({ repoId, filePath: In(filePaths) });
        await this.nodeRepo.delete({ repoId, filePath: In(filePaths) });
    }

    // -----------------------------------------------------------------------
    // Bulk insert helpers
    // -----------------------------------------------------------------------

    /**
     * Bulk insert nodes in chunks of 1000.
     * Uses orIgnore() to skip duplicates (same repo + qualifiedName).
     * Returns the total number of rows inserted.
     */
    async bulkInsertNodes(
        repoId: string,
        nodes: GraphNodeJson[],
    ): Promise<number> {
        if (nodes.length === 0) return 0;

        let inserted = 0;

        for (let i = 0; i < nodes.length; i += BULK_CHUNK_SIZE) {
            const chunk = nodes.slice(i, i + BULK_CHUNK_SIZE);

            const values = chunk.map((n) => ({
                repoId,
                kind: n.kind,
                name: n.name,
                qualifiedName: n.qualified_name,
                filePath: n.file_path,
                lineStart: n.line_start,
                lineEnd: n.line_end,
                language: n.language,
                parentName: n.parent_name ?? null,
                params: n.params ?? null,
                returnType: n.return_type ?? null,
                modifiers: n.modifiers ?? null,
                isTest: n.is_test,
                fileHash: n.file_hash,
            }));

            const result = await this.nodeRepo
                .createQueryBuilder()
                .insert()
                .into(AstNodeModel)
                .values(values)
                .orIgnore()
                .execute();

            inserted +=
                result.identifiers?.length ?? chunk.length;
        }

        return inserted;
    }

    /**
     * Bulk insert edges in chunks of 1000.
     * Uses orIgnore() to skip duplicates (same repo + kind + source + target).
     * Returns the total number of rows inserted.
     */
    async bulkInsertEdges(
        repoId: string,
        edges: GraphEdgeJson[],
    ): Promise<number> {
        if (edges.length === 0) return 0;

        let inserted = 0;

        for (let i = 0; i < edges.length; i += BULK_CHUNK_SIZE) {
            const chunk = edges.slice(i, i + BULK_CHUNK_SIZE);

            const values = chunk.map((e) => ({
                repoId,
                kind: e.kind,
                sourceQualified: e.source_qualified,
                targetQualified: e.target_qualified,
                filePath: e.file_path,
                line: e.line,
                confidence: e.confidence ?? null,
            }));

            const result = await this.edgeRepo
                .createQueryBuilder()
                .insert()
                .into(AstEdgeModel)
                .values(values)
                .orIgnore()
                .execute();

            inserted +=
                result.identifiers?.length ?? chunk.length;
        }

        return inserted;
    }

    // -----------------------------------------------------------------------
    // Transactional operations
    // -----------------------------------------------------------------------

    /**
     * Full rebuild: delete all existing data and insert everything in a single
     * transaction.
     */
    async fullRebuild(
        repoId: string,
        nodes: GraphNodeJson[],
        edges: GraphEdgeJson[],
    ): Promise<{ nodeCount: number; edgeCount: number }> {
        return this.dataSource.transaction(async (manager) => {
            // Delete existing data (edges first due to potential FK)
            await manager.delete(AstEdgeModel, { repoId });
            await manager.delete(AstNodeModel, { repoId });

            // Insert nodes in chunks
            let nodeCount = 0;
            for (let i = 0; i < nodes.length; i += BULK_CHUNK_SIZE) {
                const chunk = nodes.slice(i, i + BULK_CHUNK_SIZE);
                const values = chunk.map((n) => this.mapNodeToEntity(repoId, n));

                const result = await manager
                    .createQueryBuilder()
                    .insert()
                    .into(AstNodeModel)
                    .values(values)
                    .orIgnore()
                    .execute();

                nodeCount += result.identifiers?.length ?? chunk.length;
            }

            // Insert edges in chunks
            let edgeCount = 0;
            for (let i = 0; i < edges.length; i += BULK_CHUNK_SIZE) {
                const chunk = edges.slice(i, i + BULK_CHUNK_SIZE);
                const values = chunk.map((e) => this.mapEdgeToEntity(repoId, e));

                const result = await manager
                    .createQueryBuilder()
                    .insert()
                    .into(AstEdgeModel)
                    .values(values)
                    .orIgnore()
                    .execute();

                edgeCount += result.identifiers?.length ?? chunk.length;
            }

            return { nodeCount, edgeCount };
        });
    }

    /**
     * Incremental update: delete nodes/edges for the given file paths, then
     * insert the new data — all in a single transaction.
     */
    async incrementalUpdate(
        repoId: string,
        filePaths: string[],
        nodes: GraphNodeJson[],
        edges: GraphEdgeJson[],
    ): Promise<{ nodeCount: number; edgeCount: number }> {
        return this.dataSource.transaction(async (manager) => {
            // Delete stale data for affected files
            if (filePaths.length > 0) {
                await manager.delete(AstEdgeModel, {
                    repoId,
                    filePath: In(filePaths),
                });
                await manager.delete(AstNodeModel, {
                    repoId,
                    filePath: In(filePaths),
                });
            }

            // Insert nodes in chunks
            let nodeCount = 0;
            for (let i = 0; i < nodes.length; i += BULK_CHUNK_SIZE) {
                const chunk = nodes.slice(i, i + BULK_CHUNK_SIZE);
                const values = chunk.map((n) => this.mapNodeToEntity(repoId, n));

                const result = await manager
                    .createQueryBuilder()
                    .insert()
                    .into(AstNodeModel)
                    .values(values)
                    .orIgnore()
                    .execute();

                nodeCount += result.identifiers?.length ?? chunk.length;
            }

            // Insert edges in chunks
            let edgeCount = 0;
            for (let i = 0; i < edges.length; i += BULK_CHUNK_SIZE) {
                const chunk = edges.slice(i, i + BULK_CHUNK_SIZE);
                const values = chunk.map((e) => this.mapEdgeToEntity(repoId, e));

                const result = await manager
                    .createQueryBuilder()
                    .insert()
                    .into(AstEdgeModel)
                    .values(values)
                    .orIgnore()
                    .execute();

                edgeCount += result.identifiers?.length ?? chunk.length;
            }

            return { nodeCount, edgeCount };
        });
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------

    /**
     * Export the full graph from the DB in kodus-graph's JSON format
     * (snake_case field names).
     */
    async exportAsGraphJson(
        repoId: string,
    ): Promise<{ nodes: GraphNodeJson[]; edges: GraphEdgeJson[] }> {
        const [dbNodes, dbEdges] = await Promise.all([
            this.nodeRepo.find({ where: { repoId } }),
            this.edgeRepo.find({ where: { repoId } }),
        ]);

        const nodes: GraphNodeJson[] = dbNodes.map((n) => ({
            kind: n.kind,
            name: n.name,
            qualified_name: n.qualifiedName,
            file_path: n.filePath,
            line_start: n.lineStart ?? 0,
            line_end: n.lineEnd ?? 0,
            language: n.language ?? '',
            is_test: n.isTest,
            file_hash: n.fileHash ?? '',
            ...(n.parentName && { parent_name: n.parentName }),
            ...(n.params && { params: n.params }),
            ...(n.returnType && { return_type: n.returnType }),
            ...(n.modifiers && { modifiers: n.modifiers }),
        }));

        const edges: GraphEdgeJson[] = dbEdges.map((e) => ({
            kind: e.kind,
            source_qualified: e.sourceQualified,
            target_qualified: e.targetQualified,
            file_path: e.filePath,
            line: e.line,
            ...(e.confidence != null && { confidence: e.confidence }),
        }));

        return { nodes, edges };
    }

    // -----------------------------------------------------------------------
    // Private mapping helpers
    // -----------------------------------------------------------------------

    private mapNodeToEntity(
        repoId: string,
        n: GraphNodeJson,
    ): Partial<AstNodeModel> {
        return {
            repoId,
            kind: n.kind,
            name: n.name,
            qualifiedName: n.qualified_name,
            filePath: n.file_path,
            lineStart: n.line_start,
            lineEnd: n.line_end,
            language: n.language,
            parentName: n.parent_name ?? null,
            params: n.params ?? null,
            returnType: n.return_type ?? null,
            modifiers: n.modifiers ?? null,
            isTest: n.is_test,
            fileHash: n.file_hash,
        };
    }

    private mapEdgeToEntity(
        repoId: string,
        e: GraphEdgeJson,
    ): Partial<AstEdgeModel> {
        return {
            repoId,
            kind: e.kind,
            sourceQualified: e.source_qualified,
            targetQualified: e.target_qualified,
            filePath: e.file_path,
            line: e.line,
            confidence: e.confidence ?? null,
        };
    }
}
