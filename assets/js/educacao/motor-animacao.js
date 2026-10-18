/* ============================================================
   MOTOR-ANIMACAO.JS — v1
   Motor de passo a passo do Auloo.

   Decisões travadas:
   - Passo manual (aluno clica "próximo").
   - Simulador persiste entre passos; só título/texto mudam.
   - Cada passo pode exigir interação (requerInteracao: true).
   - Navegação só por "anterior/próximo".
   - Sem salvamento de progresso.

   Contrato:
     const motor = Motor.criar(container, {
       passos: [...],
       simulador: { criar, aoMudarPasso, destruir },
       aoMudarPasso: (indice, passo) => {}
     });

     motor.proximoPasso();
     motor.passoAnterior();
     motor.irParaPasso(n);
     motor.interacaoConcluida();   // chamado pelo simulador
     motor.destruir();

   Cada passo:
     {
       titulo: 'Passo 1 — ...',
       texto: 'Explicação...',
       requerInteracao: false,
       aoEntrar: (ctx) => {},
       aoSair: (ctx) => {}
     }

   O `ctx` passado ao simulador em `aoMudarPasso(indice, passo, ctx)` tem:
     ctx.interacaoConcluida()  // libera o botão "próximo"
     ctx.passoAtual
     ctx.totalPassos
   ============================================================ */
