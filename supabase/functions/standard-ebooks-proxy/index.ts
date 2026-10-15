// ==============================================
// EDGE FUNCTION: standard-ebooks-proxy (PAGINADA)
// Busca multiplas paginas do catalogo do Standard
// Ebooks e devolve tudo numa resposta so.
// ==============================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const BASE_URL = 'https://standardebooks.org';
const TIMEOUT_MS = 20000;
const MAX_PAGINAS = 40; // 40 paginas * 48 = ~1.920 livros (cobre os 1.500)

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const url = new URL(req.url);
        const acao = url.searchParams.get('acao') || 'listar';
        const query = url.searchParams.get('q') || '';
        const slug = url.searchParams.get('slug') || '';

        // Nova logica: aceita 'paginas' para buscar varias paginas
        if (acao === 'listar-todas') {
            let totalPaginas = parseInt(url.searchParams.get('paginas') || '40', 10);
            if (totalPaginas > MAX_PAGINAS) totalPaginas = MAX_PAGINAS;
            if (totalPaginas < 1) totalPaginas = 1;

            const todasHtml: string[] = [];

            for (let p = 1; p <= totalPaginas; p++) {
                const targetUrl = BASE_URL + '/ebooks?page=' + p + '&per-page=48&view=list';
                
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

                try {
                    const resposta = await fetch(targetUrl, {
                        signal: controller.signal,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; AcervoBot/1.0)',
                            'Accept': 'text/html,application/xhtml+xml',
                        },
                    });
                    clearTimeout(timer);

                    if (resposta.ok) {
                        const html = await resposta.text();
                        // So adiciona se a pagina tiver conteudo real (evita loop vazio)
                        if (html.indexOf('/ebooks/') !== -1) {
                            todasHtml.push(html);
                        }
                    }
                } catch (e) {
                    clearTimeout(timer);
                    console.warn('Pagina ' + p + ' falhou, continuando...');
                }
            }

            if (todasHtml.length === 0) {
                return new Response(
                    JSON.stringify({ error: 'Nenhuma pagina pode ser carregada' }),
                    { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            return new Response(
                JSON.stringify({ 
                    html: todasHtml.join('\n<!-- PROXIMA PAGINA -->\n'),
                    paginas: todasHtml.length
                }),
                {
                    status: 200,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=3600',
                    },
                }
            );
        }

        // Modo antigo (uma pagina) continua funcionando como fallback
        let targetUrl = '';
        if (acao === 'listar') {
            targetUrl = BASE_URL + '/ebooks';
            if (query) targetUrl += '?query=' + encodeURIComponent(query);
        } else if (acao === 'detalhe' && slug) {
            targetUrl = BASE_URL + '/ebooks/' + encodeURIComponent(slug);
        } else {
            return new Response(
                JSON.stringify({ error: 'Acao invalida' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const resposta = await fetch(targetUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AcervoBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml',
            },
        });

        clearTimeout(timer);

        if (!resposta.ok) {
            return new Response(
                JSON.stringify({ error: 'Standard Ebooks retornou ' + resposta.status }),
                { status: resposta.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const html = await resposta.text();
        return new Response(
            JSON.stringify({ html: html }),
            {
                status: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=3600',
                },
            }
        );

    } catch (err: any) {
        console.error('Erro no proxy:', err.message || String(err));
        return new Response(
            JSON.stringify({ error: err.message || 'Erro inesperado' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});