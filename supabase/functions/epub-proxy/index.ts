// ==============================================
// EDGE FUNCTION: epub-proxy
// Faz proxy de arquivos EPUB (resolve CORS)
// ==============================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const TIMEOUT_MS = 30000;

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

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const resposta = await fetch(targetUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AcervoBot/1.0)',
                'Accept': 'application/epub+zip,*/*',
            },
        });

        clearTimeout(timer);

        if (!resposta.ok) {
            return new Response(
                JSON.stringify({ error: 'Origem retornou ' + resposta.status }),
                { status: resposta.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const arrayBuffer = await resposta.arrayBuffer();

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