import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SkillModel } from './infrastructure/adapters/repositories/schemas/skill.model';
import { SkillSubmissionModel } from './infrastructure/adapters/repositories/schemas/skill-submission.model';
import { ApprovalEventModel } from './infrastructure/adapters/repositories/schemas/approval-event.model';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            SkillModel,
            SkillSubmissionModel,
            ApprovalEventModel,
        ]),
    ],
    providers: [],
    exports: [TypeOrmModule],
})
export class KodySkillsModule {}
