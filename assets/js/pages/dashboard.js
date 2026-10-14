/* ============================================================
   DASHBOARD.JS — v24
   ------------------------------------------------------------
   Suporte a:
     - Perfil (nome, foto, senha)
     - Criar senha para contas Google
     - Ficha do leitor responsiva (desktop / compacto / row)
     - Calendário mensal
     - Reposicionamento de inputs para teclado virtual

   Estrutura:
     1. Constantes
     2. Dependências (Auth)
     3. Utilitários puros
     4. DOM (cache)
     5. Estado
     6. Tela / viewport
     7. Teclado virtual (KB)
     8. Mensagens & containers
     9. Perfil (carregar / renderizar / logout)
    10. Ações do perfil (nome, senha, foto)
    11. Layout (sidebar / ficha / overlay)
    12. Calendário
    13. Auth listener
    14. Bootstrap & cleanup
   ============================================================ */
(function () {
    'use strict';

    /* ============================================================
       1. CONSTANTES
       ============================================================ */
    const CONFIG = Object.freeze({
        PAGINA_LOGIN: 'login.html',

        TIMEOUT_SIGNOUT_MS: 3000,
        TAMANHO_MAX_FOTO: 5 * 1024 * 1024,
        TENTATIVAS_OAUTH: 40,
        INTERVALO_OAUTH_MS: 200,
        MSG_VISIVEL_MS: 3000,
        MSG_SAIDA_MS: 500,

        // Teclado virtual
        KB_LIMITE_PX: 100,       // diferença mínima para considerar teclado aberto
        KB_MARGEM_PX: 16,        // folga entre input e topo do teclado
        KB_ESTABILIDADE_MS: 120, // espera antes de reposicionar quando o teclado fecha
        KB_PADDING_FICHA_VH: 60, // padding-bottom aplicado na ficha (em vh)

        CHAVES_LOGOUT: ['auloo_user', 'auloo_saved_email'],
    });

    const EXTENSOES_FOTO = Object.freeze({
        'image/jpeg': 'jpg',
        'image/png':  'png',
        'image/gif':  'gif',
        'image/webp': 'webp',
    });

    const IDS_CONTAINERS = Object.freeze([
        'container-editar-nome',
        'container-editar-senha',
        'container-criar-senha',
        'container-saiba-mais',
    ]);

    const MESES = Object.freeze([
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ]);

    const DIAS_SEMANA = Object.freeze([
        'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
        'Quinta-feira', 'Sexta-feira', 'Sábado',
    ]);

    /* ============================================================
       2. DEPENDÊNCIAS
       ============================================================ */
    let Auth = null;

    function resolverAuth() {
        const A = window.Auth;
        if (!A) {
            console.error('[dashboard] window.Auth não encontrado.');
            return false;
        }
        Auth = A;
        return true;
    }

    /* ============================================================
       3. UTILITÁRIOS PUROS
       ============================================================ */
    const $ = (id) => document.getElementById(id);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    const debounce = (fn, ms) => {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    };

    const verificar = (resultado) => {
        if (resultado?.error) throw resultado.error;
        return resultado?.data ?? null;
    };

    const formatarNome = (nome, email) => {
        let texto = String(nome || '').trim() || String(email || '');
        if (texto.includes('@')) texto = texto.split('@')[0];
        if (!texto) return 'Usuário';
        return texto.charAt(0).toUpperCase() + texto.slice(1);
    };

    /* ============================================================
       4. DOM (cache)
       ============================================================ */
    const raiz = document.documentElement;
    const dom = {};

    function montarDom() {
        // Navbar
        dom.btnSair        = $('btn-sair');
        dom.perfilBotao    = $('perfil-botao');
        dom.perfilUsuario  = $('perfil-usuario');
        dom.btnHamburger   = $('btn-hamburger');

        // Sidebar / ficha
        dom.sidebar        = $('sidebar');
        dom.ficha          = $('sidebar-perfil');
        dom.overlay        = $('gaveta-overlay');
        dom.fichaFechar    = $('ficha-fechar');

        // Ficha — perfil
        dom.fichaFoto      = $('sidebar-perfil-foto');
        dom.fichaNome      = $('sidebar-perfil-nome');
        dom.fichaEmail     = $('sidebar-perfil-email');

        // Ações
        dom.btnEditarFoto       = $('btn-editar-foto');
        dom.inputFoto           = $('input-foto');
        dom.btnEditarNome       = $('btn-editar-nome');
        dom.btnSalvarNome       = $('btn-salvar-nome');
        dom.inputNovoNome       = $('input-novo-nome');
        dom.btnEditarSenha      = $('btn-editar-senha');
        dom.inputSenhaAtual     = $('input-senha-atual');
        dom.inputSenhaNova      = $('input-senha-nova');
        dom.btnConfirmarSenha   = $('btn-confirmar-senha');
        dom.inputNovaSenhaCriar = $('input-nova-senha-criar');
        dom.inputConfirmarCriar = $('input-confirmar-senha-criar');
        dom.btnConfirmarCriar   = $('btn-confirmar-criar-senha');
        dom.btnSaibaMais        = $('btn-saiba-mais');

        // Calendário
        dom.calendarioTitulo    = $('calendario-titulo');
        dom.calendarioSubtitulo = $('calendario-subtitulo');
        dom.calendarioDias      = $('calendario-dias');
        dom.btnMesAnterior      = $('btn-mes-anterior');
        dom.btnProximoMes       = $('btn-proximo-mes');
    }

    /* ============================================================
       5. ESTADO
       ============================================================ */
    const perfil = {
        usuario: null,
        nome: 'Usuário',
        email: '',
        avatarUrl: null,
    };

    const estado = {
        timers: {
            mensagem: null,
            resize: null,
            redimensionando: null,
            kbEstabilidade: null,
        },
        listeners: [],
        resizeObserver: null,
        calendario: { mes: 0, ano: 0 },
        kb: {
            offset: 0,
            razao: 0.5,
            vvHeightAnterior: 0,
            rafPendente: false,
        },
    };

    function on(target, evento, handler, opts) {
        if (!target) return () => {};
        target.addEventListener(evento, handler, opts);
        const off = () => target.removeEventListener(evento, handler, opts);
        estado.listeners.push(off);
        return off;
    }

    function cleanup() {
        Object.values(estado.timers).forEach(clearTimeout);
        estado.listeners.forEach((off) => { try { off(); } catch (_) {} });
        estado.listeners.length = 0;
        estado.resizeObserver?.disconnect();
        estado.resizeObserver = null;
    }

    /* ============================================================
       6. TELA / VIEWPORT
       ============================================================ */
    const mqCompacto = window.matchMedia('(max-width: 1366px)');

    function campoEmFoco() {
        const el = document.activeElement;
        return Boolean(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    }

    /** Detecta se a mudança de viewport veio do teclado virtual. */
    function veioDoTeclado() {
        if (!window.visualViewport) return false;
        return (window.innerHeight - window.visualViewport.height) > CONFIG.KB_LIMITE_PX;
    }

    function sincronizarTela(forcar = false) {
        if (!forcar && campoEmFoco()) return;
        raiz.style.setProperty('--viewport-h', `${window.innerHeight}px`);
        raiz.setAttribute(
            'data-layout',
            window.innerWidth > window.innerHeight ? 'row' : 'stacked'
        );
    }

    let calendarioContainer = null;

    function ajustarLarguraFicha() {
        if (!calendarioContainer) {
            calendarioContainer = document.querySelector('.calendario-container');
        }
        if (!calendarioContainer) return;
        const esquerda = calendarioContainer.getBoundingClientRect().left;
        raiz.style.setProperty('--ficha-row-w', `${window.innerWidth - esquerda}px`);
    }

    function resetarScroll() {
        window.scrollTo(0, 0);
        const main = document.querySelector('.dashboard-main');
        const ficha = dom.ficha;
        if (main) main.scrollTop = 0;
        if (ficha) ficha.scrollTop = 0;
    }

    function setupTela() {
        let ultimaLargura = window.innerWidth;

        function sincronizarSeNecessario() {
            if (campoEmFoco() || veioDoTeclado()) return;

            const largura = window.innerWidth;
            const altura = window.innerHeight;
            const larguraMudou = largura !== ultimaLargura;
            const orientacaoMudou =
                (largura > altura) !== (ultimaLargura > window.innerHeight);

            ultimaLargura = largura;

            if (!larguraMudou && !orientacaoMudou) return;

            raiz.classList.add('redimensionando');

            sincronizarTela(true);
            ajustarLarguraFicha();
            resetarScroll();

            clearTimeout(estado.timers.redimensionando);
            estado.timers.redimensionando = setTimeout(
                () => raiz.classList.remove('redimensionando'),
                400
            );
        }

        const aoRedimensionar = debounce(() => {
            if (campoEmFoco() || veioDoTeclado()) return;
            sincronizarSeNecessario();
        }, 250);

        on(window, 'resize', aoRedimensionar);
        on(window, 'orientationchange', () => {
            [100, 400, 900].forEach((ms) =>
                setTimeout(() => {
                    if (campoEmFoco()) return;
                    sincronizarSeNecessario();
                }, ms)
            );
        });

        on(document, 'focusin', (e) => {
            if (e.target?.matches?.('input, textarea')) {
                document.body.classList.add('campo-focado');
            }
        });

        on(document, 'focusout', () => {
            setTimeout(() => {
                if (campoEmFoco()) return;
                document.body.classList.remove('campo-focado');
            }, 350);
        });

        if ('ResizeObserver' in window) {
            estado.resizeObserver = new ResizeObserver(() => {
                if (campoEmFoco() || veioDoTeclado()) return;
                ajustarLarguraFicha();
            });
            $$('.ilustracao-container, .calendario-container').forEach((el) =>
                estado.resizeObserver.observe(el)
            );
        }

        sincronizarTela(true);
        ajustarLarguraFicha();
    }

    /* ============================================================
       7. TECLADO VIRTUAL (KB)
       ------------------------------------------------------------
       Mesma lógica do login.js: quando o usuário foca um input
       perto do fundo, empurra o container pra cima via
       `--kb-offset` para deixá-lo visível acima do teclado.
       ============================================================ */
    const KB = (() => {
        function getAppH() {
            const v = raiz.style.getPropertyValue('--viewport-h');
            const n = parseFloat(v);
            return Number.isFinite(n) && n > 0 ? n : window.innerHeight;
        }

        function getTopoTeclado() {
            const vv = window.visualViewport;
            const topo = vv ? vv.offsetTop + vv.height : window.innerHeight;
            return Math.min(topo, window.innerHeight);
        }

        function tecladoAberto() {
            if (!campoEmFoco() || !window.visualViewport) return false;
            return (getAppH() - window.visualViewport.height) > CONFIG.KB_LIMITE_PX;
        }

        /**
         * Escolhe qual elemento serve de referência para o reposicionamento.
         * Retorna o wrapper mais externo que faz sentido empurrar.
         */
        function escolherReferencia() {
            const ativo = document.activeElement;
            if (!ativo || !(ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA')) {
                return null;
            }

            // Input dentro de wrapper de olho de senha → sobe o wrapper
            const wrapper = ativo.closest('.wrapper-olho-senha');
            if (wrapper) return wrapper;

            // Input dentro de container expansível → sobe o container
            const container = ativo.closest('.container-expansivel');
            if (container) return container;

            // Input dentro da ficha (fallback) → usa o input direto
            return ativo;
        }

        function calcular() {
            // Atualiza `--kb-visivel` enquanto o teclado está aberto
            if (tecladoAberto()) {
                const topo = Math.max(0, getTopoTeclado());
                const appH = getAppH();
                if (appH > 0) estado.kb.razao = topo / appH;
                raiz.style.setProperty('--kb-visivel', `${topo}px`);
            } else if (!raiz.classList.contains('kb-aberto')) {
                raiz.style.removeProperty('--kb-visivel');
            }

            if (!tecladoAberto()) {
                if (estado.kb.offset !== 0) {
                    estado.kb.offset = 0;
                    raiz.style.setProperty('--kb-offset', '0px');
                }
                return;
            }

            const ref = escolherReferencia();
            if (!ref) return;

            const bottomNatural = ref.getBoundingClientRect().bottom - estado.kb.offset;
            const limite = getTopoTeclado() - CONFIG.KB_MARGEM_PX;
            const novo = bottomNatural > limite ? limite - bottomNatural : 0;

            if (Math.abs(novo - estado.kb.offset) > 2) {
                estado.kb.offset = novo;
                raiz.style.setProperty('--kb-offset', `${novo}px`);
            }
        }

        function executar() {
            if (estado.kb.rafPendente) return;
            estado.kb.rafPendente = true;
            requestAnimationFrame(() => {
                estado.kb.rafPendente = false;
                calcular();
            });
        }

        function agendar() {
            const vv = window.visualViewport;
            const h = vv ? vv.height : window.innerHeight;
            const diff = h - estado.kb.vvHeightAnterior;
            if (Math.abs(diff) <= 1) return;

            estado.kb.vvHeightAnterior = h;
            clearTimeout(estado.timers.kbEstabilidade);

            if (diff > 0) {
                // Teclado fechando/abrindo pra cima → executa logo
                executar();
            } else {
                // Teclado abrindo → espera estabilizar
                estado.timers.kbEstabilidade = setTimeout(
                    executar,
                    CONFIG.KB_ESTABILIDADE_MS
                );
            }
        }

        function limpar() {
            estado.kb.offset = 0;
            raiz.style.setProperty('--kb-offset', '0px');
            raiz.classList.remove('kb-aberto');
            raiz.style.removeProperty('--kb-visivel');

            if (dom.ficha) dom.ficha.style.paddingBottom = '';
        }

        function setup() {
            if (window.visualViewport) {
                on(window.visualViewport, 'resize', agendar);
                on(window.visualViewport, 'scroll', agendar);
            }
            on(window, 'resize', agendar);

            on(document, 'focusin', (e) => {
                if (!e.target?.matches?.('input, textarea')) return;

                raiz.classList.add('kb-aberto');

                // Aplica padding-bottom dinâmico na ficha quando o campo
                // está dentro dela — permite rolar até o input no compacto
                if (e.target.closest('.sidebar-direita')) {
                    if (dom.ficha) {
                        dom.ficha.style.paddingBottom =
                            `${CONFIG.KB_PADDING_FICHA_VH}vh`;
                    }
                }

                // Execuções escalonadas para pegar a abertura do teclado
                setTimeout(agendar, 50);
                setTimeout(agendar, 200);
                setTimeout(executar, 350);
            });

            on(document, 'focusout', () => {
                setTimeout(() => {
                    if (campoEmFoco()) return;

                    raiz.classList.remove('kb-aberto');
                    if (dom.ficha) dom.ficha.style.paddingBottom = '';

                    clearTimeout(estado.timers.kbEstabilidade);
                    executar();

                    // Segunda passada: garante que o offset zerou
                    setTimeout(executar, 300);
                }, 80);
            });

            on(window, 'orientationchange', () => {
                [50, 300, 600].forEach((ms) => setTimeout(agendar, ms));
            });

            // Quando a ficha é fechada, zera qualquer offset pendente
            on(window, 'pagehide', limpar);
        }

        return { setup, limpar, tecladoAberto, getTopoTeclado };
    })();

    /* ============================================================
       8. MENSAGENS & CONTAINERS
       ============================================================ */
    function mostrarMensagem(texto, tipo = 'sucesso') {
        clearTimeout(estado.timers.mensagem);

        const anterior = $('mensagem-sidebar');
        if (anterior) anterior.remove();

        const msg = document.createElement('div');
        msg.id = 'mensagem-sidebar';
        msg.className = `mensagem-sidebar mensagem-sidebar--${tipo}`;
        msg.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
        msg.textContent = texto;

        const referencia = $('container-editar-senha');
        if (referencia?.parentNode) {
            referencia.parentNode.insertBefore(msg, referencia);
        } else {
            const menu = document.querySelector('.ficha-menu');
            if (menu) menu.insertBefore(msg, menu.firstChild);
        }

        estado.timers.mensagem = setTimeout(() => {
            msg.classList.add('saindo');
            setTimeout(() => msg.remove(), CONFIG.MSG_SAIDA_MS);
        }, CONFIG.MSG_VISIVEL_MS);
    }

    function fecharContainer(id) {
        const container = $(id);
        if (!container) return;
        container.style.display = 'none';
        container.classList.remove('aberto');
    }

    function fecharTodosContainers() {
        IDS_CONTAINERS.forEach(fecharContainer);
    }

    function alternarContainer(id) {
        const alvo = $(id);
        if (!alvo) return;

        const jaAberto = alvo.classList.contains('aberto')
            || alvo.style.display === 'block';

        fecharTodosContainers();

        if (!jaAberto) {
            alvo.style.display = 'block';
            alvo.classList.add('aberto');
        }
    }

    /* ============================================================
       9. PERFIL
       ============================================================ */
    function criarIniciais(nome) {
        const partes = String(nome || 'Usuário').trim().split(/\s+/);
        const primeira = partes[0].charAt(0).toUpperCase();
        const ultima = partes.length > 1
            ? partes[partes.length - 1].charAt(0).toUpperCase()
            : '';

        const span = document.createElement('span');
        span.className = 'avatar-iniciais';
        span.textContent = primeira + ultima;
        return span;
    }

    function renderizarAvatar(container, avatarUrl, nome) {
        if (!container) return;
        container.textContent = '';

        if (!avatarUrl || avatarUrl === 'null') {
            container.appendChild(criarIniciais(nome));
            return;
        }

        const img = document.createElement('img');
        img.className = 'foto-perfil';
        img.alt = 'Foto de perfil';
        img.onerror = () => {
            img.remove();
            container.appendChild(criarIniciais(nome));
        };
        img.src = avatarUrl;
        container.appendChild(img);
    }

    function renderizarPerfil() {
        renderizarAvatar(dom.perfilUsuario, perfil.avatarUrl, perfil.nome);
        renderizarAvatar(dom.fichaFoto, perfil.avatarUrl, perfil.nome);
        if (dom.fichaNome) dom.fichaNome.textContent = perfil.nome;
        if (dom.fichaEmail) dom.fichaEmail.textContent = perfil.email;
    }

    function irParaLogin() {
        window.location.href = CONFIG.PAGINA_LOGIN;
    }

    function aplicarUsuario(usuario, { recarregar = false } = {}) {
        if (!usuario) return;

        const meta = usuario.user_metadata || {};
        perfil.usuario = usuario;
        perfil.email = usuario.email || '';
        perfil.nome = formatarNome(meta.full_name || meta.name, perfil.email);
        perfil.avatarUrl = meta.avatar_url || meta.picture || null;

        renderizarPerfil();
        if (recarregar) carregarPerfil();
    }

    async function carregarPerfil() {
        const db = Auth.getSupabaseClient?.();
        if (!db) { irParaLogin(); return; }

        try {
            const sessao = verificar(await db.auth.getSession());
            if (!sessao?.session) { irParaLogin(); return; }

            const usuario = sessao.session.user;
            const meta = usuario.user_metadata || {};
            let nome = meta.full_name || meta.name || null;
            let avatarUrl = meta.avatar_url || meta.picture || null;

            const consulta = await db
                .from('profiles')
                .select('full_name, avatar_url')
                .eq('id', usuario.id)
                .maybeSingle();

            if (consulta.error) {
                console.warn('[dashboard] profiles:', consulta.error.message);
            } else if (consulta.data) {
                if (consulta.data.full_name) nome = consulta.data.full_name;
                if (consulta.data.avatar_url) avatarUrl = consulta.data.avatar_url;
            }

            perfil.usuario = usuario;
            perfil.email = usuario.email || '';
            perfil.nome = formatarNome(nome, perfil.email);
            perfil.avatarUrl = avatarUrl;
            renderizarPerfil();
        } catch (erro) {
            console.error('[dashboard] carregarPerfil:', erro);
        }
    }

    async function fazerLogout() {
        const db = Auth.getSupabaseClient?.();

        try {
            if (db) {
                await Promise.race([
                    db.auth.signOut(),
                    new Promise((resolve) =>
                        setTimeout(resolve, CONFIG.TIMEOUT_SIGNOUT_MS)
                    ),
                ]);
            }
        } catch (erro) {
            console.warn('[dashboard] signOut:', erro);
        }

        try {
            CONFIG.CHAVES_LOGOUT.forEach((c) => localStorage.removeItem(c));
            Object.keys(localStorage)
                .filter((c) => c.startsWith('sb-') || c.startsWith('auloo-auth'))
                .forEach((c) => localStorage.removeItem(c));
            sessionStorage.clear();
        } catch (erro) {
            console.warn('[dashboard] limpar storage:', erro);
        }

        irParaLogin();
    }

    /* ============================================================
       10. AÇÕES DO PERFIL
       ============================================================ */
    async function executarAcao(botao, acao) {
        if (botao.disabled) return;
        botao.disabled = true;
        try {
            await acao();
        } catch (erro) {
            console.error('[dashboard]', erro);
            mostrarMensagem(`Erro: ${erro?.message || erro}`, 'erro');
        } finally {
            botao.disabled = false;
        }
    }

    async function salvarNome() {
        const novoNome = dom.inputNovoNome?.value.trim() || '';
        if (!novoNome) {
            mostrarMensagem('Digite um nome válido!', 'erro');
            return;
        }

        const db = Auth.getSupabaseClient?.();
        if (!db || !perfil.usuario) {
            mostrarMensagem('Erro: usuário não autenticado!', 'erro');
            return;
        }

        verificar(await db.auth.updateUser({ data: { full_name: novoNome } }));
        verificar(await db.from('profiles').upsert({
            id: perfil.usuario.id,
            full_name: novoNome,
            email: perfil.email,
            updated_at: new Date().toISOString(),
        }));

        perfil.nome = formatarNome(novoNome, perfil.email);
        renderizarPerfil();
        fecharContainer('container-editar-nome');
        mostrarMensagem('Nome atualizado!');
    }

    async function alterarSenha() {
        const senhaAtual = dom.inputSenhaAtual?.value || '';
        const senhaNova = dom.inputSenhaNova?.value || '';

        if (!senhaAtual || !senhaNova) {
            mostrarMensagem('Preencha todos os campos!', 'erro');
            return;
        }
        if (senhaNova.length < 8) {
            mostrarMensagem('Senha deve ter 8+ caracteres!', 'erro');
            return;
        }

        const db = Auth.getSupabaseClient?.();
        if (!db || !perfil.usuario) {
            mostrarMensagem('Erro de configuração!', 'erro');
            return;
        }

        const login = await db.auth.signInWithPassword({
            email: perfil.email,
            password: senhaAtual,
        });

        if (login.error) {
            const invalidas = login.error.code === 'invalid_credentials'
                || login.error.status === 400;
            mostrarMensagem(
                invalidas ? 'Senha atual incorreta!' : `Erro: ${login.error.message}`,
                'erro'
            );
            return;
        }

        verificar(await db.auth.updateUser({ password: senhaNova }));

        if (dom.inputSenhaAtual) dom.inputSenhaAtual.value = '';
        if (dom.inputSenhaNova) dom.inputSenhaNova.value = '';
        fecharContainer('container-editar-senha');
        mostrarMensagem('Senha atualizada!');
    }

    function usuarioTemSenha() {
        if (!perfil.usuario) return false;
        const identities = perfil.usuario.identities;
        if (!Array.isArray(identities)) return true;
        return identities.some((i) => i.provider === 'email');
    }

    async function criarSenha() {
        const senha = dom.inputNovaSenhaCriar?.value || '';
        const confirmacao = dom.inputConfirmarCriar?.value || '';

        if (!senha || !confirmacao) {
            mostrarMensagem('Preencha todos os campos!', 'erro');
            return;
        }
        if (senha.length < 8) {
            mostrarMensagem('Senha deve ter 8+ caracteres!', 'erro');
            return;
        }
        if (senha !== confirmacao) {
            mostrarMensagem('As senhas não coincidem!', 'erro');
            return;
        }

        const db = Auth.getSupabaseClient?.();
        if (!db || !perfil.usuario) {
            mostrarMensagem('Erro de configuração!', 'erro');
            return;
        }

        const resultado = await db.auth.updateUser({ password: senha });

        if (resultado.error) {
            mostrarMensagem(`Erro: ${resultado.error.message}`, 'erro');
            return;
        }

        if (resultado.data?.user) perfil.usuario = resultado.data.user;

        if (dom.inputNovaSenhaCriar) dom.inputNovaSenhaCriar.value = '';
        if (dom.inputConfirmarCriar) dom.inputConfirmarCriar.value = '';
        fecharContainer('container-criar-senha');
        mostrarMensagem('Senha criada!');
    }

    async function enviarFoto(arquivo) {
        const db = Auth.getSupabaseClient?.();
        if (!db || !perfil.usuario) {
            mostrarMensagem('Erro: usuário não autenticado!', 'erro');
            return;
        }

        const extensao = EXTENSOES_FOTO[arquivo.type];
        if (!extensao) {
            mostrarMensagem('Formato não suportado!', 'erro');
            return;
        }
        if (arquivo.size > CONFIG.TAMANHO_MAX_FOTO) {
            mostrarMensagem('Imagem muito grande! Máximo 5MB.', 'erro');
            return;
        }

        try {
            const caminho =
                `${perfil.usuario.id}/avatar_${perfil.usuario.id}_${Date.now()}.${extensao}`;

            verificar(await db.storage.from('avatars').upload(caminho, arquivo, {
                cacheControl: '3600',
                contentType: arquivo.type,
            }));

            const urlPublica =
                db.storage.from('avatars').getPublicUrl(caminho).data.publicUrl;

            verificar(await db.auth.updateUser({ data: { avatar_url: urlPublica } }));
            verificar(await db.from('profiles').upsert({
                id: perfil.usuario.id,
                avatar_url: urlPublica,
                updated_at: new Date().toISOString(),
            }));

            perfil.avatarUrl = urlPublica;
            renderizarPerfil();
            mostrarMensagem('Foto atualizada!');
        } catch (erro) {
            console.error('[dashboard] enviarFoto:', erro);
            mostrarMensagem(`Erro: ${erro?.message || erro}`, 'erro');
        }
    }

    function setupPerfil() {
        // Sair
        if (dom.btnSair) {
            on(dom.btnSair, 'click', () => {
                dom.btnSair.disabled = true;
                fazerLogout();
            });
        }

        // Mudar foto
        if (dom.btnEditarFoto && dom.inputFoto) {
            on(dom.btnEditarFoto, 'click', () => {
                fecharTodosContainers();
                dom.inputFoto.click();
            });
            on(dom.inputFoto, 'change', () => {
                const arquivo = dom.inputFoto.files[0];
                dom.inputFoto.value = '';
                if (arquivo) enviarFoto(arquivo);
            });
        }

        // Editar nome
        if (dom.btnEditarNome) {
            on(dom.btnEditarNome, 'click', (e) => {
                e.preventDefault();
                alternarContainer('container-editar-nome');
                if (dom.inputNovoNome) dom.inputNovoNome.value = perfil.nome;
            });
        }
        if (dom.btnSalvarNome) {
            on(dom.btnSalvarNome, 'click', (e) => {
                e.preventDefault();
                executarAcao(dom.btnSalvarNome, salvarNome);
            });
        }

        // Botão "Senha" — decide entre editar e criar
        if (dom.btnEditarSenha) {
            on(dom.btnEditarSenha, 'click', (e) => {
                e.preventDefault();

                if (usuarioTemSenha()) {
                    alternarContainer('container-editar-senha');
                    if (dom.inputSenhaAtual) dom.inputSenhaAtual.value = '';
                    if (dom.inputSenhaNova) dom.inputSenhaNova.value = '';
                } else {
                    alternarContainer('container-criar-senha');
                    if (dom.inputNovaSenhaCriar) dom.inputNovaSenhaCriar.value = '';
                    if (dom.inputConfirmarCriar) dom.inputConfirmarCriar.value = '';
                }
            });
        }

        if (dom.btnConfirmarSenha) {
            on(dom.btnConfirmarSenha, 'click', (e) => {
                e.preventDefault();
                executarAcao(dom.btnConfirmarSenha, alterarSenha);
            });
        }

        if (dom.btnConfirmarCriar) {
            on(dom.btnConfirmarCriar, 'click', (e) => {
                e.preventDefault();
                executarAcao(dom.btnConfirmarCriar, criarSenha);
            });
        }

        // Saiba mais
        if (dom.btnSaibaMais) {
            on(dom.btnSaibaMais, 'click', (e) => {
                e.preventDefault();
                alternarContainer('container-saiba-mais');
            });
        }

        // Olhos de senha
        $$('.btn-olho-senha').forEach((botao) => {
            on(botao, 'click', () => {
                const input = $(botao.getAttribute('data-target'));
                const aberto = botao.querySelector('.icone-olho-aberto');
                const fechado = botao.querySelector('.icone-olho-fechado');
                if (!input || !aberto || !fechado) return;

                const mostrar = input.type === 'password';
                input.type = mostrar ? 'text' : 'password';
                aberto.style.display = mostrar ? 'block' : 'none';
                fechado.style.display = mostrar ? 'none' : 'block';
            });
        });
    }

    /* ============================================================
       11. LAYOUT (sidebar / ficha / overlay)
       ============================================================ */
    function setupLayout() {
        const { sidebar, ficha, overlay, perfilBotao, fichaFechar, btnHamburger } = dom;

        const sidebarAberta = () => sidebar?.classList.contains('aberta') ?? false;
        const fichaAberta = () => ficha?.classList.contains('ativa') ?? false;

        function atualizarEstado() {
            if (overlay) {
                overlay.classList.toggle(
                    'ativa',
                    sidebarAberta() || (mqCompacto.matches && fichaAberta())
                );
            }
            btnHamburger?.setAttribute('aria-expanded', String(sidebarAberta()));
            perfilBotao?.setAttribute('aria-expanded', String(fichaAberta()));
        }

        function abrirSidebar() { sidebar?.classList.add('aberta'); atualizarEstado(); }
        function fecharSidebar() { sidebar?.classList.remove('aberta'); atualizarEstado(); }

        function abrirFicha() {
            if (!ficha) return;
            ficha.classList.add('ativa');
            document.body.classList.add('ficha-aberta');
            ajustarLarguraFicha();
            atualizarEstado();
        }

        function fecharFicha() {
            if (!ficha) return;
            if (ficha.contains(document.activeElement)) document.activeElement.blur();
            ficha.classList.remove('ativa');
            document.body.classList.remove('ficha-aberta');
            fecharTodosContainers();
            KB.limpar();
            atualizarEstado();
        }

        if (perfilBotao) {
            on(perfilBotao, 'click', () => {
                fichaAberta() ? fecharFicha() : abrirFicha();
            });
        }

        if (fichaFechar) on(fichaFechar, 'click', fecharFicha);

        if (btnHamburger) {
            on(btnHamburger, 'click', () => {
                sidebarAberta() ? fecharSidebar() : abrirSidebar();
            });
        }

        if (overlay) {
            on(overlay, 'click', () => {
                fecharSidebar();
                fecharFicha();
            });
        }

        on(document, 'click', (e) => {
            const alvo = e.target;
            if (sidebarAberta() && !sidebar.contains(alvo)
                && !btnHamburger?.contains(alvo)) {
                fecharSidebar();
            }
            if (mqCompacto.matches && fichaAberta() && !ficha.contains(alvo)
                && !perfilBotao?.contains(alvo) && !campoEmFoco()) {
                fecharFicha();
            }
        });

        if (sidebar) {
            on(sidebar, 'click', (e) => {
                if (mqCompacto.matches && e.target.closest('.sidebar-link')) {
                    fecharSidebar();
                }
            });
        }

        on(document, 'keydown', (e) => {
            if (e.key !== 'Escape') return;
            fecharSidebar();
            fecharFicha();
        });

        const aoCruzarBreakpoint = () => {
            fecharSidebar();
            fecharFicha();
            if (campoEmFoco()) document.activeElement.blur();
            document.body.classList.remove('campo-focado');
            sincronizarTela(true);
            resetarScroll();
            ajustarLarguraFicha();
        };

        if (mqCompacto.addEventListener) {
            on(mqCompacto, 'change', aoCruzarBreakpoint);
        } else if (mqCompacto.addListener) {
            mqCompacto.addListener(aoCruzarBreakpoint);
            estado.listeners.push(() => mqCompacto.removeListener(aoCruzarBreakpoint));
        }
    }

    /* ============================================================
       12. CALENDÁRIO
       ============================================================ */
    function setupCalendario() {
        const { calendarioTitulo, calendarioSubtitulo, calendarioDias,
                btnMesAnterior, btnProximoMes } = dom;
        if (!calendarioTitulo || !calendarioDias) return;

        const agora = new Date();
        estado.calendario.mes = agora.getMonth();
        estado.calendario.ano = agora.getFullYear();

        function desenhar() {
            const hoje = new Date();
            const { mes, ano } = estado.calendario;

            const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
            const diasNoMes = new Date(ano, mes + 1, 0).getDate();
            const diasMesAnterior = new Date(ano, mes, 0).getDate();

            const celulas = [];

            for (let i = primeiroDiaSemana - 1; i >= 0; i--) {
                celulas.push(`<span class="dia-outro-mes">${diasMesAnterior - i}</span>`);
            }

            for (let i = 1; i <= diasNoMes; i++) {
                const ehHoje = i === hoje.getDate()
                    && mes === hoje.getMonth()
                    && ano === hoje.getFullYear();
                celulas.push(`<span${ehHoje ? ' class="dia-atual"' : ''}>${i}</span>`);
            }

            const faltam = (7 - (celulas.length % 7)) % 7;
            for (let i = 1; i <= faltam; i++) {
                celulas.push(`<span class="dia-outro-mes">${i}</span>`);
            }

            calendarioTitulo.textContent = `${MESES[mes]} ${ano}`;
            if (calendarioSubtitulo) {
                calendarioSubtitulo.textContent = DIAS_SEMANA[hoje.getDay()];
            }
            calendarioDias.innerHTML = celulas.join('');
        }

        function mudarMes(delta) {
            let { mes, ano } = estado.calendario;
            mes += delta;
            if (mes < 0) { mes = 11; ano--; }
            if (mes > 11) { mes = 0; ano++; }
            estado.calendario.mes = mes;
            estado.calendario.ano = ano;
            desenhar();
        }

        if (btnMesAnterior) on(btnMesAnterior, 'click', () => mudarMes(-1));
        if (btnProximoMes) on(btnProximoMes, 'click', () => mudarMes(1));

        desenhar();
    }

    /* ============================================================
       13. AUTH LISTENER
       ============================================================ */
    function setupAuthListener() {
        const db = Auth.getSupabaseClient?.();
        if (!db) return;

        on(db.auth, 'onAuthStateChange', (evento, sessao) => {
            if (
                (evento === 'SIGNED_IN' || evento === 'INITIAL_SESSION') &&
                sessao?.user
            ) {
                aplicarUsuario(sessao.user, { recarregar: true });
            }
        });
    }

    async function aguardarOAuthEEntrar() {
        for (let i = 0; i < CONFIG.TENTATIVAS_OAUTH; i++) {
            const db = Auth.getSupabaseClient?.();

            if (db) {
                try {
                    const { data } = await db.auth.getSession();
                    if (data?.session?.user) {
                        aplicarUsuario(data.session.user, { recarregar: true });
                        return;
                    }
                } catch (erro) {
                    console.error('[dashboard] getSession:', erro);
                    irParaLogin();
                    return;
                }
            }

            await new Promise((r) => setTimeout(r, CONFIG.INTERVALO_OAUTH_MS));
        }

        console.warn('[dashboard] Nenhuma sessão após espera, indo para login.');
        irParaLogin();
    }

    /* ============================================================
       14. BOOTSTRAP
       ============================================================ */
    function bootstrap() {
        montarDom();

        if (!resolverAuth()) return;

        sincronizarTela(true);
        setupTela();
        KB.setup();
        setupPerfil();
        setupLayout();
        setupCalendario();
        setupAuthListener();
        aguardarOAuthEEntrar();

        on(window, 'pagehide', cleanup);
        on(window, 'beforeunload', cleanup);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }
})();