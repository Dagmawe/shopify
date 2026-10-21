// Health check for the host: answers 200 without signing in, so the host can
// tell the server is up before sending merchants to it.
export const loader = () =>
  new Response("ok", { headers: { "Content-Type": "text/plain" } });
