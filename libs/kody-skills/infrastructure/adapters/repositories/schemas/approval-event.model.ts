import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
} from 'typeorm';

import { CoreModel } from '@libs/core/infrastructure/repositories/model/typeOrm';
import { OrganizationModel } from '@libs/organization/infrastructure/adapters/repositories/schemas/organization.model';
import { SkillSubmissionModel } from './skill-submission.model';

@Entity('approval_events')
@Index('IDX_approval_events_submission', ['submission'], { concurrent: true })
export class ApprovalEventModel extends CoreModel {
    @ManyToOne(() => SkillSubmissionModel, { nullable: false })
    @JoinColumn({ name: 'submission_id', referencedColumnName: 'uuid' })
    submission: SkillSubmissionModel;

    @Column({ nullable: true })
    actorId: string;

    @Column({ length: 32 })
    fromStatus: string;

    @Column({ length: 32 })
    toStatus: string;

    @Column({ type: 'text', nullable: true })
    comment: string;

    @ManyToOne(() => OrganizationModel, { nullable: false })
    @JoinColumn({ name: 'organization_id', referencedColumnName: 'uuid' })
    organization: OrganizationModel;
}
