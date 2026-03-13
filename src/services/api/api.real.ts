import type {
    IKodusApi,
    ITrialApi,
    ISessionsApi,
} from './api.interface.js';
import { RealSessionsApi } from './sessions.api.js';
import {
    request,
    resetApiConfigCache,
    resolveApiBaseUrl,
    getCloudflareAccessHeaders,
} from './api-core.js';
import { RealConfigApi } from './config.api.js';
import { RealReviewApi } from './review.api.js';
import { RealAuthApi } from './auth.api.js';
import { RealTrialApi } from './trial.api.js';
import { RealMemoryApi } from './memory.api.js';

export const _resetConfigCache = resetApiConfigCache;
export { request, resolveApiBaseUrl, getCloudflareAccessHeaders };

export class RealApi implements IKodusApi {
    auth = new RealAuthApi();
    config = new RealConfigApi();
    review = new RealReviewApi();
    trial: ITrialApi = new RealTrialApi();
    memory = new RealMemoryApi();
    sessions: ISessionsApi = new RealSessionsApi();
}
