import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSkillTables1772000000001 implements MigrationInterface {
    name = 'CreateSkillTables1772000000001';

    // Disable transaction because CONCURRENTLY cannot run inside a transaction
    transaction = false;

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "skills" (
                "uuid" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "createdAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "updatedAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "slug" character varying(64) NOT NULL,
                "description" text NOT NULL,
                "version" character varying(32) NOT NULL,
                "status" character varying NOT NULL DEFAULT 'draft',
                "skillMdContent" text,
                "submittedAt" TIMESTAMP,
                "organization_id" uuid NOT NULL,
                CONSTRAINT "PK_skills_uuid" PRIMARY KEY ("uuid")
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "skills"
            ADD CONSTRAINT "FK_skills_organization"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("uuid")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX CONCURRENTLY "UQ_skills_slug_org" ON "skills" ("slug", "organization_id")
        `);

        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY "IDX_skills_organization" ON "skills" ("organization_id")
        `);

        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY "IDX_skills_status" ON "skills" ("status")
        `);

        await queryRunner.query(`
            CREATE TABLE "skill_submissions" (
                "uuid" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "createdAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "updatedAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "skill_id" uuid NOT NULL,
                "submitterId" uuid,
                "status" character varying NOT NULL DEFAULT 'pending',
                "reviewerComment" text,
                "reviewerId" uuid,
                "submittedAt" TIMESTAMP,
                "reviewedAt" TIMESTAMP,
                "organization_id" uuid NOT NULL,
                CONSTRAINT "PK_skill_submissions_uuid" PRIMARY KEY ("uuid")
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "skill_submissions"
            ADD CONSTRAINT "FK_skill_submissions_skill"
            FOREIGN KEY ("skill_id") REFERENCES "skills"("uuid")
            ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "skill_submissions"
            ADD CONSTRAINT "FK_skill_submissions_org"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("uuid")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY "IDX_skill_submissions_org" ON "skill_submissions" ("organization_id")
        `);

        await queryRunner.query(`
            CREATE TABLE "approval_events" (
                "uuid" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "createdAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "updatedAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "submission_id" uuid NOT NULL,
                "actorId" uuid,
                "fromStatus" character varying(32) NOT NULL,
                "toStatus" character varying(32) NOT NULL,
                "comment" text,
                "organization_id" uuid NOT NULL,
                CONSTRAINT "PK_approval_events_uuid" PRIMARY KEY ("uuid")
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "approval_events"
            ADD CONSTRAINT "FK_approval_events_submission"
            FOREIGN KEY ("submission_id") REFERENCES "skill_submissions"("uuid")
            ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "approval_events"
            ADD CONSTRAINT "FK_approval_events_org"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("uuid")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY "IDX_approval_events_submission" ON "approval_events" ("submission_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX CONCURRENTLY "public"."IDX_approval_events_submission"
        `);

        await queryRunner.query(`
            ALTER TABLE "approval_events" DROP CONSTRAINT "FK_approval_events_org"
        `);

        await queryRunner.query(`
            ALTER TABLE "approval_events" DROP CONSTRAINT "FK_approval_events_submission"
        `);

        await queryRunner.query(`
            DROP TABLE "approval_events"
        `);

        await queryRunner.query(`
            DROP INDEX CONCURRENTLY "public"."IDX_skill_submissions_org"
        `);

        await queryRunner.query(`
            ALTER TABLE "skill_submissions" DROP CONSTRAINT "FK_skill_submissions_org"
        `);

        await queryRunner.query(`
            ALTER TABLE "skill_submissions" DROP CONSTRAINT "FK_skill_submissions_skill"
        `);

        await queryRunner.query(`
            DROP TABLE "skill_submissions"
        `);

        await queryRunner.query(`
            DROP INDEX CONCURRENTLY "public"."IDX_skills_status"
        `);

        await queryRunner.query(`
            DROP INDEX CONCURRENTLY "public"."IDX_skills_organization"
        `);

        await queryRunner.query(`
            DROP INDEX CONCURRENTLY "public"."UQ_skills_slug_org"
        `);

        await queryRunner.query(`
            ALTER TABLE "skills" DROP CONSTRAINT "FK_skills_organization"
        `);

        await queryRunner.query(`
            DROP TABLE "skills"
        `);
    }
}
