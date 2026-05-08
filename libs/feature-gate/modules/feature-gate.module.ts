import { Global, Module } from '@nestjs/common';

import { FeatureGateService } from '../application/feature-gate.service';

@Global()
@Module({
    providers: [FeatureGateService],
    exports: [FeatureGateService],
})
export class FeatureGateModule {}
