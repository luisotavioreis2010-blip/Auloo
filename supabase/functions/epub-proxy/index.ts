// ==============================================
// EDGE FUNCTION: epub-proxy (v3)
// Redireciona para o arquivo real em vez de baixar
// ==============================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

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
        const resposta = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
            },
        });

        if (!resposta.ok) {
            return new Response(
                JSON.stringify({ error: 'Origem retornou ' + resposta.status }),
                { status: resposta.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const contentType = resposta.headers.get('content-type') || '';
        console.log('Content-Type inicial:', contentType);

        // Se JÁ for um EPUB direto, redireciona o navegador para ele
        if (contentType.includes('epub') || contentType.includes('zip')) {
            return new Response(null, {
                status: 302,
                headers: { ...corsHeaders, 'Location': targetUrl }
            });
        }

        // Se for HTML (página de download), extrai a URL real e redireciona
        const html = await resposta.text();
        const urlReal = extrairUrlReal(html);

        if (urlReal) {
            console.log('Redirecionando para URL real:', urlReal);
            return new Response(null, {
                status: 302,
                headers: { ...corsHeaders, 'Location': urlReal }
            });
        }

        return new Response(
            JSON.stringify({ error: 'Nao foi possivel encontrar a URL real do EPUB no HTML' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (err: any) {
        console.error('Erro no epub-proxy:', err.message || String(err));
        return new Response(
            JSON.stringify({ error: err.message || 'Erro inesperado' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});