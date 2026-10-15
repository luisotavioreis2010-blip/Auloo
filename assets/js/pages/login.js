/* ============================================================
   LOGIN.JS
   Login, cadastro (e-mail -> código -> senha), recuperação de senha,
   login social e ajustes de layout/teclado para celular e tablet.
   Sintaxe limitada a ES2017 (sem ?. nem ??) por causa de iPads antigos.

   Depende de funções globais de auth.js:
   validateEmail, validarSenhaForte, loginUser, checkEmailExists,
   recoverPassword, sendSignupCode, verifySignupCode.
   ============================================================ */
(function () {
    'use strict';

    /* ============================================================
       1. CONSTANTES, ESTADO E UTILITÁRIOS
       ============================================================ */
    const PAGINA_ESTANTE = 'estante.html';
    const URL_ESTANTE_PRODUCAO = 'https://auloo.com.br/estante.html';
    const LOTTIE_PATH = 'assets/img/animacoes/mail-animation.json';

    const REDIRECIONAR_MS = 500;
    const MENSAGEM_MIN_MS = 1800;
    const MENSAGEM_MS_CHAR = 55;
    const ALTURA_BAIXA_PX = 640;
    const LARGURA_MOBILE_PX = 599;
    const LIMITE_TECLADO_PX = 100;
    const MARGEM_TECLADO_PX = 16;
    const ROTATING_MS = 500;
    const ESTABILIDADE_MS = 120;
    const WATCHDOG_MS = 1500;
    const SUPABASE_TENTATIVAS = 30;
    const SUPABASE_INTERVALO_MS = 200;
    const DIGITOS_CODIGO = 6;

    const MQ_ROW = '(min-width: 568px) and (max-width: 950px) and (orientation: landscape) and (max-height: 500px)';

    const PROVEDORES_SOCIAIS = {
        google:  { rotulo: 'Google',  params: { prompt: 'select_account', access_type: 'online' } },
        discord: { rotulo: 'Discord', params: {} },
        github:  { rotulo: 'GitHub',  params: {} }
    };

    const svgIcone = (caminho) =>
        '<svg class="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" ' +
        'fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="' + caminho + '"/></svg>';

    const ICONE_EMAIL = svgIcone(
        'M13.106 7.222c0-2.967-2.249-5.032-5.482-5.032-3.35 0-5.646 2.318-5.646 5.702 0 3.493 2.235 5.708 5.762 5.708.862 0 1.689-.123 2.304-.335v-.862c-.43.199-1.354.328-2.29.328-2.926 0-4.813-1.88-4.813-4.798 0-2.844 1.921-4.881 4.594-4.881 2.735 0 4.608 1.688 4.608 4.156 0 1.682-.554 2.769-1.416 2.769-.492 0-.772-.28-.772-.76V5.206H8.923v.834h-.11c-.266-.595-.881-.964-1.6-.964-1.4 0-2.378 1.162-2.378 2.823 0 1.737.957 2.906 2.379 2.906.8 0 1.415-.39 1.709-1.087h.11c.081.67.703 1.148 1.503 1.148 1.572 0 2.57-1.415 2.57-3.643zm-7.177.704c0-1.197.54-1.907 1.456-1.907.93 0 1.524.738 1.524 1.907S8.308 9.84 7.371 9.84c-.895 0-1.442-.725-1.442-1.914z');

    const ICONE_CADEADO = svgIcone(
        'M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z');

    const $ = (id) => document.getElementById(id);
    const raiz = document.documentElement;

    /* Elementos (preenchidos em iniciar()) */
    let form = null;
    let inputEmail = null;
    let inputSenha = null;
    let botaoLogin = null;
    let botaoSignUp = null;
    let botaoForgot = null;
    let rotuloLogin = 'Login';

    /* Estado compartilhado entre as seções */
    let animacoesLottie = [];
    let offsetAtual = 0;             // deslocamento vertical aplicado por causa do teclado
    let razaoTeclado = 0.5;          // proporção da tela ocupada pela área visível com teclado
    let ativoAtual = null;           // input em foco no modo "row"
    let temporizadorMensagem = null;
    let timerAltura = null;
    let ajusteRaf = false;
    let vvHeightAnterior = 0;
    let timerEstabilidade = null;

    const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function getDb() {
        return window.supabaseClient ||
               (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    async function aguardarSupabase() {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const db = getDb();
            if (db) return db;
            await esperar(SUPABASE_INTERVALO_MS);
        }
        return null;
    }

    /* Remove < > e espaços das pontas; e-mail é sempre comparado em minúsculas */
    function normalizarEmail(valor) {
        return valor ? String(valor).replace(/[<>]/g, '').trim().toLowerCase() : '';
    }

    function emailValido(email) {
        if (typeof validateEmail === 'function') return validateEmail(email);
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /* Contexto lido por auth.js */
    function definirContexto(modoForgot, email, senha) {
        window.modoForgotPassword = modoForgot;
        window.emailVerificacao = email || null;
        window.senhaVerificacao = senha || null;
    }

    function estaVisivel(el) {
        if (!el || el.offsetParent === null) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function aoPressionarEnter(input, acao) {
        if (!input) return;
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            acao();
        });
    }

    function irParaESTANTE() {
        setTimeout(() => { window.location.href = PAGINA_ESTANTE; }, REDIRECIONAR_MS);
    }

    /* ============================================================
       2. VIEWPORT, ALTURA FIXA E LAYOUT
       ============================================================ */
    function ehLayoutRow() {
        return raiz.getAttribute('data-layout') === 'row';
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

    function campoEmFoco() {
        const ativo = document.activeElement;
        return !!ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA');
    }

    function tecladoAberto() {
        return campoEmFoco() && (getAppH() - getAlturaVisivel()) > LIMITE_TECLADO_PX;
    }

    /* Guarda a MAIOR altura vista, para o layout não encolher quando o teclado abre */
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

        /* O iOS/Android só "assentam" as dimensões alguns instantes depois */
        [0, 100, 300, 600, 1000, 1500].forEach((ms) => setTimeout(medir, ms));

        window.addEventListener('resize', medir);

        window.addEventListener('orientationchange', () => {
            maiorAltura = 0;
            [50, 300, 600, 1000].forEach((ms) => setTimeout(medir, ms));
        });

        medir();
    }

    /* Trava a altura mínima do card para ele não "pular" ao trocar mensagens */
    function aplicarAlturaLogin() {
        if (campoEmFoco() || tecladoAberto()) return;
        if (form.classList.contains('modo-forgot')) return;

        const mensagens = Array.from(form.querySelectorAll('.mensagem'));
        mensagens.forEach((m) => { m.hidden = true; });

        const anterior = form.style.minHeight;
        form.style.minHeight = '0px';
        const h = form.offsetHeight;
        form.style.minHeight = anterior;

        mensagens.forEach((m) => { m.hidden = false; });

        if (h > 0) form.style.minHeight = h + 'px';
    }

    function agendarAltura() {
        clearTimeout(timerAltura);
        timerAltura = setTimeout(aplicarAlturaLogin, 150);
    }

    function orientacaoAtual() {
        if (window.screen && screen.orientation && screen.orientation.type) {
            return screen.orientation.type.indexOf('landscape') === 0 ? 'L' : 'P';
        }
        if (typeof window.orientation === 'number') {
            return Math.abs(window.orientation) === 90 ? 'L' : 'P';
        }
        return (window.matchMedia && window.matchMedia('(orientation: landscape)').matches) ? 'L' : 'P';
    }

    function calcularLayout() {
        return (window.matchMedia && window.matchMedia(MQ_ROW).matches &&
                orientacaoAtual() === 'L') ? 'row' : 'stacked';
    }

    function resetarScroll() {
        const container = $('login-container');
        if (container && container.scrollTop > 0) container.scrollTop = 0;
        if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    }

    function resetarKbOffset() {
        if (offsetAtual === 0) return;
        offsetAtual = 0;
        raiz.style.setProperty('--kb-offset', '0px');
    }

    function limparAtivos() {
        form.querySelectorAll('[data-ativo="true"]').forEach((el) => el.removeAttribute('data-ativo'));
    }

    /* Desfaz tudo que o teclado virtual alterou (foco, offset, altura visível) */
    function limparEstadoTeclado() {
        limparAtivos();
        raiz.classList.remove('kb-focus');
        resetarKbOffset();
        raiz.style.removeProperty('--kb-visivel');
        resetarScroll();
    }

    function reiniciarEstadoTeclado() {
        if (campoEmFoco()) document.activeElement.blur();
        limparEstadoTeclado();
    }

    function sincronizarTela() {
        if (campoEmFoco() || tecladoAberto()) return;

        const layout = calcularLayout();
        if (raiz.getAttribute('data-layout') !== layout) {
            raiz.setAttribute('data-layout', layout);
        }
        const alturaNova = window.innerHeight <= ALTURA_BAIXA_PX ? 'baixa' : 'normal';
        if (raiz.getAttribute('data-altura') !== alturaNova) {
            raiz.setAttribute('data-altura', alturaNova);
        }
    }

    function setupTela() {
        let temporizador = null;
        let orientacao = orientacaoAtual();
        let largura = window.innerWidth;

        function reavaliar() {
            sincronizarTela();
            agendarAltura();
            resetarScroll();
        }

        function agendar() {
            clearTimeout(temporizador);
            temporizador = setTimeout(() => {
                sincronizarTela();
                agendarAltura();
            }, 250);
        }

        function aoMudarGeometria() {
            const novaOrientacao = orientacaoAtual();
            const novaLargura = window.innerWidth;
            if (novaOrientacao === orientacao && novaLargura === largura) return;
            orientacao = novaOrientacao;
            largura = novaLargura;

            raiz.classList.add('rotating');
            reiniciarEstadoTeclado();
            form.style.minHeight = '';

            reavaliar();
            [60, 250, 600, 1100, 1800].forEach((ms) => setTimeout(reavaliar, ms));
            setTimeout(() => raiz.classList.remove('rotating'), ROTATING_MS + 300);
        }

        function aoRedimensionar() {
            aoMudarGeometria();
            agendar();
        }

        window.addEventListener('resize', aoRedimensionar);
        window.addEventListener('orientationchange', aoRedimensionar);
        if (window.screen && screen.orientation && screen.orientation.addEventListener) {
            screen.orientation.addEventListener('change', aoRedimensionar);
        }

        document.addEventListener('focusout', () => {
            setTimeout(() => {
                if (!campoEmFoco() && !tecladoAberto()) sincronizarTela();
            }, 400);
        });

        /* Rede de segurança: alguns navegadores móveis perdem eventos de resize/foco */
        setInterval(() => {
            if (document.hidden || campoEmFoco() || tecladoAberto()) return;
            if (raiz.classList.contains('kb-focus') || offsetAtual !== 0 ||
                raiz.style.getPropertyValue('--kb-visivel')) {
                limparEstadoTeclado();
            }
            aoMudarGeometria();
            sincronizarTela();
        }, WATCHDOG_MS);
    }

    /* ============================================================
       3. OFFSET DO TECLADO
       ============================================================ */
    /* Elemento que precisa ficar visível acima do teclado */
    function escolherReferencia() {
        const ativo = form.querySelector('[data-ativo="true"]');
        if (ativo) return ativo;

        if (form.classList.contains('modo-forgot')) {
            const container = form.querySelector('#container-forgot');
            if (!container) return null;

            if (window.innerWidth <= LARGURA_MOBILE_PX) {
                const primario = container.querySelector('.forgot-form > .button1');
                if (primario) return primario;
            }

            const candidatos = container.querySelectorAll('button, .otp-caixas, .field');
            return candidatos[candidatos.length - 1] || null;
        }

        if (ehLayoutRow()) {
            const btnRow = form.querySelector('.form-coluna-login > .btn');
            if (btnRow) return btnRow;
        }

        const campos = form.querySelectorAll('.form-coluna-login > .field');
        return campos[campos.length - 1] || null;
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

    /* Teclado abrindo (altura diminui): espera estabilizar. Fechando: ajusta na hora. */
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
                setTimeout(() => {
                    if (!campoEmFoco() && !tecladoAberto()) resetarScroll();
                }, 300);
            }, 80);
        });

        window.addEventListener('orientationchange', () => {
            [50, 300, 600].forEach((ms) => setTimeout(agendarImediato, ms));
        });

        executarAjuste();
    }

    /* ============================================================
       4. MODO FOCO (celular deitado)
       ============================================================ */
    function setupModoFoco() {
        function marcarAtivo(input) {
            raiz.classList.add('kb-focus');

            if (!ehLayoutRow()) return;
            if (input === ativoAtual) return;
            ativoAtual = input;

            const container = input.closest('.field, .otp-caixas');
            if (!container || !form.contains(container)) return;

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

        form.addEventListener('focusin', (e) => {
            if (e.target && e.target.tagName === 'INPUT') marcarAtivo(e.target);
        });

        form.addEventListener('focusout', () => {
            setTimeout(() => {
                const ativo = document.activeElement;
                if (ativo && ativo.tagName === 'INPUT' && form.contains(ativo)) {
                    marcarAtivo(ativo);
                } else {
                    limparModo();
                }
            }, 80);
        });

        window.addEventListener('pageshow', limparModo);
    }

    /* ============================================================
       5. MENSAGENS E BOTÕES
       ============================================================ */
    function removerMensagem(msg) {
        if (!msg) return;
        msg.removeAttribute('id');
        msg.classList.remove('visivel');
        setTimeout(() => {
            if (msg.parentNode) msg.parentNode.removeChild(msg);
        }, 300);
    }

    function primeiroVisivel(lista) {
        for (let i = 0; i < lista.length; i++) {
            if (estaVisivel(lista[i])) return lista[i];
        }
        return lista[0] || null;
    }

    /* Decide em qual contêiner e acima de qual campo a mensagem deve aparecer */
    function escolherPaiMensagem() {
        const modoAtivo = form.querySelector('.forgot-form');
        if (modoAtivo) {
            return {
                parent: modoAtivo,
                ref: primeiroVisivel(modoAtivo.querySelectorAll('.field, .otp-caixas'))
            };
        }

        const colLog = form.querySelector('.form-coluna-login');

        const ativo = form.querySelector('[data-ativo="true"]');
        if (ativo && colLog) return { parent: colLog, ref: ativo };

        if (ehLayoutRow()) {
            const colSoc = form.querySelector('.form-coluna-sociais');
            const divisor = colSoc && colSoc.querySelector('.divisor-login');
            if (estaVisivel(colSoc) && estaVisivel(divisor)) {
                return { parent: colSoc, ref: divisor };
            }
        }

        if (colLog) return { parent: colLog, ref: colLog.querySelector('.field') };
        return { parent: form, ref: null };
    }

    /* Colunas com display:contents (tablet) não geram caixa: usa o form como referência */
    function paiPosicionavel(el) {
        return (el && getComputedStyle(el).display === 'contents') ? form : el;
    }

    function posicionarMensagem(msg) {
        const escolha = escolherPaiMensagem();
        const parent = paiPosicionavel(escolha.parent);
        parent.appendChild(msg);

        if (!escolha.ref) { msg.style.bottom = '100%'; return; }

        const parentRect = parent.getBoundingClientRect();
        const refRect = escolha.ref.getBoundingClientRect();
        msg.style.bottom = (parentRect.bottom - refRect.top + 8) + 'px';
    }

    function mostrarMensagem(texto, tipo) {
        tipo = tipo || 'sucesso';

        clearTimeout(temporizadorMensagem);
        removerMensagem($('mensagem-login'));

        const msg = document.createElement('div');
        msg.id = 'mensagem-login';
        msg.className = 'mensagem mensagem--' + tipo;
        msg.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');

        const p = document.createElement('p');
        p.textContent = texto;
        msg.appendChild(p);

        posicionarMensagem(msg);
        void msg.offsetHeight; // força o reflow para a transição de entrada rodar
        msg.classList.add('visivel');

        temporizadorMensagem = setTimeout(() => {
            removerMensagem(msg);
        }, Math.max(MENSAGEM_MIN_MS, String(texto).length * MENSAGEM_MS_CHAR));
    }

    function mostrarLoading(botao) {
        botao.disabled = true;
        botao.textContent = '';
        const spinner = document.createElement('span');
        spinner.className = 'button-loading';
        botao.appendChild(spinner);
    }

    function restaurarBotao(botao, textoOriginal) {
        if (!botao) return;
        botao.disabled = false;
        botao.textContent = textoOriginal;
    }

    /* Roda `acao` com o botão em loading. Se ela devolver true, o botão fica em loading
       (ex.: redirecionando); caso contrário volta ao texto original. */
    async function executarComBotao(botao, textoOriginal, acao) {
        if (!botao || botao.disabled) return;
        mostrarLoading(botao);
        let manter = false;
        try {
            manter = await acao();
        } catch (erro) {
            console.error(erro);
            mostrarMensagem('Ocorreu um erro. Tente novamente.', 'erro');
        } finally {
            if (!manter) restaurarBotao(botao, textoOriginal);
        }
    }

    /* ============================================================
       6. MODOS DO CARD (forgot / cadastro / nova senha)
       ============================================================ */
    function carregarLottie(idContainer) {
        const container = $(idContainer);
        if (!container || typeof lottie === 'undefined') return;

        animacoesLottie.push(lottie.loadAnimation({
            container: container,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: LOTTIE_PATH
        }));
    }

    function removerContainersDeModo() {
        animacoesLottie.forEach((animacao) => animacao.destroy());
        animacoesLottie = [];

        ativoAtual = null;

        const anterior = $('container-forgot');
        if (anterior) anterior.remove();
    }

    function abrirModo(html) {
        removerContainersDeModo();
        limparAtivos();
        form.classList.add('modo-forgot');
        form.insertAdjacentHTML('beforeend', html); // `html` é sempre texto estático deste arquivo
        agendarImediato();
    }

    function voltarParaLogin() {
        removerContainersDeModo();
        form.classList.remove('modo-forgot');
        ativoAtual = null;
        definirContexto(false, null, null);

        inputEmail.value = '';
        inputSenha.value = '';

        restaurarBotao(botaoLogin, rotuloLogin);
        agendarImediato();
        setTimeout(agendarAltura, 100);
    }

    /* ============================================================
       7. LOGIN
       ============================================================ */
    function validarCredenciais(email, senha) {
        if (!email || !senha) return 'Digite e-mail e senha!';
        if (!emailValido(email)) return 'E-mail inválido!';
        return '';
    }

    function fazerLogin() {
        const email = normalizarEmail(inputEmail.value);
        const senha = inputSenha.value;

        const erro = validarCredenciais(email, senha);
        if (erro) { mostrarMensagem(erro, 'erro'); return; }

        executarComBotao(botaoLogin, rotuloLogin, async () => {
            const resultado = await loginUser(email, senha);
            if (resultado.success) {
                irParaESTANTE();
                return true;
            }
            mostrarMensagem(resultado.message || 'E-mail ou senha incorretos!', 'erro');
            return false;
        });
    }

    /* ============================================================
       8. ESQUECI A SENHA
       ============================================================ */
    function mostrarForgotPassword() {
        abrirModo(
            '<div id="container-forgot">' +
                '<div id="forgot-lottie"></div>' +
                '<div class="forgot-form">' +
                    '<div class="field">' + ICONE_EMAIL +
                        '<input type="email" id="email-forgot" class="input-field" ' +
                        'placeholder="E-mail" autocomplete="email" aria-label="E-mail">' +
                    '</div>' +
                    '<button type="button" id="btn-enviar-link" class="button1">ENVIAR LINK</button>' +
                    '<button type="button" id="btn-voltar-forgot" class="button3">Voltar para o login</button>' +
                '</div>' +
            '</div>'
        );
        carregarLottie('forgot-lottie');

        const inputForgot = $('email-forgot');
        const btnEnviar = $('btn-enviar-link');

        function enviarLink() {
            const email = normalizarEmail(inputForgot.value);
            if (!email || !emailValido(email)) {
                mostrarMensagem('Digite um e-mail válido!', 'erro');
                return;
            }

            executarComBotao(btnEnviar, 'ENVIAR LINK', async () => {
                const existente = await checkEmailExists(email);
                if (!existente.exists) {
                    mostrarMensagem('E-mail não cadastrado!', 'erro');
                    return false;
                }

                if (existente.provider === 'google' && !existente.hasPassword) {
                    mostrarMensagem('Use o botão "Entrar com Google".', 'erro');
                    return false;
                }

                const resultado = await recoverPassword(email);
                if (resultado.success) {
                    mostrarMensagem('Link enviado!', 'sucesso');
                } else {
                    mostrarMensagem(resultado.message || 'Erro ao enviar link!', 'erro');
                }
                return false;
            });
        }

        $('btn-voltar-forgot').addEventListener('click', voltarParaLogin);
        btnEnviar.addEventListener('click', enviarLink);
        aoPressionarEnter(inputForgot, enviarLink);
    }

    /* ============================================================
       9. CADASTRO (e-mail -> código -> senha)
       ============================================================ */
    function ligarOlho(botao, input) {
        botao.addEventListener('click', () => {
            const mostrar = input.type === 'password';
            input.type = mostrar ? 'text' : 'password';
            botao.classList.toggle('mostrando', mostrar);
        });
    }

    function ligarConfirmacao(senha, confirmar) {
        confirmar.addEventListener('input', () => {
            const diverge = confirmar.value.length > 0 && confirmar.value !== senha.value;
            confirmar.closest('.field').style.borderColor = diverge ? 'var(--erro)' : '';
        });
    }

    /* Clona o botão de olho do login (#btn-olho) para os campos criados dinamicamente */
    function adicionarOlho(input) {
        const modelo = $('btn-olho');
        if (!modelo) return;
        const olho = modelo.cloneNode(true);
        olho.removeAttribute('id');
        olho.classList.remove('mostrando');
        input.closest('.field').appendChild(olho);
        ligarOlho(olho, input);
    }

    function caixasCodigoHtml() {
        let html = '';
        for (let i = 0; i < DIGITOS_CODIGO; i++) {
            html += '<input type="text" maxlength="1" class="codigo-input" ' +
                    'inputmode="numeric" autocomplete="one-time-code" ' +
                    'aria-label="Dígito ' + (i + 1) + '">';
        }
        return html;
    }

    function lerCodigo(caixas) {
        return caixas.map((c) => c.value).join('');
    }

    /* Navegação entre as caixas: digitar avança, backspace volta, colar/autofill distribui */
    function ligarCaixasCodigo(caixas) {
        const ultima = caixas.length - 1;

        function preencher(inicio, texto) {
            const digitos = texto.replace(/\D/g, '').slice(0, caixas.length - inicio);
            digitos.split('').forEach((d, i) => { caixas[inicio + i].value = d; });
            caixas[Math.min(inicio + digitos.length, ultima)].focus();
        }

        caixas.forEach((caixa, indice) => {
            caixa.addEventListener('focus', () => caixa.select());

            caixa.addEventListener('input', () => {
                const digitos = caixa.value.replace(/\D/g, '');
                /* Autofill de SMS pode entregar o código inteiro na primeira caixa */
                if (digitos.length > 1) { preencher(indice, digitos); return; }

                caixa.value = digitos;
                if (digitos && indice < ultima) caixas[indice + 1].focus();
            });

            caixa.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !caixa.value && indice > 0) {
                    caixas[indice - 1].focus();
                }
            });

            caixa.addEventListener('paste', (e) => {
                const dados = e.clipboardData || window.clipboardData;
                const texto = dados ? dados.getData('text').replace(/\D/g, '') : '';
                if (!texto) return;
                e.preventDefault();
                caixas.forEach((c) => { c.value = ''; });
                preencher(0, texto);
            });
        });
    }

    function mostrarCadastro() {
        const emailInicial = normalizarEmail(inputEmail.value);
        const estado = { email: '', codigo: '' };

        abrirModo(
            '<div id="container-forgot" class="modo-dois-campos">' +
                '<div id="forgot-lottie"></div>' +
                '<div class="forgot-form" id="cadastro-form"></div>' +
            '</div>'
        );
        carregarLottie('forgot-lottie');

        const painel = $('cadastro-form');

        function trocarEtapa(html) {
            limparAtivos();
            ativoAtual = null;
            raiz.classList.remove('kb-focus');
            painel.innerHTML = html; // `html` é sempre texto estático deste arquivo
            painel.classList.remove('aparece');
            void painel.offsetWidth; // reinicia a animação de entrada
            painel.classList.add('aparece');
            agendarImediato();
        }

        const BOTAO_VOLTAR =
            '<button type="button" id="btn-voltar-cadastro" class="button3">Voltar para o login</button>';

        function etapaEmail() {
            trocarEtapa(
                '<div class="field">' + ICONE_EMAIL +
                    '<input type="email" id="email-cadastro" class="input-field" ' +
                    'placeholder="E-mail" autocomplete="email" aria-label="E-mail">' +
                '</div>' +
                '<button type="button" id="btn-cadastro-acao" class="button1">ENVIAR CÓDIGO</button>' +
                BOTAO_VOLTAR
            );
            $('btn-voltar-cadastro').addEventListener('click', voltarParaLogin);

            const emailCad = $('email-cadastro');
            const btn = $('btn-cadastro-acao');
            emailCad.value = estado.email || emailInicial;

            function enviarCodigo() {
                const email = normalizarEmail(emailCad.value);
                if (!email || !emailValido(email)) {
                    mostrarMensagem('Digite um e-mail válido!', 'erro');
                    return;
                }

                executarComBotao(btn, 'ENVIAR CÓDIGO', async () => {
                    definirContexto(false, email, null);

                    const existente = await checkEmailExists(email);

                    if (existente.exists) {
                        if (existente.provider === 'google' && !existente.hasPassword) {
                            mostrarMensagem('Use o botão "Entrar com Google".', 'erro');
                            return false;
                        }
                        mostrarMensagem('Este e-mail já está cadastrado. Faça login!', 'erro');
                        return false;
                    }

                    const envio = await sendSignupCode(email);
                    if (!envio.success) {
                        mostrarMensagem(envio.message || 'Erro ao enviar código!', 'erro');
                        return false;
                    }

                    estado.email = email;
                    etapaCodigo();
                    mostrarMensagem('Código enviado!', 'sucesso');
                    return false;
                });
            }

            btn.addEventListener('click', enviarCodigo);
            aoPressionarEnter(emailCad, enviarCodigo);
        }

        function etapaCodigo() {
            trocarEtapa(
                '<div class="otp-caixas" id="caixas-cadastro">' + caixasCodigoHtml() + '</div>' +
                '<button type="button" id="btn-cadastro-acao" class="button1">CONFIRMAR</button>' +
                '<button type="button" id="btn-voltar-cadastro" class="button3">Alterar e-mail</button>'
            );

            $('btn-voltar-cadastro').addEventListener('click', etapaEmail);

            const caixas = Array.from($('caixas-cadastro').querySelectorAll('.codigo-input'));
            const btn = $('btn-cadastro-acao');

            function avancar() {
                const codigo = lerCodigo(caixas);
                if (codigo.length < caixas.length) {
                    mostrarMensagem('Digite os ' + caixas.length + ' dígitos!', 'erro');
                    return;
                }
                estado.codigo = codigo;
                etapaSenha();
            }

            btn.addEventListener('click', avancar);
            ligarCaixasCodigo(caixas);
            caixas.forEach((caixa) => aoPressionarEnter(caixa, avancar));
            caixas[0].focus();
        }

        function etapaSenha() {
            trocarEtapa(
                '<div class="field field-senha">' + ICONE_CADEADO +
                    '<input type="password" id="senha-cadastro" class="input-field" ' +
                    'placeholder="Senha" autocomplete="new-password" aria-label="Senha">' +
                '</div>' +
                '<div class="field field-senha">' + ICONE_CADEADO +
                    '<input type="password" id="confirmar-cadastro" class="input-field" ' +
                    'placeholder="Confirmar senha" autocomplete="new-password" aria-label="Confirmar senha">' +
                '</div>' +
                '<button type="button" id="btn-cadastro-acao" class="button1">CONFIRMAR</button>' +
                BOTAO_VOLTAR
            );
            $('btn-voltar-cadastro').addEventListener('click', voltarParaLogin);

            const senha = $('senha-cadastro');
            const confirmar = $('confirmar-cadastro');
            const btn = $('btn-cadastro-acao');

            adicionarOlho(senha);
            adicionarOlho(confirmar);
            ligarConfirmacao(senha, confirmar);

            function concluir() {
                const forca = validarSenhaForte(senha.value);
                if (!forca.valida) {
                    mostrarMensagem(forca.mensagem, 'erro');
                    return;
                }
                if (senha.value !== confirmar.value) {
                    mostrarMensagem('As senhas não coincidem!', 'erro');
                    return;
                }

                executarComBotao(btn, 'CONFIRMAR', async () => {
                    definirContexto(false, estado.email, senha.value);

                    const criacao = await verifySignupCode(
                        estado.email, estado.codigo, senha.value, estado.email.split('@')[0]
                    );

                    if (!criacao.success) {
                        const msg = criacao.message || 'Não foi possível criar a conta.';
                        if (/c[óo]digo|code|expir|inv[áa]lid/i.test(msg)) {
                            estado.codigo = '';
                            etapaCodigo();
                        }
                        mostrarMensagem(msg, 'erro');
                        return false;
                    }

                    const entrada = await loginUser(estado.email, senha.value);
                    if (entrada.success) {
                        mostrarMensagem('Conta criada!', 'sucesso');
                        irParaESTANTE();
                        return true;
                    }

                    voltarParaLogin();
                    mostrarMensagem('Conta criada! Faça login.', 'sucesso');
                    return true;
                });
            }

            btn.addEventListener('click', concluir);
            aoPressionarEnter(senha, () => confirmar.focus());
            aoPressionarEnter(confirmar, concluir);
            senha.focus();
        }

        etapaEmail();
    }

    /* ============================================================
       10. NOVA SENHA (link de recuperação)
       ============================================================ */
    function limparUrl() {
        window.history.replaceState(null, '', window.location.pathname);
    }

    function falhaRecovery(texto) {
        limparUrl();
        mostrarMensagem(texto, 'erro');
    }

    async function detectarRecovery() {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.substring(1));
        const tipo = query.get('type') || hash.get('type');
        if (tipo !== 'recovery') return;

        const tokenHash = query.get('token_hash');
        const accessToken = hash.get('access_token');
        const code = query.get('code');
        if (!tokenHash && !accessToken && !code) return;

        try {
            const db = await aguardarSupabase();
            if (!db) {
                falhaRecovery('Não foi possível validar o link.');
                return;
            }

            let resultado;
            if (tokenHash) {
                resultado = await db.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
            } else if (accessToken) {
                resultado = await db.auth.setSession({
                    access_token: accessToken,
                    refresh_token: hash.get('refresh_token') || ''
                });
            } else {
                resultado = await db.auth.exchangeCodeForSession(code);
            }

            const sessao = resultado && resultado.data && resultado.data.session;
            if (!resultado || resultado.error || !sessao) {
                falhaRecovery('Link inválido ou expirado.');
                return;
            }

            definirContexto(true, sessao.user.email, null);
            limparUrl();
            mostrarNovaSenha();
        } catch (erro) {
            console.error(erro);
            falhaRecovery('Link inválido ou expirado.');
        }
    }

    function mostrarNovaSenha() {
        abrirModo(
            '<div id="container-forgot" class="modo-dois-campos">' +
                '<div id="forgot-lottie"></div>' +
                '<div class="forgot-form">' +
                    '<div class="field field-senha">' + ICONE_CADEADO +
                        '<input type="password" id="nova-senha" class="input-field" ' +
                        'placeholder="Nova senha" autocomplete="new-password" ' +
                        'aria-label="Nova senha">' +
                    '</div>' +
                    '<div class="field field-senha">' + ICONE_CADEADO +
                        '<input type="password" id="confirmar-senha" class="input-field" ' +
                        'placeholder="Confirmar nova senha" autocomplete="new-password" ' +
                        'aria-label="Confirmar nova senha">' +
                    '</div>' +
                    '<button type="button" id="btn-salvar-senha" class="button1">CONFIRMAR</button>' +
                    '<button type="button" id="btn-voltar-nova" class="button3">Voltar para o login</button>' +
                '</div>' +
            '</div>'
        );
        carregarLottie('forgot-lottie');

        const novaSenha = $('nova-senha');
        const confirmar = $('confirmar-senha');
        const btnSalvar = $('btn-salvar-senha');

        adicionarOlho(novaSenha);
        adicionarOlho(confirmar);
        ligarConfirmacao(novaSenha, confirmar);

        function salvarSenha() {
            const validacao = validarSenhaForte(novaSenha.value);
            if (!validacao.valida) {
                mostrarMensagem(validacao.mensagem, 'erro');
                return;
            }
            if (novaSenha.value !== confirmar.value) {
                mostrarMensagem('As senhas não coincidem!', 'erro');
                return;
            }

            executarComBotao(btnSalvar, 'CONFIRMAR', async () => {
                const db = getDb();
                if (!db) {
                    mostrarMensagem('Erro de configuração.', 'erro');
                    return false;
                }

                const resultado = await db.auth.updateUser({ password: novaSenha.value });
                /* Reenviar a mesma senha não é falha para o usuário */
                const igualASenhaAntiga = !!resultado.error &&
                    String(resultado.error.message).indexOf('different from the old password') !== -1;

                if (resultado.error && !igualASenhaAntiga) {
                    mostrarMensagem('Erro: ' + resultado.error.message, 'erro');
                    return false;
                }

                voltarParaLogin();
                mostrarMensagem('Senha alterada!', 'sucesso');
                return true;
            });
        }

        $('btn-voltar-nova').addEventListener('click', voltarParaLogin);
        btnSalvar.addEventListener('click', salvarSenha);
        aoPressionarEnter(novaSenha, () => confirmar.focus());
        aoPressionarEnter(confirmar, salvarSenha);
    }

    /* ============================================================
       11. OLHO DA SENHA, LOGIN SOCIAL E MENU "SAIBA MAIS"
       ============================================================ */
    function setupOlhoSenha() {
        const botao = $('btn-olho');
        if (botao) ligarOlho(botao, inputSenha);
    }

    function urlEstante() {
        const host = window.location.hostname;
        return (host === 'localhost' || host === '127.0.0.1')
            ? window.location.origin + '/estante.html'
            : URL_ESTANTE_PRODUCAO;
    }

    function definirCarregandoSocial(botao, carregando) {
        botao.classList.toggle('carregando', carregando);
        botao.setAttribute('aria-busy', String(carregando));
    }

    async function entrarComProvedor(provedor, botao) {
        const db = getDb();
        if (!db) {
            mostrarMensagem('Erro de configuração.', 'erro');
            return;
        }
        if (botao.classList.contains('carregando')) return;

        definirCarregandoSocial(botao, true);

        try {
            const resultado = await db.auth.signInWithOAuth({
                provider: provedor,
                options: {
                    redirectTo: urlEstante(),
                    queryParams: PROVEDORES_SOCIAIS[provedor].params
                }
            });
            if (resultado && resultado.error) {
                definirCarregandoSocial(botao, false);
                mostrarMensagem('Não foi possível entrar com ' + PROVEDORES_SOCIAIS[provedor].rotulo + '.', 'erro');
            }
            /* Sem erro: o navegador está a caminho do provedor; o botão fica travado */
        } catch (erro) {
            console.error(erro);
            definirCarregandoSocial(botao, false);
            mostrarMensagem('Ocorreu um erro. Tente novamente.', 'erro');
        }
    }

    function setupLoginSocial() {
        const botoes = [];

        Object.keys(PROVEDORES_SOCIAIS).forEach((provedor) => {
            const botao = $('btn-' + provedor);
            if (!botao) return;
            botoes.push(botao);
            botao.addEventListener('click', () => entrarComProvedor(provedor, botao));
        });

        /* Voltar pelo histórico (bfcache) restaura a página com os botões ainda travados */
        window.addEventListener('pageshow', (e) => {
            if (e.persisted) botoes.forEach((botao) => definirCarregandoSocial(botao, false));
        });
    }

    function setupMenuSaiba() {
        const botao = $('navbar-saiba-btn');
        const menu = $('navbar-saiba-menu');
        if (!botao || !menu) return;

        /* No celular deitado o menu se alinha à coluna correta */
        function posicionar() {
            menu.style.left = menu.style.right = menu.style.width = '';
            menu.style.removeProperty('--seta-x');
            if (!ehLayoutRow()) return;

            const folga = 5;
            const wrap = menu.parentNode.getBoundingClientRect();
            const emModoForgot = form.classList.contains('modo-forgot');

            let esq, dir;

            if (emModoForgot) {
                // Modo forgot/cadastro/nova senha: centraliza na coluna esquerda
                // (até a linha divisória do #container-forgot)
                const containerForgot = form.querySelector('#container-forgot');
                if (!containerForgot) return;

                const formRect = form.getBoundingClientRect();
                const containerRect = containerForgot.getBoundingClientRect();

                // A linha divisória fica em 0.8/1.8 da largura do container (grid 0.8fr 1fr)
                const larguraContainer = containerRect.width;
                const posicaoLinha = containerRect.left + (larguraContainer * 0.8 / 1.8);

                esq = formRect.left + folga;
                dir = posicaoLinha - folga;
            } else {
                // Modo login normal: centraliza na coluna direita (botões sociais)
                const coluna = document.querySelector('.form-coluna-sociais');
                if (!coluna) return;

                const sec = coluna.getBoundingClientRect();
                esq = sec.left + folga;
                dir = Math.min(sec.right, window.innerWidth) - folga;
            }

            const larg = Math.min(330, dir - esq);
            if (larg <= 0) return;

            const x = esq + (dir - esq - larg) / 2;

            menu.style.right = 'auto';
            menu.style.left = (x - wrap.left) + 'px';
            menu.style.width = larg + 'px';

            const b = botao.getBoundingClientRect();
            const seta = b.left + b.width / 2 - x;
            menu.style.setProperty('--seta-x', Math.max(16, Math.min(larg - 28, seta - 6)) + 'px');
        }

        function definir(aberto) {
            if (aberto) posicionar();
            menu.hidden = !aberto;
            botao.setAttribute('aria-expanded', aberto ? 'true' : 'false');
        }

        botao.addEventListener('click', (e) => {
            e.stopPropagation();
            definir(menu.hidden);
        });

        document.addEventListener('click', (e) => {
            if (!menu.hidden && !menu.contains(e.target)) definir(false);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !menu.hidden) { definir(false); botao.focus(); }
        });

        window.addEventListener('resize', () => definir(false));
        window.addEventListener('orientationchange', () => definir(false));
    }

    /* ============================================================
       12. INICIALIZAÇÃO
       ============================================================ */
    function aoCarregar() {
        sincronizarTela();
        agendarImediato();
        agendarAltura();
    }

    function iniciar() {
        form = $('login-form');
        if (!form) return; // outra página que reaproveita este script

        inputEmail = $('email');
        inputSenha = $('senha');
        botaoLogin = $('btn-login');
        botaoSignUp = $('btn-signup');
        botaoForgot = $('btn-forgot');

        if (!inputEmail || !inputSenha || !botaoLogin || !botaoSignUp || !botaoForgot) {
            console.error('login.js: elementos obrigatórios do formulário não encontrados.');
            return;
        }

        rotuloLogin = botaoLogin.textContent.trim() || 'Login';

        /* Impede o zoom por pinça do iOS (o layout é todo calculado para escala 1) */
        document.addEventListener('gesturestart', (e) => e.preventDefault());

        sincronizarTela();
        setupAlturaFixa();
        setupTela();
        setupTeclado();
        setupModoFoco();
        setupMenuSaiba();
        setupOlhoSenha();
        setupLoginSocial();

        form.addEventListener('submit', (e) => e.preventDefault());

        botaoLogin.addEventListener('click', fazerLogin);
        botaoSignUp.addEventListener('click', mostrarCadastro);
        botaoForgot.addEventListener('click', mostrarForgotPassword);

        aoPressionarEnter(inputEmail, () => inputSenha.focus());
        aoPressionarEnter(inputSenha, fazerLogin);

        detectarRecovery();

        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(agendarAltura);
        }

        if (document.readyState === 'complete') aoCarregar();
        else window.addEventListener('load', aoCarregar);

        window.addEventListener('pageshow', () => {
            sincronizarTela();
            agendarAltura();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();

