/* ============================================================
   API-STANDARDEBOOKS.JS — v3
   Cache localStorage de 6h + parsing otimizado
   ============================================================ */
(function () {
    'use strict';

    var TTL = 1000 * 60 * 60 * 6; /* 6h */
    var SUPABASE_URL_PADRAO = 'https://qswvoxkhicficbdkcpzn.supabase.co';
    var TOTAL_PAGINAS = 40;
    var memo = new Map();

    function getUrlProxy() {
        var c = window.SUPABASE_CONFIG;
        var base = (c && c.url) ? c.url : SUPABASE_URL_PADRAO;
        return base.replace(/\/$/, '') + '/functions/v1/standard-ebooks-proxy';
    }

    function getAnonKey() {
        var c = window.SUPABASE_CONFIG;
        return (c && c.anonKey) ? c.anonKey : '';
    }

    function cacheGet(k) {
        var m = memo.get(k);
        if (m && Date.now() - m.ts < TTL) return m.v;
        var local = window.utils.cacheGet('se:' + k, TTL);
        if (local) memo.set(k, { ts: Date.now(), v: local });
        return local;
    }
    function cacheSet(k, v) {
        memo.set(k, { ts: Date.now(), v: v });
        /* Não salva catálogo enorme em localStorage (estoura quota) */
        if (Array.isArray(v) && v.length < 300) window.utils.cacheSet('se:' + k, v);
    }

    async function fetchProxy(params) {
        var url = getUrlProxy() + '?' + new URLSearchParams(params).toString();
        var headers = { 'Accept': 'application/json' };
        var key = getAnonKey();
        if (key) {
            headers['Authorization'] = 'Bearer ' + key;
            headers['apikey'] = key;
        }
        var r = await window.utils.fetchComTimeout(url, { headers: headers }, 20000);
        if (!r.ok) throw new Error('Proxy ' + r.status);
        var dados = await r.json();
        if (dados && dados.error) throw new Error(dados.error);
        return dados.html || '';
    }

    function parseListagem(htmlCompleto) {
        var paginas = htmlCompleto.split('<!-- PROXIMA PAGINA -->');
        var livros = [];
        var vistos = new Set();
        var parser = new DOMParser();

        paginas.forEach(function (html) {
            var doc = parser.parseFromString(html, 'text/html');
            var itens = doc.querySelectorAll(
                'li[typeof="schema:Book"], li.ebook, article.ebook, .ebook-list > li'
            );
            if (itens.length === 0) itens = doc.querySelectorAll('a[href*="/ebooks/"]');

            Array.prototype.forEach.call(itens, function (item) {
                try {
                    var link = item.querySelector
                        ? item.querySelector('a[href*="/ebooks/"]')
                        : item;
                    if (!link) return;

                    var href = link.getAttribute('href') || '';
                    var m = href.match(/\/ebooks\/([^\/]+)\/([^\/]+)/);
                    if (!m) return;

                    var slug = m[2] || m[1];
                    if (vistos.has(slug)) return;
                    vistos.add(slug);

                    var tituloEl = item.querySelector
                        ? item.querySelector('[property="schema:name"], .title, h2, h3')
                        : null;
                    var autorEl = item.querySelector
                        ? item.querySelector('[property="schema:author"], .author, .subtitle')
                        : null;
                    var capaEl = item.querySelector ? item.querySelector('img') : null;

                    var titulo = tituloEl
                        ? tituloEl.textContent.trim()
                        : slug.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });

                    var autor = autorEl ? autorEl.textContent.trim() : 'Autor desconhecido';
                    var capa = capaEl ? (capaEl.getAttribute('src') || capaEl.getAttribute('data-src')) : null;

                    if (capa && capa.indexOf('http') !== 0) {
                        capa = 'https://standardebooks.org' + (capa.charAt(0) === '/' ? '' : '/') + capa;
                    }

                    var epubUrl = 'https://standardebooks.org/ebooks/' + m[1] + '/' + slug + '/downloads/' + slug + '.epub';

                    livros.push({
                        source: 'standardebooks',
                        external_id: slug,
                        title: titulo,
                        author: autor,
                        year: null,
                        isbn: null,
                        cover_url: capa,
                        pages: null,
                        language: 'en',
                        genre: null,
                        external_url: 'https://standardebooks.org/ebooks/' + m[1] + '/' + slug,
                        has_ebook: true,
                        ebook_url: epubUrl,
                        ebook_format: 'epub',
                        download_count: 0
                    });
                } catch (e) { /* ignora item ruim */ }
            });
        });

        return livros;
    }

    async function buscarPopulares() {
        var chave = 'populares:v3';
        var em = cacheGet(chave);
        if (em) return em;

        try {
            var html = await fetchProxy({ acao: 'listar-todas', paginas: TOTAL_PAGINAS });
            var out = parseListagem(html);
            console.log('[SE] ' + out.length + ' livros');
            cacheSet(chave, out);
            return out;
        } catch (e) {
            console.warn('[SE] fallback 1 página:', e);
            try {
                var html2 = await fetchProxy({ acao: 'listar' });
                var out2 = parseListagem(html2);
                cacheSet(chave, out2);
                return out2;
            } catch (e2) { return []; }
        }
    }

    async function buscar(query) {
        query = String(query || '').trim();
        var chave = 'busca:' + query;
        var em = cacheGet(chave);
        if (em) return em;

        var params = { acao: 'listar' };
        if (query) params.q = query;

        try {
            var html = await fetchProxy(params);
            var out = parseListagem(html);
            cacheSet(chave, out);
            return out;
        } catch (e) { return []; }
    }

    window.apiStandardEbooks = {
        buscar: buscar,
        buscarPopulares: buscarPopulares
    };
})();