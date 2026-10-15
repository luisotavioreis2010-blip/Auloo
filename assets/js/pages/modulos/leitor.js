/* ============================================================
   LEITOR.JS — v1
   Leitor interno de EPUB usando epub.js
   - Abre o EPUB a partir da URL (?url=...)
   - Renderiza com epub.js
   - Salva progresso no Supabase
   - Controles de fonte e tema
   ============================================================ */
(function () {
    'use strict';

    const PAGINA_LOGIN = '/login.html';
    const SUPABASE_TENTATIVAS = 40;
    const SUPABASE_INTERVALO_MS = 200;

    const TAMANHO_FONTE_MIN = 12;
    const TAMANHO_FONTE_MAX = 28;
    const TAMANHO_FONTE_PADRAO = 18;

    const raiz = document.documentElement;
    const $ = (id) => document.getElementById(id);

    let book = null;
    let rendition = null;
    let usuario = null;
    let db = null;
    let progressoAtual = 0;
    let tamanhoFonte = TAMANHO_FONTE_PADRAO;
    let timerSalvar = null;

    const estado = {
        url: null,
        titulo: '',
        slug: ''
    };

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

    /* ============================================================
       PARAMETROS DA URL
       ============================================================ */
    function lerParametros() {
        const params = new URLSearchParams(window.location.search);
        estado.url = params.get('url');
        estado.titulo = params.get('titulo') || 'Livro';
        estado.slug = params.get('slug') || '';

        if (!estado.url) {
            mostrarErro('URL do livro não foi fornecida.');
            return false;
        }

        document.title = estado.titulo + ' | Acervo';
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
       PROGRESSO NO SUPABASE
       ============================================================ */
    async function carregarProgresso() {
        if (!db || !usuario || !estado.slug) return null;

        try {
            const resultado = await db
                .from('reading_progress')
                .select('position, percent')
                .eq('user_id', usuario.id)
                .eq('book_slug', estado.slug)
                .maybeSingle();

            if (resultado.data) return resultado.data;
        } catch (e) {
            console.warn('Erro ao carregar progresso:', e);
        }
        return null;
    }

    async function salvarProgresso(position, percent) {
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
        }, 1000);
    }

    function atualizarBarraProgresso(percent) {
        progressoAtual = percent;
        const fill = $('progresso-fill');
        const texto = $('progresso-texto');
        if (fill) fill.style.width = percent + '%';
        if (texto) texto.textContent = Math.round(percent) + '%';
    }

    /* ============================================================
       EPUB.JS
       ============================================================ */
    async function abrirLivro() {
        const area = $('area');
        const loading = $('leitor-loading');
        const nav = $('leitor-nav');

        if (loading) loading.hidden = false;
        if (area) area.hidden = true;
        if (nav) nav.hidden = true;

        try {
            // Cria o livro
            book = ePub(estado.url);

            // Espera os metadados carregarem
            await book.ready;

            // Aplica tema e fonte iniciais
            aplicarTema();
            aplicarFonte();

            // Renderiza
            rendition = book.renderTo('area', {
                width: '100%',
                height: '100%',
                flow: 'paginated',
                spread: 'none'
            });

            // Carrega progresso salvo
            const progresso = await carregarProgresso();

            // Exibe
            if (progresso && progresso.position) {
                await rendition.display(progresso.position);
            } else {
                await rendition.display();
            }

            // Esconde loading, mostra area e navegacao
            if (loading) loading.hidden = true;
            if (area) area.hidden = false;
            if (nav) nav.hidden = false;

            // Salva a localizacao inicial
            rendition.on('relocated', (location) => {
                const pos = location.start.cfi;
                const percent = book.locations.percentageFromCfi(pos) * 100;
                salvarProgresso(pos, percent);
                atualizarBarraProgresso(percent);
            });

            // Gera locations para o progresso funcionar
            book.locations.generate(1000).then(() => {
                // Agora podemos calcular porcentagem
            });

            // Constroi o sumário na sidebar
            construirSumario();

            // Configura navegacao
            configurarNavegacao();

        } catch (erro) {
            console.error('Erro ao abrir EPUB:', erro);
            mostrarErro('Não foi possível carregar este livro. O arquivo pode estar corrompido ou indisponível.');
        }
    }

    function construirSumario() {
        if (!book || !book.navigation) return;

        const lista = $('lista-capitulos');
        if (!lista) return;

        lista.textContent = '';

        const toc = book.navigation.toc;
        if (!toc || toc.length === 0) return;

        toc.forEach((capitulo, i) => {
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'sidebar-link';
            link.setAttribute('aria-label', 'Ir para ' + capitulo.label);

            const romano = document.createElement('span');
            romano.className = 'sidebar-romano';
            romano.textContent = (i + 1).toString();

            const nome = document.createElement('span');
            nome.className = 'sidebar-nome';
            nome.textContent = capitulo.label || 'Capítulo ' + (i + 1);
            nome.style.textTransform = 'none';
            nome.style.fontFamily = 'var(--fonte-display)';

            link.appendChild(romano);
            link.appendChild(nome);

            link.addEventListener('click', () => {
                if (rendition && capitulo.href) {
                    rendition.display(capitulo.href);
                }
            });

            lista.appendChild(link);
        });
    }

    function configurarNavegacao() {
        const btnAnterior = $('btn-anterior');
        const btnProximo = $('btn-proximo');
        const navPagina = $('nav-pagina');

        if (btnAnterior) {
            btnAnterior.addEventListener('click', () => {
                if (rendition) rendition.prev();
            });
        }

        if (btnProximo) {
            btnProximo.addEventListener('click', () => {
                if (rendition) rendition.next();
            });
        }

        // Atualiza o numero da pagina
        if (rendition) {
            rendition.on('relocated', (location) => {
                if (navPagina && location.start) {
                    navPagina.textContent = (location.start.displayed ? location.start.displayed.page : '?') +
                                           ' / ' +
                                           (location.start.displayed ? location.start.displayed.total : '?');
                }
            });
        }

        // Teclado: setas e espaço
        document.addEventListener('keydown', (e) => {
            if (!rendition) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); rendition.prev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); rendition.next(); }
            if (e.key === ' ') { e.preventDefault(); rendition.next(); }
        });
    }

    /* ============================================================
       CONTROLES (fonte, tema, marcar)
       ============================================================ */
    function aplicarFonte() {
        if (!rendition) return;
        rendition.themes.fontSize(tamanhoFonte + 'px');
    }

    function aplicarTema() {
        const escuro = document.body.classList.contains('leitor-tema-escuro');
        if (!rendition) return;

        if (escuro) {
            rendition.themes.register('dark', {
                body: { background: '#1A1614', color: '#F0E8D8' },
                a: { color: '#D9B878' }
            });
            rendition.themes.select('dark');
        } else {
            rendition.themes.register('light', {
                body: { background: '#F8F2E4', color: '#1A1614' },
                a: { color: '#5C1A1A' }
            });
            rendition.themes.select('light');
        }
    }

    function configurarControles() {
        const btnMais = $('btn-fonte-mais');
        const btnMenos = $('btn-fonte-menos');
        const btnTema = $('btn-tema');

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

        if (btnTema) {
            btnTema.addEventListener('click', () => {
                document.body.classList.toggle('leitor-tema-escuro');
                const escuro = document.body.classList.contains('leitor-tema-escuro');
                btnTema.textContent = escuro ? '🌙' : '☀';
                aplicarTema();
            });
        }
    }

    /* ============================================================
       LAYOUT (sidebar, ficha)
       ============================================================ */
    function configurarLayout() {
        const sidebar = $('sidebar');
        const ficha = $('sidebar-perfil');
        const overlay = $('gaveta-overlay');
        const btnHamburger = $('btn-hamburger');
        const btnPerfil = $('perfil-botao');
        const btnFecharFicha = $('ficha-fechar');

        const compacto = window.matchMedia('(max-width: 1366px)');

        function atualizarOverlay() {
            if (!overlay) return;
            const sidebarAberta = sidebar && sidebar.classList.contains('aberta');
            const fichaAberta = ficha && ficha.classList.contains('ativa');
            overlay.classList.toggle('ativa', sidebarAberta || (compacto.matches && fichaAberta));
        }

        if (btnHamburger && sidebar) {
            btnHamburger.addEventListener('click', () => {
                sidebar.classList.toggle('aberta');
                atualizarOverlay();
            });
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
                if (sidebar) sidebar.classList.remove('aberta');
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