/* ============================================================
   LOGIN.JS — Página de login / cadastro / recuperação
   ------------------------------------------------------------
   Estrutura:
     1. Constantes
     2. Utilitários puros
     3. DOM (cache)
     4. Estado da aplicação
     5. Viewport & layout
     6. Teclado virtual
     7. Modo foco (layout row)
     8. Mensagens & loading
     9. Modos do card (forgot / signup / nova senha)
    10. Ações (login / signup / recovery)
    11. Login social
    12. Menu "Saiba mais"
    13. Bootstrap & cleanup
   ============================================================ */
(function () {
    'use strict';

    /* ============================================================
       1. CONSTANTES
       ============================================================ */
    const CONFIG = Object.freeze({
        PAGINA_DASHBOARD: 'dashboard.html',
        LOTTIE_PATH: 'assets/img/animacoes/mail-animation.json',
        DASHBOARD_PROD: 'https://auloo.com.br/dashboard.html',

        MENSAGEM_MIN_MS: 1800,
        MENSAGEM_MS_CHAR: 55,

        ALTURA_BAIXA_PX: 640,
        LARGURA_MOBILE_PX: 599,
        LIMITE_TECLADO_PX: 100,
        MARGEM_TECLADO_PX: 16,

        ROTATING_MS: 500,
        ESTABILIDADE_MS: 120,
        ASSENTAR_ALTURA_MS: 700,
        FOCUSOUT_MS: 80,

        SUPABASE_TENTATIVAS: 30,
        SUPABASE_INTERVALO_MS: 200,

        MQ_ROW: '(min-width: 568px) and (max-width: 950px) and (orientation: landscape) and (max-height: 500px)',

        PROVEDORES_SOCIAIS: ['google', 'discord', 'github'],
    });

    const SVG_ICONE_EMAIL =
        '<svg class="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">' +
        '<path d="M13.106 7.222c0-2.967-2.249-5.032-5.482-5.032-3.35 0-5.646 2.318-5.646 5.702 0 3.493 2.235 5.708 5.762 5.708.862 0 1.689-.123 2.304-.335v-.862c-.43.199-1.354.328-2.29.328-2.926 0-4.813-1.88-4.813-4.798 0-2.844 1.921-4.881 4.594-4.881 2.735 0 4.608 1.688 4.608 4.156 0 1.682-.554 2.769-1.416 2.769-.492 0-.772-.28-.772-.76V5.206H8.923v.834h-.11c-.266-.595-.881-.964-1.6-.964-1.4 0-2.378 1.162-2.378 2.823 0 1.737.957 2.906 2.379 2.906.8 0 1.415-.39 1.709-1.087h.11c.081.67.703 1.148 1.503 1.148 1.572 0 2.57-1.415 2.57-3.643zm-7.177.704c0-1.197.54-1.907 1.456-1.907.93 0 1.524.738 1.524 1.907S8.308 9.84 7.371 9.84c-.895 0-1.442-.725-1.442-1.914z"/></svg>';

    const SVG_ICONE_CADEADO =
        '<svg class="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">' +
        '<path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>';

    /* ============================================================
       2. UTILITÁRIOS PUROS
       ============================================================ */
    const $ = (id) => document.getElementById(id);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    const sanitizar = (v) => (v ? String(v).replace(/[<>]/g, '') : '');

    const estaVisivel = (el) => {
        if (!el || el.offsetParent === null) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };

    const proximoFrame = () =>
        new Promise((resolve) => requestAnimationFrame(() => resolve()));

    const debounce = (fn, ms) => {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    };

    /* ============================================================
       3. DOM (cache)
       ============================================================ */
    const raiz = document.documentElement;

    let form, inputEmail, inputSenha;
    let botaoLogin, botaoSignUp, botaoForgot;

    const dom = {
        montar() {
            form        = $('login-form');
            inputEmail  = $('email');
            inputSenha  = $('senha');
            botaoLogin  = $('btn-login');
            botaoSignUp = $('btn-signup');
            botaoForgot = $('btn-forgot');
        },
        valido() {
            return Boolean(form && inputEmail && inputSenha && botaoLogin);
        },
    };

    /* ============================================================
       4. ESTADO
       ============================================================ */
    const estado = {
        // teclado / layout
        offsetKb: 0,
        razaoTeclado: 0.5,
        vvHeightAnterior: 0,
        larguraMedida: 0,
        maiorAltura: 0,
        layoutAnterior: null,
        alturaAnterior: null,
        larguraAnterior: null,

        // foco
        inputAtivo: null,

        // timers
        timers: {
            mensagem: null,
            altura: null,
            estabilidade: null,
            assentar: null,
            temporizadorTela: null,
        },

        // animações lottie
        lottie: [],

        // listeners registrados (para cleanup)
        listeners: [],
    };

    /** Registra listener e guarda referência para cleanup futuro. */
    function on(target, evento, handler, opts) {
        if (!target) return () => {};
        target.addEventListener(evento, handler, opts);
        const off = () => target.removeEventListener(evento, handler, opts);
        estado.listeners.push(off);
        return off;
    }

    function limparTimers() {
        Object.values(estado.timers).forEach(clearTimeout);
        Object.values(estado.timers).forEach((t) => { t = null; });
    }

    function cleanup() {
        limparTimers();
        estado.listeners.forEach((off) => { try { off(); } catch (_) {} });
        estado.listeners.length = 0;
        estado.lottie.forEach((a) => { try { a.destroy(); } catch (_) {} });
        estado.lottie.length = 0;
    }

    /* ============================================================
       5. VIEWPORT & LAYOUT
       ============================================================ */
    const Viewport = {
        ehLayoutRow() {
            return raiz.getAttribute('data-layout') === 'row';
        },

        getAppH() {
            const v = raiz.style.getPropertyValue('--app-h');
            const n = /px\s*$/.test(v) ? parseFloat(v) : NaN;
            return Number.isFinite(n) && n > 0 ? n : window.innerHeight;
        },

        getAlturaVisivel() {
            const vv = window.visualViewport;
            const h = window.innerHeight;
            return vv && vv.height > 0 && vv.height < h ? vv.height : h;
        },

        getTopoTeclado() {
            const vv = window.visualViewport;
            const topo = vv ? vv.offsetTop + vv.height : window.innerHeight;
            return Math.min(topo, window.innerHeight);
        },

        campoEmFoco() {
            const el = document.activeElement;
            return Boolean(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
        },

        tecladoAberto() {
            return (
                Viewport.campoEmFoco() &&
                Viewport.getAppH() - Viewport.getAlturaVisivel() > CONFIG.LIMITE_TECLADO_PX
            );
        },

        orientacao() {
            if (screen?.orientation?.type) {
                return screen.orientation.type.startsWith('landscape') ? 'L' : 'P';
            }
            if (typeof window.orientation === 'number') {
                return Math.abs(window.orientation) === 90 ? 'L' : 'P';
            }
            return matchMedia('(orientation: landscape)').matches ? 'L' : 'P';
        },

        layout() {
            const ehRow =
                matchMedia(CONFIG.MQ_ROW).matches && Viewport.orientacao() === 'L';
            return ehRow ? 'row' : 'stacked';
        },

        alturaCategoria() {
            return window.innerHeight <= CONFIG.ALTURA_BAIXA_PX ? 'baixa' : 'normal';
        },
    };

    /* ---------- 5.1 Altura fixa (--app-h) ---------- */
    function setupAlturaFixa() {
        const aplicar = (h) => {
            estado.maiorAltura = h;
            raiz.style.setProperty('--app-h', `${h}px`);
        };

        const medir = () => {
            if (window.innerWidth !== estado.larguraMedida) {
                estado.larguraMedida = window.innerWidth;
                estado.maiorAltura = 0;
            }
            const h = window.innerHeight;
            if (h > estado.maiorAltura) aplicar(h);

            clearTimeout(estado.timers.assentar);
            estado.timers.assentar = setTimeout(() => {
                if (!Viewport.campoEmFoco() && window.innerHeight !== estado.maiorAltura) {
                    aplicar(window.innerHeight);
                }
            }, CONFIG.ASSENTAR_ALTURA_MS);
        };

        [0, 100, 300, 600, 1000, 1500].forEach((ms) => setTimeout(medir, ms));
        on(window, 'resize', medir);
        on(window, 'orientationchange', () => {
            estado.maiorAltura = 0;
            [50, 300, 600, 1000].forEach((ms) => setTimeout(medir, ms));
        });
        medir();
    }

    /* ---------- 5.2 Altura mínima do form ---------- */
    function aplicarAlturaLogin() {
        if (!form) return;
        if (Viewport.campoEmFoco() || Viewport.tecladoAberto()) return;
        if (form.classList.contains('modo-forgot')) return;

        const mensagens = $$('.mensagem', form);
        mensagens.forEach((m) => { m.hidden = true; });

        const anterior = form.style.minHeight;
        form.style.minHeight = '0px';
        const h = form.offsetHeight;
        form.style.minHeight = anterior;

        mensagens.forEach((m) => { m.hidden = false; });

        if (h > 0) form.style.minHeight = `${h}px`;
    }

    const agendarAltura = debounce(aplicarAlturaLogin, 150);

    /* ---------- 5.3 Sincronizar atributos de layout ---------- */
    function sincronizarTela() {
        if (Viewport.campoEmFoco() || Viewport.tecladoAberto()) return;

        const layout = Viewport.layout();
        if (estado.layoutAnterior !== layout) {
            raiz.setAttribute('data-layout', layout);
            estado.layoutAnterior = layout;
        }

        const altura = Viewport.alturaCategoria();
        if (estado.alturaAnterior !== altura) {
            raiz.setAttribute('data-altura', altura);
            estado.alturaAnterior = altura;
        }
    }

    /* ---------- 5.4 Orquestração de mudança de tela ---------- */
    function setupTela() {
        let orientacao = Viewport.orientacao();
        let largura = window.innerWidth;

        const reavaliar = () => {
            sincronizarTela();
            agendarAltura();
            resetarScroll();
        };

        const aoMudarGeometria = () => {
            const novaOrientacao = Viewport.orientacao();
            const novaLargura = window.innerWidth;
            if (novaOrientacao === orientacao && novaLargura === largura) return;

            orientacao = novaOrientacao;
            largura = novaLargura;

            raiz.classList.add('rotating');
            resetarEstadoTeclado();
            form.style.minHeight = '';

            reavaliar();
            [60, 250, 600, 1100, 1800].forEach((ms) => setTimeout(reavaliar, ms));
            setTimeout(() => raiz.classList.remove('rotating'), CONFIG.ROTATING_MS + 300);
        };

        const aoRedimensionar = () => {
            aoMudarGeometria();
            debounce(reavaliar, 250)();
        };

        on(window, 'resize', aoRedimensionar);
        on(window, 'orientationchange', aoRedimensionar);
        if (screen?.orientation?.addEventListener) {
            on(screen.orientation, 'change', aoRedimensionar);
        }

        on(document, 'focusout', () => {
            setTimeout(() => {
                if (!Viewport.campoEmFoco() && !Viewport.tecladoAberto()) {
                    sincronizarTela();
                }
            }, 400);
        });

        // Substitui o setInterval infinito por um único listener de visibilitychange
        on(document, 'visibilitychange', () => {
            if (document.hidden) return;
            if (Viewport.campoEmFoco() || Viewport.tecladoAberto()) return;
            if (raiz.classList.contains('kb-focus') || estado.offsetKb !== 0) {
                limparAtivos();
                raiz.classList.remove('kb-focus');
                resetarKbOffset();
                raiz.style.removeProperty('--kb-visivel');
                resetarScroll();
            }
            aoMudarGeometria();
            sincronizarTela();
        });
    }

    /* ============================================================
       6. TECLADO VIRTUAL
       ============================================================ */
    function escolherReferencia() {
        const ativo = form.querySelector('[data-ativo="true"]');
        if (ativo) return ativo;

        if (form.classList.contains('modo-forgot')) {
            const container = form.querySelector('#container-forgot');
            if (!container) return null;

            if (window.innerWidth <= CONFIG.LARGURA_MOBILE_PX) {
                const primario = container.querySelector('.forgot-form > .button1');
                if (primario) return primario;
            }
            const cands = $$('button, .otp-caixas, .field', container);
            return cands.at(-1) ?? null;
        }

        if (Viewport.ehLayoutRow()) {
            const btnRow = form.querySelector('.form-coluna-login > .btn');
            if (btnRow) return btnRow;
        }

        const fields = $$('.form-coluna-login > .field', form);
        return fields.at(-1) ?? null;
    }

    function resetarScroll() {
        const container = $('login-container');
        if (container?.scrollTop > 0) container.scrollTop = 0;
        if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    }

    function resetarKbOffset() {
        if (estado.offsetKb === 0) return;
        estado.offsetKb = 0;
        raiz.style.setProperty('--kb-offset', '0px');
    }

    function atualizarAlturaVisivel() {
        if (Viewport.tecladoAberto()) {
            const topo = Math.max(0, Viewport.getTopoTeclado());
            const appH = Viewport.getAppH();
            if (appH > 0) estado.razaoTeclado = topo / appH;
            raiz.style.setProperty('--kb-visivel', `${topo}px`);
        } else if (
            !(Viewport.ehLayoutRow() && raiz.classList.contains('kb-focus') && Viewport.campoEmFoco())
        ) {
            raiz.style.removeProperty('--kb-visivel');
        }
    }

    function calcularKbOffset() {
        atualizarAlturaVisivel();
        if (!Viewport.tecladoAberto()) {
            resetarKbOffset();
            return;
        }
        if (Viewport.ehLayoutRow() && raiz.classList.contains('kb-focus')) {
            resetarKbOffset();
            return;
        }

        const ref = escolherReferencia();
        if (!ref) return;

        const bottomNatural = ref.getBoundingClientRect().bottom - estado.offsetKb;
        const limite = Viewport.getTopoTeclado() - CONFIG.MARGEM_TECLADO_PX;
        const novo = bottomNatural > limite ? limite - bottomNatural : 0;

        if (Math.abs(novo - estado.offsetKb) > 2) {
            estado.offsetKb = novo;
            raiz.style.setProperty('--kb-offset', `${novo}px`);
        }
    }

    let ajusteRaf = false;
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
        const diff = h - estado.vvHeightAnterior;
        if (Math.abs(diff) <= 1) return;

        estado.vvHeightAnterior = h;
        clearTimeout(estado.timers.estabilidade);

        if (diff > 0) {
            executarAjuste();
        } else {
            estado.timers.estabilidade = setTimeout(executarAjuste, CONFIG.ESTABILIDADE_MS);
        }
    }

    function agendarImediato() {
        clearTimeout(estado.timers.estabilidade);
        executarAjuste();
    }

    function resetarEstadoTeclado() {
        if (Viewport.campoEmFoco()) document.activeElement.blur();
        limparAtivos();
        raiz.classList.remove('kb-focus');
        resetarKbOffset();
        raiz.style.removeProperty('--kb-visivel');
        resetarScroll();
    }

    function setupTeclado() {
        if (window.visualViewport) {
            on(window.visualViewport, 'resize', agendarAposEstabilidade);
            on(window.visualViewport, 'scroll', agendarAposEstabilidade);
        }
        on(window, 'resize', agendarAposEstabilidade);

        on(document, 'focusin', (e) => {
            if (e.target?.tagName === 'INPUT') agendarAposEstabilidade();
        });

        on(document, 'focusout', () => {
            setTimeout(() => {
                if (Viewport.campoEmFoco()) return;
                clearTimeout(estado.timers.estabilidade);
                executarAjuste();
                setTimeout(() => {
                    if (!Viewport.campoEmFoco() && !Viewport.tecladoAberto()) resetarScroll();
                }, 300);
            }, CONFIG.FOCUSOUT_MS);
        });

        on(window, 'orientationchange', () => {
            [50, 300, 600].forEach((ms) => setTimeout(agendarImediato, ms));
        });

        executarAjuste();
    }

    /* ============================================================
       7. MODO FOCO (row)
       ============================================================ */
    function limparAtivos() {
        $$('[data-ativo="true"]', form).forEach((el) => el.removeAttribute('data-ativo'));
    }

    function setupModoFoco() {
        const marcarAtivo = (input) => {
            raiz.classList.add('kb-focus');

            if (!Viewport.ehLayoutRow()) return;
            if (input === estado.inputAtivo) return;
            estado.inputAtivo = input;

            const container = input.closest('.field, .otp-caixas');
            if (!container || !form.contains(container)) return;

            limparAtivos();
            container.setAttribute('data-ativo', 'true');
            if (!Viewport.tecladoAberto()) {
                raiz.style.setProperty(
                    '--kb-visivel',
                    `${Math.round(Viewport.getAppH() * estado.razaoTeclado)}px`
                );
            }
            agendarAposEstabilidade();
        };

        const limparModo = () => {
            estado.inputAtivo = null;
            limparAtivos();
            raiz.classList.remove('kb-focus');
            agendarAposEstabilidade();
        };

        on(form, 'focusin', (e) => {
            if (e.target?.tagName === 'INPUT') marcarAtivo(e.target);
        });

        on(form, 'focusout', () => {
            setTimeout(() => {
                const ativo = document.activeElement;
                if (ativo?.tagName === 'INPUT' && form.contains(ativo)) {
                    marcarAtivo(ativo);
                } else {
                    limparModo();
                }
            }, CONFIG.FOCUSOUT_MS);
        });

        on(window, 'pageshow', limparModo);
    }

    /* ============================================================
       8. MENSAGENS & LOADING
       ============================================================ */
    function removerMensagem(msg) {
        if (!msg) return;
        msg.removeAttribute('id');
        msg.classList.remove('visivel');
        setTimeout(() => msg.parentNode?.removeChild(msg), 300);
    }

    function primeiroVisivel(lista) {
        return lista.find(estaVisivel) ?? lista[0] ?? null;
    }

    function escolherPaiMensagem() {
        const modoAtivo = form.querySelector('.forgot-form');
        if (modoAtivo) {
            return {
                parent: modoAtivo,
                ref: primeiroVisivel($$('.field, .otp-caixas', modoAtivo)),
            };
        }

        const colLog = form.querySelector('.form-coluna-login');
        const ativo = form.querySelector('[data-ativo="true"]');
        if (ativo && colLog) return { parent: colLog, ref: ativo };

        if (Viewport.ehLayoutRow()) {
            const colSoc = form.querySelector('.form-coluna-sociais');
            const divisor = colSoc?.querySelector('.divisor-login');
            if (estaVisivel(colSoc) && estaVisivel(divisor)) {
                return { parent: colSoc, ref: divisor };
            }
        }

        if (colLog) return { parent: colLog, ref: colLog.querySelector('.field') };
        return { parent: form, ref: null };
    }

    function paiPosicionavel(el) {
        return el && getComputedStyle(el).display === 'contents' ? form : el;
    }

    function posicionarMensagem(msg) {
        const escolha = escolherPaiMensagem();
        const parent = paiPosicionavel(escolha.parent);
        parent.appendChild(msg);

        if (!escolha.ref) {
            msg.style.bottom = '100%';
            return;
        }

        const parentRect = parent.getBoundingClientRect();
        const refRect = escolha.ref.getBoundingClientRect();
        msg.style.bottom = `${parentRect.bottom - refRect.top + 8}px`;
    }

    function mostrarMensagem(texto, tipo = 'sucesso') {
        clearTimeout(estado.timers.mensagem);
        removerMensagem($('mensagem-login'));

        const msg = document.createElement('div');
        msg.id = 'mensagem-login';
        msg.className = `mensagem mensagem--${tipo}`;
        msg.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');

        const p = document.createElement('p');
        p.textContent = texto;
        msg.appendChild(p);

        posicionarMensagem(msg);
        void msg.offsetHeight;
        msg.classList.add('visivel');

        const tempo = Math.max(CONFIG.MENSAGEM_MIN_MS, String(texto).length * CONFIG.MENSAGEM_MS_CHAR);
        estado.timers.mensagem = setTimeout(() => removerMensagem(msg), tempo);
    }

    function mostrarLoading(botao) {
        botao.disabled = true;
        botao.textContent = '';
        const spinner = document.createElement('span');
        spinner.className = 'button-loading';
        botao.appendChild(spinner);
    }

    function restaurarBotao(botao, texto) {
        if (!botao) return;
        botao.disabled = false;
        botao.textContent = typeof texto === 'function' ? texto() : texto;
    }

    async function executarComBotao(botao, textoOriginal, acao) {
        if (botao.disabled) return;
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
       9. MODOS DO CARD
       ============================================================ */
    function carregarLottie(idContainer) {
        const container = $(idContainer);
        if (!container || typeof lottie === 'undefined') return;

        estado.lottie.push(
            lottie.loadAnimation({
                container,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                path: CONFIG.LOTTIE_PATH,
            })
        );
    }

    function removerContainersDeModo() {
        estado.lottie.forEach((a) => { try { a.destroy(); } catch (_) {} });
        estado.lottie.length = 0;
        estado.inputAtivo = null;
        $('container-forgot')?.remove();
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
        estado.inputAtivo = null;
        definirContexto(false, null, null);

        inputEmail.value = '';
        inputSenha.value = '';

        restaurarBotao(botaoLogin, 'Login');
        agendarImediato();
        setTimeout(agendarAltura, 100);
    }

    /* ============================================================
       10. AÇÕES
       ============================================================ */
    function definirContexto(modoForgot, email, senha) {
        window.modoForgotPassword = modoForgot;
        window.emailVerificacao = email || null;
        window.senhaVerificacao = senha || null;
    }

    function aoPressionarEnter(input, acao) {
        if (!input) return;
        on(input, 'keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            acao();
        });
    }

    function validarCredenciais(email, senha) {
        if (!email || !senha) return 'Digite e-mail e senha!';
        if (!validateEmail(email)) return 'E-mail invalido!';
        return '';
    }

    function fazerLogin() {
        const email = sanitizar(inputEmail.value);
        const senha = inputSenha.value;

        const erro = validarCredenciais(email, senha);
        if (erro) {
            mostrarMensagem(erro, 'erro');
            return;
        }

        executarComBotao(botaoLogin, 'Login', async () => {
            const r = await loginUser(email, senha);
            if (r.success) {
                setTimeout(() => { window.location.href = CONFIG.PAGINA_DASHBOARD; }, 500);
                return true;
            }
            mostrarMensagem(r.message || 'E-mail ou senha incorretos!', 'erro');
            return false;
        });
    }

    /* ---------- 10.1 Esqueci a senha ---------- */
    function mostrarForgotPassword() {
        abrirModo(`
            <div id="container-forgot">
                <div id="forgot-lottie"></div>
                <div class="forgot-form">
                    <div class="field">${SVG_ICONE_EMAIL}
                        <input type="email" id="email-forgot" class="input-field"
                               placeholder="E-mail" autocomplete="email" aria-label="E-mail">
                    </div>
                    <button type="button" id="btn-enviar-link" class="button1">ENVIAR LINK</button>
                    <button type="button" id="btn-voltar-forgot" class="button3">Voltar para o login</button>
                </div>
            </div>
        `);
        carregarLottie('forgot-lottie');

        const inputForgot = $('email-forgot');
        const btnEnviar = $('btn-enviar-link');

        const enviarLink = () => {
            const email = sanitizar(inputForgot.value);
            if (!email || !validateEmail(email)) {
                mostrarMensagem('Digite um e-mail valido!', 'erro');
                return;
            }

            executarComBotao(btnEnviar, 'ENVIAR LINK', async () => {
                const existente = await checkEmailExists(email);
                if (!existente.exists) {
                    mostrarMensagem('E-mail nao cadastrado!', 'erro');
                    return false;
                }
                if (existente.provider === 'google' && !existente.hasPassword) {
                    mostrarMensagem('Use o botao "Entrar com Google".', 'erro');
                    return false;
                }

                const r = await recoverPassword(email);
                mostrarMensagem(
                    r.success ? 'Link enviado!' : r.message || 'Erro ao enviar link!',
                    r.success ? 'sucesso' : 'erro'
                );
                return false;
            });
        };

        $('btn-voltar-forgot').addEventListener('click', voltarParaLogin);
        btnEnviar.addEventListener('click', enviarLink);
        aoPressionarEnter(inputForgot, enviarLink);
    }

    /* ---------- 10.2 Helpers de formulário ---------- */
    function ligarConfirmacao(senha, confirmar) {
        on(confirmar, 'input', () => {
            const diverge = confirmar.value.length > 0 && confirmar.value !== senha.value;
            confirmar.closest('.field').style.borderColor = diverge ? 'var(--erro)' : '';
        });
    }

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
        return Array.from({ length: 6 }, (_, i) =>
            `<input type="text" maxlength="1" class="codigo-input"
                    inputmode="numeric" autocomplete="one-time-code"
                    aria-label="Digito ${i + 1}">`
        ).join('');
    }

    function ligarCaixasCodigo(caixas, aoCompletar) {
        const codigo = () => caixas.map((c) => c.value).join('');
        const verificar = () => {
            if (codigo().length === caixas.length && aoCompletar) aoCompletar(codigo());
        };

        caixas.forEach((caixa, i) => {
            on(caixa, 'input', () => {
                caixa.value = caixa.value.replace(/\D/g, '');
                if (caixa.value && i < caixas.length - 1) caixas[i + 1].focus();
                verificar();
            });

            on(caixa, 'keydown', (e) => {
                if (e.key === 'Backspace' && !caixa.value && i > 0) {
                    caixas[i - 1].focus();
                }
            });

            on(caixa, 'paste', (e) => {
                const dados = e.clipboardData || window.clipboardData;
                const texto = dados ? dados.getData('text').replace(/\D/g, '') : '';
                if (!texto) return;
                e.preventDefault();
                caixas.forEach((c, idx) => { c.value = texto.charAt(idx) || ''; });
                caixas[Math.min(texto.length, caixas.length) - 1].focus();
                verificar();
            });
        });
    }

    /* ---------- 10.3 Cadastro ---------- */
    function mostrarCadastro() {
        const emailInicial = sanitizar(inputEmail.value);
        const ctx = { email: '', codigo: '' };

        abrirModo(`
            <div id="container-forgot" class="modo-dois-campos">
                <div id="forgot-lottie"></div>
                <div class="forgot-form" id="cadastro-form"></div>
            </div>
        `);
        carregarLottie('forgot-lottie');

        const painel = $('cadastro-form');

        const trocarEtapa = (html) => {
            limparAtivos();
            estado.inputAtivo = null;
            raiz.classList.remove('kb-focus');
            painel.innerHTML = html;
            painel.classList.remove('aparece');
            void painel.offsetWidth;
            painel.classList.add('aparece');
            agendarImediato();
        };

        const BOTAO_VOLTAR =
            '<button type="button" id="btn-voltar-cadastro" class="button3">Voltar para o login</button>';

        const etapaEmail = () => {
            trocarEtapa(`
                <div class="field">${SVG_ICONE_EMAIL}
                    <input type="email" id="email-cadastro" class="input-field"
                           placeholder="E-mail" autocomplete="email" aria-label="E-mail">
                </div>
                <button type="button" id="btn-cadastro-acao" class="button1">ENVIAR CODIGO</button>
                ${BOTAO_VOLTAR}
            `);
            $('btn-voltar-cadastro').addEventListener('click', voltarParaLogin);

            const emailCad = $('email-cadastro');
            const btn = $('btn-cadastro-acao');
            emailCad.value = ctx.email || emailInicial;

            const enviarCodigo = () => {
                const email = sanitizar(emailCad.value);
                if (!email || !validateEmail(email)) {
                    mostrarMensagem('Digite um e-mail valido!', 'erro');
                    return;
                }

                executarComBotao(btn, 'ENVIAR CODIGO', async () => {
                    definirContexto(false, email, null);

                    const existente = await checkEmailExists(email);
                    if (existente.exists) {
                        if (existente.provider === 'google' && !existente.hasPassword) {
                            mostrarMensagem('Use o botao "Entrar com Google".', 'erro');
                            return false;
                        }
                        mostrarMensagem('Este e-mail ja esta cadastrado. Faca login!', 'erro');
                        return false;
                    }

                    const envio = await sendSignupCode(email);
                    if (!envio.success) {
                        mostrarMensagem(envio.message || 'Erro ao enviar codigo!', 'erro');
                        return false;
                    }

                    ctx.email = email;
                    etapaCodigo();
                    mostrarMensagem('Codigo enviado!', 'sucesso');
                    return false;
                });
            };

            btn.addEventListener('click', enviarCodigo);
            aoPressionarEnter(emailCad, enviarCodigo);
        };

        const etapaCodigo = () => {
            trocarEtapa(`
                <div class="otp-caixas" id="caixas-cadastro">${caixasCodigoHtml()}</div>
                <button type="button" id="btn-cadastro-acao" class="button1">CONFIRMAR</button>
                <button type="button" id="btn-voltar-cadastro" class="button3">Alterar e-mail</button>
            `);
            $('btn-voltar-cadastro').addEventListener('click', etapaEmail);

            const caixas = $$('.codigo-input', $('caixas-cadastro'));
            const btn = $('btn-cadastro-acao');

            const avancar = () => {
                const codigo = caixas.map((c) => c.value).join('');
                if (codigo.length < caixas.length) {
                    mostrarMensagem('Digite os 6 digitos!', 'erro');
                    return;
                }
                ctx.codigo = codigo;
                etapaSenha();
            };

            btn.addEventListener('click', avancar);
            ligarCaixasCodigo(caixas, () => {});
            caixas.forEach((c) => aoPressionarEnter(c, avancar));
            caixas[0].focus();
        };

        const etapaSenha = () => {
            trocarEtapa(`
                <div class="field field-senha">${SVG_ICONE_CADEADO}
                    <input type="password" id="senha-cadastro" class="input-field"
                           placeholder="Senha" autocomplete="new-password" aria-label="Senha">
                </div>
                <div class="field field-senha">${SVG_ICONE_CADEADO}
                    <input type="password" id="confirmar-cadastro" class="input-field"
                           placeholder="Confirmar senha" autocomplete="new-password" aria-label="Confirmar senha">
                </div>
                <button type="button" id="btn-cadastro-acao" class="button1">CONFIRMAR</button>
                ${BOTAO_VOLTAR}
            `);
            $('btn-voltar-cadastro').addEventListener('click', voltarParaLogin);

            const senha = $('senha-cadastro');
            const confirmar = $('confirmar-cadastro');
            const btn = $('btn-cadastro-acao');

            adicionarOlho(senha);
            adicionarOlho(confirmar);
            ligarConfirmacao(senha, confirmar);

            const concluir = () => {
                const forca = validarSenhaForte(senha.value);
                if (!forca.valida) {
                    mostrarMensagem(forca.mensagem, 'erro');
                    return;
                }
                if (senha.value !== confirmar.value) {
                    mostrarMensagem('As senhas nao coincidem!', 'erro');
                    return;
                }

                executarComBotao(btn, 'CONFIRMAR', async () => {
                    definirContexto(false, ctx.email, senha.value);

                    const criacao = await verifySignupCode(
                        ctx.email, ctx.codigo, senha.value, ctx.email.split('@')[0]
                    );

                    if (!criacao.success) {
                        const msg = criacao.message || 'Nao foi possivel criar a conta.';
                        if (/c[óo]digo|code|expir|inv[áa]lid/i.test(msg)) {
                            ctx.codigo = '';
                            etapaCodigo();
                        }
                        mostrarMensagem(msg, 'erro');
                        return false;
                    }

                    const entrada = await loginUser(ctx.email, senha.value);
                    if (entrada.success) {
                        mostrarMensagem('Conta criada!', 'sucesso');
                        setTimeout(() => { window.location.href = CONFIG.PAGINA_DASHBOARD; }, 500);
                        return true;
                    }

                    voltarParaLogin();
                    mostrarMensagem('Conta criada! Faca login.', 'sucesso');
                    return true;
                });
            };

            btn.addEventListener('click', concluir);
            aoPressionarEnter(senha, () => confirmar.focus());
            aoPressionarEnter(confirmar, concluir);
            senha.focus();
        };

        etapaEmail();
    }

    /* ---------- 10.4 Nova senha (recovery) ---------- */
    const limparUrl = () => window.history.replaceState(null, '', window.location.pathname);

    const falhaRecovery = (texto) => {
        limparUrl();
        mostrarMensagem(texto, 'erro');
    };

    function detectarRecovery() {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.substring(1));
        const tipo = query.get('type') || hash.get('type');
        if (tipo !== 'recovery') return;

        const tokenHash = query.get('token_hash');
        const accessToken = hash.get('access_token');
        const code = query.get('code');
        if (!tokenHash && !accessToken && !code) return;

        (async () => {
            try {
                const db = await aguardarSupabase();
                if (!db) {
                    falhaRecovery('Nao foi possivel validar o link.');
                    return;
                }

                let resultado;
                if (tokenHash) {
                    resultado = await db.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
                } else if (accessToken) {
                    resultado = await db.auth.setSession({
                        access_token: accessToken,
                        refresh_token: hash.get('refresh_token') || '',
                    });
                } else {
                    resultado = await db.auth.exchangeCodeForSession(code);
                }

                const sessao = resultado?.data?.session;
                if (resultado?.error || !sessao) {
                    falhaRecovery('Link invalido ou expirado.');
                    return;
                }

                definirContexto(true, sessao.user.email, null);
                limparUrl();
                mostrarNovaSenha();
            } catch (erro) {
                console.error(erro);
                falhaRecovery('Link invalido ou expirado.');
            }
        })();
    }

    function mostrarNovaSenha() {
        abrirModo(`
            <div id="container-forgot" class="modo-dois-campos">
                <div id="forgot-lottie"></div>
                <div class="forgot-form">
                    <div class="field field-senha">${SVG_ICONE_CADEADO}
                        <input type="password" id="nova-senha" class="input-field"
                               placeholder="Nova senha" autocomplete="new-password" aria-label="Nova senha">
                    </div>
                    <div class="field field-senha">${SVG_ICONE_CADEADO}
                        <input type="password" id="confirmar-senha" class="input-field"
                               placeholder="Confirmar nova senha" autocomplete="new-password" aria-label="Confirmar nova senha">
                    </div>
                    <button type="button" id="btn-salvar-senha" class="button1">CONFIRMAR</button>
                    <button type="button" id="btn-voltar-nova" class="button3">Voltar para o login</button>
                </div>
            </div>
        `);
        carregarLottie('forgot-lottie');

        const novaSenha = $('nova-senha');
        const confirmar = $('confirmar-senha');
        const btnSalvar = $('btn-salvar-senha');

        adicionarOlho(novaSenha);
        adicionarOlho(confirmar);
        ligarConfirmacao(novaSenha, confirmar);

        const salvarSenha = () => {
            const validacao = validarSenhaForte(novaSenha.value);
            if (!validacao.valida) {
                mostrarMensagem(validacao.mensagem, 'erro');
                return;
            }
            if (novaSenha.value !== confirmar.value) {
                mostrarMensagem('As senhas nao coincidem!', 'erro');
                return;
            }

            executarComBotao(btnSalvar, 'CONFIRMAR', async () => {
                const db = getDb();
                if (!db) {
                    mostrarMensagem('Erro de configuracao.', 'erro');
                    return false;
                }

                const resultado = await db.auth.updateUser({ password: novaSenha.value });
                const igualASenhaAntiga =
                    resultado.error?.message.indexOf('different from the old password') !== -1;

                if (resultado.error && !igualASenhaAntiga) {
                    mostrarMensagem(`Erro: ${resultado.error.message}`, 'erro');
                    return false;
                }

                voltarParaLogin();
                mostrarMensagem('Senha alterada!', 'sucesso');
                return true;
            });
        };

        $('btn-voltar-nova').addEventListener('click', voltarParaLogin);
        btnSalvar.addEventListener('click', salvarSenha);
        aoPressionarEnter(novaSenha, () => confirmar.focus());
        aoPressionarEnter(confirmar, salvarSenha);
    }

    /* ============================================================
       11. OLHO DA SENHA & LOGIN SOCIAL
       ============================================================ */
    function ligarOlho(botao, input) {
        on(botao, 'click', () => {
            const mostrar = input.type === 'password';
            input.type = mostrar ? 'text' : 'password';
            botao.classList.toggle('mostrando', mostrar);
        });
    }

    function setupOlhoSenha() {
        const botao = $('btn-olho');
        if (botao) ligarOlho(botao, inputSenha);
    }

    function setupLoginSocial() {
        CONFIG.PROVEDORES_SOCIAIS.forEach((provedor) => {
            const botao = $(`btn-${provedor}`);
            if (!botao) return;

            on(botao, 'click', async () => {
                const db = getDb();
                if (!db) {
                    mostrarMensagem('Erro de configuracao.', 'erro');
                    return;
                }
                if (botao.dataset.carregando === '1') return;

                botao.dataset.carregando = '1';
                botao.style.opacity = '0.6';
                botao.style.pointerEvents = 'none';

                const host = window.location.hostname;
                const urlRedirect =
                    host === 'localhost' || host === '127.0.0.1'
                        ? `${window.location.origin}/dashboard.html`
                        : CONFIG.DASHBOARD_PROD;

                const restaurar = () => {
                    botao.dataset.carregando = '0';
                    botao.style.opacity = '';
                    botao.style.pointerEvents = '';
                };

                try {
                    const r = await db.auth.signInWithOAuth({
                        provider: provedor,
                        options: {
                            redirectTo: urlRedirect,
                            queryParams:
                                provedor === 'google'
                                    ? { prompt: 'select_account', access_type: 'online' }
                                    : {},
                        },
                    });
                    if (r?.error) {
                        restaurar();
                        mostrarMensagem(`Nao foi possivel entrar com ${provedor}.`, 'erro');
                    }
                } catch (erro) {
                    console.error(erro);
                    restaurar();
                    mostrarMensagem('Ocorreu um erro. Tente novamente.', 'erro');
                }
            });
        });
    }

    /* ============================================================
       12. MENU "SAIBA MAIS"
       ============================================================ */
    function setupMenuSaiba() {
        const botao = $('navbar-saiba-btn');
        const menu = $('navbar-saiba-menu');
        if (!botao || !menu) return;

        const posicionar = () => {
            const coluna = document.querySelector('.form-coluna-sociais');
            const ehRow = raiz.getAttribute('data-layout') === 'row';

            menu.style.left = menu.style.right = menu.style.width = '';
            menu.style.removeProperty('--seta-x');
            if (!ehRow || !coluna) return;

            const folga = 5;
            const wrap = menu.parentNode.getBoundingClientRect();
            const sec = coluna.getBoundingClientRect();
            const esq = sec.left + folga;
            const dir = Math.min(sec.right, window.innerWidth) - folga;
            const larg = Math.min(330, dir - esq);
            const x = esq + (dir - esq - larg) / 2;

            menu.style.right = 'auto';
            menu.style.left = `${x - wrap.left}px`;
            menu.style.width = `${larg}px`;

            const b = botao.getBoundingClientRect();
            const seta = b.left + b.width / 2 - x;
            menu.style.setProperty('--seta-x', `${Math.max(16, Math.min(larg - 28, seta - 6))}px`);
        };

        const definir = (aberto) => {
            if (aberto) posicionar();
            menu.hidden = !aberto;
            botao.setAttribute('aria-expanded', aberto ? 'true' : 'false');
        };

        on(botao, 'click', (e) => {
            e.stopPropagation();
            definir(menu.hidden);
        });

        on(document, 'click', (e) => {
            if (!menu.hidden && !menu.contains(e.target)) definir(false);
        });

        on(document, 'keydown', (e) => {
            if (e.key === 'Escape' && !menu.hidden) {
                definir(false);
                botao.focus();
            }
        });

        on(window, 'resize', () => definir(false));
        on(window, 'orientationchange', () => definir(false));
    }

    /* ============================================================
       13. BOOTSTRAP
       ============================================================ */
    async function aguardarSupabase() {
        for (let i = 0; i < CONFIG.SUPABASE_TENTATIVAS; i++) {
            const db = getDb();
            if (db) return db;
            await new Promise((r) => setTimeout(r, CONFIG.SUPABASE_INTERVALO_MS));
        }
        return null;
    }

    function getDb() {
        return (
            window.supabaseClient ||
            (typeof supabaseClient !== 'undefined' ? supabaseClient : null)
        );
    }

    function setupEventos() {
        form.addEventListener('submit', (e) => e.preventDefault());

        botaoLogin.addEventListener('click', fazerLogin);
        botaoSignUp.addEventListener('click', mostrarCadastro);
        botaoForgot.addEventListener('click', mostrarForgotPassword);

        aoPressionarEnter(inputEmail, () => inputSenha.focus());
        aoPressionarEnter(inputSenha, fazerLogin);

        document.addEventListener('gesturestart', (e) => e.preventDefault());
    }

    function bootstrap() {
        dom.montar();
        if (!dom.valido()) {
            console.error('[login.js] Elementos essenciais não encontrados.');
            return;
        }

        sincronizarTela();
        setupAlturaFixa();
        setupTela();
        setupTeclado();
        setupModoFoco();
        setupMenuSaiba();
        setupOlhoSenha();
        setupLoginSocial();
        setupEventos();

        detectarRecovery();

        if (document.fonts?.ready) {
            document.fonts.ready.then(agendarAltura);
        }

        on(window, 'load', () => {
            sincronizarTela();
            agendarImediato();
            agendarAltura();
        });

        on(window, 'pageshow', () => {
            sincronizarTela();
            agendarAltura();
        });

        // Cleanup ao sair (útil para navegação e bfcache)
        on(window, 'pagehide', cleanup);
        on(window, 'beforeunload', cleanup);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }
})();