(function () {
    'use strict';

    const CLASSE_PREFIXO = 'motor-';

    function criarElemento(tag, classe, texto) {
        const el = document.createElement(tag);
        if (classe) el.className = classe;
        if (texto != null) el.textContent = texto;
        return el;
    }

    function criar(container, config) {
        if (!container) throw new Error('Motor: container obrigatório');
        if (!config || !Array.isArray(config.passos) || config.passos.length === 0) {
            throw new Error('Motor: config.passos obrigatório (array não vazio)');
        }

        const passos = config.passos;
        const simulador = config.simulador || null;
        const aoMudarPassoExterno = typeof config.aoMudarPasso === 'function'
            ? config.aoMudarPasso
            : null;

        let indiceAtual = 0;
        let interacaoOk = !passos[0].requerInteracao;
        let destruido = false;

        /* ---------- Estrutura visual ---------- */
        container.classList.add(CLASSE_PREFIXO + 'container');
        container.textContent = '';

        const areaSimulador = criarElemento('div', CLASSE_PREFIXO + 'simulador');
        areaSimulador.setAttribute('role', 'img');
        areaSimulador.setAttribute('aria-label', 'Simulador interativo');

        const areaTexto = criarElemento('div', CLASSE_PREFIXO + 'texto');
        areaTexto.setAttribute('aria-live', 'polite');

        const tituloEl = criarElemento('h2', CLASSE_PREFIXO + 'titulo');
        const corpoEl = criarElemento('div', CLASSE_PREFIXO + 'corpo');

        areaTexto.appendChild(tituloEl);
        areaTexto.appendChild(corpoEl);

        const barra = criarElemento('div', CLASSE_PREFIXO + 'barra');
        barra.setAttribute('role', 'toolbar');
        barra.setAttribute('aria-label', 'Controles do passo a passo');

        const btnAnterior = criarElemento('button', CLASSE_PREFIXO + 'btn ' + CLASSE_PREFIXO + 'btn--anterior', '← Anterior');
        btnAnterior.type = 'button';

        const indicador = criarElemento('span', CLASSE_PREFIXO + 'indicador');

        const btnProximo = criarElemento('button', CLASSE_PREFIXO + 'btn ' + CLASSE_PREFIXO + 'btn--proximo', 'Próximo →');
        btnProximo.type = 'button';

        barra.appendChild(btnAnterior);
        barra.appendChild(indicador);
        barra.appendChild(btnProximo);

        container.appendChild(areaSimulador);
        container.appendChild(areaTexto);
        container.appendChild(barra);

        /* ---------- Contexto passado ao simulador ---------- */
        const ctx = {
            get passoAtual() { return indiceAtual; },
            get totalPassos() { return passos.length; },
            interacaoConcluida: function () {
                if (destruido) return;
                interacaoOk = true;
                atualizarBotoes();
            },
            get elementoSimulador() { return areaSimulador; }
        };

        /* ---------- Renderização de um passo ---------- */
        function renderizarPasso(indice) {
            const passo = passos[indice];

            interacaoOk = !passo.requerInteracao;

            tituloEl.textContent = passo.titulo || ('Passo ' + (indice + 1));
            corpoEl.textContent = passo.texto || '';
            indicador.textContent = 'Passo ' + (indice + 1) + ' de ' + passos.length;

            /* Avisa o simulador (ele decide o que fazer) */
            if (simulador && typeof simulador.aoMudarPasso === 'function') {
                try {
                    simulador.aoMudarPasso(indice, passo, ctx);
                } catch (e) {
                    console.error('Motor: erro em simulador.aoMudarPasso', e);
                }
            }

            atualizarBotoes();

            if (aoMudarPassoExterno) {
                try { aoMudarPassoExterno(indice, passo); }
                catch (e) { console.error('Motor: erro em aoMudarPasso externo', e); }
            }
        }

        /* ---------- Estado dos botões ---------- */
        function atualizarBotoes() {
            btnAnterior.disabled = indiceAtual === 0;

            const ultimo = indiceAtual === passos.length - 1;
            const podeAvancar = !passos[indiceAtual].requerInteracao || interacaoOk;
            btnProximo.disabled = ultimo || !podeAvancar;

            /* Feedback visual quando falta interação */
            btnProximo.setAttribute(
                'title',
                (!ultimo && !podeAvancar)
                    ? 'Interaja com o simulador para continuar'
                    : ''
            );

            btnProximo.textContent = ultimo ? 'Fim' : 'Próximo →';
        }

        /* ---------- Transições ---------- */
        function irParaPasso(novoIndice) {
            if (destruido) return;
            if (novoIndice < 0 || novoIndice >= passos.length) return;
            if (novoIndice === indiceAtual) return;

            const passoAtual = passos[indiceAtual];
            if (typeof passoAtual.aoSair === 'function') {
                try { passoAtual.aoSair(ctx); }
                catch (e) { console.error('Motor: erro em aoSair', e); }
            }

            indiceAtual = novoIndice;

            const novoPasso = passos[indiceAtual];
            if (typeof novoPasso.aoEntrar === 'function') {
                try { novoPasso.aoEntrar(ctx); }
                catch (e) { console.error('Motor: erro em aoEntrar', e); }
            }

            renderizarPasso(indiceAtual);
        }

        function proximoPasso() {
            if (btnProximo.disabled) return;
            irParaPasso(indiceAtual + 1);
        }

        function passoAnterior() {
            if (btnAnterior.disabled) return;
            irParaPasso(indiceAtual - 1);
        }

        /* ---------- Listeners ---------- */
        function onProximo() { proximoPasso(); }
        function onAnterior() { passoAnterior(); }

        btnProximo.addEventListener('click', onProximo);
        btnAnterior.addEventListener('click', onAnterior);

        /* Atalhos de teclado: setas esquerda/direita */
        function onKeydown(e) {
            if (destruido) return;
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (e.key === 'ArrowRight') { e.preventDefault(); proximoPasso(); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); passoAnterior(); }
        }
        document.addEventListener('keydown', onKeydown);

        /* ---------- Inicialização do simulador ---------- */
        if (simulador && typeof simulador.criar === 'function') {
            try {
                simulador.criar(areaSimulador, ctx);
            } catch (e) {
                console.error('Motor: erro em simulador.criar', e);
            }
        }

        renderizarPasso(0);

        /* ---------- Destruição ---------- */
        function destruir() {
            if (destruido) return;
            destruido = true;

            btnProximo.removeEventListener('click', onProximo);
            btnAnterior.removeEventListener('click', onAnterior);
            document.removeEventListener('keydown', onKeydown);

            if (simulador && typeof simulador.destruir === 'function') {
                try { simulador.destruir(); }
                catch (e) { console.error('Motor: erro em simulador.destruir', e); }
            }

            container.textContent = '';
            container.classList.remove(CLASSE_PREFIXO + 'container');
        }

        /* ---------- API pública ---------- */
        return {
            proximoPasso: proximoPasso,
            passoAnterior: passoAnterior,
            irParaPasso: irParaPasso,
            interacaoConcluida: ctx.interacaoConcluida,
            destruir: destruir,
            get indiceAtual() { return indiceAtual; },
            get totalPassos() { return passos.length; }
        };
    }

    window.Motor = { criar: criar };
})();