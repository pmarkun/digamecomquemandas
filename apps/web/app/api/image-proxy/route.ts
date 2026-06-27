import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'URL ausente.' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'URL inválida.' }, { status: 400 });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return NextResponse.json({ error: 'Protocolo não permitido.' }, { status: 400 });
  }

  const upstream = await fetch(parsed, {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'user-agent': 'DigaMeWorkbench/0.1',
    },
    cache: 'no-store',
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Imagem não carregada.' }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'URL não retornou uma imagem.' }, { status: 415 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      'cache-control': 'no-store',
      'content-type': contentType,
    },
  });
}
