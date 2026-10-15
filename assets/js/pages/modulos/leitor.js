/* ============================================================
   LEITOR.JS — v13
   Leitor com 2 paginas lado a lado (livro aberto)
   - Sem marcar texto
   - Contador de paginas correto (1 ate o final, sem ciclo)
   - Navegacao lateral (setas nas laterais)
   - Progresso na navbar
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

    function atualizarProgresso(percent) {
        const fillTop = $('progresso-fill');
        const fillSide = $('progresso-fill-sidebar');
        const texto = $('progresso-texto');
        if (fillTop) fillTop.style.width = percent + '%';
        if (fillSide) fillSide.style.width = percent + '%';
        if (texto) texto.textContent = Math.round(percent) + '%';
    }

    /* ============================================================
       EPUB — 2 paginas lado a lado
       ============================================================ */
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

            // Verifica se a tela cabe 2 paginas
            const podeLivro = window.innerWidth >= MIN_WIDTH_PARA_LIVRO;

            if (podeLivro) {
                if (livro) livro.hidden = false;
                await renderizarLivroAberto();
            } else {
                if (areaUnica) areaUnica.hidden = false;
                await renderizarPaginaUnica();
            }

        } catch (erro) {
            console.error('Erro ao abrir EPUB:', erro);
            mostrarErro('Nao foi possivel carregar este livro. ' + (erro.message || ''));
        }
    }

    /* Renderiza 2 paginas lado a lado */
    async function renderizarLivroAberto() {
        const elEsq = $('area-esq');
        const elDir = $('area-dir');

        if (!elEsq || !elDir) return;

        // O epub.js cria um iframe em cada container
        // Nao da pra renderizar 2 renditions, entao usamos a propria paginacao
        // do epub.js em modo spread, mas com 2 containers visiveis

        // Estrategia: um unico rendition no container esquerdo que
        // automaticamente ocupa 2 colunas (spread auto)

        rendition = book.renderTo('area-esq', {
            width: '100%',
            height: '100%',
            flow: 'paginated',
            spread: 'auto',
            minSpreadWidth: 600
        });

        // Esconde o container direito (nao precisamos dele)
        // O epub.js ja renderiza 2 colunas no container esquerdo
        elDir.style.display = 'none';
        elEsq.style.width = '100%';

        aplicarFonte();
        aplicarTema();

        const progresso = await carregarProgresso();
        if (progresso && progresso.position) {
            await rendition.display(progresso.position);
        } else {
            await rendition.display();
        }

        // Gera locations (calcula numero total de paginas reais)
        await book.locations.generate(600);
        paginasTotais = book.locations.length();

        configurarEventosRendition();
    }

    /* Renderiza pagina unica (mobile) */
    async function renderizarPaginaUnica() {
        const area = $('area');
        if (!area) return;

        rendition = book.renderTo('area', {
            width: '100%',
            height: '100%',
            flow: 'paginated',
            spread: 'none'
        });

        aplicarFonte();
        aplicarTema();

        const progresso = await carregarProgresso();
        if (progresso && progresso.position) {
            await rendition.display(progresso.position);
        } else {
            await rendition.display();
        }

        await book.locations.generate(600);
        paginasTotais = book.locations.length();

        configurarEventosRendition();
    }

    function configurarEventosRendition() {
        if (!rendition) return;

        rendition.on('relocated', (location) => {
            const cfi = location.start.cfi;
            const percent = book.locations.percentageFromCfi(cfi) * 100;
            const paginaAtual = book.locations.locationFromCfi(cfi);

            // Atualiza contador: pagina atual / total
            const el = $('nav-pagina');
            if (el) {
                if (paginasTotais > 0 && paginaAtual >= 0) {
                    el.textContent = (paginaAtual + 1) + ' / ' + paginasTotais;
                } else {
                    // Fallback: usa displayed do epub.js
                    if (location.start.displayed) {
                        const d = location.start.displayed;
                        el.textContent = d.page + ' / ' + d.total;
                    }
                }
            }

            atualizarProgresso(percent);
            salvarProgresso(cfi, percent);
        });

        // Botao esquerdo
        const btnAnterior = $('btn-anterior');
        if (btnAnterior) {
            btnAnterior.addEventListener('click', () => {
                if (rendition) rendition.prev();
            });
        }

        // Botao direito
        const btnProximo = $('btn-proximo');
        if (btnProximo) {
            btnProximo.addEventListener('click', () => {
                if (rendition) rendition.next();
            });
        }

        // Teclado
        document.addEventListener('keydown', (e) => {
            if (!rendition) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); rendition.prev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); rendition.next(); }
            if (e.key === ' ') { e.preventDefault(); rendition.next(); }
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
                'padding': '2rem 3rem',
                'overflow': 'hidden'
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