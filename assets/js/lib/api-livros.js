/* ============================================================
   API-LIVROS.JS — v2
   Integracao com APIs de livros:
   - Open Library (openlibrary.org)
   - Google Books (googleapis.com/books)
   - BrasilAPI (brasilapi.com.br)

   Novidades da v2:
   - Fila sequencial para o Google Books (evita 429)
   - Cache de 1h por termo
   - Limite de 1 chamada por vez ao Google
   - Nao tenta Open Library se o termo for muito longo
   ============================================================ */
(function () {
    'use strict';

    var TIMEOUT_MS = 8000;
    var CACHE_TTL_MS = 1000 * 60 * 60; // 1 hora
    var cache = new Map();

    /* Fila para o Google Books: no maximo 1 requisicao a cada X ms */
    var GOOGLE_INTERVALO_MS = 700;
    var googleFila = Promise.resolve();
    var ultimaChamadaGoogle = 0;

    /* ---------- Helpers ---------- */

    function fetchComTimeout(url, opcoes) {
        opcoes = opcoes || {};
        return new Promise(function (resolve, reject) {
            var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = setTimeout(function () {
                if (controller) controller.abort();
                reject(new Error('Timeout'));
            }, TIMEOUT_MS);

            var opcoesFinal = Object.assign({}, opcoes);
            if (controller) opcoesFinal.signal = controller.signal;

            fetch(url, opcoesFinal)
                .then(function (r) {
                    clearTimeout(timer);
                    resolve(r);
                })
                .catch(function (e) {
                    clearTimeout(timer);
                    reject(e);
                });
        });
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

    function limparIsbn(valor) {
        return String(valor || '').replace(/[^0-9X]/gi, '');
    }

    function esperar(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    /* Enfileira uma chamada ao Google Books com intervalo minimo entre elas */
    function googleComFila(funcao) {
        googleFila = googleFila.then(function () {
            var agora = Date.now();
            var diff = agora - ultimaChamadaGoogle;
            var espera = diff < GOOGLE_INTERVALO_MS ? (GOOGLE_INTERVALO_MS - diff) : 0;
            return esperar(espera).then(function () {
                ultimaChamadaGoogle = Date.now();
                return funcao();
            });
        });
        return googleFila;
    }

    /* ---------- Open Library ---------- */

    function buscarOpenLibrary(query) {
        var url = 'https://openlibrary.org/search.json?q=' +
                  encodeURIComponent(query) + '&limit=20';

        return fetchComTimeout(url)
            .then(function (r) { return r.json(); })
            .then(function (dados) {
                if (!dados || !dados.docs) return [];

                return dados.docs.map(function (doc) {
                    var isbn = doc.isbn && doc.isbn[0] ? doc.isbn[0] : null;
                    var capa = doc.cover_i
                        ? 'https://covers.openlibrary.org/b/id/' + doc.cover_i + '-M.jpg'
                        : null;

                    return {
                        source: 'openlibrary',
                        external_id: doc.key || null,
                        title: doc.title || 'Sem titulo',
                        author: doc.author_name ? doc.author_name[0] : null,
                        year: doc.first_publish_year || null,
                        isbn: isbn,
                        cover_url: capa,
                        pages: doc.number_of_pages_median || null,
                        language: doc.language ? doc.language[0] : null,
                        external_url: doc.key ? 'https://openlibrary.org' + doc.key : null,
                        has_ebook: !!doc.ebook_access && doc.ebook_access !== 'no_ebook'
                    };
                });
            })
            .catch(function (erro) {
                console.warn('Open Library falhou:', erro.message || erro);
                return [];
            });
    }

    function buscarOpenLibraryPorIsbn(isbn) {
        var limpo = limparIsbn(isbn);
        if (!limpo) return Promise.resolve(null);

        var url = 'https://openlibrary.org/isbn/' + limpo + '.json';

        return fetchComTimeout(url)
            .then(function (r) {
                if (!r.ok) throw new Error('Not found');
                return r.json();
            })
            .then(function (dados) {
                if (!dados) return null;

                return {
                    source: 'openlibrary',
                    external_id: dados.key || null,
                    title: dados.title || 'Sem titulo',
                    author: null,
                    year: dados.publish_date || null,
                    isbn: limpo,
                    cover_url: 'https://covers.openlibrary.org/b/isbn/' + limpo + '-M.jpg',
                    pages: dados.number_of_pages || null,
                    language: null,
                    external_url: dados.key ? 'https://openlibrary.org' + dados.key : null,
                    has_ebook: false
                };
            })
            .catch(function () { return null; });
    }

    /* ---------- Google Books (com fila) ---------- */

    function buscarGoogleBooks(query) {
        var chaveCache = 'google:' + query;
        var emCache = cacheGet(chaveCache);
        if (emCache) return Promise.resolve(emCache);

        return googleComFila(function () {
            var url = 'https://www.googleapis.com/books/v1/volumes?q=' +
                      encodeURIComponent(query) + '&maxResults=20&langRestrict=pt';

            return fetchComTimeout(url)
                .then(function (r) {
                    if (r.status === 429) {
                        console.warn('Google Books 429 (limite atingido) para:', query);
                        return { items: [] };
                    }
                    return r.json();
                })
                .then(function (dados) {
                    if (!dados || !dados.items) return [];

                    var resultado = dados.items.map(function (item) {
                        var info = item.volumeInfo || {};
                        var links = item.saleInfo || {};

                        return {
                            source: 'google',
                            external_id: item.id || null,
                            title: info.title || 'Sem titulo',
                            author: info.authors ? info.authors[0] : null,
                            year: info.publishedDate ? parseInt(info.publishedDate.substring(0, 4), 10) : null,
                            isbn: extrairIsbnGoogle(info.industryIdentifiers),
                            cover_url: info.imageLinks ? (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail) : null,
                            pages: info.pageCount || null,
                            language: info.language || null,
                            description: info.description || null,
                            publisher: info.publisher || null,
                            genre: info.categories ? info.categories[0] : null,
                            external_url: info.infoLink || null,
                            buy_link: links.buyLink || null,
                            has_ebook: info.accessInfo && info.accessInfo.epub && info.accessInfo.epub.isAvailable
                        };
                    });

                    cacheSet(chaveCache, resultado);
                    return resultado;
                })
                .catch(function (erro) {
                    console.warn('Google Books falhou:', erro.message || erro);
                    return [];
                });
        });
    }

    function extrairIsbnGoogle(identificadores) {
        if (!identificadores || !identificadores.length) return null;
        var isbn13 = identificadores.filter(function (i) { return i.type === 'ISBN_13'; })[0];
        if (isbn13) return isbn13.identifier;
        var isbn10 = identificadores.filter(function (i) { return i.type === 'ISBN_10'; })[0];
        if (isbn10) return isbn10.identifier;
        return null;
    }

    /* ---------- BrasilAPI (ISBN brasileiro) ---------- */

    function buscarBrasilApi(isbn) {
        var limpo = limparIsbn(isbn);
        if (!limpo) return Promise.resolve(null);

        var url = 'https://brasilapi.com.br/api/isbn/v1/' + limpo;

        return fetchComTimeout(url)
            .then(function (r) {
                if (!r.ok) throw new Error('Not found');
                return r.json();
            })
            .then(function (dados) {
                if (!dados) return null;

                return {
                    source: 'brasilapi',
                    external_id: dados.isbn || limpo,
                    title: dados.title || 'Sem titulo',
                    author: dados.authors ? dados.authors[0] : null,
                    year: dados.year || null,
                    isbn: limpo,
                    cover_url: dados.cover_url || null,
                    pages: dados.page_count || null,
                    language: 'pt',
                    publisher: dados.publisher || null,
                    genre: dados.subjects ? dados.subjects[0] : null,
                    description: dados.synopsis || null,
                    external_url: null,
                    has_ebook: false
                };
            })
            .catch(function () { return null; });
    }

    /* ---------- Busca unificada ---------- */

    function buscar(query, opcoes) {
        opcoes = opcoes || {};
        var chaveCache = 'busca:' + query + ':' + (opcoes.tipo || 'geral');

        var emCache = cacheGet(chaveCache);
        if (emCache) return Promise.resolve(emCache);

        var promessa;

        if (opcoes.tipo === 'isbn') {
            promessa = buscarBrasilApi(query).then(function (livro) {
                if (livro) return [livro];
                return buscarOpenLibraryPorIsbn(query).then(function (l) {
                    return l ? [l] : [];
                });
            });
        } else {
            promessa = buscarOpenLibrary(query).then(function (resultadosOL) {
                if (resultadosOL.length > 0) {
                    return resultadosOL;
                }
                return buscarGoogleBooks(query);
            });
        }

        return promessa.then(function (resultados) {
            cacheSet(chaveCache, resultados);
            return resultados;
        });
    }

    /* ---------- API publica ---------- */

    window.apiLivros = {
        buscar: buscar,
        buscarPorIsbn: function (isbn) { return buscar(isbn, { tipo: 'isbn' }); },
        buscarOpenLibrary: buscarOpenLibrary,
        buscarGoogleBooks: buscarGoogleBooks,
        buscarBrasilApi: buscarBrasilApi,
        limparCache: function () { cache.clear(); }
    };

    console.log('api-livros.js v2 carregado');
})();