import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
} from 'typeorm';

import { CoreModel } from '@libs/core/infrastructure/repositories/model/typeOrm';
import { OrganizationModel } from '@libs/organization/infrastructure/adapters/repositories/schemas/organization.model';
import { SkillModel } from './skill.model';

@Entity('skill_submissions')
@Index('IDX_skill_submissions_org', ['organization'], { concurrent: true })
export class SkillSubmissionModel extends CoreModel {
    @ManyToOne(() => SkillModel, { nullable: false })
    @JoinColumn({ name: 'skill_id', referencedColumnName: 'uuid' })
    skill: SkillModel;

    @Column({ nullable: true })
    submitterId: string;

    @Column({ default: 'pending' })
    status: string;

    @Column({ type: 'text', nullable: true })
    reviewerComment: string;

    @Column({ nullable: true })
    reviewerId: string;

    @Column({ type: 'timestamp', nullable: true })
    submittedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    reviewedAt: Date;

    @ManyToOne(() => OrganizationModel, { nullable: false })
    @JoinColumn({ name: 'organization_id', referencedColumnName: 'uuid' })
    organization: OrganizationModel;
}
