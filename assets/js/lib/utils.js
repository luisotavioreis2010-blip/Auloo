/* ============================================================
   UTILS.JS
   Helpers compartilhados por todas as páginas
   ============================================================ */
(function () {
    'use strict';

    /* ---------- DOM ---------- */

    function $(id) {
        return document.getElementById(id);
    }

    function $$(seletor) {
        return document.querySelectorAll(seletor);
    }

    function criar(tag, atributos, filhos) {
        var el = document.createElement(tag);

        if (atributos) {
            Object.keys(atributos).forEach(function (chave) {
                if (chave === 'className') {
                    el.className = atributos[chave];
                } else if (chave === 'textContent') {
                    el.textContent = atributos[chave];
                } else if (chave === 'innerHTML') {
                    el.innerHTML = atributos[chave];
                } else if (chave.indexOf('on') === 0 && typeof atributos[chave] === 'function') {
                    el.addEventListener(chave.substring(2).toLowerCase(), atributos[chave]);
                } else {
                    el.setAttribute(chave, atributos[chave]);
                }
            });
        }

        if (filhos) {
            (Array.isArray(filhos) ? filhos : [filhos]).forEach(function (filho) {
                if (typeof filho === 'string') {
                    el.appendChild(document.createTextNode(filho));
                } else if (filho) {
                    el.appendChild(filho);
                }
            });
        }

        return el;
    }

    function limpar(el) {
        if (!el) return;
        while (el.firstChild) el.removeChild(el.firstChild);
    }

    /* ---------- Texto ---------- */

    function truncar(texto, limite) {
        limite = limite || 100;
        if (!texto) return '';
        if (texto.length <= limite) return texto;
        return texto.substring(0, limite).trim() + '...';
    }

    function escapar(texto) {
        if (!texto) return '';
        var div = document.createElement('div');
        div.textContent = texto;
        return div.innerHTML;
    }

    function slug(texto) {
        if (!texto) return '';
        return texto
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /* ---------- Datas ---------- */

    function formatarData(data) {
        if (!data) return '';
        var d;
        if (typeof data === 'string') {
            var match = data.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (match) {
                d = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
            } else {
                d = new Date(data);
            }
        } else {
            d = data;
        }
        var dia = String(d.getDate()).padStart(2, '0');
        var mes = String(d.getMonth() + 1).padStart(2, '0');
        var ano = d.getFullYear();
        return dia + '/' + mes + '/' + ano;
    }

    function tempoRelativo(data) {
        if (!data) return '';
        var d;
        if (typeof data === 'string') {
            var match = data.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (match) {
                d = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
            } else {
                d = new Date(data);
            }
        } else {
            d = data;
        }
        var diff = Math.floor((Date.now() - d.getTime()) / 1000);
        if (diff < 60) return 'agora';
        if (diff < 3600) return Math.floor(diff / 60) + 'min';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h';
        if (diff < 604800) return Math.floor(diff / 86400) + 'd';
        return formatarData(d);
    }

    /* ---------- Storage ---------- */

    function salvarLocal(chave, valor) {
        try {
            localStorage.setItem(chave, JSON.stringify(valor));
            return true;
        } catch (e) {
            console.warn('Erro ao salvar:', e);
            return false;
        }
    }

    function lerLocal(chave, padrao) {
        try {
            var valor = localStorage.getItem(chave);
            return valor ? JSON.parse(valor) : padrao;
        } catch (e) {
            return padrao;
        }
    }

    function removerLocal(chave) {
        try {
            localStorage.removeItem(chave);
        } catch (e) {}
    }

    /* ---------- URL ---------- */

    function getParametro(nome) {
        var params = new URLSearchParams(window.location.search);
        return params.get(nome);
    }

    /* ---------- Debounce ---------- */

    function debounce(funcao, espera) {
        var timer = null;
        espera = espera || 300;
        return function () {
            var args = arguments;
            var contexto = this;
            clearTimeout(timer);
            timer = setTimeout(function () {
                funcao.apply(contexto, args);
            }, espera);
        };
    }

    /* ---------- Loading ---------- */

    function mostrarLoading(botao) {
        if (!botao) return;
        botao.disabled = true;
        botao.dataset.textoOriginal = botao.textContent;
        botao.textContent = '';
        var spinner = criar('span', { className: 'button-loading' });
        botao.appendChild(spinner);
    }

    function restaurarBotao(botao) {
        if (!botao) return;
        botao.disabled = false;
        if (botao.dataset.textoOriginal) {
            botao.textContent = botao.dataset.textoOriginal;
            delete botao.dataset.textoOriginal;
        }
    }

    /* ---------- API pública ---------- */

    window.utils = {
        $: $,
        $$: $$,
        criar: criar,
        limpar: limpar,
        truncar: truncar,
        escapar: escapar,
        slug: slug,
        formatarData: formatarData,
        tempoRelativo: tempoRelativo,
        salvarLocal: salvarLocal,
        lerLocal: lerLocal,
        removerLocal: removerLocal,
        getParametro: getParametro,
        debounce: debounce,
        mostrarLoading: mostrarLoading,
        restaurarBotao: restaurarBotao
    };

    console.log('utils.js carregado');
})();