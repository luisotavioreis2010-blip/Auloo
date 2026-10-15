/* ============================================================
   CATALOGO.JS — v16 (OTIMIZADO)
   - Standard Ebooks + Gutenberg
   - Gutenberg reduzido para 3 paginas (era 10)
   - Mostra livros conforme carregam
   - Sessao esperada corretamente
   - Estatisticas na ficha
   ============================================================ */
(function () {
    'use strict';

    document.documentElement.classList.add('carregando-catalogo');

    const PAGINA_LOGIN = '/login.html';
    const LIMITE_RESULTADOS = 500;
    const LIMITE_STANDARD_EBOOKS = 400;
    const LIMITE_GUTENBERG_PAGINAS = 3;
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
    const $ = (id) => document.getElementById(id);
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

    function getDb() {
        if (window.getSupabaseClient) return window.getSupabaseClient();
        return window.supabaseClient ||
               (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    async function aguardarDb() {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const d = getDb();
            if (d && d.auth && typeof d.auth.getSession === 'function') return d;
            await esperar(SUPABASE_INTERVALO_MS);
        }
        return null;
    }

    function irParaLogin() {
        console.error('[CATALOGO] irParaLogin chamado');
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
       AUTENTICACAO
       ============================================================ */
    async function iniciarSessao() {
        console.log('[CATALOGO] iniciarSessao: comecando');

        const db = await aguardarDb();
        if (!db) {
            console.error('[CATALOGO] Supabase nao inicializou');
            irParaLogin();
            return;
        }
        console.log('[CATALOGO] Supabase OK');

        db.auth.onAuthStateChange((evento) => {
            console.log('[CATALOGO] Auth state change:', evento);
            if (evento === 'SIGNED_OUT') irParaLogin();
        });

        try {
            let sessao = null;
            for (let i = 0; i < 80; i++) {
                const resultado = await db.auth.getSession();
                if (resultado.error) console.warn('[CATALOGO] getSession erro:', resultado.error);
                sessao = resultado.data && resultado.data.session;
                if (sessao && sessao.user) {
                    console.log('[CATALOGO] Sessao encontrada na tentativa', i + 1, ':', sessao.user.email);
                    break;
                }
                if (i % 10 === 0 && i > 0) console.log('[CATALOGO] Tentativa', i + 1, '- sem sessao...');
                await esperar(SUPABASE_INTERVALO_MS);
            }

            if (!sessao || !sessao.user) {
                console.warn('[CATALOGO] Sem sessao depois de 16s');
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

            console.log('[CATALOGO] Usuario:', sessao.user.email);

            try {
                await carregarEstatisticas();
                console.log('[CATALOGO] Estatisticas OK');
            } catch (e) {
                console.warn('[CATALOGO] Estatisticas falharam:', e);
            }
            console.log('[CATALOGO] iniciarSessao: OK');
        } catch (erro) {
            console.error('[CATALOGO] Erro getSession:', erro);
            irParaLogin();
        }
    }

    /* ============================================================
       ESTATISTICAS
       ============================================================ */
    async function carregarEstatisticas() {
        const db = getDb();
        if (!db || !estado.usuario) return;

        try {
            const { data: progresso, error: errProg } = await db
                .from('reading_progress')
                .select('book_slug')
                .eq('user_id', estado.usuario.id)
                .gt('percent', 0);
            if (errProg) throw errProg;
            const totalLidos = progresso ? progresso.length : 0;

            const { data: historico, error: errHist } = await db
                .from('reading_history')
                .select('book_slug, book_title, book_author, book_cover, last_read_at')
                .eq('user_id', estado.usuario.id)
                .order('last_read_at', { ascending: false })
                .limit(3);
            if (errHist) throw errHist;

            renderizarEstatisticas(totalLidos, historico || []);
        } catch (e) {
            console.warn('Erro ao carregar estatisticas:', e);
        }
    }

    function renderizarEstatisticas(totalLidos, ultimos) {
        const contador = $('ficha-total-lidos');
        if (contador) contador.textContent = totalLidos;

        const container = $('ficha-ultimos-lidos');
        if (!container) return;
        container.textContent = '';

        if (!ultimos || ultimos.length === 0) {
            const vazio = document.createElement('p');
            vazio.className = 'ficha-vazio';
            vazio.textContent = 'Nenhum livro lido ainda';
            container.appendChild(vazio);
            return;
        }

        ultimos.forEach((livro) => {
            const item = document.createElement('a');
            item.className = 'ficha-livro-recente';
            item.href = 'leitor.html?url=' + encodeURIComponent(livro.book_slug) +
                        '&titulo=' + encodeURIComponent(livro.book_title || '') +
                        '&slug=' + encodeURIComponent(livro.book_slug) +
                        '&autor=' + encodeURIComponent(livro.book_author || '') +
                        '&capa=' + encodeURIComponent(livro.book_cover || '');
            item.title = livro.book_title;

            const capa = document.createElement('div');
            capa.className = 'ficha-livro-capa';
            if (livro.book_cover) {
                const img = document.createElement('img');
                img.src = livro.book_cover;
                img.alt = livro.book_title;
                img.loading = 'lazy';
                img.referrerPolicy = 'no-referrer';
                img.onerror = () => { capa.textContent = '📖'; };
                capa.appendChild(img);
            } else {
                capa.textContent = '📖';
            }

            const info = document.createElement('div');
            info.className = 'ficha-livro-info';
            const titulo = document.createElement('span');
            titulo.className = 'ficha-livro-titulo';
            titulo.textContent = livro.book_title || 'Sem titulo';
            info.appendChild(titulo);

            if (livro.book_author) {
                const autor = document.createElement('span');
                autor.className = 'ficha-livro-autor';
                autor.textContent = livro.book_author;
                info.appendChild(autor);
            }

            item.appendChild(capa);
            item.appendChild(info);
            container.appendChild(item);
        });
    }

    /* ============================================================
       AVATAR
       ============================================================ */
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
       SISTEMA DE FOCO
       ============================================================ */
    function setupAlturaFixa() {
        let maiorAltura = 0;
        let larguraMedida = 0;
        let timerAssentar = null;

        function aplicar(h) { maiorAltura = h; raiz.style.setProperty('--app-h', h + 'px'); }

        function medir() {
            if (window.innerWidth !== larguraMedida) { larguraMedida = window.innerWidth; maiorAltura = 0; }
            const h = window.innerHeight;
            if (h > maiorAltura) aplicar(h);
            clearTimeout(timerAssentar);
            timerAssentar = setTimeout(() => {
                if (!campoEmFoco() && window.innerHeight !== maiorAltura) aplicar(window.innerHeight);
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
        document.querySelectorAll('[data-ativo="true"]').forEach((el) => el.removeAttribute('data-ativo'));
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
        if (raiz.getAttribute('data-layout') !== layout) raiz.setAttribute('data-layout', layout);
        const alturaNova = window.innerHeight <= ALTURA_BAIXA_PX ? 'baixa' : 'normal';
        if (raiz.getAttribute('data-altura') !== alturaNova) raiz.setAttribute('data-altura', alturaNova);
    }

    function escolherReferencia() { return document.querySelector('[data-ativo="true"]'); }

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
        if (ehLayoutRow() && raiz.classList.contains('kb-focus')) { resetarKbOffset(); return; }

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
        requestAnimationFrame(() => { ajusteRaf = false; calcularKbOffset(); });
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
                if (ativo && ativo.tagName === 'INPUT') marcarAtivo(ativo);
                else limparModo();
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
            temporizadorTransicao = setTimeout(() => raiz.classList.remove('redimensionando'), REDIMENSIONANDO_MS);
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
                raiz.style.getPropertyValue('--kb-visivel')) limparEstadoTeclado();
        }, WATCHDOG_MS);
        sincronizarTela();
    }

    /* ============================================================
       RENDERIZACAO
       ============================================================ */
    function esconderTudo() {
        ['catalogo-loading', 'catalogo-erro', 'resultados-info', 'catalogo-fim'].forEach((id) => {
            const el = $(id); if (el) el.hidden = true;
        });
        const grid = $('resultados-grid'); if (grid) limpar(grid);
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
        if (msg) msg.textContent = mensagem || 'Nao foi possivel buscar os livros.';
        if (erro) erro.hidden = false;
    }

    function mostrarResultados(livros) {
        esconderTudo();
        if (!livros || livros.length === 0) return;
        const grid = $('resultados-grid');
        const info = $('resultados-info');
        const contagem = $('resultados-contagem');
        const btnVoltar = $('btn-voltar-populares');

        if (contagem) contagem.textContent = livros.length === 1 ? '1 livro' : livros.length + ' livros';
        if (info) info.hidden = false;
        if (btnVoltar) btnVoltar.hidden = estado.modo !== 'busca';

        const fragmento = document.createDocumentFragment();
        livros.forEach((livro) => fragmento.appendChild(criarCardLivro(livro)));
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

        if (livro.cover_url) mostrarCapa(livro.cover_url);
        else mostrarPlaceholder();

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
       CARREGAR CATALOGO — OTIMIZADO
       ============================================================ */
    async function carregarCatalogo() {
        console.log('[CATALOGO] carregarCatalogo: comecando');
        estado.modo = 'populares';
        estado.buscaAtual = '';
        mostrarLoading('Carregando catalogo...');

        try {
            const todos = [];
            const vistos = new Set();
            let jaMostrou = false;

            function adicionar(lista, fonte) {
                if (!lista) return;
                lista.forEach((livro) => {
                    if (!livro || !livro.title) return;
                    const chave = (livro.title || '').toLowerCase().trim() + '|' + (livro.author || '').toLowerCase().trim();
                    if (vistos.has(chave)) return;
                    vistos.add(chave);
                    if (fonte) livro.source = fonte;
                    todos.push(livro);
                });
            }

            // Mostra os livros conforme vao chegando (nao espera tudo)
            function atualizar() {
                estado.resultados = todos.slice();
                if (todos.length > 0) {
                    mostrarResultados(todos);
                    jaMostrou = true;
                }
            }

            // 1. STANDARD EBOOKS
            console.log('[CATALOGO] Buscando Standard Ebooks...');
            const t1 = Date.now();
            atualizarLoading('Buscando no Standard Ebooks...');
            try {
                const se = await window.apiStandardEbooks.buscarPopulares();
                console.log('[CATALOGO] Standard Ebooks:', se ? se.length : 0, 'em', Date.now() - t1, 'ms');
                if (se && se.length > 0) {
                    adicionar(se.slice(0, LIMITE_STANDARD_EBOOKS), 'standardebooks');
                    atualizar();
                    atualizarLoading('Carregando ' + todos.length + ' livros...');
                }
            } catch (e) { console.warn('[CATALOGO] Standard Ebooks falhou:', e); }

            // 2. GUTENBERG (3 paginas apenas)
            console.log('[CATALOGO] Buscando Gutenberg...');
            const t2 = Date.now();
            atualizarLoading('Buscando no Gutenberg...');
            for (let p = 1; p <= LIMITE_GUTENBERG_PAGINAS; p++) {
                if (todos.length >= LIMITE_RESULTADOS) break;
                try {
                    const tp = Date.now();
                    const pagina = await window.apiGutenberg.buscarPopularesPaginado('', p);
                    console.log('[CATALOGO] Gutenberg p' + p + ':', pagina ? pagina.length : 0, 'em', Date.now() - tp, 'ms');
                    if (!pagina || pagina.length === 0) break;
                    adicionar(pagina, 'gutenberg');
                    atualizar();
                    atualizarLoading('Carregando ' + todos.length + ' de ' + LIMITE_RESULTADOS + ' livros...');
                } catch (e) {
                    console.warn('[CATALOGO] Gutenberg p' + p + ' falhou');
                    break;
                }
            }
            console.log('[CATALOGO] Gutenberg total:', Date.now() - t2, 'ms');

            // 3. ORDENAR
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
            console.log('[CATALOGO] Total final:', todos.length, 'livros');
            if (todos.length === 0) mostrarErro('Nenhum livro carregado.');
        } catch (erro) {
            console.error('[CATALOGO] Erro ao carregar catalogo:', erro);
            mostrarErro('Nao foi possivel carregar o catalogo.');
        }
    }

    /* ============================================================
       BUSCA
       ============================================================ */
    async function buscarLivros(termo) {
        termo = String(termo || '').trim();
        if (!termo) { await carregarCatalogo(); return; }

        estado.modo = 'busca';
        estado.buscaAtual = termo;
        estado.carregando = true;
        mostrarLoading('Buscando livros...');

        try {
            let livros = [];
            try {
                const gutenberg = await window.apiGutenberg.buscar(termo);
                livros = mesclarLivros(livros, gutenberg);
            } catch (e) {}
            try {
                const standardEbooks = await window.apiStandardEbooks.buscar(termo);
                livros = mesclarLivros(livros, standardEbooks);
            } catch (e) {}

            estado.resultados = livros;
            aplicarFiltrosEOrdenacao();
        } catch (erro) {
            console.error(erro);
            mostrarErro('Nao foi possivel buscar os livros.');
        } finally {
            estado.carregando = false;
        }
    }

    function mesclarLivros(lista1, lista2) {
        const vistos = new Set();
        const resultado = [];
        function adicionar(livro) {
            const chave = (livro.title || '').toLowerCase() + '|' + (livro.author || '').toLowerCase();
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
        if (idioma) livros = livros.filter((l) => (l.language || '').toLowerCase().indexOf(idioma) === 0);

        const fonte = $('filtro-fonte') ? $('filtro-fonte').value : '';
        if (fonte) {
            if (fonte === 'gutenberg') livros = livros.filter((l) => l.has_ebook);
            else livros = livros.filter((l) => l.source === fonte);
        }

        const ordem = $('filtro-ordem') ? $('filtro-ordem').value : 'relevancia';
        if (ordem === 'ano-desc') livros.sort((a, b) => (b.year || 0) - (a.year || 0));
        else if (ordem === 'ano-asc') livros.sort((a, b) => (a.year || 9999) - (b.year || 9999));
        else if (ordem === 'titulo') livros.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

        estado.resultadosFiltrados = livros;
        mostrarResultados(livros);
    }

    /* ============================================================
       FILTROS
       ============================================================ */
    function setupPopoverFiltros() {
        const btn = $('busca-filtro-btn');
        const popover = $('filtros-popover');
        if (!btn || !popover) return;
        function abrir() { popover.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
        function fechar() { popover.hidden = true; btn.setAttribute('aria-expanded', 'false'); }

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
            if (e.key === 'Escape' && !popover.hidden) { fechar(); btn.focus(); }
        });
        ['filtro-idioma', 'filtro-fonte', 'filtro-ordem'].forEach((id) => {
            const el = $(id);
            if (el) el.addEventListener('change', aplicarFiltrosEOrdenacao);
        });
    }

    /* ============================================================
       MODAIS
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
        if (descricao) descricao.textContent = livro.description || 'Sem descricao disponivel.';

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
        if (modal) { modal.hidden = false; document.body.style.overflow = 'hidden'; }
    }

    function fecharModalEstante() {
        const modal = $('modal-estante');
        if (modal) modal.hidden = true;
        document.body.style.overflow = '';
    }

    /* ============================================================
       ADICIONAR A ESTANTE
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
                title: livro.title, author: livro.author || null,
                cover_url: livro.cover_url || null, description: livro.description || null,
                pages: livro.pages || null, year: livro.year || null,
                publisher: livro.publisher || null, language: livro.language || 'pt',
                genre: livro.genre || null, source: livro.source || 'manual',
                external_id: livro.external_id || null, external_url: livro.external_url || null,
                has_ebook: !!livro.has_ebook, ebook_url: livro.ebook_url || null
            };

            let bookId = null;
            if (livro.external_id && livro.source) {
                const existente = await db.from('books').select('id')
                    .eq('external_id', livro.external_id).eq('source', livro.source).maybeSingle();
                if (existente.data) bookId = existente.data.id;
            }
            if (!bookId) {
                const inserido = await db.from('books').insert(livroParaSalvar).select('id').single();
                if (inserido.error) throw inserido.error;
                bookId = inserido.data.id;
            }

            const jaTem = await db.from('user_books').select('id')
                .eq('user_id', estado.usuario.id).eq('book_id', bookId).maybeSingle();

            if (jaTem.data) {
                const atualizar = await db.from('user_books')
                    .update({ status: status }).eq('id', jaTem.data.id);
                if (atualizar.error) throw atualizar.error;
            } else {
                const inserir = await db.from('user_books').insert({
                    user_id: estado.usuario.id, book_id: bookId, status: status
                });
                if (inserir.error) throw inserir.error;
            }

            fecharModalEstante();
            fecharModalLivro();
            mostrarToast('Adicionado a estante!');
        } catch (erro) {
            console.error('Erro ao adicionar:', erro);
            mostrarToast('Nao foi possivel adicionar.', true);
        } finally {
            botoes.forEach((b) => { b.disabled = false; });
        }
    }

    function mostrarToast(mensagem, ehErro) {
        const toast = document.createElement('div');
        toast.style.cssText = [
            'position: fixed', 'bottom: 2rem', 'left: 50%',
            'transform: translateX(-50%)', 'padding: 0.9rem 1.5rem',
            'background: ' + (ehErro ? '#B23A2E' : '#2E7D4F'),
            'color: #fff', 'font-family: Poppins, sans-serif', 'font-size: 0.85rem',
            'border-radius: 4px', 'box-shadow: 0 12px 32px rgba(0,0,0,0.25)',
            'z-index: 9999', 'opacity: 0', 'transition: opacity 0.3s'
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
       EVENTOS
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
        document.querySelectorAll('[data-fechar-modal]').forEach((el) => el.addEventListener('click', fecharModalLivro));
        document.querySelectorAll('[data-fechar-modal-estante]').forEach((el) => el.addEventListener('click', fecharModalEstante));

        const btnAdd = $('btn-adicionar-estante');
        if (btnAdd) btnAdd.addEventListener('click', () => {
            if (estado.livroSelecionado) abrirModalEstante(estado.livroSelecionado);
        });

        document.querySelectorAll('.opcao-estante').forEach((btn) => {
            btn.addEventListener('click', () => adicionarAEstante(btn.getAttribute('data-status')));
        });

        const btnTentar = $('btn-tentar');
        if (btnTentar) btnTentar.addEventListener('click', () => {
            if (estado.modo === 'busca' && estado.buscaAtual) buscarLivros(estado.buscaAtual);
            else carregarCatalogo();
        });

        const btnVoltar = $('btn-voltar-populares');
        if (btnVoltar) btnVoltar.addEventListener('click', () => {
            const input = $('busca-input');
            if (input) input.value = '';
            carregarCatalogo();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { fecharModalLivro(); fecharModalEstante(); }
        });

        setupLayout();

        const btnSair = $('btn-sair');
        if (btnSair) btnSair.addEventListener('click', async () => {
            const dbLocal = getDb();
            if (dbLocal) await dbLocal.auth.signOut();
            irParaLogin();
        });
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

        if (btnHamburger && sidebar) btnHamburger.addEventListener('click', () => {
            sidebar.classList.toggle('aberta'); atualizarOverlay();
        });
        if (btnPerfil && ficha) btnPerfil.addEventListener('click', () => {
            ficha.classList.toggle('ativa');
            document.body.classList.toggle('ficha-aberta', ficha.classList.contains('ativa'));
            atualizarOverlay();
        });
        if (btnFecharFicha && ficha) btnFecharFicha.addEventListener('click', () => {
            ficha.classList.remove('ativa');
            document.body.classList.remove('ficha-aberta');
            atualizarOverlay();
        });
        if (overlay) overlay.addEventListener('click', () => {
            if (sidebar) sidebar.classList.remove('aberta');
            if (ficha) ficha.classList.remove('ativa');
            document.body.classList.remove('ficha-aberta');
            atualizarOverlay();
        });
        document.addEventListener('click', (e) => {
            const alvo = e.target;
            if (sidebar && sidebar.classList.contains('aberta') &&
                !sidebar.contains(alvo) && !(btnHamburger && btnHamburger.contains(alvo))) {
                sidebar.classList.remove('aberta'); atualizarOverlay();
            }
            if (ficha && ficha.classList.contains('ativa') && compacto.matches &&
                !ficha.contains(alvo) && !(btnPerfil && btnPerfil.contains(alvo))) {
                ficha.classList.remove('ativa');
                document.body.classList.remove('ficha-aberta');
                atualizarOverlay();
            }
        });
        if (sidebar) sidebar.addEventListener('click', (e) => {
            if (compacto.matches && e.target.closest('.sidebar-link')) {
                sidebar.classList.remove('aberta'); atualizarOverlay();
            }
        });
    }

    /* ============================================================
       INICIALIZACAO
       ============================================================ */
    async function iniciar() {
        console.log('[CATALOGO] iniciar: comecando');
        sincronizarTela();
        setupAlturaFixa();
        setupTela();
        setupTeclado();
        setupModoFoco();
        setupPopoverFiltros();
        try { setupEventos(); console.log('[CATALOGO] setupEventos OK'); }
        catch (e) { console.error('[CATALOGO] setupEventos FALHOU:', e); }

        await iniciarSessao();
        await carregarCatalogo();
        document.documentElement.classList.remove('carregando-catalogo');
        console.log('[CATALOGO] iniciar: FIM');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();