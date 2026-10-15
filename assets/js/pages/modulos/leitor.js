/* ============================================================
   LEITOR.JS — v15 (VERSAO QUE FUNCIONAVA)
   - Texto aparece em todas as paginas
   - Navegacao com botoes
   - Marcar texto funcionando
   ============================================================ */
(function () {
    'use strict';

    const PAGINA_LOGIN = '/login.html';
    const SUPABASE_TENTATIVAS = 40;
    const SUPABASE_INTERVALO_MS = 200;

    const TAMANHO_FONTE_MIN = 14;
    const TAMANHO_FONTE_MAX = 28;
    const TAMANHO_FONTE_PADRAO = 19;
    const MIN_WIDTH_PARA_LIVRO = 1024;

    const $ = (id) => document.getElementById(id);

    let book = null;
    let rendition = null;
    let usuario = null;
    let db = null;
    let tamanhoFonte = TAMANHO_FONTE_PADRAO;
    let timerSalvar = null;
    let paginasTotais = 0;
    let modoMarcacao = false;
    let cfiSelecaoAtual = null;

    const estado = {
        url: null,
        titulo: '',
        slug: '',
        autor: '',
        capa: ''
    };

    function getDb() {
        if (window.getSupabaseClient) return window.getSupabaseClient();
        return window.supabaseClient ||
               (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    async function aguardarDb() {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const d = getDb();
            if (d && d.auth && typeof d.auth.getSession === 'function') return d;
            await new Promise((r) => setTimeout(r, SUPABASE_INTERVALO_MS));
        }
        return null;
    }

    function irParaLogin() {
        window.location.replace(PAGINA_LOGIN);
    }

    async function baixarEpub(urlOriginal) {
        const config = window.SUPABASE_CONFIG;
        if (!config || !config.url) {
            const r = await fetch(urlOriginal);
            if (!r.ok) throw new Error('Falha ao baixar EPUB: ' + r.status);
            return await r.arrayBuffer();
        }
        const base = config.url.replace(/\/$/, '');
        const proxyUrl = base + '/functions/v1/epub-proxy?url=' + encodeURIComponent(urlOriginal);
        const headers = {};
        if (config.anonKey) {
            headers['Authorization'] = 'Bearer ' + config.anonKey;
            headers['apikey'] = config.anonKey;
        }
        const r = await fetch(proxyUrl, { headers });
        if (!r.ok) throw new Error('Proxy retornou ' + r.status);
        return await r.arrayBuffer();
    }

    function lerParametros() {
        const params = new URLSearchParams(window.location.search);
        estado.url = params.get('url');
        estado.titulo = params.get('titulo') || 'Livro';
        estado.slug = params.get('slug') || '';
        estado.autor = params.get('autor') || '';
        estado.capa = params.get('capa') || '';

        if (!estado.url) {
            mostrarErro('URL do livro nao foi fornecida.');
            return false;
        }
        document.title = estado.titulo + ' | Acervo';
        const el = $('leitor-titulo');
        if (el) el.textContent = estado.titulo;
        return true;
    }

    async function aguardarSessao(d) {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const resultado = await d.auth.getSession();
            if (resultado.error) throw resultado.error;
            const sessao = resultado.data && resultado.data.session;
            if (sessao && sessao.user) return sessao;
            await new Promise((r) => setTimeout(r, SUPABASE_INTERVALO_MS));
        }
        return null;
    }

    async function iniciarSessao() {
        db = await aguardarDb();
        if (!db) { irParaLogin(); return false; }

        db.auth.onAuthStateChange((evento) => {
            if (evento === 'SIGNED_OUT') irParaLogin();
        });

        try {
            const sessao = await aguardarSessao(db);
            if (!sessao) { irParaLogin(); return false; }

            usuario = sessao.user;
            const meta = usuario.user_metadata || {};
            const nome = meta.full_name || meta.name || usuario.email || 'Usuario';
            const avatar = meta.avatar_url || meta.picture || null;

            renderizarAvatar($('perfil-usuario'), avatar, nome);
            renderizarAvatar($('sidebar-perfil-foto'), avatar, nome);

            const elNome = $('sidebar-perfil-nome');
            const elEmail = $('sidebar-perfil-email');
            if (elNome) elNome.textContent = nome.split('@')[0];
            if (elEmail) elEmail.textContent = usuario.email || '';
            return true;
        } catch (erro) {
            console.error('Erro getSession:', erro);
            irParaLogin();
            return false;
        }
    }

    function renderizarAvatar(container, avatarUrl, nome) {
        if (!container) return;
        container.textContent = '';

        if (!avatarUrl || avatarUrl === 'null') {
            const span = document.createElement('span');
            span.className = 'avatar-iniciais';
            const partes = (nome || 'U').trim().split(/\s+/);
            span.textContent = (partes[0][0] || 'U').toUpperCase() +
                              (partes.length > 1 ? (partes[partes.length - 1][0] || '').toUpperCase() : '');
            container.appendChild(span);
            return;
        }
        const img = document.createElement('img');
        img.className = 'foto-perfil';
        img.alt = 'Foto de perfil';
        img.referrerPolicy = 'no-referrer';
        img.src = avatarUrl;
        img.onerror = () => {
            img.remove();
            const span = document.createElement('span');
            span.className = 'avatar-iniciais';
            span.textContent = (nome || 'U').charAt(0).toUpperCase();
            container.appendChild(span);
        };
        container.appendChild(img);
    }

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
        } catch (e) { console.warn('Erro historico:', e); }
    }

    async function carregarProgresso() {
        if (!db || !usuario || !estado.slug) return null;
        try {
            const r = await db.from('reading_progress')
                .select('position, percent')
                .eq('user_id', usuario.id)
                .eq('book_slug', estado.slug)
                .maybeSingle();
            return r.data || null;
        } catch (e) { return null; }
    }

    function salvarProgresso(position, percent) {
        if (!db || !usuario || !estado.slug) return;
        clearTimeout(timerSalvar);
        timerSalvar = setTimeout(async () => {
            try {
                await db.from('reading_progress').upsert({
                    user_id: usuario.id,
                    book_slug: estado.slug,
                    book_title: estado.titulo,
                    position: position,
                    percent: percent,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id,book_slug' });
            } catch (e) { console.warn('Erro progresso:', e); }
        }, 1200);
    }

    function atualizarProgresso(percent) {
        const fillTop = $('progresso-fill');
        const fillSide = $('progresso-fill-sidebar');
        const texto = $('progresso-texto');
        if (fillTop) fillTop.style.width = percent + '%';
        if (fillSide) fillSide.style.width = percent + '%';
        if (texto) texto.textContent = Math.round(percent) + '%';
    }

    async function carregarMarcacoes() {
        if (!db || !usuario || !estado.slug) return [];
        try {
            const r = await db.from('reading_highlights')
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
            const r = await db.from('reading_highlights').insert({
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
        const lista = $('lista-marcacoes');
        if (!lista) return;
        lista.textContent = '';

        if (!estado.marcacoes || estado.marcacoes.length === 0) {
            const li = document.createElement('li');
            li.className = 'marcacao-vazia';
            li.textContent = 'Nenhuma marcacao ainda';
            lista.appendChild(li);
            return;
        }
        estado.marcacoes.forEach((m) => {
            const li = document.createElement('li');
            li.className = 'marcacao-item';
            li.textContent = m.text.length > 140 ? m.text.slice(0, 140) + '...' : m.text;
            li.title = 'Clique para ir ao trecho';
            li.addEventListener('click', () => { if (rendition && m.cfi) rendition.display(m.cfi); });
            lista.appendChild(li);
        });
    }

    function aplicarModoMarcacao() {
        document.body.classList.toggle('modo-marcacao', modoMarcacao);
        const btn = $('btn-marcar-modo');
        if (btn) {
            btn.setAttribute('aria-pressed', String(modoMarcacao));
            const span = btn.querySelector('span');
            if (span) span.textContent = modoMarcacao ? 'Marcando' : 'Marcar';
        }
        injetarListenersEmTodos();
    }

    function injetarListenersEmTodos() {
        if (!rendition) return;
        rendition.getContents().forEach((c) => injetarListeners(c));
    }

    function injetarListeners(contents) {
        if (!contents || !contents.document) return;
        if (contents._acervoListeners) return;
        contents._acervoListeners = true;
        const doc = contents.document;
        doc.addEventListener('mouseup', () => {
            if (!modoMarcacao) return;
            setTimeout(() => processarSelecao(contents), 50);
        });
        doc.addEventListener('touchend', () => {
            if (!modoMarcacao) return;
            setTimeout(() => processarSelecao(contents), 50);
        });
    }

    async function processarSelecao(contents) {
        try {
            const sel = contents.window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const texto = sel.toString().trim();
            if (!texto || texto.length < 3) return;

            const range = sel.getRangeAt(0);
            const cfi = contents.cfiFromRange(range);
            if (!cfi || cfi === cfiSelecaoAtual) return;
            cfiSelecaoAtual = cfi;

            try { contents.addClass('acervo-highlight', cfi); } catch (e) {}
            sel.removeAllRanges();

            const marcacao = await salvarMarcacao(cfi, texto);
            if (marcacao) {
                estado.marcacoes.unshift(marcacao);
                renderizarMarcacoes();
            }
        } catch (e) { console.warn('Erro selecao:', e); }
    }

    function aplicarHighlightsSalvos() {
        if (!rendition || !estado.marcacoes) return;
        estado.marcacoes.forEach((m) => {
            try { rendition.annotations.highlight(m.cfi, {}, () => {}, 'acervo-highlight'); } catch (e) {}
        });
    }

    async function abrirLivro() {
        const loading = $('leitor-loading');
        const livro = $('leitor-livro');
        const areaUnica = $('area');

        if (loading) loading.hidden = false;
        if (livro) livro.hidden = true;
        if (areaUnica) areaUnica.hidden = true;

        try {
            const buffer = await baixarEpub(estado.url);
            book = ePub(buffer);
            await book.ready;

            if (loading) loading.hidden = true;

            const podeLivro = window.innerWidth >= MIN_WIDTH_PARA_LIVRO;
            if (podeLivro) {
                if (livro) livro.hidden = false;
                await renderizarLivroAberto();
            } else {
                if (areaUnica) areaUnica.hidden = false;
                await renderizarPaginaUnica();
            }
            registrarHistorico();
        } catch (erro) {
            console.error('Erro EPUB:', erro);
            mostrarErro('Nao foi possivel carregar este livro. ' + (erro.message || ''));
        }
    }

    async function renderizarLivroAberto() {
        const elEsq = $('area-esq');
        if (!elEsq) return;

        // Espera o layout
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => setTimeout(r, 100));

        rendition = book.renderTo('area-esq', {
            width: '100%',
            height: '100%',
            flow: 'paginated',
            spread: 'auto',
            minSpreadWidth: 600
        });

        aplicarFonte();
        aplicarTema();

        // Carrega progresso
        const progresso = await carregarProgresso();

        // Configura eventos ANTES do display
        configurarEventosRendition();

        // Exibe
        if (progresso && progresso.position) {
            await rendition.display(progresso.position);
        } else {
            await rendition.display();
        }

        // Gera locations para numeracao
        await book.locations.generate(600);
        paginasTotais = book.locations.length();

        // Atualiza numeracao
        setTimeout(atualizarNumeracaoAtual, 500);
    }

    async function renderizarPaginaUnica() {
        const area = $('area');
        if (!area) return;

        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => setTimeout(r, 100));

        rendition = book.renderTo('area', {
            width: '100%',
            height: '100%',
            flow: 'paginated',
            spread: 'none'
        });

        aplicarFonte();
        aplicarTema();

        const progresso = await carregarProgresso();
        configurarEventosRendition();

        if (progresso && progresso.position) {
            await rendition.display(progresso.position);
        } else {
            await rendition.display();
        }

        await book.locations.generate(600);
        paginasTotais = book.locations.length();

        setTimeout(atualizarNumeracaoAtual, 500);
    }

    function atualizarNumeracaoAtual() {
        const el = $('nav-pagina');
        if (!el || !rendition) return;

        try {
            const loc = rendition.currentLocation();
            if (!loc) return;

            const cfi = loc.start.cfi;

            // Tenta pela localizacao
            let pagina = -1;
            try {
                pagina = book.locations.locationFromCfi(cfi);
            } catch (e) { /* ignora */ }

            if (pagina >= 0 && paginasTotais > 0) {
                el.textContent = (pagina + 1) + ' / ' + paginasTotais;
                return;
            }

            // Fallback
            if (loc.start.displayed && loc.start.displayed.page) {
                el.textContent = loc.start.displayed.page + ' / ' + loc.start.displayed.total;
                return;
            }

            if (el.textContent === '— / —') {
                el.textContent = '1 / ' + (paginasTotais || '...');
            }
        } catch (e) {
            console.warn('Erro numeracao:', e);
        }
    }

    function configurarEventosRendition() {
        if (!rendition) return;

        (async () => {
            estado.marcacoes = await carregarMarcacoes();
            renderizarMarcacoes();
            aplicarHighlightsSalvos();
        })();

        rendition.on('relocated', (location) => {
            const cfi = location.start.cfi;

            // Numeracao
            const el = $('nav-pagina');
            if (el) {
                const paginaAtual = book.locations.locationFromCfi(cfi);
                if (paginaAtual >= 0 && paginasTotais > 0) {
                    el.textContent = (paginaAtual + 1) + ' / ' + paginasTotais;
                } else if (location.start.displayed) {
                    el.textContent = location.start.displayed.page + ' / ' + location.start.displayed.total;
                }
            }

            // Progresso
            const percent = book.locations.percentageFromCfi(cfi) * 100;
            atualizarProgresso(percent);
            salvarProgresso(cfi, percent);

            // Re-injeta listeners
            setTimeout(injetarListenersEmTodos, 300);
        });

        rendition.on('rendered', (section, view) => {
            if (view && view.contents) injetarListeners(view.contents);
        });

        const btnAnterior = $('btn-anterior');
        const btnProximo = $('btn-proximo');
        if (btnAnterior) btnAnterior.addEventListener('click', () => rendition && rendition.prev());
        if (btnProximo) btnProximo.addEventListener('click', () => rendition && rendition.next());

        document.addEventListener('keydown', (e) => {
            if (!rendition) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); rendition.prev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); rendition.next(); }
            if (e.key === ' ') { e.preventDefault(); rendition.next(); }
        });
    }

    function aplicarFonte() {
        if (!rendition) return;
        rendition.themes.fontSize(tamanhoFonte + 'px');
    }

    function aplicarTema() {
        if (!rendition) return;
        rendition.themes.default({
            'body': {
                'font-family': "'Cormorant Garamond', Georgia, serif",
                'font-size': tamanhoFonte + 'px',
                'line-height': '1.75',
                'color': '#1A1614', 'background': '#F8F2E4',
                'padding': '2rem 3rem',
                'overflow': 'hidden',
                '-webkit-user-select': 'text', 'user-select': 'text'
            },
            'p': { 'margin': '0 0 1em 0', 'text-align': 'justify' },
            'h1, h2, h3': {
                'font-family': "'Playfair Display', Georgia, serif",
                'font-style': 'italic', 'color': '#5C1A1A'
            },
            'a': { 'color': '#5C1A1A' },
            '.acervo-highlight': {
                'background-color': 'rgba(184, 137, 74, 0.45)',
                'border-bottom': '2px solid #B8894A',
                'cursor': 'pointer'
            }
        });
    }

    function configurarControles() {
        const btnMais = $('btn-font-mais');
        const btnMenos = $('btn-font-menos');
        const btnMarcar = $('btn-marcar-modo');

        if (btnMais) btnMais.addEventListener('click', () => {
            tamanhoFonte = Math.min(TAMANHO_FONTE_MAX, tamanhoFonte + 2);
            aplicarFonte();
        });
        if (btnMenos) btnMenos.addEventListener('click', () => {
            tamanhoFonte = Math.max(TAMANHO_FONTE_MIN, tamanhoFonte - 2);
            aplicarFonte();
        });
        if (btnMarcar) btnMarcar.addEventListener('click', () => {
            modoMarcacao = !modoMarcacao;
            aplicarModoMarcacao();
        });
    }

    function configurarLayout() {
        const ficha = $('sidebar-perfil');
        const overlay = $('gaveta-overlay');
        const btnPerfil = $('perfil-botao');
        const btnFecharFicha = $('ficha-fechar');
        const compacto = window.matchMedia('(max-width: 1366px)');

        function atualizarOverlay() {
            if (!overlay) return;
            const aberta = ficha && ficha.classList.contains('ativa');
            overlay.classList.toggle('ativa', aberta && compacto.matches);
        }

        if (btnPerfil && ficha) {
            btnPerfil.addEventListener('click', () => {
                ficha.classList.toggle('ativa');
                document.body.classList.toggle('ficha-aberta', ficha.classList.contains('ativa'));
                atualizarOverlay();
            });
        }
        if (btnFecharFicha && ficha) {
            btnFecharFicha.addEventListener('click', () => {
                ficha.classList.remove('ativa');
                document.body.classList.remove('ficha-aberta');
                atualizarOverlay();
            });
        }
        if (overlay) {
            overlay.addEventListener('click', () => {
                if (ficha) ficha.classList.remove('ativa');
                document.body.classList.remove('ficha-aberta');
                atualizarOverlay();
            });
        }
    }

    function mostrarErro(mensagem) {
        const loading = $('leitor-loading');
        const erro = $('leitor-erro');
        const msg = $('erro-mensagem');
        if (loading) loading.hidden = true;
        if (msg) msg.textContent = mensagem;
        if (erro) erro.hidden = false;
    }

    async function iniciar() {
        if (!lerParametros()) return;
        const ok = await iniciarSessao();
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