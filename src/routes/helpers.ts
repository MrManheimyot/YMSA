// ─── Shared HTTP Response Helpers ─────────────────────────────

export function jsonResponse(data: unknown, status: number = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...extra,
    },
  });
}

export function addHeaders(res: Response, extra: Record<string, string>): Response {
  const newRes = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) newRes.headers.set(k, v);
  return newRes;
}
