/* ============================================================
   LEITOR.JS — v16
   Leitor EPUB com marcação e histórico.
   Depende de: epub.min.js, jszip.min.js, utils.js, auth.js
   ============================================================ */
(function () {
    'use strict';

    var PAGINA_LOGIN = '/login.html';
    var TENTATIVAS_DB = 40;
    var INTERVALO_DB = 200;
    var FONTE_MIN = 14;
    var FONTE_MAX = 28;
    var FONTE_PADRAO = 19;
    var MIN_WIDTH_LIVRO = 1024;
    var HIGHLIGHT_CLASS = 'acervo-highlight';

    var $ = function (id) { return document.getElementById(id); };
    var esperar = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    var book = null;
    var rendition = null;
    var usuario = null;
    var db = null;
    var tamanhoFonte = FONTE_PADRAO;
    var timerSalvar = null;
    var paginasTotais = 0;
    var modoMarcacao = false;
    var cfiSelecaoAtual = null;
    var marcacoes = [];

    var estado = { url: null, titulo: '', slug: '', autor: '', capa: '' };

    function getDb() {
        return window.getSupabaseClientSeguro ? window.getSupabaseClientSeguro()
                                              : window.getSupabaseClient();
    }

    async function aguardarDb() {
        for (var i = 0; i < TENTATIVAS_DB; i++) {
            var d = getDb();
            if (d && d.auth && typeof d.auth.getSession === 'function') return d;
            await esperar(INTERVALO_DB);
        }
        return null;
    }

    /* ---------- Parâmetros ---------- */
    function lerParametros() {
        var p = new URLSearchParams(window.location.search);
        estado.url = p.get('url');
        estado.titulo = p.get('titulo') || 'Livro';
        estado.slug = p.get('slug') || '';
        estado.autor = p.get('autor') || '';
        estado.capa = p.get('capa') || '';

        if (!estado.url) { mostrarErro('URL do livro não foi fornecida.'); return false; }
        document.title = estado.titulo + ' | Acervo';
        var el = $('leitor-titulo');
        if (el) el.textContent = estado.titulo;
        return true;
    }

    /* ---------- Sessão ---------- */
    async function iniciarSessao() {
        db = await aguardarDb();
        if (!db) { window.location.replace(PAGINA_LOGIN); return false; }

        db.auth.onAuthStateChange(function (evento) {
            if (evento === 'SIGNED_OUT') window.location.replace(PAGINA_LOGIN);
        });

        try {
            for (var i = 0; i < TENTATIVAS_DB; i++) {
                var r = await db.auth.getSession();
                var sessao = r && r.data && r.data.session;
                if (sessao && sessao.user) {
                    usuario = sessao.user;
                    var meta = usuario.user_metadata || {};
                    var nome = meta.full_name || meta.name || usuario.email || 'Usuário';
                    var avatar = meta.avatar_url || meta.picture || null;
                    window.utils.renderizarAvatar($('perfil-usuario'), avatar, nome);
                    window.utils.renderizarAvatar($('sidebar-perfil-foto'), avatar, nome);
                    var n = $('sidebar-perfil-nome'), e = $('sidebar-perfil-email');
                    if (n) n.textContent = nome.split('@')[0];
                    if (e) e.textContent = usuario.email || '';
                    return true;
                }
                await esperar(INTERVALO_DB);
            }
            window.location.replace(PAGINA_LOGIN);
            return false;
        } catch (err) {
            console.error(err);
            window.location.replace(PAGINA_LOGIN);
            return false;
        }
    }

    /* ---------- Download EPUB via proxy ---------- */
    async function baixarEpub(urlOriginal) {
        var config = window.SUPABASE_CONFIG;
        if (!config || !config.url) {
            var r = await fetch(urlOriginal);
            if (!r.ok) throw new Error('Falha ao baixar EPUB: ' + r.status);
            return await r.arrayBuffer();
        }
        var base = config.url.replace(/\/$/, '');
        var proxy = base + '/functions/v1/epub-proxy?url=' + encodeURIComponent(urlOriginal);
        var headers = {};
        if (config.anonKey) {
            headers['Authorization'] = 'Bearer ' + config.anonKey;
            headers['apikey'] = config.anonKey;
        }
        var resp = await fetch(proxy, { headers: headers });
        if (!resp.ok) throw new Error('Proxy retornou ' + resp.status);
        return await resp.arrayBuffer();
    }

    /* ---------- Progresso / Histórico ---------- */
    async function registrarHistorico() {
        if (!db || !usuario || !estado.slug) return;
        try {
            await db.from('reading_history').upsert({
                user_id: usuario.id,
                book_slug: estado.slug,
                book_title: estado.titulo,
                book_author: estado.autor || null,
                book_cover: estado.capa || null,
                last_read_at: new Date().toISOString()
            }, { onConflict: 'user_id,book_slug' });
        } catch (e) { console.warn(e); }
    }

    async function carregarProgresso() {
        if (!db || !usuario || !estado.slug) return null;
        try {
            var r = await db.from('reading_progress')
                .select('position, percent')
                .eq('user_id', usuario.id)
                .eq('book_slug', estado.slug).maybeSingle();
            return r.data || null;
        } catch (e) { return null; }
    }

    function salvarProgresso(position, percent) {
        if (!db || !usuario || !estado.slug) return;
        clearTimeout(timerSalvar);
        timerSalvar = setTimeout(async function () {
            try {
                await db.from('reading_progress').upsert({
                    user_id: usuario.id,
                    book_slug: estado.slug,
                    book_title: estado.titulo,
                    position: position,
                    percent: percent,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id,book_slug' });
            } catch (e) { /* ignora */ }
        }, 1200);
    }

    function atualizarProgresso(percent) {
        var a = $('progresso-fill'), b = $('progresso-fill-sidebar'), t = $('progresso-texto');
        if (a) a.style.width = percent + '%';
        if (b) b.style.width = percent + '%';
        if (t) t.textContent = Math.round(percent) + '%';
    }

    /* ---------- Marcações ---------- */
    async function carregarMarcacoes() {
        if (!db || !usuario || !estado.slug) return [];
        try {
            var r = await db.from('reading_highlights')
                .select('id, cfi, text, created_at')
                .eq('user_id', usuario.id)
                .eq('book_slug', estado.slug)
                .order('created_at', { ascending: false });
            return r.data || [];
        } catch (e) { return []; }
    }

    async function salvarMarcacao(cfi, texto) {
        if (!db || !usuario || !estado.slug) return null;
        try {
            var r = await db.from('reading_highlights').insert({
                user_id: usuario.id,
                book_slug: estado.slug,
                book_title: estado.titulo,
                cfi: cfi,
                text: texto
            }).select('id, cfi, text, created_at').single();
            return r.data;
        } catch (e) { return null; }
    }

    function renderizarMarcacoes() {
        var lista = $('lista-marcacoes');
        if (!lista) return;
        window.utils.limpar(lista);

        if (!marcacoes.length) {
            var li = document.createElement('li');
            li.className = 'marcacao-vazia';
            li.textContent = 'Nenhuma marcação ainda';
            lista.appendChild(li);
            return;
        }
        marcacoes.forEach(function (m) {
            var li = document.createElement('li');
            li.className = 'marcacao-item';
            li.textContent = m.text.length > 140 ? m.text.slice(0, 140) + '...' : m.text;
            li.title = 'Clique para ir ao trecho';
            li.addEventListener('click', function () {
                if (rendition && m.cfi) rendition.display(m.cfi);
            });
            lista.appendChild(li);
        });
    }

    /* ---------- Marcação de texto ---------- */
    function aplicarModoMarcacao() {
        document.body.classList.toggle('modo-marcacao', modoMarcacao);
        var btn = $('btn-marcar-modo');
        if (btn) {
            btn.setAttribute('aria-pressed', String(modoMarcacao));
            var s = btn.querySelector('span');
            if (s) s.textContent = modoMarcacao ? 'Marcando' : 'Marcar';
        }
        injetarListenersEmTodos();
    }

    function injetarListenersEmTodos() {
        if (!rendition) return;
        rendition.getContents().forEach(injetarListeners);
    }

    function injetarListeners(contents) {
        if (!contents || !contents.document || contents._aulooListeners) return;
        contents._aulooListeners = true;

        var handler = function () {
            if (!modoMarcacao) return;
            setTimeout(function () { processarSelecao(contents); }, 50);
        };
        contents.document.addEventListener('mouseup', handler);
        contents.document.addEventListener('touchend', handler);
    }

    async function processarSelecao(contents) {
        try {
            var sel = contents.window.getSelection();
            if (!sel || !sel.rangeCount) return;
            var texto = sel.toString().trim();
            if (!texto || texto.length < 3) return;

            var range = sel.getRangeAt(0);
            var cfi = contents.cfiFromRange(range);
            if (!cfi || cfi === cfiSelecaoAtual) return;
            cfiSelecaoAtual = cfi;

            try { contents.addClass(HIGHLIGHT_CLASS, cfi); } catch (e) { /* ignora */ }
            sel.removeAllRanges();

            var m = await salvarMarcacao(cfi, texto);
            if (m) { marcacoes.unshift(m); renderizarMarcacoes(); }
        } catch (e) { console.warn(e); }
    }

    function aplicarHighlightsSalvos() {
        if (!rendition || !marcacoes.length) return;
        marcacoes.forEach(function (m) {
            try { rendition.annotations.highlight(m.cfi, {}, function () {}, HIGHLIGHT_CLASS); }
            catch (e) { /* ignora */ }
        });
    }

    /* ---------- Renderização do livro ---------- */
    async function abrirLivro() {
        var loading = $('leitor-loading');
        var livro = $('leitor-livro');
        var area = $('area');

        if (loading) loading.hidden = false;
        if (livro) livro.hidden = true;
        if (area) area.hidden = true;

        try {
            var buffer = await baixarEpub(estado.url);
            book = ePub(buffer);
            await book.ready;

            if (loading) loading.hidden = true;

            if (window.innerWidth >= MIN_WIDTH_LIVRO) {
                if (livro) livro.hidden = false;
                await renderizarLivroAberto();
            } else {
                if (area) area.hidden = false;
                await renderizarPaginaUnica();
            }
            registrarHistorico();
        } catch (e) {
            console.error(e);
            mostrarErro('Não foi possível carregar este livro. ' + (e.message || ''));
        }
    }

    async function renderizarLivroAberto() {
        var el = $('area-esq');
        if (!el) return;
        rendition = book.renderTo('area-esq', {
            width: '100%', height: '100%',
            flow: 'paginated', spread: 'auto', minSpreadWidth: 600
        });
        aplicarFonte();
        aplicarTema();
        var prog = await carregarProgresso();
        await (prog && prog.position ? rendition.display(prog.position) : rendition.display());
        await book.locations.generate(600);
        paginasTotais = book.locations.length();
        configurarEventosRendition();
    }

    async function renderizarPaginaUnica() {
        var el = $('area');
        if (!el) return;
        rendition = book.renderTo('area', {
            width: '100%', height: '100%',
            flow: 'paginated', spread: 'none'
        });
        aplicarFonte();
        aplicarTema();
        var prog = await carregarProgresso();
        await (prog && prog.position ? rendition.display(prog.position) : rendition.display());
        await book.locations.generate(600);
        paginasTotais = book.locations.length();
        configurarEventosRendition();
    }

    function configurarEventosRendition() {
        if (!rendition) return;

        (async function () {
            marcacoes = await carregarMarcacoes();
            renderizarMarcacoes();
            aplicarHighlightsSalvos();
        })();

        rendition.on('relocated', function (loc) {
            var cfi = loc.start.cfi;
            var percent = book.locations.percentageFromCfi(cfi) * 100;
            var pag = book.locations.locationFromCfi(cfi);
            var el = $('nav-pagina');
            if (el && paginasTotais > 0 && pag >= 0) {
                el.textContent = (pag + 1) + ' / ' + paginasTotais;
            }
            atualizarProgresso(percent);
            salvarProgresso(cfi, percent);
            setTimeout(injetarListenersEmTodos, 300);
        });

        rendition.on('rendered', function (section, view) {
            if (view && view.contents) injetarListeners(view.contents);
        });

        var ant = $('btn-anterior');
        var prox = $('btn-proximo');
        if (ant) ant.addEventListener('click', function () { rendition && rendition.prev(); });
        if (prox) prox.addEventListener('click', function () { rendition && rendition.next(); });

        document.addEventListener('keydown', function (e) {
            if (!rendition) return;
            if (e.key === 'ArrowLeft')  { e.preventDefault(); rendition.prev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); rendition.next(); }
            if (e.key === ' ')          { e.preventDefault(); rendition.next(); }
        });
    }

    function aplicarFonte() {
        if (rendition) rendition.themes.fontSize(tamanhoFonte + 'px');
    }

    function aplicarTema() {
        if (!rendition) return;
        rendition.themes.default({
            'body': {
                'font-family': "'Cormorant Garamond', Georgia, serif",
                'font-size': tamanhoFonte + 'px',
                'line-height': '1.75',
                'color': '#1A1614',
                'background': '#F8F2E4',
                'padding': '2rem 3rem',
                'overflow': 'hidden',
                '-webkit-user-select': 'text',
                'user-select': 'text'
            },
            'p': { 'margin': '0 0 1em 0', 'text-align': 'justify' },
            'h1,h2,h3': {
                'font-family': "'Playfair Display', Georgia, serif",
                'font-style': 'italic',
                'color': '#5C1A1A'
            },
            'a': { 'color': '#5C1A1A' },
            '.acervo-highlight': {
                'background-color': 'rgba(184,137,74,0.45)',
                'border-bottom': '2px solid #B8894A',
                'cursor': 'pointer'
            }
        });
    }

    function configurarControles() {
        var mais = $('btn-font-mais');
        var menos = $('btn-font-menos');
        var marcar = $('btn-marcar-modo');

        if (mais) mais.addEventListener('click', function () {
            tamanhoFonte = Math.min(FONTE_MAX, tamanhoFonte + 2);
            aplicarFonte();
        });
        if (menos) menos.addEventListener('click', function () {
            tamanhoFonte = Math.max(FONTE_MIN, tamanhoFonte - 2);
            aplicarFonte();
        });
        if (marcar) marcar.addEventListener('click', function () {
            modoMarcacao = !modoMarcacao;
            aplicarModoMarcacao();
        });
    }

    function configurarLayout() {
        var ficha = $('sidebar-perfil');
        var overlay = $('gaveta-overlay');
        var btnPerfil = $('perfil-botao');
        var btnFechar = $('ficha-fechar');
        var compacto = window.matchMedia('(max-width: 1366px)');

        function atualizarOverlay() {
            if (!overlay) return;
            var aberta = ficha && ficha.classList.contains('ativa');
            overlay.classList.toggle('ativa', aberta && compacto.matches);
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
                if (ficha) ficha.classList.remove('ativa');
                document.body.classList.remove('ficha-aberta');
                atualizarOverlay();
            });
        }
    }

    function mostrarErro(msg) {
        var loading = $('leitor-loading');
        var erro = $('leitor-erro');
        var m = $('erro-mensagem');
        if (loading) loading.hidden = true;
        if (m) m.textContent = msg;
        if (erro) erro.hidden = false;
    }

    async function iniciar() {
        if (!lerParametros()) return;
        var ok = await iniciarSessao();
        if (!ok) return;
        configurarLayout();
        configurarControles();
        await abrirLivro();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();