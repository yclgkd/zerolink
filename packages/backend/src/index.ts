export default {
  async fetch(_request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    return new Response('ZeroLink API', { status: 200 });
  },
} satisfies ExportedHandler<Env>;

export interface Env {
  SECRET_VAULT: DurableObjectNamespace;
  SECRETS_KV: KVNamespace;
}
