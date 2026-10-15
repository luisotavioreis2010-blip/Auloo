/* ============================================================
   API-GUTENBERG.JS — v2
   Aproveita summaries[], subjects[], bookshelves[], anos do autor
   ============================================================ */
(function () {
    'use strict';

    var BASE_URL = 'https://gutendex.com/books';
    var TIMEOUT_MS = 12000;
    var CACHE_TTL_MS = 1000 * 60 * 60;
    var cache = new Map();

    function fetchComTimeout(url) {
        return new Promise(function (resolve, reject) {
            var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = setTimeout(function () {
                if (controller) controller.abort();
                reject(new Error('Timeout'));
            }, TIMEOUT_MS);

            var opcoes = {
                headers: { 'User-Agent': 'Auloo/1.0 (contato@auloo.com.br)' }
            };
            if (controller) opcoes.signal = controller.signal;

            fetch(url, opcoes)
                .then(function (r) { clearTimeout(timer); resolve(r); })
                .catch(function (e) { clearTimeout(timer); reject(e); });
        });
    }

    function cacheGet(chave) {
        var item = cache.get(chave);
        if (!item) return null;
        if (Date.now() - item.tempo > CACHE_TTL_MS) { cache.delete(chave); return null; }
        return item.valor;
    }
    function cacheSet(chave, valor) { cache.set(chave, { valor: valor, tempo: Date.now() }); }

    function normalizarLivro(item) {
        var formatos = item.formats || {};
        var capa  = formatos['image/jpeg'] || null;
        var epub  = formatos['application/epub+zip'] || null;
        var pdf   = formatos['application/pdf'] || null;
        var html  = formatos['text/html'] || null;
        var texto = formatos['text/plain; charset=utf-8'] || formatos['text/plain'] || null;

        var urlLeitura = epub || html || texto || pdf || null;
        var tipo = epub ? 'epub' : (pdf ? 'pdf' : (html ? 'html' : 'txt'));

        var autor = item.authors && item.authors[0] ? item.authors[0] : null;

        var sinopse = null;
        if (item.summaries && item.summaries.length) {
            sinopse = String(item.summaries[0])
                .replace(/\s*\(This is an automatically generated summary\.\)\s*$/i, '')
                .trim();
        }

        var genero = null;
        if (item.subjects && item.subjects.length) {
            genero = item.subjects[0];
        } else if (item.bookshelves && item.bookshelves.length) {
            genero = item.bookshelves[0].replace(/^Category:\s*/, '');
        }

        return {
            source: 'gutenberg',
            external_id: String(item.id),
            title: item.title || 'Sem título',
            author: autor ? autor.name : null,
            author_birth: autor ? autor.birth_year : null,
            author_death: autor ? autor.death_year : null,
            year: null,
            isbn: null,
            cover_url: capa,
            pages: null,
            language: item.languages && item.languages[0] ? item.languages[0] : 'en',
            language_list: item.languages || [],
            genre: genero,
            subjects: item.subjects || [],
            bookshelves: item.bookshelves || [],
            description: sinopse,
            external_url: 'https://www.gutenberg.org/ebooks/' + item.id,
            has_ebook: !!urlLeitura,
            ebook_url: urlLeitura,
            ebook_format: tipo,
            formats: formatos,
            copyright: item.copyright === true,
            download_count: item.download_count || 0
        };
    }

    function buscar(query, opcoes) {
        opcoes = opcoes || {};
        var chaveCache = 'gutenberg:busca:' + query + ':' + (opcoes.idioma || 'all');
        var emCache = cacheGet(chaveCache);
        if (emCache) return Promise.resolve(emCache);

        var url = BASE_URL + '?search=' + encodeURIComponent(query);
        if (opcoes.idioma) url += '&languages=' + opcoes.idioma;

        return fetchComTimeout(url)
            .then(function (r) { return r.json(); })
            .then(function (dados) {
                if (!dados || !dados.results) return [];
                var resultado = dados.results.map(normalizarLivro);
                cacheSet(chaveCache, resultado);
                return resultado;
            })
            .catch(function (erro) {
                console.warn('Gutenberg busca falhou:', erro);
                return [];
            });
    }

    function buscarPopulares(idioma) {
        idioma = idioma || 'pt';
        var chaveCache = 'gutenberg:populares:' + idioma;
        var emCache = cacheGet(chaveCache);
        if (emCache) return Promise.resolve(emCache);

        var url = BASE_URL + '?languages=' + idioma + '&sort=popular';
        return fetchComTimeout(url)
            .then(function (r) { return r.json(); })
            .then(function (dados) {
                if (!dados || !dados.results) return [];
                var resultado = dados.results.map(normalizarLivro);
                cacheSet(chaveCache, resultado);
                return resultado;
            })
            .catch(function () { return []; });
    }

    function buscarPopularesPaginado(idioma, pagina) {
        idioma = idioma || 'pt';
        pagina = pagina || 1;
        var chaveCache = 'gutenberg:populares:' + idioma + ':p' + pagina;
        var emCache = cacheGet(chaveCache);
        if (emCache) return Promise.resolve(emCache);

        var url = BASE_URL + '?languages=' + idioma + '&sort=popular&page=' + pagina;
        return fetchComTimeout(url)
            .then(function (r) { return r.json(); })
            .then(function (dados) {
                if (!dados || !dados.results) return [];
                var resultado = dados.results.map(normalizarLivro);
                cacheSet(chaveCache, resultado);
                return resultado;
            })
            .catch(function () { return []; });
    }

    function buscarPorId(id) {
        var chaveCache = 'gutenberg:id:' + id;
        var emCache = cacheGet(chaveCache);
        if (emCache) return Promise.resolve(emCache);

        var url = BASE_URL + '/' + id;
        return fetchComTimeout(url)
            .then(function (r) { return r.json(); })
            .then(function (dados) {
                if (!dados) return null;
                var livro = normalizarLivro(dados);
                cacheSet(chaveCache, livro);
                return livro;
            })
            .catch(function () { return null; });
    }

    window.apiGutenberg = {
        buscar: buscar,
        buscarPopulares: buscarPopulares,
        buscarPopularesPaginado: buscarPopularesPaginado,
        buscarPorId: buscarPorId,
        limparCache: function () { cache.clear(); }
    };

    console.log('api-gutenberg.js v2 carregado');
})();
