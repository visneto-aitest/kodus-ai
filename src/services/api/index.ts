import { RealApi } from './api.real.js';

export type { IKodusApi, IMemoryApi } from './api.interface.js';

export const api = new RealApi();
