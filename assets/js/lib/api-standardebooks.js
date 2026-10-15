/* ============================================================
   API-STANDARDEBOOKS.JS — v4
   TOTAL_PAGINAS = 40 (todos os livros)
   ============================================================ */
(function () {
    'use strict';

    var CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 horas
    var cache = new Map();

    var SUPABASE_URL_PADRAO = 'https://qswvoxkhicficbdkcpzn.supabase.co';
    var TOTAL_PAGINAS = 40;

    function getUrlProxy() {
        var config = window.SUPABASE_CONFIG;
        var base = (config && config.url) ? config.url : SUPABASE_URL_PADRAO;
        return base.replace(/\/$/, '') + '/functions/v1/standard-ebooks-proxy';
    }

    function getAnonKey() {
        var config = window.SUPABASE_CONFIG;
        return (config && config.anonKey) ? config.anonKey : '';
    }

    function cacheGet(chave) {
        var item = cache.get(chave);
        if (!item) return null;
        if (Date.now() - item.tempo > CACHE_TTL_MS) {
            cache.delete(chave);
            return null;
        }
        return item.valor;
    }

    function cacheSet(chave, valor) {
        cache.set(chave, { valor: valor, tempo: Date.now() });
    }

    function fetchProxy(params) {
        var url = getUrlProxy() + '?' + new URLSearchParams(params).toString();
        var headers = { 'Accept': 'application/json' };
        var anonKey = getAnonKey();
        if (anonKey) {
            headers['Authorization'] = 'Bearer ' + anonKey;
            headers['apikey'] = anonKey;
        }

        return fetch(url, { headers: headers })
            .then(function (r) {
                if (!r.ok) throw new Error('Proxy retornou ' + r.status);
                return r.json();
            })
            .then(function (dados) {
                if (dados && dados.error) throw new Error(dados.error);
                return dados.html || '';
            });
    }

    function parseListagem(htmlCompleto) {
        var paginas = htmlCompleto.split('<!-- PROXIMA PAGINA -->');
        var livros = [];
        var vistos = new Set();

        paginas.forEach(function (html) {
            var parser = new DOMParser();
            var doc = parser.parseFromString(html, 'text/html');

            var itens = doc.querySelectorAll(
                'li[typeof="schema:Book"], li.ebook, article.ebook, .ebook-list > li'
            );

            if (itens.length === 0) {
                itens = doc.querySelectorAll('a[href*="/ebooks/"]');
            }

            Array.prototype.forEach.call(itens, function (item) {
                try {
                    var link = item.querySelector
                        ? item.querySelector('a[href*="/ebooks/"]')
                        : item;

                    if (!link) return;

                    var href = link.getAttribute('href') || '';
                    var match = href.match(/\/ebooks\/([^\/]+)\/([^\/]+)/);
                    if (!match) return;

                    var slug = match[2] || match[1];
                    if (vistos.has(slug)) return;
                    vistos.add(slug);

                    var tituloEl = item.querySelector
                        ? item.querySelector('[property="schema:name"], .title, h2, h3')
                        : null;
                    var autorEl = item.querySelector
                        ? item.querySelector('[property="schema:author"], .author, .subtitle')
                        : null;
                    var capaEl = item.querySelector
                        ? item.querySelector('img')
                        : null;

                    var titulo = tituloEl
                        ? tituloEl.textContent.trim()
                        : slug.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });

                    var autor = autorEl ? autorEl.textContent.trim() : 'Autor desconhecido';
                    var capa = capaEl ? (capaEl.getAttribute('src') || capaEl.getAttribute('data-src')) : null;

                    if (capa && capa.indexOf('http') !== 0) {
                        capa = 'https://standardebooks.org' + (capa.charAt(0) === '/' ? '' : '/') + capa;
                    }

                    var epubUrl = 'https://standardebooks.org/ebooks/' + match[1] + '/' + slug + '/downloads/' + slug + '.epub';

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
                        external_url: 'https://standardebooks.org/ebooks/' + match[1] + '/' + slug,
                        has_ebook: true,
                        ebook_url: epubUrl,
                        ebook_format: 'epub',
                        download_count: 0
                    });
                } catch (e) {
                    console.warn('Erro ao parsear item:', e);
                }
            });
        });

        return livros;
    }

    function buscarPopulares() {
        var chaveCache = 'standardebooks:populares:v4';

        var emCache = cacheGet(chaveCache);
        if (emCache) return Promise.resolve(emCache);

        return fetchProxy({ acao: 'listar-todas', paginas: TOTAL_PAGINAS })
            .then(function (html) {
                var resultado = parseListagem(html);
                console.log('Standard Ebooks: ' + resultado.length + ' livros carregados');
                cacheSet(chaveCache, resultado);
                return resultado;
            })
            .catch(function (erro) {
                console.warn('Standard Ebooks paginado falhou, tentando uma pagina...');
                return fetchProxy({ acao: 'listar' })
                    .then(function (html) {
                        var resultado = parseListagem(html);
                        cacheSet(chaveCache, resultado);
                        return resultado;
                    })
                    .catch(function () { return []; });
            });
    }

    function buscar(query) {
        query = String(query || '').trim();
        var chaveCache = 'standardebooks:busca:' + query;

        var emCache = cacheGet(chaveCache);
        if (emCache) return Promise.resolve(emCache);

        var params = { acao: 'listar' };
        if (query) params.q = query;

        return fetchProxy(params)
            .then(function (html) {
                var resultado = parseListagem(html);
                cacheSet(chaveCache, resultado);
                return resultado;
            })
            .catch(function (erro) {
                console.warn('Standard Ebooks busca falhou:', erro);
                return [];
            });
    }

    window.apiStandardEbooks = {
        buscar: buscar,
        buscarPopulares: buscarPopulares,
        limparCache: function () { cache.clear(); }
    };

    console.log('api-standardebooks.js v4 carregado (40 paginas)');
})();