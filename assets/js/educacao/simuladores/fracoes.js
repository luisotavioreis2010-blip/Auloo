/* ============================================================
   SIMULADOR: FRAÇÕES (v3 - Design Integrado)
   ============================================================ */
window.SimuladorFracoes = (function () {
    'use strict';

    let svg, containerEl;
    let totalFatias = 4;
    let fatiasPintadas = new Set();
    let ctxMotor = null;
    let interacaoAlvo = null;

    const COR_DOURADO = '#B8894A';
    const COR_FUNDO = '#E5D9C0';
    const COR_PINTADA = '#D9B878';

    function polarParaCartesiano(cx, cy, r, anguloGraus) {
        const rad = (anguloGraus - 90) * Math.PI / 180.0;
        return { x: cx + (r * Math.cos(rad)), y: cy + (r * Math.sin(rad)) };
    }

    function gerarCaminhoFatia(cx, cy, r, inicioAngulo, fimAngulo) {
        const inicio = polarParaCartesiano(cx, cy, r, fimAngulo);
        const fim = polarParaCartesiano(cx, cy, r, inicioAngulo);
        const largeArcFlag = fimAngulo - inicioAngulo <= 180 ? "0" : "1";
        return `M ${cx} ${cy} L ${inicio.x} ${inicio.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${fim.x} ${fim.y} Z`;
    }

    function desenhar() {
        if (!svg) return;
        svg.innerHTML = '';

        const cx = 150, cy = 150, r = 140;
        const anguloPorFatia = 360 / totalFatias;

        const borda = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        borda.setAttribute('cx', cx); borda.setAttribute('cy', cy); borda.setAttribute('r', r);
        borda.setAttribute('fill', COR_FUNDO);
        borda.setAttribute('stroke', COR_DOURADO);
        borda.setAttribute('stroke-width', '3');
        svg.appendChild(borda);

        for (let i = 0; i < totalFatias; i++) {
            const inicio = i * anguloPorFatia;
            const fim = (i + 1) * anguloPorFatia;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', gerarCaminhoFatia(cx, cy, r, inicio, fim));
            path.setAttribute('stroke', COR_DOURADO);
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', fatiasPintadas.has(i) ? COR_PINTADA : 'transparent');
            path.style.cursor = 'pointer';
            path.style.transition = 'fill 0.3s ease';

            path.addEventListener('click', () => {
                if (fatiasPintadas.has(i)) fatiasPintadas.delete(i);
                else fatiasPintadas.add(i);
                desenhar();
                verificarInteracao();
            });

            svg.appendChild(path);
        }

        const centro = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        centro.setAttribute('cx', cx); centro.setAttribute('cy', cy); centro.setAttribute('r', '4');
        centro.setAttribute('fill', COR_DOURADO);
        svg.appendChild(centro);
    }

    function verificarInteracao() {
        if (!interacaoAlvo || !ctxMotor) return;
        if (interacaoAlvo.tipo === 'pintar' && fatiasPintadas.size === interacaoAlvo.quantidade) {
            ctxMotor.interacaoConcluida();
        }
    }

    return {
        criar: function (container, ctx) {
            containerEl = container;
            container.innerHTML = '';

            const sliderWrapper = document.createElement('div');
            sliderWrapper.style.cssText = 'text-align: center; width: 100%; margin-bottom: 2rem;';

            const label = document.createElement('label');
            label.textContent = 'Número de fatias: ';
            
            const valorLabel = document.createElement('span');
            valorLabel.textContent = totalFatias;
            valorLabel.style.fontWeight = 'bold';
            valorLabel.style.color = 'var(--vinho)';

            const slider = document.createElement('input');
            slider.type = 'range'; slider.min = '2'; slider.max = '12'; slider.value = totalFatias;
            slider.style.marginTop = '0.5rem';
            slider.style.display = 'block';
            slider.style.margin = '0.5rem auto 0';

            slider.addEventListener('input', (e) => {
                totalFatias = parseInt(e.target.value);
                valorLabel.textContent = totalFatias;
                fatiasPintadas.clear();
                desenhar();
                
                if (interacaoAlvo && interacaoAlvo.tipo === 'slider' && totalFatias === interacaoAlvo.quantidade) {
                    if (ctxMotor) ctxMotor.interacaoConcluida();
                }
            });

            label.appendChild(valorLabel);
            sliderWrapper.appendChild(label);
            sliderWrapper.appendChild(slider);

            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 300 300');
            svg.style.cssText = 'width: 100%; max-width: 320px; height: auto; display: block; margin: 0 auto; filter: drop-shadow(0 10px 20px rgba(92,26,26,0.1));';

            container.appendChild(sliderWrapper);
            container.appendChild(svg);

            desenhar();
        },

        aoMudarPasso: function (indice, passo, ctx) {
            ctxMotor = ctx;
            interacaoAlvo = null;

            if (indice === 0) {
                totalFatias = 4; fatiasPintadas.clear();
            } else if (indice === 1) {
                totalFatias = 2; fatiasPintadas.clear();
                interacaoAlvo = { tipo: 'slider', quantidade: 4 };
            } else if (indice === 2) {
                totalFatias = 4; fatiasPintadas.clear(); fatiasPintadas.add(0);
            } else if (indice === 3) {
                totalFatias = 4; fatiasPintadas.clear();
                interacaoAlvo = { tipo: 'pintar', quantidade: 3 };
            } else if (indice === 4) {
                totalFatias = 8; fatiasPintadas.clear();
                for (let i = 0; i < 5; i++) fatiasPintadas.add(i);
            }
            
            const slider = containerEl.querySelector('input[type="range"]');
            if (slider) slider.value = totalFatias;
            const valorLabel = containerEl.querySelector('span');
            if (valorLabel) valorLabel.textContent = totalFatias;
            
            desenhar();
        },

        destruir: function () {
            if (containerEl) containerEl.innerHTML = '';
            svg = null; containerEl = null; ctxMotor = null; interacaoAlvo = null;
        }
    };
})();