import { API_ROUTES } from "../config/constants";
import { apiProxyPath } from "./api-proxy";
import { axiosAuthorized } from "./axios";

export function captureSegmentEvent(event: {
    userId: string;
    event: string;
    properties?: any;
}) {
    return axiosAuthorized.post(apiProxyPath(API_ROUTES.segmentTrack), event);
}
