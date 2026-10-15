/* ============================================================
   API-GUTENBERG.JS — v3
   Cache localStorage de 1h + fetch com timeout
   ============================================================ */
(function () {
    'use strict';

    var BASE = 'https://gutendex.com/books';
    var TTL = 1000 * 60 * 60; /* 1h */
    var memo = new Map();

    function cacheGet(k) {
        var m = memo.get(k);
        if (m && Date.now() - m.ts < TTL) return m.v;
        var local = window.utils.cacheGet('gut:' + k, TTL);
        if (local) memo.set(k, { ts: Date.now(), v: local });
        return local;
    }
    function cacheSet(k, v) {
        memo.set(k, { ts: Date.now(), v: v });
        window.utils.cacheSet('gut:' + k, v);
    }

    function normalizar(item) {
        var f = item.formats || {};
        var capa  = f['image/jpeg'] || null;
        var epub  = f['application/epub+zip'] || null;
        var pdf   = f['application/pdf'] || null;
        var html  = f['text/html'] || null;
        var texto = f['text/plain; charset=utf-8'] || f['text/plain'] || null;
        var url   = epub || html || texto || pdf || null;
        var tipo  = epub ? 'epub' : (pdf ? 'pdf' : (html ? 'html' : 'txt'));
        var autor = item.authors && item.authors[0] ? item.authors[0] : null;

        var sinopse = null;
        if (item.summaries && item.summaries.length) {
            sinopse = String(item.summaries[0])
                .replace(/\s*\(This is an automatically generated summary\.\)\s*$/i, '')
                .trim();
        }

        var genero = null;
        if (item.subjects && item.subjects.length) genero = item.subjects[0];
        else if (item.bookshelves && item.bookshelves.length) {
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
            has_ebook: !!url,
            ebook_url: url,
            ebook_format: tipo,
            formats: f,
            copyright: item.copyright === true,
            download_count: item.download_count || 0
        };
    }

    async function req(url) {
        var r = await window.utils.fetchComTimeout(url, {
            headers: { 'User-Agent': 'Auloo/1.0' }
        }, 12000);
        return r.json();
    }

    async function buscar(query, opcoes) {
        opcoes = opcoes || {};
        var chave = 'busca:' + query + ':' + (opcoes.idioma || 'all');
        var em = cacheGet(chave);
        if (em) return em;

        var url = BASE + '?search=' + encodeURIComponent(query);
        if (opcoes.idioma) url += '&languages=' + opcoes.idioma;

        try {
            var dados = await req(url);
            if (!dados || !dados.results) return [];
            var out = dados.results.map(normalizar);
            cacheSet(chave, out);
            return out;
        } catch (e) {
            console.warn('Gutenberg busca:', e);
            return [];
        }
    }

    async function buscarPopularesPaginado(idioma, pagina) {
        idioma = idioma || 'pt';
        pagina = pagina || 1;
        var chave = 'pop:' + idioma + ':p' + pagina;
        var em = cacheGet(chave);
        if (em) return em;

        var url = BASE + '?languages=' + idioma + '&sort=popular&page=' + pagina;
        try {
            var dados = await req(url);
            if (!dados || !dados.results) return [];
            var out = dados.results.map(normalizar);
            cacheSet(chave, out);
            return out;
        } catch (e) { return []; }
    }

    function buscarPopulares(idioma) { return buscarPopularesPaginado(idioma, 1); }

    async function buscarPorId(id) {
        var chave = 'id:' + id;
        var em = cacheGet(chave);
        if (em) return em;
        try {
            var dados = await req(BASE + '/' + id);
            if (!dados) return null;
            var livro = normalizar(dados);
            cacheSet(chave, livro);
            return livro;
        } catch (e) { return null; }
    }

    window.apiGutenberg = {
        buscar: buscar,
        buscarPopulares: buscarPopulares,
        buscarPopularesPaginado: buscarPopularesPaginado,
        buscarPorId: buscarPorId
    };
})();