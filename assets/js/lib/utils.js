/* ============================================================
   UTILS.JS — v4
   Helpers compartilhados (DOM, texto, storage, UI, cache HTTP)
   ============================================================ */
(function () {
    'use strict';

    /* ---------- DOM ---------- */
    function $(id) { return document.getElementById(id); }
    function $$(sel) { return document.querySelectorAll(sel); }

    function criar(tag, attrs, filhos) {
        var el = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === 'className') el.className = attrs[k];
                else if (k === 'textContent') el.textContent = attrs[k];
                else if (k === 'innerHTML') el.innerHTML = attrs[k];
                else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
                    el.addEventListener(k.substring(2).toLowerCase(), attrs[k]);
                } else el.setAttribute(k, attrs[k]);
            });
        }
        if (filhos) {
            (Array.isArray(filhos) ? filhos : [filhos]).forEach(function (f) {
                if (typeof f === 'string') el.appendChild(document.createTextNode(f));
                else if (f) el.appendChild(f);
            });
        }
        return el;
    }

    function limpar(el) { if (el) while (el.firstChild) el.removeChild(el.firstChild); }

    /* ---------- Texto ---------- */
    function truncar(t, limite) {
        limite = limite || 100;
        if (!t) return '';
        return t.length <= limite ? t : t.substring(0, limite).trim() + '...';
    }

    function escapar(t) {
        if (!t) return '';
        var d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }

    function slug(t) {
        if (!t) return '';
        return t.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    /* ---------- Datas ---------- */
    function formatarData(data) {
        if (!data) return '';
        var d;
        if (typeof data === 'string') {
            var m = data.match(/^(\d{4})-(\d{2})-(\d{2})/);
            d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(data);
        } else d = data;
        return String(d.getDate()).padStart(2, '0') + '/' +
               String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    }

    function tempoRelativo(data) {
        if (!data) return '';
        var d = new Date(data);
        var s = Math.floor((Date.now() - d.getTime()) / 1000);
        if (s < 60) return 'agora';
        if (s < 3600) return Math.floor(s / 60) + 'min';
        if (s < 86400) return Math.floor(s / 3600) + 'h';
        if (s < 604800) return Math.floor(s / 86400) + 'd';
        return formatarData(d);
    }

    /* ---------- Storage (namespace) ---------- */
    var NS = 'auloo:';
    function salvarLocal(chave, valor) {
        try { localStorage.setItem(NS + chave, JSON.stringify(valor)); return true; }
        catch (e) { return false; }
    }
    function lerLocal(chave, padrao) {
        try {
            var v = localStorage.getItem(NS + chave);
            return v ? JSON.parse(v) : padrao;
        } catch (e) { return padrao; }
    }
    function removerLocal(chave) {
        try { localStorage.removeItem(NS + chave); } catch (e) { /* ignora */ }
    }

    /* ---------- Cache HTTP com TTL ---------- */
    var CACHE_PREFIXO = 'auloo:cache:';
    var cacheMemoria = {};

    function cacheGet(chave, ttlMs) {
        var agora = Date.now();
        var emMem = cacheMemoria[chave];
        if (emMem && agora - emMem.ts < ttlMs) return emMem.valor;

        try {
            var bruto = localStorage.getItem(CACHE_PREFIXO + chave);
            if (bruto) {
                var obj = JSON.parse(bruto);
                if (agora - obj.ts < ttlMs) {
                    cacheMemoria[chave] = obj;
                    return obj.valor;
                }
                localStorage.removeItem(CACHE_PREFIXO + chave);
            }
        } catch (e) { /* ignora */ }
        return null;
    }

    function cacheSet(chave, valor) {
        var obj = { ts: Date.now(), valor: valor };
        cacheMemoria[chave] = obj;
        try { localStorage.setItem(CACHE_PREFIXO + chave, JSON.stringify(obj)); }
        catch (e) { /* quota cheia: ignora */ }
    }

    /* FIX: permite invalidar cache após mutations */
    function cacheLimpar(chave) {
        if (chave) {
            delete cacheMemoria[chave];
            try { localStorage.removeItem(CACHE_PREFIXO + chave); } catch (e) {}
            return;
        }
        cacheMemoria = {};
        try {
            Object.keys(localStorage)
                .filter(function (k) { return k.indexOf(CACHE_PREFIXO) === 0; })
                .forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) {}
    }

    /* ---------- URL ---------- */
    function getParametro(nome) {
        return new URLSearchParams(window.location.search).get(nome);
    }

    /* ---------- Performance ---------- */
    function debounce(fn, espera) {
        var t = null;
        espera = espera || 300;
        return function () {
            var args = arguments, ctx = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(ctx, args); }, espera);
        };
    }

    /* ---------- UI ---------- */
    function mostrarLoading(botao) {
        if (!botao) return;
        botao.disabled = true;
        botao.dataset.textoOriginal = botao.textContent;
        botao.textContent = '';
        botao.appendChild(criar('span', { className: 'button-loading' }));
    }

    function restaurarBotao(botao) {
        if (!botao) return;
        botao.disabled = false;
        if (botao.dataset.textoOriginal) {
            botao.textContent = botao.dataset.textoOriginal;
            delete botao.dataset.textoOriginal;
        }
    }

    function iniciais(nome) {
        var p = String(nome || 'U').trim().split(/\s+/);
        var a = (p[0] || 'U').charAt(0).toUpperCase();
        var b = p.length > 1 ? (p[p.length - 1] || '').charAt(0).toUpperCase() : '';
        return a + b;
    }

    function renderizarAvatar(container, avatarUrl, nome) {
        if (!container) return;
        container.textContent = '';

        if (!avatarUrl || avatarUrl === 'null') {
            var span = document.createElement('span');
            span.className = 'avatar-iniciais';
            span.textContent = iniciais(nome);
            container.appendChild(span);
            return;
        }

        var img = document.createElement('img');
        img.className = 'foto-perfil';
        img.alt = 'Foto de perfil';
        img.referrerPolicy = 'no-referrer';
        img.loading = 'lazy';
        img.src = avatarUrl;
        img.onerror = function () {
            img.remove();
            var s = document.createElement('span');
            s.className = 'avatar-iniciais';
            s.textContent = iniciais(nome);
            container.appendChild(s);
        };
        container.appendChild(img);
    }

    /* FIX: toast acessível com aria-live */
    function toast(mensagem, ehErro) {
        var el = document.createElement('div');
        el.setAttribute('role', ehErro ? 'alert' : 'status');
        el.setAttribute('aria-live', ehErro ? 'assertive' : 'polite');
        el.style.cssText = [
            'position:fixed', 'bottom:2rem', 'left:50%',
            'transform:translateX(-50%)', 'padding:0.9rem 1.5rem',
            'background:' + (ehErro ? '#B23A2E' : '#2E7D4F'),
            'color:#fff', 'font-family:Poppins,sans-serif', 'font-size:0.85rem',
            'border-radius:4px', 'box-shadow:0 12px 32px rgba(0,0,0,0.25)',
            'z-index:9999', 'opacity:0', 'transition:opacity 0.3s',
            'max-width:calc(100vw - 2rem)', 'text-align:center'
        ].join(';');
        el.textContent = mensagem;
        document.body.appendChild(el);
        requestAnimationFrame(function () { el.style.opacity = '1'; });
        setTimeout(function () {
            el.style.opacity = '0';
            setTimeout(function () { el.remove(); }, 300);
        }, 2600);
    }

    /* ---------- Fetch com timeout e cache opcional ---------- */
    function fetchComTimeout(url, opcoes, timeoutMs) {
        opcoes = opcoes || {};
        timeoutMs = timeoutMs || 12000;
        return new Promise(function (resolve, reject) {
            var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = setTimeout(function () {
                if (ctrl) ctrl.abort();
                reject(new Error('Timeout'));
            }, timeoutMs);

            var cfg = Object.assign({}, opcoes);
            if (ctrl) cfg.signal = ctrl.signal;

            fetch(url, cfg)
                .then(function (r) { clearTimeout(timer); resolve(r); })
                .catch(function (e) { clearTimeout(timer); reject(e); });
        });
    }

    window.utils = {
        $: $, $$: $$, criar: criar, limpar: limpar,
        truncar: truncar, escapar: escapar, slug: slug,
        formatarData: formatarData, tempoRelativo: tempoRelativo,
        salvarLocal: salvarLocal, lerLocal: lerLocal, removerLocal: removerLocal,
        cacheGet: cacheGet, cacheSet: cacheSet, cacheLimpar: cacheLimpar,
        getParametro: getParametro, debounce: debounce,
        mostrarLoading: mostrarLoading, restaurarBotao: restaurarBotao,
        iniciais: iniciais, renderizarAvatar: renderizarAvatar, toast: toast,
        fetchComTimeout: fetchComTimeout
    };
})();