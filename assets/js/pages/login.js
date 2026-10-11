/* ============================================================
   LOGIN.JS

   Seções:
   1. Constantes e utilitários     7. Login
   2. Viewport, altura e layout    8. Esqueci a senha
   3. Offset do teclado            9. Cadastro (e-mail → código → senha)
   4. Modo foco (row)             10. Nova senha
   5. Mensagens                   11. Olho da senha e login social
   6. Modos do card               12. Inicialização

   Dependências globais (auth.js): validateEmail, loginUser,
   checkEmailExists, validarSenhaForte, sendSignupCode,
   verifySignupCode, recoverPassword.
   ============================================================ */
(function () {
    'use strict';

    /* ============================================================
       1. CONSTANTES E UTILITÁRIOS
       ============================================================ */
    var PAGINA_DASHBOARD   = 'dashboard.html';
    var LOTTIE_PATH        = 'assets/img/animacoes/mail-animation.json';
    var MENSAGEM_MIN_MS    = 1800;
    var MENSAGEM_MS_CHAR   = 55;
    var ALTURA_BAIXA_PX    = 640;
    var LARGURA_MOBILE_PX  = 599;
    var LIMITE_TECLADO_PX  = 100;
    var MARGEM_TECLADO_PX  = 16;
    var ROTATING_MS        = 500;
    var ESTABILIDADE_MS    = 120;
    var PROVEDORES_SOCIAIS = ['google', 'discord', 'github'];

    /* Mesma condição do CSS para [data-layout="row"] (bloco 10.6):
       celular deitado — paisagem, baixo e estreito. */
    var MQ_ROW = '(min-width: 568px) and (max-width: 950px) and (orientation: landscape) and (max-height: 500px)';

    var ICONE_EMAIL =
        '<svg class="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">' +
        '<path d="M13.106 7.222c0-2.967-2.249-5.032-5.482-5.032-3.35 0-5.646 2.318-5.646 5.702 0 3.493 2.235 5.708 5.762 5.708.862 0 1.689-.123 2.304-.335v-.862c-.43.199-1.354.328-2.29.328-2.926 0-4.813-1.88-4.813-4.798 0-2.844 1.921-4.881 4.594-4.881 2.735 0 4.608 1.688 4.608 4.156 0 1.682-.554 2.769-1.416 2.769-.492 0-.772-.28-.772-.76V5.206H8.923v.834h-.11c-.266-.595-.881-.964-1.6-.964-1.4 0-2.378 1.162-2.378 2.823 0 1.737.957 2.906 2.379 2.906.8 0 1.415-.39 1.709-1.087h.11c.081.67.703 1.148 1.503 1.148 1.572 0 2.57-1.415 2.57-3.643zm-7.177.704c0-1.197.54-1.907 1.456-1.907.93 0 1.524.738 1.524 1.907S8.308 9.84 7.371 9.84c-.895 0-1.442-.725-1.442-1.914z"/></svg>';

    var ICONE_CADEADO =
        '<svg class="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">' +
        '<path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>';

    function $(id) { return document.getElementById(id); }

    var raiz        = document.documentElement;
    var form        = $('login-form');
    var inputEmail  = $('email');
    var inputSenha  = $('senha');
    var botaoLogin  = $('btn-login');
    var botaoSignUp = $('btn-signup');
    var botaoForgot = $('btn-forgot');

    var animacoesLottie = [];

    /* Impede o zoom por pinça no iOS (o viewport sozinho não basta) */
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

    function getDb() {
        return window.supabaseClient ||
               (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    function aguardarSupabase() {
        return new Promise(function (resolve) {
            (function tentar(restantes) {
                var db = getDb();
                if (db || restantes <= 0) { resolve(db); return; }
                setTimeout(function () { tentar(restantes - 1); }, 200);
            })(30);
        });
    }

    function sanitizar(valor) {
        return valor ? String(valor).replace(/[<>]/g, '') : '';
    }

    /* Estado compartilhado com auth.js (lido via window.*) */
    function definirContexto(modoForgot, email, senha) {
        window.modoForgotPassword = modoForgot;
        window.emailVerificacao   = email || null;
        window.senhaVerificacao   = senha || null;
    }

    function estaVisivel(el) {
        if (!el || el.offsetParent === null) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function aoPressionarEnter(input, acao) {
        if (!input) return;
        input.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            acao();
        });
    }

    /* ============================================================
       2. VIEWPORT, ALTURA FIXA E LAYOUT
       ============================================================ */

    /* O layout row é decidido UMA vez por sincronizarTela() e lido do
       atributo. Assim JS e CSS nunca divergem — nem com o teclado
       aberto, quando innerHeight encolhe e "parece" paisagem. */
    function ehLayoutRow() {
        return raiz.getAttribute('data-layout') === 'row';
    }

    function getAppH() {
        var valor = raiz.style.getPropertyValue('--app-h');
        var n = /px\s*$/.test(valor) ? parseFloat(valor) : NaN;
        return (isNaN(n) || n <= 0) ? window.innerHeight : n;
    }

    function getAlturaVisivel() {
        var vv = window.visualViewport;
        var h = window.innerHeight;
        return (vv && vv.height > 0 && vv.height < h) ? vv.height : h;
    }

    function getTopoTeclado() {
        var vv = window.visualViewport;
        var topoVV = vv ? (vv.offsetTop + vv.height) : window.innerHeight;
        return Math.min(topoVV, window.innerHeight);
    }

    function campoEmFoco() {
        var ativo = document.activeElement;
        return !!ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA');
    }

    /* Sem campo em foco não há teclado — evita falso positivo quando
       a janela é redimensionada (ex.: DevTools, rotação). */
    function tecladoAberto() {
        return campoEmFoco() && (getAppH() - getAlturaVisivel()) > LIMITE_TECLADO_PX;
    }

    /* --app-h = altura "sem teclado": cresce na hora, mas só diminui depois
       que a janela assenta (resize/rotação reais), nunca por causa do teclado. */
    function setupAlturaFixa() {
        var maiorAltura = 0;
        var larguraMedida = 0;
        var timerAssentar = null;

        function aplicar(h) {
            maiorAltura = h;
            raiz.style.setProperty('--app-h', h + 'px');
        }

        function medir() {
            if (window.innerWidth !== larguraMedida) {
                larguraMedida = window.innerWidth;
                maiorAltura = 0;
            }

            var h = window.innerHeight;
            if (h > maiorAltura) aplicar(h);

            /* Reduzir só depois que a janela "assentar" e sem campo em foco.
               Reduzir na hora faz o card subir enquanto o teclado ainda está
               fechando e depois cair de volta. */
            clearTimeout(timerAssentar);
            timerAssentar = setTimeout(function () {
                if (!campoEmFoco() && window.innerHeight !== maiorAltura) {
                    aplicar(window.innerHeight);
                }
            }, 700);
        }

        [0, 100, 300, 600, 1000, 1500].forEach(function (ms) {
            setTimeout(medir, ms);
        });

        window.addEventListener('resize', medir);

        window.addEventListener('orientationchange', function () {
            maiorAltura = 0;
            [50, 300, 600, 1000].forEach(function (ms) { setTimeout(medir, ms); });
        });

        medir();
    }

    /* Trava a altura do card do login para que ele não "pule" ao
       alternar com os modos forgot/cadastro. */
    function aplicarAlturaLogin() {
        if (!form) return;
        if (campoEmFoco() || tecladoAberto()) return;
        if (form.classList.contains('modo-forgot')) return;

        var mensagens = Array.prototype.slice.call(form.querySelectorAll('.mensagem'));
        mensagens.forEach(function (m) { m.hidden = true; });

        var anterior = form.style.minHeight;
        form.style.minHeight = '0px';
        var h = form.offsetHeight;
        form.style.minHeight = anterior;

        mensagens.forEach(function (m) { m.hidden = false; });

        if (h > 0) form.style.minHeight = h + 'px';
    }

    var timerAltura = null;
    function agendarAltura() {
        clearTimeout(timerAltura);
        timerAltura = setTimeout(aplicarAlturaLogin, 150);
    }

    /* Orientação física do aparelho. Não depende da altura da janela, que
       encolhe com o teclado e faria um tablet em pé "parecer" deitado. */
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

    /* Zera tudo que depende do teclado (usado ao girar o aparelho e pelo
       vigia): sem campo em foco, sem modo foco, sem deslocamentos. */
    function reiniciarEstadoTeclado() {
        if (campoEmFoco()) document.activeElement.blur();
        limparAtivos();
        raiz.classList.remove('kb-focus');
        resetarKbOffset();
        raiz.style.removeProperty('--kb-visivel');
        resetarScroll();
    }

    function sincronizarTela() {
        if (campoEmFoco() || tecladoAberto()) return;

        var layout = calcularLayout();
        if (raiz.getAttribute('data-layout') !== layout) {
            raiz.setAttribute('data-layout', layout);
        }
        var alturaAtual = raiz.getAttribute('data-altura');
        var alturaNova  = window.innerHeight <= ALTURA_BAIXA_PX ? 'baixa' : 'normal';
        if (alturaAtual !== alturaNova) {
            raiz.setAttribute('data-altura', alturaNova);
        }
    }

    /* Qualquer mudança real de geometria (girar o aparelho, trocar o
       dispositivo no DevTools, redimensionar a janela) invalida o que foi
       medido antes. O teclado virtual NÃO muda a largura nem a orientação,
       então ele nunca é confundido com isso. */
    function setupTela() {
        var temporizador = null;
        var orientacao = orientacaoAtual();
        var largura = window.innerWidth;

        function reavaliar() {
            sincronizarTela();
            agendarAltura();
            resetarScroll();
        }

        function agendar() {
            clearTimeout(temporizador);
            temporizador = setTimeout(function () {
                sincronizarTela();
                agendarAltura();
            }, 250);
        }

        function aoMudarGeometria() {
            var novaOrientacao = orientacaoAtual();
            var novaLargura = window.innerWidth;
            if (novaOrientacao === orientacao && novaLargura === largura) return;
            orientacao = novaOrientacao;
            largura = novaLargura;

            raiz.classList.add('rotating');
            reiniciarEstadoTeclado();
            form.style.minHeight = '';          /* altura medida no layout antigo */

            reavaliar();
            [60, 250, 600, 1100, 1800].forEach(function (ms) { setTimeout(reavaliar, ms); });
            setTimeout(function () { raiz.classList.remove('rotating'); }, ROTATING_MS + 300);
        }

        function aoRedimensionar() { aoMudarGeometria(); agendar(); }

        window.addEventListener('resize', aoRedimensionar);
        window.addEventListener('orientationchange', aoRedimensionar);
        if (window.screen && screen.orientation && screen.orientation.addEventListener) {
            screen.orientation.addEventListener('change', aoRedimensionar);
        }

        document.addEventListener('focusout', function () {
            setTimeout(function () {
                if (!campoEmFoco() && !tecladoAberto()) sincronizarTela();
            }, 400);
        });

        /* Vigia: se o teclado já fechou mas sobrou modo foco, deslocamento
           ou layout defasado, corrige sozinho. */
        setInterval(function () {
            if (document.hidden || campoEmFoco() || tecladoAberto()) return;
            if (raiz.classList.contains('kb-focus') || offsetAtual !== 0 ||
                raiz.style.getPropertyValue('--kb-visivel')) {
                limparAtivos();
                raiz.classList.remove('kb-focus');
                resetarKbOffset();
                raiz.style.removeProperty('--kb-visivel');
                resetarScroll();
            }
            aoMudarGeometria();
            sincronizarTela();
        }, 1500);
    }

    /* ============================================================
       3. OFFSET DO TECLADO
       ============================================================ */
    var offsetAtual = 0;

    function escolherReferencia() {
        var ativo = form.querySelector('[data-ativo="true"]');
        if (ativo) return ativo;

        if (form.classList.contains('modo-forgot')) {
            var container = form.querySelector('#container-forgot');
            if (!container) return null;

            if (window.innerWidth <= LARGURA_MOBILE_PX) {
                var primario = container.querySelector('.forgot-form > .button1');
                if (primario) return primario;
            }

            var cands = container.querySelectorAll('button, .otp-caixas, .field');
            return cands[cands.length - 1] || null;
        }

        if (ehLayoutRow()) {
            var btnRow = form.querySelector('.form-coluna-login > .btn');
            if (btnRow) return btnRow;
        }

        var fields = form.querySelectorAll('.form-coluna-login > .field');
        return fields[fields.length - 1] || null;
    }

    function resetarScroll() {
        var container = $('login-container');
        if (container && container.scrollTop > 0) container.scrollTop = 0;
        if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    }

    function resetarKbOffset() {
        if (offsetAtual === 0) return;
        offsetAtual = 0;
        raiz.style.setProperty('--kb-offset', '0px');
    }

    var razaoTeclado = 0.5;

    function atualizarAlturaVisivel() {
        if (tecladoAberto()) {
            var topo = Math.max(0, getTopoTeclado());
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

        var ref = escolherReferencia();
        if (!ref) return;

        var bottomNatural = ref.getBoundingClientRect().bottom - offsetAtual;
        var limite = getTopoTeclado() - MARGEM_TECLADO_PX;
        var novoOffset = bottomNatural > limite ? limite - bottomNatural : 0;

        if (Math.abs(novoOffset - offsetAtual) > 2) {
            offsetAtual = novoOffset;
            raiz.style.setProperty('--kb-offset', novoOffset + 'px');
        }
    }

    var ajusteRaf = false;
    function executarAjuste() {
        if (ajusteRaf) return;
        ajusteRaf = true;
        requestAnimationFrame(function () {
            ajusteRaf = false;
            calcularKbOffset();
        });
    }

    var vvHeightAnterior = 0;
    var timerEstabilidade = null;

    function agendarAposEstabilidade() {
        var vv = window.visualViewport;
        var h = vv ? vv.height : window.innerHeight;
        var diff = h - vvHeightAnterior;
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

        document.addEventListener('focusin', function (e) {
            if (!e.target || e.target.tagName !== 'INPUT') return;
            agendarAposEstabilidade();
        });

        document.addEventListener('focusout', function () {
            setTimeout(function () {
                if (campoEmFoco()) return;
                clearTimeout(timerEstabilidade);
                executarAjuste();
                setTimeout(function () {
                    if (!campoEmFoco() && !tecladoAberto()) resetarScroll();
                }, 300);
            }, 80);
        });

        window.addEventListener('orientationchange', function () {
            [50, 300, 600].forEach(function (ms) { setTimeout(agendarImediato, ms); });
        });

        executarAjuste();
    }

    /* ============================================================
       4. MODO FOCO (row)
       ============================================================ */
    function limparAtivos() {
        Array.prototype.forEach.call(
            form.querySelectorAll('[data-ativo="true"]'),
            function (el) { el.removeAttribute('data-ativo'); }
        );
    }

    var ativoAtual = null;

    function setupModoFoco() {
        function marcarAtivo(input) {
            if (!ehLayoutRow()) return;
            if (input === ativoAtual) return;
            ativoAtual = input;

            var container = input.closest('.field, .otp-caixas');
            if (!container || !form.contains(container)) return;

            limparAtivos();
            container.setAttribute('data-ativo', 'true');
            if (!tecladoAberto()) {
                raiz.style.setProperty('--kb-visivel', Math.round(getAppH() * razaoTeclado) + 'px');
            }
            raiz.classList.add('kb-focus');
            agendarAposEstabilidade();
        }

        function limparModo() {
            ativoAtual = null;
            limparAtivos();
            raiz.classList.remove('kb-focus');
            agendarAposEstabilidade();
        }

        form.addEventListener('focusin', function (e) {
            if (e.target && e.target.tagName === 'INPUT') marcarAtivo(e.target);
        });

        form.addEventListener('focusout', function () {
            setTimeout(function () {
                var ativo = document.activeElement;
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
       5. MENSAGENS
       ============================================================ */
    var temporizadorMensagem = null;

    function removerMensagem(msg) {
        if (!msg) return;
        msg.removeAttribute('id');
        msg.classList.remove('visivel');
        setTimeout(function () {
            if (msg.parentNode) msg.parentNode.removeChild(msg);
        }, 300);
    }

    function primeiroVisivel(lista) {
        for (var i = 0; i < lista.length; i++) {
            if (estaVisivel(lista[i])) return lista[i];
        }
        return lista[0] || null;
    }

    function escolherPaiMensagem() {
        var modoAtivo = form.querySelector('.forgot-form');
        if (modoAtivo) {
            return {
                parent: modoAtivo,
                ref: primeiroVisivel(modoAtivo.querySelectorAll('.field, .otp-caixas'))
            };
        }

        var colLog = form.querySelector('.form-coluna-login');

        var ativo = form.querySelector('[data-ativo="true"]');
        if (ativo && colLog) return { parent: colLog, ref: ativo };

        if (ehLayoutRow()) {
            var colSoc = form.querySelector('.form-coluna-sociais');
            var divisor = colSoc && colSoc.querySelector('.divisor-login');
            if (estaVisivel(colSoc) && estaVisivel(divisor)) {
                return { parent: colSoc, ref: divisor };
            }
        }

        if (colLog) return { parent: colLog, ref: colLog.querySelector('.field') };
        return { parent: form, ref: null };
    }

    function paiPosicionavel(el) {
        return (el && getComputedStyle(el).display === 'contents') ? form : el;
    }

    function posicionarMensagem(msg) {
        var escolha = escolherPaiMensagem();
        var parent  = paiPosicionavel(escolha.parent);
        parent.appendChild(msg);

        if (!escolha.ref) { msg.style.bottom = '100%'; return; }

        var parentRect = parent.getBoundingClientRect();
        var refRect    = escolha.ref.getBoundingClientRect();
        msg.style.bottom = (parentRect.bottom - refRect.top + 8) + 'px';
    }

    function mostrarMensagem(texto, tipo) {
        tipo = tipo || 'sucesso';

        clearTimeout(temporizadorMensagem);
        removerMensagem($('mensagem-login'));

        var msg = document.createElement('div');
        msg.id = 'mensagem-login';
        msg.className = 'mensagem mensagem--' + tipo;
        msg.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');

        var p = document.createElement('p');
        p.textContent = texto;
        msg.appendChild(p);

        posicionarMensagem(msg);
        void msg.offsetHeight;
        msg.classList.add('visivel');

        temporizadorMensagem = setTimeout(function () {
            removerMensagem(msg);
        }, Math.max(MENSAGEM_MIN_MS, String(texto).length * MENSAGEM_MS_CHAR));
    }

    function mostrarLoading(botao) {
        botao.disabled = true;
        botao.textContent = '';
        var spinner = document.createElement('span');
        spinner.className = 'button-loading';
        botao.appendChild(spinner);
    }

    function restaurarBotao(botao, textoOriginal) {
        if (!botao) return;
        botao.disabled = false;
        botao.textContent = textoOriginal;
    }

    async function executarComBotao(botao, textoOriginal, acao) {
        if (botao.disabled) return;
        mostrarLoading(botao);
        var manter = false;
        try {
            manter = await acao();
        } catch (erro) {
            console.error(erro);
            mostrarMensagem('Ocorreu um erro. Tente novamente.', 'erro');
        } finally {
            if (!manter) {
                restaurarBotao(botao,
                    typeof textoOriginal === 'function' ? textoOriginal() : textoOriginal);
            }
        }
    }

    /* ============================================================
       6. MODOS DO CARD
       ============================================================ */
    function carregarLottie(idContainer) {
        var container = $(idContainer);
        if (!container || typeof lottie === 'undefined') return;

        animacoesLottie.push(lottie.loadAnimation({
            container: container,
            renderer:  'svg',
            loop:      true,
            autoplay:  true,
            path:      LOTTIE_PATH
        }));
    }

    function removerContainersDeModo() {
        animacoesLottie.forEach(function (animacao) { animacao.destroy(); });
        animacoesLottie = [];

        ativoAtual = null;

        var anterior = $('container-forgot');
        if (anterior) anterior.remove();
    }

    function abrirModo(html) {
        removerContainersDeModo();
        limparAtivos();
        form.classList.add('modo-forgot');
        form.insertAdjacentHTML('beforeend', html);
        agendarImediato();
    }

    function voltarParaLogin() {
        removerContainersDeModo();
        form.classList.remove('modo-forgot');
        ativoAtual = null;
        definirContexto(false, null, null);

        inputEmail.value = '';
        inputSenha.value = '';

        restaurarBotao(botaoLogin,  'Login');
        agendarImediato();
        setTimeout(agendarAltura, 100);
    }

    /* ============================================================
       7. LOGIN
       ============================================================ */
    function validarCredenciais(email, senha) {
        if (!email || !senha)      return 'Digite e-mail e senha!';
        if (!validateEmail(email)) return 'E-mail inválido!';
        return '';
    }

    function fazerLogin() {
        var email = sanitizar(inputEmail.value);
        var senha = inputSenha.value;

        var erro = validarCredenciais(email, senha);
        if (erro) { mostrarMensagem(erro, 'erro'); return; }

        executarComBotao(botaoLogin, 'Login', async function () {
            var resultado = await loginUser(email, senha);
            if (resultado.success) {
                setTimeout(function () {
                    window.location.href = PAGINA_DASHBOARD;
                }, 500);
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
                    '<button type="button" id="btn-voltar-forgot" class="button3">← Voltar para o login</button>' +
                '</div>' +
            '</div>'
        );
        carregarLottie('forgot-lottie');

        var inputForgot = $('email-forgot');
        var btnEnviar   = $('btn-enviar-link');

        function enviarLink() {
            var email = sanitizar(inputForgot.value);
            if (!email || !validateEmail(email)) {
                mostrarMensagem('Digite um e-mail válido!', 'erro');
                return;
            }

            executarComBotao(btnEnviar, 'ENVIAR LINK', async function () {
                var existente = await checkEmailExists(email);
                if (!existente.exists) {
                    mostrarMensagem('E-mail não cadastrado!', 'erro');
                    return false;
                }

                var resultado = await recoverPassword(email);
                if (resultado.success) {
                    mostrarMensagem('Link enviado! Verifique seu e-mail.', 'sucesso');
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
       9. CADASTRO (e-mail → código → senha)
       ============================================================ */
    function ligarConfirmacao(senha, confirmar) {
        confirmar.addEventListener('input', function () {
            var diverge = confirmar.value.length > 0 && confirmar.value !== senha.value;
            confirmar.closest('.field').style.borderColor = diverge ? 'var(--erro)' : '';
        });
    }

    function adicionarOlho(input) {
        var modelo = $('btn-olho');
        if (!modelo) return;
        var olho = modelo.cloneNode(true);
        olho.removeAttribute('id');
        olho.classList.remove('mostrando');
        input.closest('.field').appendChild(olho);
        ligarOlho(olho, input);
    }

    function caixasCodigoHtml() {
        var html = '';
        for (var i = 0; i < 6; i++) {
            html += '<input type="text" maxlength="1" class="codigo-input" ' +
                    'inputmode="numeric" autocomplete="one-time-code" ' +
                    'aria-label="Dígito ' + (i + 1) + '">';
        }
        return html;
    }

    function ligarCaixasCodigo(caixas, aoCompletar) {
        function codigo() {
            return caixas.map(function (c) { return c.value; }).join('');
        }

        function verificar() {
            if (codigo().length === caixas.length) aoCompletar(codigo());
        }

        caixas.forEach(function (caixa, indice) {
            caixa.addEventListener('input', function () {
                caixa.value = caixa.value.replace(/\D/g, '');
                if (caixa.value && indice < caixas.length - 1) caixas[indice + 1].focus();
                verificar();
            });

            caixa.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !caixa.value && indice > 0) {
                    caixas[indice - 1].focus();
                }
            });

            caixa.addEventListener('paste', function (e) {
                var dados = e.clipboardData || window.clipboardData;
                var texto = dados ? dados.getData('text').replace(/\D/g, '') : '';
                if (!texto) return;
                e.preventDefault();
                caixas.forEach(function (c, i) { c.value = texto.charAt(i) || ''; });
                caixas[Math.min(texto.length, caixas.length) - 1].focus();
                verificar();
            });
        });
    }

    /* Confere o código SEM criar a conta (a função só valida e mantém o
       código pendente; a conta nasce no último passo, com a senha). */
    async function conferirCodigo(email, codigo) {
        var db = getDb();
        if (!db) return { success: false, message: 'Erro de configuração. Recarregue a página.' };

        try {
            var resposta = await db.functions.invoke('verify-signup-otp', {
                body: { email: String(email).trim().toLowerCase(), code: String(codigo), check_only: true }
            });

            if (resposta.error) {
                var msg = 'Código inválido.';
                if (typeof extrairMensagemErro === 'function') {
                    msg = await extrairMensagemErro(resposta.error, msg);
                }
                /* Função antiga ainda publicada (não conhece check_only): segue
                   para a senha; o código é conferido no passo final. */
                if (/dados incompletos/i.test(msg)) return { success: true, adiado: true };
                return { success: false, message: msg };
            }
            if (resposta.data && resposta.data.error) {
                if (/dados incompletos/i.test(resposta.data.error)) return { success: true, adiado: true };
                return { success: false, message: resposta.data.error };
            }
            return { success: true };
        } catch (erro) {
            console.error(erro);
            return { success: false, message: 'Erro inesperado.' };
        }
    }

    function mostrarCadastro() {
        var emailInicial = sanitizar(inputEmail.value);
        var estado = { email: '', codigo: '' };

        abrirModo(
            '<div id="container-forgot" class="modo-dois-campos">' +
                '<div id="forgot-lottie"></div>' +
                '<div class="forgot-form" id="cadastro-form"></div>' +
            '</div>'
        );
        carregarLottie('forgot-lottie');

        var painel = $('cadastro-form');

        function trocarEtapa(html) {
            limparAtivos();
            ativoAtual = null;
            raiz.classList.remove('kb-focus');
            painel.innerHTML = html;
            painel.classList.remove('aparece');
            void painel.offsetWidth;
            painel.classList.add('aparece');
            agendarImediato();
        }

        var BOTAO_VOLTAR =
            '<button type="button" id="btn-voltar-cadastro" class="button3">← Voltar para o login</button>';

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

            var emailCad = $('email-cadastro');
            var btn      = $('btn-cadastro-acao');
            emailCad.value = estado.email || emailInicial;

            function enviarCodigo() {
                var email = sanitizar(emailCad.value);
                if (!email || !validateEmail(email)) {
                    mostrarMensagem('Digite um e-mail válido!', 'erro');
                    return;
                }

                executarComBotao(btn, 'ENVIAR CÓDIGO', async function () {
                    /* Sem checkEmailExists aqui: a própria send-signup-otp já recusa
                       e-mails cadastrados, e assim nada além dela é chamado. */
                    definirContexto(false, email, null);

                    /* Edge Function: só envia o código; NÃO cria o usuário */
                    var envio = await sendSignupCode(email);
                    if (!envio.success) {
                        var jaCadastrado = envio.message &&
                            /already registered|j[áa]\s+(est[áa]\s+)?cadastrad/i.test(envio.message);
                        mostrarMensagem(
                            jaCadastrado
                                ? 'Este e-mail já está cadastrado. Faça login!'
                                : (envio.message || 'Erro ao enviar código!'),
                            'erro'
                        );
                        return false;
                    }

                    estado.email = email;
                    etapaCodigo();
                    mostrarMensagem('Código enviado! Verifique seu e-mail.', 'sucesso');
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
                '<button type="button" id="btn-voltar-cadastro" class="button3">← Alterar e-mail</button>'
            );

            $('btn-voltar-cadastro').addEventListener('click', etapaEmail);

            var caixas = Array.prototype.slice.call($('caixas-cadastro').querySelectorAll('.codigo-input'));
            var btn    = $('btn-cadastro-acao');

            /* O código é conferido já aqui; a conta só é criada no último
               passo, depois das senhas. */
            function avancar() {
                var codigo = caixas.map(function (c) { return c.value; }).join('');
                if (codigo.length < caixas.length) {
                    mostrarMensagem('Digite os 6 dígitos do código!', 'erro');
                    return;
                }

                executarComBotao(btn, 'CONFIRMAR', async function () {
                    var resultado = await conferirCodigo(estado.email, codigo);
                    if (!resultado.success) {
                        mostrarMensagem(resultado.message || 'Código incorreto. Tente novamente.', 'erro');
                        caixas.forEach(function (c) { c.value = ''; });
                        caixas[0].focus();
                        return false;
                    }
                    estado.codigo = codigo;
                    etapaSenha();
                    return false;
                });
            }

            /* O código só é conferido ao clicar em CONFIRMAR (ou Enter),
               nunca ao digitar o último número. */
            btn.addEventListener('click', avancar);
            ligarCaixasCodigo(caixas, function () {});
            caixas.forEach(function (caixa) { aoPressionarEnter(caixa, avancar); });
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

            var senha     = $('senha-cadastro');
            var confirmar = $('confirmar-cadastro');
            var btn       = $('btn-cadastro-acao');

            adicionarOlho(senha);
            adicionarOlho(confirmar);
            ligarConfirmacao(senha, confirmar);

            function concluir() {
                var forca = validarSenhaForte(senha.value);
                if (!forca.valida) {
                    mostrarMensagem(forca.mensagem, 'erro');
                    return;
                }
                if (senha.value !== confirmar.value) {
                    mostrarMensagem('As senhas não coincidem!', 'erro');
                    return;
                }

                executarComBotao(btn, 'CONFIRMAR', async function () {
                    definirContexto(false, estado.email, senha.value);

                    var criacao = await verifySignupCode(
                        estado.email, estado.codigo, senha.value, estado.email.split('@')[0]
                    );

                    if (!criacao.success) {
                        var msg = criacao.message || 'Não foi possível criar a conta.';
                        /* código errado/expirado: volta para digitar o código de novo */
                        if (/c[óo]digo|code|expir|inv[áa]lid/i.test(msg)) {
                            estado.codigo = '';
                            etapaCodigo();
                        }
                        mostrarMensagem(msg, 'erro');
                        return false;
                    }

                    voltarParaLogin();
                    mostrarMensagem('Conta criada com sucesso!', 'sucesso');
                    return true;
                });
            }

            btn.addEventListener('click', concluir);
            aoPressionarEnter(senha, function () { confirmar.focus(); });
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

    function detectarRecovery() {
        var query = new URLSearchParams(window.location.search);
        var hash  = new URLSearchParams(window.location.hash.substring(1));
        var tipo  = query.get('type') || hash.get('type');
        if (tipo !== 'recovery') return;

        var tokenHash   = query.get('token_hash');
        var accessToken = hash.get('access_token');
        var code        = query.get('code');
        if (!tokenHash && !accessToken && !code) return;

        aguardarSupabase().then(function (db) {
            if (!db) {
                falhaRecovery('Não foi possível validar o link. Tente novamente.');
                return null;
            }

            if (tokenHash) {
                return db.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
            }
            if (accessToken) {
                return db.auth.setSession({
                    access_token:  accessToken,
                    refresh_token: hash.get('refresh_token') || ''
                });
            }
            return db.auth.exchangeCodeForSession(code);
        }).then(function (resultado) {
            if (!resultado) return;

            var sessao = resultado.data && resultado.data.session;
            if (resultado.error || !sessao) {
                falhaRecovery('Link inválido ou expirado. Tente novamente.');
                return;
            }

            definirContexto(true, sessao.user.email, null);
            limparUrl();
            mostrarNovaSenha();
        }).catch(function (erro) {
            console.error(erro);
            falhaRecovery('Link inválido ou expirado. Tente novamente.');
        });
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
                    '<button type="button" id="btn-voltar-nova" class="button3">← Voltar para o login</button>' +
                '</div>' +
            '</div>'
        );
        carregarLottie('forgot-lottie');

        var novaSenha = $('nova-senha');
        var confirmar = $('confirmar-senha');
        var btnSalvar = $('btn-salvar-senha');

        adicionarOlho(novaSenha);
        adicionarOlho(confirmar);
        ligarConfirmacao(novaSenha, confirmar);

        function salvarSenha() {
            var validacao = validarSenhaForte(novaSenha.value);
            if (!validacao.valida) {
                mostrarMensagem(validacao.mensagem, 'erro');
                return;
            }
            if (novaSenha.value !== confirmar.value) {
                mostrarMensagem('As senhas não coincidem!', 'erro');
                return;
            }

            executarComBotao(btnSalvar, 'CONFIRMAR', async function () {
                var db = getDb();
                if (!db) {
                    mostrarMensagem('Erro de configuração. Recarregue a página.', 'erro');
                    return false;
                }

                var resultado = await db.auth.updateUser({ password: novaSenha.value });
                var igualASenhaAntiga = resultado.error &&
                    resultado.error.message.indexOf('different from the old password') !== -1;

                if (resultado.error && !igualASenhaAntiga) {
                    mostrarMensagem('Erro: ' + resultado.error.message, 'erro');
                    return false;
                }

                voltarParaLogin();
                mostrarMensagem('Senha alterada com sucesso!', 'sucesso');
                return true;
            });
        }

        $('btn-voltar-nova').addEventListener('click', voltarParaLogin);
        btnSalvar.addEventListener('click', salvarSenha);
        aoPressionarEnter(novaSenha, function () { confirmar.focus(); });
        aoPressionarEnter(confirmar, salvarSenha);
    }

    /* ============================================================
       11. OLHO DA SENHA E LOGIN SOCIAL
       ============================================================ */
    function ligarOlho(botao, input) {
        botao.addEventListener('click', function () {
            var mostrar = input.type === 'password';
            input.type = mostrar ? 'text' : 'password';
            botao.classList.toggle('mostrando', mostrar);
        });
    }

    function setupOlhoSenha() {
        var botao = $('btn-olho');
        if (botao) ligarOlho(botao, inputSenha);
    }

    function setupLoginSocial() {
        PROVEDORES_SOCIAIS.forEach(function (provedor) {
            var botao = $('btn-' + provedor);
            if (!botao) return;

            botao.addEventListener('click', function () {
                var db = getDb();
                if (!db) {
                    mostrarMensagem('Erro de configuração. Recarregue a página.', 'erro');
                    return;
                }

                db.auth.signInWithOAuth({
                    provider: provedor,
                    options: {
                        redirectTo: window.location.origin + '/' + PAGINA_DASHBOARD
                    }
                }).then(function (resultado) {
                    if (resultado && resultado.error) {
                        mostrarMensagem('Não foi possível entrar com ' + provedor + '.', 'erro');
                    }
                }).catch(function (erro) {
                    console.error(erro);
                    mostrarMensagem('Ocorreu um erro. Tente novamente.', 'erro');
                });
            });
        });
    }

    /* ============================================================
       12. INICIALIZAÇÃO
       ============================================================ */
    if (!form) return;

    sincronizarTela();
    setupAlturaFixa();
    setupTela();
    setupTeclado();
    setupModoFoco();
    setupOlhoSenha();
    setupLoginSocial();

    form.addEventListener('submit', function (e) { e.preventDefault(); });

    botaoLogin.addEventListener('click',  fazerLogin);
    botaoSignUp.addEventListener('click', mostrarCadastro);
    botaoForgot.addEventListener('click', mostrarForgotPassword);

    aoPressionarEnter(inputEmail, function () { inputSenha.focus(); });
    aoPressionarEnter(inputSenha, fazerLogin);

    detectarRecovery();

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(agendarAltura);
    }

    window.addEventListener('load', function () {
        sincronizarTela();
        agendarImediato();
        agendarAltura();
    });

    window.addEventListener('pageshow', function () {
        sincronizarTela();
        agendarAltura();
    });
})();