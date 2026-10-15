/* ============================================================
   CATALOGO.JS — v11
   Pagina de catalogo — somente fontes confiaveis
   - 2 fontes: Standard Ebooks + Gutenberg
   - Standard Ebooks: ate 1.500 livros (Edge Function paginada)
   - Botao "Ler no Acervo" para Standard Ebooks (leitor interno)
   - Botao "Ler agora" para os demais (abre externo)
   - ORDENACAO: Standard Ebooks -> Portugues -> Resto
   - Busca (Enter ou lupa)
   - Popover de filtros
   - Modais (livro / adicionar a estante)
   - Sistema de foco (teclado virtual)
   ============================================================ */
(function () {
    'use strict';

    /* ============================================================
       1. CONSTANTES
       ============================================================ */
    const PAGINA_LOGIN = '/login.html';
    const LIMITE_RESULTADOS = 1500;
    const LIMITE_STANDARD_EBOOKS = 1500;
    const SUPABASE_TENTATIVAS = 40;
    const SUPABASE_INTERVALO_MS = 200;
    const LIMITE_TECLADO_PX = 100;
    const MARGEM_TECLADO_PX = 16;
    const ESTABILIDADE_MS = 120;
    const WATCHDOG_MS = 1500;
    const REDIMENSIONANDO_MS = 400;
    const ALTURA_BAIXA_PX = 640;
    const MENSAGEM_MS = 2600;

    const MQ_ROW = '(min-width: 568px) and (max-width: 950px) and (orientation: landscape) and (max-height: 500px)';

    /* ============================================================
       2. ESTADO
       ============================================================ */
    const estado = {
        usuario: null,
        resultados: [],
        resultadosFiltrados: [],
        buscaAtual: '',
        carregando: false,
        livroSelecionado: null,
        modo: 'populares',
        capasCache: new Map()
    };

    let offsetAtual = 0;
    let razaoTeclado = 0.5;
    let ativoAtual = null;
    let timerEstabilidade = null;
    let vvHeightAnterior = 0;
    let ajusteRaf = false;

    const raiz = document.documentElement;

    /* ============================================================
       3. HELPERS
       ============================================================ */
    const $ = (id) => document.getElementById(id);
    const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function getDb() {
        return window.supabaseClient ||
               (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    async function aguardarDb() {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const db = getDb();
            if (db) return db;
            await esperar(SUPABASE_INTERVALO_MS);
        }
        return null;
    }

    function irParaLogin() {
        window.location.replace(PAGINA_LOGIN);
    }

    function limpar(el) {
        if (!el) return;
        while (el.firstChild) el.removeChild(el.firstChild);
    }

    function ehLayoutRow() {
        return raiz.getAttribute('data-layout') === 'row';
    }

    function campoEmFoco() {
        const ativo = document.activeElement;
        return !!ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA');
    }

    function getAppH() {
        const valor = raiz.style.getPropertyValue('--app-h');
        const n = /px\s*$/.test(valor) ? parseFloat(valor) : NaN;
        return (isNaN(n) || n <= 0) ? window.innerHeight : n;
    }

    function getAlturaVisivel() {
        const vv = window.visualViewport;
        const h = window.innerHeight;
        return (vv && vv.height > 0 && vv.height < h) ? vv.height : h;
    }

    function getTopoTeclado() {
        const vv = window.visualViewport;
        const topoVV = vv ? (vv.offsetTop + vv.height) : window.innerHeight;
        return Math.min(topoVV, window.innerHeight);
    }

    function tecladoAberto() {
        return campoEmFoco() && (getAppH() - getAlturaVisivel()) > LIMITE_TECLADO_PX;
    }

    /* ============================================================
       4. AUTENTICACAO
       ============================================================ */
    async function aguardarSessao(db) {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const resultado = await db.auth.getSession();
            if (resultado.error) throw resultado.error;
            const sessao = resultado.data && resultado.data.session;
            if (sessao && sessao.user) return sessao;
            await esperar(SUPABASE_INTERVALO_MS);
        }
        return null;
    }

    async function iniciarSessao() {
        const db = await aguardarDb();
        if (!db) {
            console.error('Supabase nao inicializou');
            irParaLogin();
            return;
        }

        db.auth.onAuthStateChange((evento) => {
            if (evento === 'SIGNED_OUT') irParaLogin();
        });

        try {
            const sessao = await aguardarSessao(db);
            if (!sessao) {
                irParaLogin();
                return;
            }

            estado.usuario = sessao.user;

            const meta = sessao.user.user_metadata || {};
            const nome = meta.full_name || meta.name || sessao.user.email || 'Usuario';
            const avatar = meta.avatar_url || meta.picture || null;

            renderizarAvatar($('perfil-usuario'), avatar, nome);
            renderizarAvatar($('sidebar-perfil-foto'), avatar, nome);

            const elNome = $('sidebar-perfil-nome');
            const elEmail = $('sidebar-perfil-email');
            if (elNome) elNome.textContent = nome.split('@')[0];
            if (elEmail) elEmail.textContent = sessao.user.email || '';

        } catch (erro) {
            console.error('Erro getSession:', erro);
            irParaLogin();
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
       5. SISTEMA DE FOCO
       ============================================================ */
    function setupAlturaFixa() {
        let maiorAltura = 0;
        let larguraMedida = 0;
        let timerAssentar = null;

        function aplicar(h) {
            maiorAltura = h;
            raiz.style.setProperty('--app-h', h + 'px');
        }

        function medir() {
            if (window.innerWidth !== larguraMedida) {
                larguraMedida = window.innerWidth;
                maiorAltura = 0;
            }

            const h = window.innerHeight;
            if (h > maiorAltura) aplicar(h);

            clearTimeout(timerAssentar);
            timerAssentar = setTimeout(() => {
                if (!campoEmFoco() && window.innerHeight !== maiorAltura) {
                    aplicar(window.innerHeight);
                }
            }, 700);
        }

        [0, 100, 300, 600, 1000, 1500].forEach((ms) => setTimeout(medir, ms));

        window.addEventListener('resize', medir);
        window.addEventListener('orientationchange', () => {
            maiorAltura = 0;
            [50, 300, 600, 1000].forEach((ms) => setTimeout(medir, ms));
        });

        medir();
    }

    function resetarScroll() {
        if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    }

    function resetarKbOffset() {
        if (offsetAtual === 0) return;
        offsetAtual = 0;
        raiz.style.setProperty('--kb-offset', '0px');
    }

    function limparAtivos() {
        document.querySelectorAll('[data-ativo="true"]').forEach((el) => {
            el.removeAttribute('data-ativo');
        });
    }

    function limparEstadoTeclado() {
        limparAtivos();
        raiz.classList.remove('kb-focus');
        resetarKbOffset();
        raiz.style.removeProperty('--kb-visivel');
        resetarScroll();
    }

    function sincronizarTela() {
        if (campoEmFoco() || tecladoAberto()) return;

        const layout = (window.matchMedia && window.matchMedia(MQ_ROW).matches &&
                        window.innerWidth > window.innerHeight) ? 'row' : 'stacked';

        if (raiz.getAttribute('data-layout') !== layout) {
            raiz.setAttribute('data-layout', layout);
        }

        const alturaNova = window.innerHeight <= ALTURA_BAIXA_PX ? 'baixa' : 'normal';
        if (raiz.getAttribute('data-altura') !== alturaNova) {
            raiz.setAttribute('data-altura', alturaNova);
        }
    }

    function escolherReferencia() {
        return document.querySelector('[data-ativo="true"]');
    }

    function atualizarAlturaVisivel() {
        if (tecladoAberto()) {
            const topo = Math.max(0, getTopoTeclado());
            if (getAppH() > 0) razaoTeclado = topo / getAppH();
            raiz.style.setProperty('--kb-visivel', topo + 'px');
        } else if (!(ehLayoutRow() && raiz.classList.contains('kb-focus') && campoEmFoco())) {
            raiz.style.removeProperty('--kb-visivel');
        }
    }

    function calcularKbOffset() {
        atualizarAlturaVisivel();
        if (!tecladoAberto()) { resetarKbOffset(); return; }

        if (ehLayoutRow() && raiz.classList.contains('kb-focus')) {
            resetarKbOffset();
            return;
        }

        const ref = escolherReferencia();
        if (!ref) return;

        const bottomNatural = ref.getBoundingClientRect().bottom - offsetAtual;
        const limite = getTopoTeclado() - MARGEM_TECLADO_PX;
        const novoOffset = bottomNatural > limite ? limite - bottomNatural : 0;

        if (Math.abs(novoOffset - offsetAtual) > 2) {
            offsetAtual = novoOffset;
            raiz.style.setProperty('--kb-offset', novoOffset + 'px');
        }
    }

    function executarAjuste() {
        if (ajusteRaf) return;
        ajusteRaf = true;
        requestAnimationFrame(() => {
            ajusteRaf = false;
            calcularKbOffset();
        });
    }

    function agendarAposEstabilidade() {
        const vv = window.visualViewport;
        const h = vv ? vv.height : window.innerHeight;
        const diff = h - vvHeightAnterior;
        if (Math.abs(diff) <= 1) return;

        vvHeightAnterior = h;
        clearTimeout(timerEstabilidade);

        if (diff > 0) executarAjuste();
        else timerEstabilidade = setTimeout(executarAjuste, ESTABILIDADE_MS);
    }

    function agendarImediato() {
        clearTimeout(timerEstabilidade);
        executarAjuste();
    }

    function setupTeclado() {
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', agendarAposEstabilidade);
            window.visualViewport.addEventListener('scroll', agendarAposEstabilidade);
        }
        window.addEventListener('resize', agendarAposEstabilidade);

        document.addEventListener('focusin', (e) => {
            if (e.target && e.target.tagName === 'INPUT') agendarAposEstabilidade();
        });

        document.addEventListener('focusout', () => {
            setTimeout(() => {
                if (campoEmFoco()) return;
                clearTimeout(timerEstabilidade);
                executarAjuste();
            }, 80);
        });

        window.addEventListener('orientationchange', () => {
            [50, 300, 600].forEach((ms) => setTimeout(agendarImediato, ms));
        });

        executarAjuste();
    }

    function setupModoFoco() {
        function marcarAtivo(input) {
            raiz.classList.add('kb-focus');

            if (!ehLayoutRow()) return;
            if (input === ativoAtual) return;
            ativoAtual = input;

            const container = input.closest('.busca-wrapper, .field, .filtro-grupo');
            if (!container) return;

            limparAtivos();
            container.setAttribute('data-ativo', 'true');

            if (!tecladoAberto()) {
                raiz.style.setProperty('--kb-visivel', Math.round(getAppH() * razaoTeclado) + 'px');
            }
            agendarAposEstabilidade();
        }

        function limparModo() {
            ativoAtual = null;
            limparAtivos();
            raiz.classList.remove('kb-focus');
            agendarAposEstabilidade();
        }

        document.addEventListener('focusin', (e) => {
            if (e.target && e.target.tagName === 'INPUT') marcarAtivo(e.target);
        });

        document.addEventListener('focusout', () => {
            setTimeout(() => {
                const ativo = document.activeElement;
                if (ativo && ativo.tagName === 'INPUT') {
                    marcarAtivo(ativo);
                } else {
                    limparModo();
                }
            }, 80);
        });

        window.addEventListener('pageshow', limparModo);
    }

    function setupTela() {
        let temporizador = null;
        let temporizadorTransicao = null;
        let ultimaLargura = window.innerWidth;
        let ultimaAltura = window.innerHeight;

        const bloqueado = () => campoEmFoco() || tecladoAberto();

        function sincronizarSeNecessario() {
            if (bloqueado()) return;

            const larguraAtual = window.innerWidth;
            const alturaAtual = window.innerHeight;

            const larguraMudou = larguraAtual !== ultimaLargura;
            const orientacaoMudou = (larguraAtual > alturaAtual) !== (ultimaLargura > ultimaAltura);

            ultimaLargura = larguraAtual;
            ultimaAltura = alturaAtual;

            if (!larguraMudou && !orientacaoMudou) return;

            raiz.classList.add('redimensionando');
            sincronizarTela();
            resetarScroll();

            clearTimeout(temporizadorTransicao);
            temporizadorTransicao = setTimeout(() => {
                raiz.classList.remove('redimensionando');
            }, REDIMENSIONANDO_MS);
        }

        window.addEventListener('resize', () => {
            if (bloqueado()) return;
            clearTimeout(temporizador);
            temporizador = setTimeout(sincronizarSeNecessario, 250);
        });

        window.addEventListener('orientationchange', () => {
            [100, 400, 900].forEach((ms) => setTimeout(sincronizarSeNecessario, ms));
        });

        setInterval(() => {
            if (document.hidden || campoEmFoco() || tecladoAberto()) return;
            if (raiz.classList.contains('kb-focus') || offsetAtual !== 0 ||
                raiz.style.getPropertyValue('--kb-visivel')) {
                limparEstadoTeclado();
            }
        }, WATCHDOG_MS);

        sincronizarTela();
    }

    /* ============================================================
       6. RENDERIZACAO
       ============================================================ */
    function esconderTudo() {
        const loading = $('catalogo-loading');
        const erro = $('catalogo-erro');
        const grid = $('resultados-grid');
        const info = $('resultados-info');
        const fim = $('catalogo-fim');

        if (loading) loading.hidden = true;
        if (erro) erro.hidden = true;
        if (info) info.hidden = true;
        if (fim) fim.hidden = true;
        if (grid) limpar(grid);
    }

    function mostrarLoading(mensagem) {
        esconderTudo();
        const loading = $('catalogo-loading');
        const texto = $('loading-texto');
        if (texto && mensagem) texto.textContent = mensagem;
        if (loading) loading.hidden = false;
    }

    function atualizarLoading(mensagem) {
        const texto = $('loading-texto');
        if (texto) texto.textContent = mensagem;
    }

    function mostrarErro(mensagem) {
        esconderTudo();
        const erro = $('catalogo-erro');
        const msg = $('erro-mensagem');
        if (msg) msg.textContent = mensagem || 'Nao foi possivel buscar os livros. Tente novamente.';
        if (erro) erro.hidden = false;
    }

    function mostrarResultados(livros) {
        esconderTudo();

        if (!livros || livros.length === 0) return;

        const grid = $('resultados-grid');
        const info = $('resultados-info');
        const contagem = $('resultados-contagem');
        const btnVoltar = $('btn-voltar-populares');

        if (contagem) {
            contagem.textContent = livros.length === 1
                ? '1 livro'
                : livros.length + ' livros';
        }
        if (info) info.hidden = false;

        if (btnVoltar) {
            btnVoltar.hidden = estado.modo !== 'busca';
        }

        const fragmento = document.createDocumentFragment();
        livros.forEach((livro) => {
            fragmento.appendChild(criarCardLivro(livro));
        });
        grid.appendChild(fragmento);
    }

    function criarCardLivro(livro) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'livro-card';
        card.setAttribute('aria-label', 'Ver detalhes de ' + livro.title);

        const capa = document.createElement('div');
        capa.className = 'livro-capa';

        const img = document.createElement('img');
        img.alt = livro.title || '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.style.opacity = '0';
        img.style.transition = 'opacity 0.3s';

        function mostrarPlaceholder() {
            img.remove();
            if (!capa.querySelector('.livro-capa-sem')) {
                const sem = document.createElement('div');
                sem.className = 'livro-capa-sem';
                sem.textContent = livro.title;
                capa.appendChild(sem);
            }
        }

        function mostrarCapa(url) {
            img.onload = () => { img.style.opacity = '1'; };
            img.onerror = () => mostrarPlaceholder();
            img.src = url;
            if (!img.parentNode) capa.appendChild(img);
        }

        if (livro.cover_url) {
            mostrarCapa(livro.cover_url);
        } else {
            mostrarPlaceholder();
        }

        const info = document.createElement('div');
        info.className = 'livro-info';

        const titulo = document.createElement('div');
        titulo.className = 'livro-titulo';
        titulo.textContent = livro.title || 'Sem titulo';
        info.appendChild(titulo);

        if (livro.author) {
            const autor = document.createElement('div');
            autor.className = 'livro-autor';
            autor.textContent = livro.author;
            info.appendChild(autor);
        }

        const metaTexto = [];
        if (livro.year) metaTexto.push(livro.year);
        if (livro.pages) metaTexto.push(livro.pages + ' pag.');

        if (metaTexto.length > 0) {
            const meta = document.createElement('div');
            meta.className = 'livro-meta';
            meta.textContent = metaTexto.join(' . ');
            info.appendChild(meta);
        }

        card.appendChild(capa);
        card.appendChild(info);

        card.addEventListener('click', () => abrirModalLivro(livro));

        return card;
    }

    /* ============================================================
       7. CARREGAR CATALOGO (2 fontes)
       ============================================================ */
    async function carregarCatalogo() {
        estado.modo = 'populares';
        estado.buscaAtual = '';
        mostrarLoading('Carregando catalogo...');

        try {
            const todos = [];
            const vistos = new Set();

            function adicionar(lista, fonte) {
                if (!lista) return;
                lista.forEach((livro) => {
                    if (!livro || !livro.title) return;
                    const chave = (livro.title || '').toLowerCase().trim() + '|' +
                                  (livro.author || '').toLowerCase().trim();
                    if (vistos.has(chave)) return;
                    vistos.add(chave);
                    if (fonte) livro.source = fonte;
                    todos.push(livro);
                });
            }

            function atualizar() {
                estado.resultados = todos.slice();
                mostrarResultados(todos);
            }

            // ============================================================
            // 1. STANDARD EBOOKS — ate 1.500 classicos premium
            // ============================================================
            atualizarLoading('Buscando no Standard Ebooks (pode demorar)...');

            try {
                const se = await window.apiStandardEbooks.buscarPopulares();
                if (se && se.length > 0) {
                    adicionar(se.slice(0, LIMITE_STANDARD_EBOOKS), 'standardebooks');
                    atualizar();
                    atualizarLoading('Carregando ' + todos.length + ' livros...');
                }
            } catch (e) {
                console.warn('Standard Ebooks falhou:', e);
            }

            // ============================================================
            // 2. GUTENBERG — populares (todos os idiomas)
            // ============================================================
            atualizarLoading('Buscando no Gutenberg...');

            for (let p = 1; p <= 10; p++) {
                if (todos.length >= LIMITE_RESULTADOS) break;
                try {
                    const pagina = await window.apiGutenberg.buscarPopularesPaginado('', p);
                    if (!pagina || pagina.length === 0) break;
                    adicionar(pagina, 'gutenberg');
                    atualizar();
                    atualizarLoading('Carregando ' + todos.length + ' de ' + LIMITE_RESULTADOS + ' livros...');
                } catch (e) {
                    console.warn('Gutenberg pagina ' + p + ' falhou');
                    break;
                }
            }

            // ============================================================
            // 3. ORDENAR: Standard Ebooks -> Portugues -> Resto
            // ============================================================
            function pesoFonte(livro) {
                const fonte = livro.source || '';
                const idioma = (livro.language || '').toLowerCase();

                if (fonte === 'standardebooks') return 1;
                if (idioma.startsWith('pt')) return 2;
                return 3;
            }

            todos.sort((a, b) => {
                const pa = pesoFonte(a);
                const pb = pesoFonte(b);
                if (pa !== pb) return pa - pb;

                const da = a.download_count || 0;
                const db = b.download_count || 0;
                return db - da;
            });

            estado.resultados = todos;
            mostrarResultados(todos);

            if (todos.length === 0) {
                mostrarErro('Nao foi possivel carregar o catalogo. Tente buscar por titulo.');
            }

        } catch (erro) {
            console.error('Erro ao carregar catalogo:', erro);
            mostrarErro('Nao foi possivel carregar o catalogo. Tente novamente.');
        }
    }

    /* ============================================================
       8. BUSCA
       ============================================================ */
    async function buscarLivros(termo) {
        termo = String(termo || '').trim();

        if (!termo) {
            await carregarCatalogo();
            return;
        }

        estado.modo = 'busca';
        estado.buscaAtual = termo;
        estado.carregando = true;
        mostrarLoading('Buscando livros...');

        try {
            let livros = [];

            try {
                const gutenberg = await window.apiGutenberg.buscar(termo);
                livros = mesclarLivros(livros, gutenberg);
            } catch (e) {
                console.warn('Gutenberg falhou:', e);
            }

            try {
                const standardEbooks = await window.apiStandardEbooks.buscar(termo);
                livros = mesclarLivros(livros, standardEbooks);
            } catch (e) {
                console.warn('Standard Ebooks falhou:', e);
            }

            estado.resultados = livros;
            aplicarFiltrosEOrdenacao();

        } catch (erro) {
            console.error(erro);
            mostrarErro('Nao foi possivel buscar os livros. Tente novamente.');
        } finally {
            estado.carregando = false;
        }
    }

    function mesclarLivros(lista1, lista2) {
        const vistos = new Set();
        const resultado = [];

        function adicionar(livro) {
            const chave = (livro.title || '').toLowerCase() + '|' +
                          (livro.author || '').toLowerCase();
            if (vistos.has(chave)) return;
            vistos.add(chave);
            resultado.push(livro);
        }

        lista1.forEach(adicionar);
        lista2.forEach(adicionar);
        return resultado;
    }

    function aplicarFiltrosEOrdenacao() {
        let livros = estado.resultados.slice();

        const idioma = $('filtro-idioma') ? $('filtro-idioma').value : '';
        if (idioma) {
            livros = livros.filter((l) => (l.language || '').toLowerCase().indexOf(idioma) === 0);
        }

        const fonte = $('filtro-fonte') ? $('filtro-fonte').value : '';
        if (fonte) {
            if (fonte === 'gutenberg') {
                livros = livros.filter((l) => l.has_ebook);
            } else {
                livros = livros.filter((l) => l.source === fonte);
            }
        }

        const ordem = $('filtro-ordem') ? $('filtro-ordem').value : 'relevancia';
        if (ordem === 'ano-desc') {
            livros.sort((a, b) => (b.year || 0) - (a.year || 0));
        } else if (ordem === 'ano-asc') {
            livros.sort((a, b) => (a.year || 9999) - (b.year || 9999));
        } else if (ordem === 'titulo') {
            livros.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        }

        estado.resultadosFiltrados = livros;
        mostrarResultados(livros);
    }

    /* ============================================================
       9. POPOVER DE FILTROS
       ============================================================ */
    function setupPopoverFiltros() {
        const btn = $('busca-filtro-btn');
        const popover = $('filtros-popover');
        if (!btn || !popover) return;

        function abrir() {
            popover.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
        }

        function fechar() {
            popover.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (popover.hidden) abrir(); else fechar();
        });

        document.addEventListener('click', (e) => {
            if (popover.hidden) return;
            if (popover.contains(e.target) || btn.contains(e.target)) return;
            fechar();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !popover.hidden) {
                fechar();
                btn.focus();
            }
        });

        ['filtro-idioma', 'filtro-fonte', 'filtro-ordem'].forEach((id) => {
            const el = $(id);
            if (el) el.addEventListener('change', aplicarFiltrosEOrdenacao);
        });
    }

    /* ============================================================
       10. MODAIS
       ============================================================ */
    function abrirModalLivro(livro) {
        estado.livroSelecionado = livro;

        const modal = $('modal-livro');
        if (!modal) return;

        const img = $('modal-capa-img');
        const titulo = $('modal-titulo');
        const autor = $('modal-autor');
        const meta = $('modal-meta');
        const descricao = $('modal-descricao');
        const btnLer = $('btn-ler');

        if (img) {
            img.src = livro.cover_url || '';
            img.alt = livro.title || '';
            img.onerror = () => { img.style.visibility = 'hidden'; };
            img.style.visibility = 'visible';
        }

        if (titulo) titulo.textContent = livro.title || 'Sem titulo';
        if (autor) autor.textContent = livro.author || 'Autor desconhecido';

        if (meta) {
            const partes = [];
            if (livro.year) partes.push(livro.year);
            if (livro.pages) partes.push(livro.pages + ' paginas');
            if (livro.publisher) partes.push(livro.publisher);
            meta.textContent = partes.join(' . ');
        }

        if (descricao) {
            descricao.textContent = livro.description || 'Sem descricao disponivel.';
        }

        // ============================================================
        // BOTAO LER — decide entre leitor interno ou externo
        // ============================================================
        if (btnLer) {
            if (livro.ebook_url && livro.source === 'standardebooks') {
                // Abre no LEITOR INTERNO do Acervo
                btnLer.href = 'leitor.html?url=' + encodeURIComponent(livro.ebook_url) +
                              '&titulo=' + encodeURIComponent(livro.title || '') +
                              '&slug=' + encodeURIComponent(livro.external_id || '');
                btnLer.textContent = 'Ler no Acervo';
                btnLer.hidden = false;
            } else if (livro.ebook_url) {
                // Abre externo (outros formatos)
                btnLer.href = livro.ebook_url;
                btnLer.textContent = 'Ler agora';
                btnLer.hidden = false;
            } else {
                btnLer.hidden = true;
            }
        }

        modal.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function fecharModalLivro() {
        const modal = $('modal-livro');
        if (modal) modal.hidden = true;
        document.body.style.overflow = '';
    }

    function abrirModalEstante(livro) {
        estado.livroSelecionado = livro;

        const modal = $('modal-estante');
        const texto = $('modal-estante-livro');

        if (texto) texto.textContent = livro.title;

        if (modal) {
            modal.hidden = false;
            document.body.style.overflow = 'hidden';
        }
    }

    function fecharModalEstante() {
        const modal = $('modal-estante');
        if (modal) modal.hidden = true;
        document.body.style.overflow = '';
    }

    /* ============================================================
       11. ADICIONAR A ESTANTE
       ============================================================ */
    async function adicionarAEstante(status) {
        if (!estado.livroSelecionado || !estado.usuario) return;

        const db = getDb();
        if (!db) return;

        const livro = estado.livroSelecionado;

        const botoes = document.querySelectorAll('.opcao-estante');
        botoes.forEach((b) => { b.disabled = true; });

        try {
            const livroParaSalvar = {
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

            let bookId = null;

            if (livro.external_id && livro.source) {
                const existente = await db.from('books')
                    .select('id')
                    .eq('external_id', livro.external_id)
                    .eq('source', livro.source)
                    .maybeSingle();

                if (existente.data) bookId = existente.data.id;
            }

            if (!bookId) {
                const inserido = await db.from('books')
                    .insert(livroParaSalvar)
                    .select('id')
                    .single();

                if (inserido.error) throw inserido.error;
                bookId = inserido.data.id;
            }

            const jaTem = await db.from('user_books')
                .select('id')
                .eq('user_id', estado.usuario.id)
                .eq('book_id', bookId)
                .maybeSingle();

            if (jaTem.data) {
                const atualizar = await db.from('user_books')
                    .update({ status: status })
                    .eq('id', jaTem.data.id);
                if (atualizar.error) throw atualizar.error;
            } else {
                const inserir = await db.from('user_books')
                    .insert({
                        user_id: estado.usuario.id,
                        book_id: bookId,
                        status: status
                    });
                if (inserir.error) throw inserir.error;
            }

            fecharModalEstante();
            fecharModalLivro();
            mostrarToast('Adicionado a estante!');

        } catch (erro) {
            console.error('Erro ao adicionar:', erro);
            mostrarToast('Nao foi possivel adicionar. Tente novamente.', true);
        } finally {
            botoes.forEach((b) => { b.disabled = false; });
        }
    }

    function mostrarToast(mensagem, ehErro) {
        const toast = document.createElement('div');
        toast.style.cssText = [
            'position: fixed',
            'bottom: 2rem',
            'left: 50%',
            'transform: translateX(-50%)',
            'padding: 0.9rem 1.5rem',
            'background: ' + (ehErro ? '#B23A2E' : '#2E7D4F'),
            'color: #fff',
            'font-family: Poppins, sans-serif',
            'font-size: 0.85rem',
            'border-radius: 4px',
            'box-shadow: 0 12px 32px rgba(0,0,0,0.25)',
            'z-index: 9999',
            'opacity: 0',
            'transition: opacity 0.3s'
        ].join(';');
        toast.textContent = mensagem;
        document.body.appendChild(toast);

        requestAnimationFrame(() => { toast.style.opacity = '1'; });

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, MENSAGEM_MS);
    }

    /* ============================================================
       12. EVENTOS
       ============================================================ */
    function setupEventos() {
        const form = $('busca-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const input = $('busca-input');
                if (input) buscarLivros(input.value);
            });
        }

        document.querySelectorAll('[data-fechar-modal]').forEach((el) => {
            el.addEventListener('click', fecharModalLivro);
        });

        document.querySelectorAll('[data-fechar-modal-estante]').forEach((el) => {
            el.addEventListener('click', fecharModalEstante);
        });

        const btnAdd = $('btn-adicionar-estante');
        if (btnAdd) {
            btnAdd.addEventListener('click', () => {
                if (estado.livroSelecionado) abrirModalEstante(estado.livroSelecionado);
            });
        }

        document.querySelectorAll('.opcao-estante').forEach((btn) => {
            btn.addEventListener('click', () => {
                const status = btn.getAttribute('data-status');
                adicionarAEstante(status);
            });
        });

        const btnTentar = $('btn-tentar');
        if (btnTentar) {
            btnTentar.addEventListener('click', () => {
                if (estado.modo === 'busca' && estado.buscaAtual) {
                    buscarLivros(estado.buscaAtual);
                } else {
                    carregarCatalogo();
                }
            });
        }

        const btnVoltar = $('btn-voltar-populares');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', () => {
                const input = $('busca-input');
                if (input) input.value = '';
                carregarCatalogo();
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                fecharModalLivro();
                fecharModalEstante();
            }
        });

        setupLayout();

        const btnSair = $('btn-sair');
        if (btnSair) {
            btnSair.addEventListener('click', async () => {
                const db = getDb();
                if (db) await db.auth.signOut();
                irParaLogin();
            });
        }
    }

    function setupLayout() {
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

        document.addEventListener('click', (e) => {
            const alvo = e.target;

            if (sidebar && sidebar.classList.contains('aberta') &&
                !sidebar.contains(alvo) &&
                !(btnHamburger && btnHamburger.contains(alvo))) {
                sidebar.classList.remove('aberta');
                atualizarOverlay();
            }

            if (ficha && ficha.classList.contains('ativa') && compacto.matches &&
                !ficha.contains(alvo) &&
                !(btnPerfil && btnPerfil.contains(alvo))) {
                ficha.classList.remove('ativa');
                document.body.classList.remove('ficha-aberta');
                atualizarOverlay();
            }
        });

        if (sidebar) {
            sidebar.addEventListener('click', (e) => {
                if (compacto.matches && e.target.closest('.sidebar-link')) {
                    sidebar.classList.remove('aberta');
                    atualizarOverlay();
                }
            });
        }
    }

    /* ============================================================
       13. INICIALIZACAO
       ============================================================ */
    async function iniciar() {
        sincronizarTela();
        setupAlturaFixa();
        setupTela();
        setupTeclado();
        setupModoFoco();
        setupPopoverFiltros();
        setupEventos();

        await iniciarSessao();

        await carregarCatalogo();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();