import { NextRequest } from 'next/server';

// Simple JSON-RPC proxy to avoid browser CORS issues with public RPC endpoints.
// NOTE: This forwards *your* request body to the upstream RPC. Do not expose secrets here.

const UPSTREAM: Record<string, string> = {
  sonic: process.env.SONIC_RPC_UPSTREAM || 'https://rpc.soniclabs.com',
  base: process.env.BASE_RPC_UPSTREAM || 'https://mainnet.base.org',
};

export async function POST(req: NextRequest, { params }: { params: { chain: string } }) {
  const chain = params.chain;
  const upstream = UPSTREAM[chain];

  if (!upstream) {
    return new Response(JSON.stringify({ error: `Unknown chain '${chain}'` }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const body = await req.text();

  const res = await fetch(upstream, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Some RPCs require a benign UA
      'user-agent': 'lampworks-rpc-proxy/1.0',
    },
    body,
    cache: 'no-store',
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
}
