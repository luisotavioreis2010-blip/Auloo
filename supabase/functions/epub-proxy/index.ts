// ==============================================
// EDGE FUNCTION: epub-proxy (v2)
// Segue o redirect do Standard Ebooks para baixar
// o EPUB real (a URL "downloads/" retorna uma
// pagina HTML com um meta-refresh para o arquivo).
// ==============================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const TIMEOUT_MS = 30000;

async function fetchComHeaders(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const r = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://standardebooks.org/',
            },
        });
        clearTimeout(timer);
        return r;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

/* Extrai a URL real do EPUB de dentro do HTML de "Your Download Has Started" */
function extrairUrlReal(html: string): string | null {
    // Procura <meta http-equiv="refresh" content="0; url=..." />
    const metaMatch = html.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["']\d+;\s*url=([^"']+)["']/i);
    if (metaMatch) {
        const url = metaMatch[1].trim();
        if (url.startsWith('http')) return url;
        if (url.startsWith('/')) return 'https://standardebooks.org' + url;
    }
    return null;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const url = new URL(req.url);
        const targetUrl = url.searchParams.get('url');

        if (!targetUrl || !targetUrl.startsWith('http')) {
            return new Response(
                JSON.stringify({ error: 'URL invalida' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log('Buscando:', targetUrl);
        let resposta = await fetchComHeaders(targetUrl);

        if (!resposta.ok) {
            return new Response(
                JSON.stringify({ error: 'Origem retornou ' + resposta.status }),
                { status: resposta.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Verifica se o Content-Type e EPUB
        const contentType = resposta.headers.get('content-type') || '';
        console.log('Content-Type inicial:', contentType);

        // Se NAO for EPUB (veio HTML), extrai a URL real e baixa de novo
        if (!contentType.includes('epub') && !contentType.includes('zip')) {
            const html = await resposta.text();
            const urlReal = extrairUrlReal(html);

            if (!urlReal) {
                return new Response(
                    JSON.stringify({ error: 'Nao foi possivel encontrar a URL real do EPUB no HTML' }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            console.log('URL real encontrada:', urlReal);
            resposta = await fetchComHeaders(urlReal);

            if (!resposta.ok) {
                return new Response(
                    JSON.stringify({ error: 'URL real retornou ' + resposta.status }),
                    { status: resposta.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
        }

        // Baixa o EPUB
        const arrayBuffer = await resposta.arrayBuffer();
        console.log('EPUB baixado:', arrayBuffer.byteLength, 'bytes');

        return new Response(arrayBuffer, {
            status: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/epub+zip',
                'Cache-Control': 'public, max-age=86400',
            },
        });

    } catch (err: any) {
        console.error('Erro no epub-proxy:', err.message || String(err));
        return new Response(
            JSON.stringify({ error: err.message || 'Erro inesperado' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});