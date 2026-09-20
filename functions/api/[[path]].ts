import { handleHostedApi } from "../../server/hosted";
import type { HostedEnv } from "../../server/hosted";
export async function onRequest(context: { request: Request; env: HostedEnv }) {
  return handleHostedApi(context.request, context.env);
}
