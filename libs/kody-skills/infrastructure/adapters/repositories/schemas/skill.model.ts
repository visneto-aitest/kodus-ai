import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    Unique,
} from 'typeorm';

import { CoreModel } from '@libs/core/infrastructure/repositories/model/typeOrm';
import { OrganizationModel } from '@libs/organization/infrastructure/adapters/repositories/schemas/organization.model';

@Entity('skills')
@Index('IDX_skills_organization', ['organization'], { concurrent: true })
@Index('IDX_skills_status', ['status'], { concurrent: true })
@Unique('UQ_skills_slug_org', ['slug', 'organization'])
export class SkillModel extends CoreModel {
    @Column({ length: 64 })
    slug: string;

    @Column({ type: 'text' })
    description: string;

    @Column({ length: 32 })
    version: string;

    @Column({ default: 'draft' })
    status: string;

    @Column({ type: 'text', nullable: true })
    skillMdContent: string;

    @Column({ type: 'timestamp', nullable: true })
    submittedAt: Date;

    @ManyToOne(() => OrganizationModel, { nullable: false })
    @JoinColumn({ name: 'organization_id', referencedColumnName: 'uuid' })
    organization: OrganizationModel;
}
