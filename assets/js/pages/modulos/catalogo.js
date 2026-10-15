/* ============================================================
   CATALOGO.JS — v16
   - Sessão instantânea (usa obterSessao do config.js)
   - Carregamento PARALELO de Standard Ebooks + Gutenberg
   - Resultados aparecem conforme chegam
   ============================================================ */
(function () {
    'use strict';

    document.documentElement.classList.add('carregando-catalogo');

    var PAGINA_LOGIN = '/login.html';
    var LIMITE_TOTAL = 1500;

    var estado = {
        usuario: null,
        resultados: [],
        buscaAtual: '',
        modo: 'populares',
        livroSelecionado: null
    };

    var $ = function (id) { return document.getElementById(id); };
    var esperar = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    function getDb() {
        return window.getSupabaseClientSeguro ? window.getSupabaseClientSeguro()
                                              : window.getSupabaseClient();
    }

    /* ============================================================
       SESSÃO — usa obterSessao() do config.js (rápido)
       ============================================================ */
    async function iniciarSessao() {
        var db = await window.aguardarSupabase();
        if (!db) {
            window.location.replace(PAGINA_LOGIN);
            return false;
        }

        var confirmada = false;
        db.auth.onAuthStateChange(function (evento) {
            if (evento === 'SIGNED_OUT' && confirmada) {
                setTimeout(function () {
                    if (!confirmada) return;
                    window.location.replace(PAGINA_LOGIN);
                }, 2000);
            }
        });

        var sessao = await window.obterSessao(8000);
        if (sessao && sessao.user) {
            confirmada = true;
            aplicarUsuario(sessao.user);
            return true;
        }

        window.location.replace(PAGINA_LOGIN);
        return false;
    }

    function aplicarUsuario(user) {
        estado.usuario = user;
        var meta = user.user_metadata || {};
        var nome = meta.full_name || meta.name || user.email || 'Usuário';
        var avatar = meta.avatar_url || meta.picture || null;

        window.utils.renderizarAvatar($('perfil-usuario'), avatar, nome);
        window.utils.renderizarAvatar($('sidebar-perfil-foto'), avatar, nome);

        var n = $('sidebar-perfil-nome'), e = $('sidebar-perfil-email');
        if (n) n.textContent = nome.split('@')[0];
        if (e) e.textContent = user.email || '';

        carregarEstatisticas();
    }

    /* ============================================================
       ESTATÍSTICAS
       ============================================================ */
    async function carregarEstatisticas() {
        var db = getDb();
        if (!db || !estado.usuario) return;
        try {
            var prog = await db.from('reading_progress')
                .select('book_slug', { count: 'exact', head: true })
                .eq('user_id', estado.usuario.id)
                .gt('percent', 0);

            var hist = await db.from('reading_history')
                .select('book_slug, book_title, book_author, book_cover, last_read_at')
                .eq('user_id', estado.usuario.id)
                .order('last_read_at', { ascending: false })
                .limit(3);

            renderizarEstatisticas(prog.count || 0, hist.data || []);
        } catch (e) { /* ignora */ }
    }

    function renderizarEstatisticas(total, ultimos) {
        var c = $('ficha-total-lidos');
        if (c) c.textContent = total;

        var cont = $('ficha-ultimos-lidos');
        if (!cont) return;
        window.utils.limpar(cont);

        if (!ultimos.length) {
            var v = document.createElement('p');
            v.className = 'ficha-vazio';
            v.textContent = 'Nenhum livro lido ainda';
            cont.appendChild(v);
            return;
        }

        ultimos.forEach(function (l) {
            var a = document.createElement('a');
            a.className = 'ficha-livro-recente';
            a.href = 'leitor.html?url=' + encodeURIComponent(l.book_slug) +
                     '&titulo=' + encodeURIComponent(l.book_title || '') +
                     '&slug=' + encodeURIComponent(l.book_slug) +
                     '&autor=' + encodeURIComponent(l.book_author || '') +
                     '&capa=' + encodeURIComponent(l.book_cover || '');

            var capa = document.createElement('div');
            capa.className = 'ficha-livro-capa';
            if (l.book_cover) {
                var img = document.createElement('img');
                img.src = l.book_cover;
                img.alt = l.book_title || '';
                img.loading = 'lazy';
                img.referrerPolicy = 'no-referrer';
                img.onerror = function () { capa.textContent = '📖'; };
                capa.appendChild(img);
            } else capa.textContent = '📖';

            var info = document.createElement('div');
            info.className = 'ficha-livro-info';
            var t = document.createElement('span');
            t.className = 'ficha-livro-titulo';
            t.textContent = l.book_title || 'Sem título';
            info.appendChild(t);

            if (l.book_author) {
                var au = document.createElement('span');
                au.className = 'ficha-livro-autor';
                au.textContent = l.book_author;
                info.appendChild(au);
            }

            a.appendChild(capa);
            a.appendChild(info);
            cont.appendChild(a);
        });
    }

    /* ============================================================
       RENDERIZAÇÃO
       ============================================================ */
    function esconderTudo() {
        ['catalogo-loading', 'catalogo-erro', 'resultados-info', 'catalogo-fim'].forEach(function (id) {
            var el = $(id);
            if (el) el.hidden = true;
        });
        var g = $('resultados-grid');
        if (g) window.utils.limpar(g);
    }

    function mostrarLoading(msg) {
        esconderTudo();
        var l = $('catalogo-loading');
        var t = $('loading-texto');
        if (t && msg) t.textContent = msg;
        if (l) l.hidden = false;
    }

    function atualizarLoading(msg) {
        var t = $('loading-texto');
        if (t && msg) t.textContent = msg;
    }

    function mostrarErro(msg) {
        esconderTudo();
        var e = $('catalogo-erro');
        var m = $('erro-mensagem');
        if (m) m.textContent = msg || 'Não foi possível buscar os livros.';
        if (e) e.hidden = false;
    }

    /* Renderiza sem limpar o grid (para append incremental) */
    function anexarLivros(livros) {
        var grid = $('resultados-grid');
        if (!grid) return;

        var info = $('resultados-info');
        var c = $('resultados-contagem');
        var btnVoltar = $('btn-voltar-populares');

        var total = grid.children.length + livros.length;
        if (c) c.textContent = total === 1 ? '1 livro' : total + ' livros';
        if (info) info.hidden = false;
        if (btnVoltar) btnVoltar.hidden = estado.modo !== 'busca';

        var frag = document.createDocumentFragment();
        livros.forEach(function (l) { frag.appendChild(criarCard(l)); });
        grid.appendChild(frag);
    }

    function mostrarResultados(livros) {
        esconderTudo();
        if (!livros || !livros.length) return;
        anexarLivros(livros);
    }

    function criarCard(livro) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'livro-card';
        card.setAttribute('aria-label', 'Ver detalhes de ' + (livro.title || ''));

        var capa = document.createElement('div');
        capa.className = 'livro-capa';

        if (livro.cover_url) {
            var img = document.createElement('img');
            img.alt = livro.title || '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.referrerPolicy = 'no-referrer';
            img.style.opacity = '0';
            img.style.transition = 'opacity 0.3s';
            img.onload = function () { img.style.opacity = '1'; };
            img.onerror = function () {
                img.remove();
                if (!capa.querySelector('.livro-capa-sem')) {
                    var s = document.createElement('div');
                    s.className = 'livro-capa-sem';
                    s.textContent = livro.title || '';
                    capa.appendChild(s);
                }
            };
            img.src = livro.cover_url;
            capa.appendChild(img);
        } else {
            var s2 = document.createElement('div');
            s2.className = 'livro-capa-sem';
            s2.textContent = livro.title || '';
            capa.appendChild(s2);
        }

        var info = document.createElement('div');
        info.className = 'livro-info';
        var t = document.createElement('div');
        t.className = 'livro-titulo';
        t.textContent = livro.title || 'Sem título';
        info.appendChild(t);

        if (livro.author) {
            var a = document.createElement('div');
            a.className = 'livro-autor';
            a.textContent = livro.author;
            info.appendChild(a);
        }

        var meta = [];
        if (livro.year) meta.push(livro.year);
        if (livro.pages) meta.push(livro.pages + ' pág.');
        if (meta.length) {
            var m = document.createElement('div');
            m.className = 'livro-meta';
            m.textContent = meta.join(' · ');
            info.appendChild(m);
        }

        card.appendChild(capa);
        card.appendChild(info);
        card.addEventListener('click', function () { abrirModalLivro(livro); }, { passive: true });
        return card;
    }

    /* ============================================================
       CARREGAR CATÁLOGO — PARALELO E PROGRESSIVO
       ============================================================ */
    async function carregarCatalogo() {
        estado.modo = 'populares';
        estado.buscaAtual = '';
        mostrarLoading('Carregando catálogo...');

        var todos = [];
        var vistos = new Set();
        var jaRenderizou = false;

        function adicionar(lista, fonte) {
            if (!lista) return 0;
            var novos = [];
            lista.forEach(function (l) {
                if (!l || !l.title) return;
                var k = (l.title || '').toLowerCase().trim() + '|' + (l.author || '').toLowerCase().trim();
                if (vistos.has(k)) return;
                vistos.add(k);
                if (fonte) l.source = fonte;
                todos.push(l);
                novos.push(l);
            });
            return novos.length;
        }

        function pesoSorte(l) {
            if (l.source === 'standardebooks') return 1;
            if ((l.language || '').toLowerCase().indexOf('pt') === 0) return 2;
            return 3;
        }

        function exibirProgressivo(novos) {
            if (!novos.length) return;
            /* Ordena o acumulado por peso para que SE/pt venham primeiro */
            var ordenado = todos.slice().sort(function (a, b) {
                var pa = pesoSorte(a), pb = pesoSorte(b);
                if (pa !== pb) return pa - pb;
                return (b.download_count || 0) - (a.download_count || 0);
            });
            esconderTudo();
            anexarLivros(ordenado);
            jaRenderizou = true;
            atualizarLoading('Carregando... ' + todos.length + ' livros');
        }

        /* Standard Ebooks */
        var pSE = window.apiStandardEbooks.buscarPopulares().then(function (lista) {
            var novos = adicionar(lista && lista.slice(0, LIMITE_TOTAL), 'standardebooks');
            exibirProgressivo(lista ? lista.slice(0, LIMITE_TOTAL) : []);
            return novos;
        }).catch(function () { return 0; });

        /* Gutenberg paginado em série, mas em paralelo com SE */
        var pGut = (async function () {
            for (var p = 1; p <= 10; p++) {
                if (todos.length >= LIMITE_TOTAL) break;
                try {
                    var pagina = await window.apiGutenberg.buscarPopularesPaginado('', p);
                    if (!pagina || !pagina.length) break;
                    var novos = adicionar(pagina, 'gutenberg');
                    if (novos > 0) exibirProgressivo(pagina);
                } catch (e) { break; }
            }
            return todos.length;
        })();

        /* Espera ambos terminarem (para logs e fim) */
        await Promise.all([pSE, pGut]);

        /* Ordena final e re-renderiza */
        todos.sort(function (a, b) {
            var pa = pesoSorte(a), pb = pesoSorte(b);
            if (pa !== pb) return pa - pb;
            return (b.download_count || 0) - (a.download_count || 0);
        });
        estado.resultados = todos;

        if (todos.length) {
            esconderTudo();
            anexarLivros(todos);
        } else if (!jaRenderizou) {
            mostrarErro('Nenhum livro carregado. Tente buscar.');
        }
    }

    /* ============================================================
       BUSCA
       ============================================================ */
    async function buscarLivros(termo) {
        termo = String(termo || '').trim();
        if (!termo) { carregarCatalogo(); return; }

        estado.modo = 'busca';
        estado.buscaAtual = termo;
        mostrarLoading('Buscando livros...');

        try {
            /* Paralelo: Gutenberg + Standard Ebooks ao mesmo tempo */
            var [gut, se] = await Promise.all([
                window.apiGutenberg.buscar(termo).catch(function () { return []; }),
                window.apiStandardEbooks.buscar(termo).catch(function () { return []; })
            ]);

            var vistos = new Set();
            var livros = [];
            gut.concat(se).forEach(function (l) {
                if (!l || !l.title) return;
                var k = (l.title || '').toLowerCase() + '|' + (l.author || '').toLowerCase();
                if (vistos.has(k)) return;
                vistos.add(k);
                livros.push(l);
            });

            estado.resultados = livros;
            aplicarFiltrosEOrdenacao();
        } catch (e) {
            mostrarErro('Não foi possível buscar.');
        }
    }

    function aplicarFiltrosEOrdenacao() {
        var livros = estado.resultados.slice();
        var idioma = $('filtro-idioma') ? $('filtro-idioma').value : '';
        if (idioma) livros = livros.filter(function (l) {
            return (l.language || '').toLowerCase().indexOf(idioma) === 0;
        });

        var fonte = $('filtro-fonte') ? $('filtro-fonte').value : '';
        if (fonte === 'gutenberg') livros = livros.filter(function (l) { return l.has_ebook; });
        else if (fonte) livros = livros.filter(function (l) { return l.source === fonte; });

        var ordem = $('filtro-ordem') ? $('filtro-ordem').value : 'relevancia';
        if (ordem === 'ano-desc') livros.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
        else if (ordem === 'ano-asc') livros.sort(function (a, b) { return (a.year || 9999) - (b.year || 9999); });
        else if (ordem === 'titulo') livros.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });

        mostrarResultados(livros);
    }

    /* ============================================================
       MODAIS
       ============================================================ */
    function abrirModalLivro(livro) {
        estado.livroSelecionado = livro;
        var m = $('modal-livro');
        if (!m) return;

        var img = $('modal-capa-img');
        var titulo = $('modal-titulo');
        var autor = $('modal-autor');
        var meta = $('modal-meta');
        var desc = $('modal-descricao');
        var btnLer = $('btn-ler');

        if (img) {
            img.src = livro.cover_url || '';
            img.alt = livro.title || '';
            img.style.visibility = 'visible';
            img.onerror = function () { img.style.visibility = 'hidden'; };
        }
        if (titulo) titulo.textContent = livro.title || 'Sem título';
        if (autor) autor.textContent = livro.author || 'Autor desconhecido';
        if (meta) {
            var partes = [];
            if (livro.year) partes.push(livro.year);
            if (livro.pages) partes.push(livro.pages + ' páginas');
            if (livro.publisher) partes.push(livro.publisher);
            meta.textContent = partes.join(' · ');
        }
        if (desc) desc.textContent = livro.description || 'Sem descrição disponível.';

        if (btnLer) {
            if (livro.ebook_url && livro.source === 'standardebooks') {
                btnLer.href = 'leitor.html?url=' + encodeURIComponent(livro.ebook_url) +
                              '&titulo=' + encodeURIComponent(livro.title || '') +
                              '&slug=' + encodeURIComponent(livro.external_id || '') +
                              '&autor=' + encodeURIComponent(livro.author || '') +
                              '&capa=' + encodeURIComponent(livro.cover_url || '');
                btnLer.textContent = 'Ler no Acervo';
                btnLer.hidden = false;
            } else if (livro.ebook_url) {
                btnLer.href = livro.ebook_url;
                btnLer.textContent = 'Ler agora';
                btnLer.hidden = false;
            } else btnLer.hidden = true;
        }

        m.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function fecharModalLivro() {
        var m = $('modal-livro');
        if (m) m.hidden = true;
        document.body.style.overflow = '';
    }

    function abrirModalEstante(livro) {
        estado.livroSelecionado = livro;
        var m = $('modal-estante');
        var t = $('modal-estante-livro');
        if (t) t.textContent = livro.title;
        if (m) { m.hidden = false; document.body.style.overflow = 'hidden'; }
    }

    function fecharModalEstante() {
        var m = $('modal-estante');
        if (m) m.hidden = true;
        document.body.style.overflow = '';
    }

    /* ============================================================
       ADICIONAR À ESTANTE
       ============================================================ */
    async function adicionarAEstante(status) {
        if (!estado.livroSelecionado || !estado.usuario) return;
        var db = getDb();
        if (!db) return;

        var livro = estado.livroSelecionado;
        var botoes = document.querySelectorAll('.opcao-estante');
        botoes.forEach(function (b) { b.disabled = true; });

        try {
            var dados = {
                title: livro.title,
                author: livro.author || null,
                cover_url: livro.cover_url || null,
                description: livro.description || null,
                pages: livro.pages || null,
                year: livro.year || null,
                publisher: livro.publisher || null,
                language: livro.language || 'pt',
                genre: livro.genre || null,
                source: livro.source || 'manual',
                external_id: livro.external_id || null,
                external_url: livro.external_url || null,
                has_ebook: !!livro.has_ebook,
                ebook_url: livro.ebook_url || null
            };

            var bookId = null;
            if (livro.external_id && livro.source) {
                var ex = await db.from('books').select('id')
                    .eq('external_id', livro.external_id).eq('source', livro.source).maybeSingle();
                if (ex.data) bookId = ex.data.id;
            }
            if (!bookId) {
                var ins = await db.from('books').insert(dados).select('id').single();
                if (ins.error) throw ins.error;
                bookId = ins.data.id;
            }

            var ja = await db.from('user_books').select('id')
                .eq('user_id', estado.usuario.id).eq('book_id', bookId).maybeSingle();

            if (ja.data) {
                await db.from('user_books').update({ status: status }).eq('id', ja.data.id);
            } else {
                await db.from('user_books').insert({
                    user_id: estado.usuario.id, book_id: bookId, status: status
                });
            }

            fecharModalEstante();
            fecharModalLivro();
            window.utils.toast('Adicionado à estante!');
        } catch (e) {
            console.error(e);
            window.utils.toast('Não foi possível adicionar.', true);
        } finally {
            botoes.forEach(function (b) { b.disabled = false; });
        }
    }

    /* ============================================================
       POPOVER DE FILTROS E LAYOUT
       ============================================================ */
    function setupPopoverFiltros() {
        var btn = $('busca-filtro-btn');
        var pop = $('filtros-popover');
        if (!btn || !pop) return;

        function abrir() { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
        function fechar() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            pop.hidden ? abrir() : fechar();
        });
        document.addEventListener('click', function (e) {
            if (pop.hidden) return;
            if (pop.contains(e.target) || btn.contains(e.target)) return;
            fechar();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !pop.hidden) { fechar(); btn.focus(); }
        });

        ['filtro-idioma', 'filtro-fonte', 'filtro-ordem'].forEach(function (id) {
            var el = $(id);
            if (el) el.addEventListener('change', aplicarFiltrosEOrdenacao);
        });
    }

    function setupLayout() {
        var sidebar = $('sidebar');
        var ficha = $('sidebar-perfil');
        var overlay = $('gaveta-overlay');
        var btnHamburger = $('btn-hamburger');
        var btnPerfil = $('perfil-botao');
        var btnFechar = $('ficha-fechar');
        var compacto = window.matchMedia('(max-width: 1366px)');

        function atualizarOverlay() {
            if (!overlay) return;
            var sa = sidebar && sidebar.classList.contains('aberta');
            var fa = ficha && ficha.classList.contains('ativa');
            overlay.classList.toggle('ativa', sa || (compacto.matches && fa));
        }

        if (btnHamburger && sidebar) {
            btnHamburger.addEventListener('click', function () {
                sidebar.classList.toggle('aberta');
                atualizarOverlay();
            });
        }
        if (btnPerfil && ficha) {
            btnPerfil.addEventListener('click', function () {
                ficha.classList.toggle('ativa');
                document.body.classList.toggle('ficha-aberta', ficha.classList.contains('ativa'));
                atualizarOverlay();
            });
        }
        if (btnFechar && ficha) {
            btnFechar.addEventListener('click', function () {
                ficha.classList.remove('ativa');
                document.body.classList.remove('ficha-aberta');
                atualizarOverlay();
            });
        }
        if (overlay) {
            overlay.addEventListener('click', function () {
                if (sidebar) sidebar.classList.remove('aberta');
                if (ficha) ficha.classList.remove('ativa');
                document.body.classList.remove('ficha-aberta');
                atualizarOverlay();
            });
        }
    }

    function setupEventos() {
        var form = $('busca-form');
        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                var i = $('busca-input');
                if (i) buscarLivros(i.value);
            });
        }

        document.querySelectorAll('[data-fechar-modal]').forEach(function (el) {
            el.addEventListener('click', fecharModalLivro);
        });
        document.querySelectorAll('[data-fechar-modal-estante]').forEach(function (el) {
            el.addEventListener('click', fecharModalEstante);
        });

        var btnAdd = $('btn-adicionar-estante');
        if (btnAdd) {
            btnAdd.addEventListener('click', function () {
                if (estado.livroSelecionado) abrirModalEstante(estado.livroSelecionado);
            });
        }

        document.querySelectorAll('.opcao-estante').forEach(function (b) {
            b.addEventListener('click', function () {
                adicionarAEstante(b.getAttribute('data-status'));
            });
        });

        var btnTentar = $('btn-tentar');
        if (btnTentar) {
            btnTentar.addEventListener('click', function () {
                if (estado.modo === 'busca' && estado.buscaAtual) buscarLivros(estado.buscaAtual);
                else carregarCatalogo();
            });
        }

        var btnVoltar = $('btn-voltar-populares');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                var i = $('busca-input');
                if (i) i.value = '';
                carregarCatalogo();
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { fecharModalLivro(); fecharModalEstante(); }
        });

        var btnSair = $('btn-sair');
        if (btnSair) {
            btnSair.addEventListener('click', async function () {
                var db = getDb();
                try { if (db) await db.auth.signOut(); } catch (e) { /* ignora */ }
                window.location.replace(PAGINA_LOGIN);
            });
        }

        setupLayout();
        setupPopoverFiltros();
    }

    /* ============================================================
       INICIALIZAÇÃO
       ============================================================ */
    async function iniciar() {
        setupEventos();

        var ok = await iniciarSessao();
        if (!ok) return;

        await carregarCatalogo();
        document.documentElement.classList.remove('carregando-catalogo');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();