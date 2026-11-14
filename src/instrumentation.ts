export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
}
