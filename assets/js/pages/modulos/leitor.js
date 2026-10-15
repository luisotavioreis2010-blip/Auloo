/* ============================================================
   LEITOR.JS — v10
   Leitor em tela cheia com:
   - EPUB via Edge Function (com fetch autenticado)
   - Modo marcacao de texto (salva trechos no Supabase)
   - Ficha do leitor padrao estante
   - Usa flow: 'scrolled' para leitura continua (mais confiavel)
   ============================================================ */
(function () {
    'use strict';

    const PAGINA_LOGIN = '/login.html';
    const SUPABASE_TENTATIVAS = 40;
    const SUPABASE_INTERVALO_MS = 200;

    const TAMANHO_FONTE_MIN = 14;
    const TAMANHO_FONTE_MAX = 28;
    const TAMANHO_FONTE_PADRAO = 19;

    const $ = (id) => document.getElementById(id);

    let book = null;
    let rendition = null;
    let usuario = null;
    let db = null;
    let tamanhoFonte = TAMANHO_FONTE_PADRAO;
    let modoMarcacao = false;
    let timerSalvar = null;

    const estado = {
        url: null,
        titulo: '',
        slug: '',
        marcacoes: []
    };

    /* ============================================================
       HELPERS
       ============================================================ */
    function getDb() {
        return window.supabaseClient ||
               (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    async function aguardarDb() {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const d = getDb();
            if (d) return d;
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

        const r = await fetch(proxyUrl, { headers: headers });
        if (!r.ok) throw new Error('Proxy retornou ' + r.status);
        return await r.arrayBuffer();
    }

    /* ============================================================
       PARAMETROS
       ============================================================ */
    function lerParametros() {
        const params = new URLSearchParams(window.location.search);
        estado.url = params.get('url');
        estado.titulo = params.get('titulo') || 'Livro';
        estado.slug = params.get('slug') || '';

        if (!estado.url) {
            mostrarErro('URL do livro nao foi fornecida.');
            return false;
        }

        document.title = estado.titulo + ' | Acervo';
        const el = $('leitor-titulo');
        if (el) el.textContent = estado.titulo;
        return true;
    }

    /* ============================================================
       AUTENTICACAO
       ============================================================ */
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
        if (!db) {
            console.error('Supabase nao inicializou');
            irParaLogin();
            return false;
        }

        db.auth.onAuthStateChange((evento) => {
            if (evento === 'SIGNED_OUT') irParaLogin();
        });

        try {
            const sessao = await aguardarSessao(db);
            if (!sessao) {
                irParaLogin();
                return false;
            }

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

    /* ============================================================
       PROGRESSO
       ============================================================ */
    async function carregarProgresso() {
        if (!db || !usuario || !estado.slug) return null;
        try {
            const r = await db.from('reading_progress')
                .select('position, percent')
                .eq('user_id', usuario.id)
                .eq('book_slug', estado.slug)
                .maybeSingle();
            return r.data || null;
        } catch (e) {
            console.warn('Erro ao carregar progresso:', e);
            return null;
        }
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
            } catch (e) {
                console.warn('Erro ao salvar progresso:', e);
            }
        }, 1200);
    }

    function atualizarBarraProgresso(percent) {
        const fill = $('progresso-fill');
        const texto = $('progresso-texto');
        if (fill) fill.style.width = percent + '%';
        if (texto) texto.textContent = Math.round(percent) + '%';
    }

    /* ============================================================
       MARCACOES
       ============================================================ */
    async function carregarMarcacoes() {
        if (!db || !usuario || !estado.slug) return [];
        try {
            const r = await db.from('reading_highlights')
                .select('id, cfi, text, created_at')
                .eq('user_id', usuario.id)
                .eq('book_slug', estado.slug)
                .order('created_at', { ascending: false });
            return r.data || [];
        } catch (e) {
            console.warn('Erro ao carregar marcacoes:', e);
            return [];
        }
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
        } catch (e) {
            console.warn('Erro ao salvar marcacao:', e);
            return null;
        }
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
            li.addEventListener('click', () => {
                if (rendition && m.cfi) rendition.display(m.cfi);
            });
            lista.appendChild(li);
        });
    }

    /* ============================================================
       EPUB — com flow: 'scrolled' (mais confiavel)
       ============================================================ */
    async function abrirLivro() {
        const area = $('area');
        const loading = $('leitor-loading');
        const nav = $('leitor-nav');

        if (loading) loading.hidden = false;
        if (area) area.hidden = true;
        if (nav) nav.hidden = true;

        try {
            const buffer = await baixarEpub(estado.url);

            book = ePub(buffer);
            await book.ready;

            if (loading) loading.hidden = true;
            if (area) area.hidden = false;
            if (nav) nav.hidden = false;

            // Deixa o navegador calcular o layout
            await new Promise((r) => requestAnimationFrame(r));
            await new Promise((r) => requestAnimationFrame(r));
            await new Promise((r) => setTimeout(r, 100));

            // Renderiza com flow 'scrolled' — mais confiavel que 'paginated'
            rendition = book.renderTo('area', {
                width: '100%',
                height: '100%',
                flow: 'scrolled',
                spread: 'none'
            });

            aplicarFonte();
            aplicarTema();
            aplicarModoMarcacao();

            // Exibe o conteudo
            const progresso = await carregarProgresso();
            if (progresso && progresso.position) {
                await rendition.display(progresso.position);
            } else {
                await rendition.display();
            }

            rendition.on('relocated', (location) => {
                const pos = location.start.cfi;
                const percent = book.locations.percentageFromCfi(pos) * 100;
                salvarProgresso(pos, percent);
                atualizarBarraProgresso(percent);

                const navPagina = $('nav-pagina');
                if (navPagina && location.start.displayed) {
                    navPagina.textContent = location.start.displayed.page + ' / ' + location.start.displayed.total;
                }
            });

            book.locations.generate(1000);

            estado.marcacoes = await carregarMarcacoes();
            renderizarMarcacoes();

            configurarSelecaoTexto();
            aplicarHighlightsSalvos();

        } catch (erro) {
            console.error('Erro ao abrir EPUB:', erro);
            mostrarErro('Nao foi possivel carregar este livro. ' + (erro.message || ''));
        }
    }

    /* ============================================================
       MODO MARCACAO
       ============================================================ */
    function aplicarModoMarcacao() {
        document.body.classList.toggle('modo-marcacao', modoMarcacao);
    }

    function configurarSelecaoTexto() {
        if (!rendition) return;

        rendition.on('selected', async (cfiRange, contents) => {
            if (!modoMarcacao) return;

            try {
                const texto = contents.window.getSelection().toString().trim();
                if (!texto || texto.length < 3) return;

                const marcacao = await salvarMarcacao(cfiRange, texto);
                if (marcacao) {
                    estado.marcacoes.unshift(marcacao);
                    renderizarMarcacoes();
                }

                contents.addClass('acervo-highlight', cfiRange);
                contents.window.getSelection().removeAllRanges();

            } catch (e) {
                console.warn('Erro ao processar selecao:', e);
            }
        });

        rendition.themes.default({
            '.acervo-highlight': {
                'background-color': 'rgba(184, 137, 74, 0.35)',
                'border-bottom': '1px solid #B8894A',
                'cursor': 'pointer'
            }
        });
    }

    function aplicarHighlightsSalvos() {
        if (!rendition || !estado.marcacoes) return;

        estado.marcacoes.forEach((m) => {
            try {
                rendition.annotations.highlight(m.cfi, {}, () => {}, 'acervo-highlight');
            } catch (e) {
                // Ignora CFIs invalidos
            }
        });
    }

    /* ============================================================
       CONTROLES
       ============================================================ */
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
                'color': '#1A1614',
                'background': '#F8F2E4',
                'padding': '2rem 3rem'
            },
            'p': { 'margin': '0 0 1em 0', 'text-align': 'justify' },
            'h1, h2, h3': {
                'font-family': "'Playfair Display', Georgia, serif",
                'font-style': 'italic',
                'color': '#5C1A1A'
            },
            'a': { 'color': '#5C1A1A' }
        });
    }

    function configurarControles() {
        const btnMais = $('btn-font-mais');
        const btnMenos = $('btn-font-menos');
        const btnMarcar = $('btn-marcar-modo');

        if (btnMais) {
            btnMais.addEventListener('click', () => {
                tamanhoFonte = Math.min(TAMANHO_FONTE_MAX, tamanhoFonte + 2);
                aplicarFonte();
            });
        }

        if (btnMenos) {
            btnMenos.addEventListener('click', () => {
                tamanhoFonte = Math.max(TAMANHO_FONTE_MIN, tamanhoFonte - 2);
                aplicarFonte();
            });
        }

        if (btnMarcar) {
            btnMarcar.addEventListener('click', () => {
                modoMarcacao = !modoMarcacao;
                btnMarcar.setAttribute('aria-pressed', String(modoMarcacao));
                aplicarModoMarcacao();
            });
        }

        const btnAnterior = $('btn-anterior');
        const btnProximo = $('btn-proximo');
        if (btnAnterior) btnAnterior.addEventListener('click', () => rendition && rendition.prev());
        if (btnProximo) btnProximo.addEventListener('click', () => rendition && rendition.next());

        document.addEventListener('keydown', (e) => {
            if (!rendition) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); rendition.prev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); rendition.next(); }
        });
    }

    /* ============================================================
       LAYOUT
       ============================================================ */
    function configurarLayout() {
        const ficha = $('sidebar-perfil');
        const overlay = $('gaveta-overlay');
        const btnPerfil = $('perfil-botao');
        const btnFecharFicha = $('ficha-fechar');
        const btnFecharLeitor = $('btn-fechar-leitor');
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

        if (btnFecharLeitor) {
            btnFecharLeitor.addEventListener('click', () => {
                window.location.href = 'catalogo.html';
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

    /* ============================================================
       ERRO
       ============================================================ */
    function mostrarErro(mensagem) {
        const loading = $('leitor-loading');
        const erro = $('leitor-erro');
        const msg = $('erro-mensagem');

        if (loading) loading.hidden = true;
        if (msg) msg.textContent = mensagem;
        if (erro) erro.hidden = false;
    }

    /* ============================================================
       INICIALIZACAO
       ============================================================ */
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