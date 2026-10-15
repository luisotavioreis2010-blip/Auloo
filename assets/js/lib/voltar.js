/* Botao "Voltar" das paginas publicas (portfolio, termos, privacidade).
   Origem vem de ?de=estante|login e fica guardada na sessao, para o
   botao continuar certo ao navegar entre as paginas. */
(function () {
    'use strict';

    var DESTINOS = {
        estante: { url: '/estante.html', rotulo: 'Voltar à estante' },
        login:     { url: '/login.html',     rotulo: 'Voltar ao login' }
    };
    var CHAVE = 'acervo-origem';

    var origem = null;
    try {
        var param = new URLSearchParams(window.location.search).get('de');
        if (param && DESTINOS[param]) sessionStorage.setItem(CHAVE, param);
        var salva = sessionStorage.getItem(CHAVE);
        if (salva && DESTINOS[salva]) origem = salva;
    } catch (e) {
        var p = new URLSearchParams(window.location.search).get('de');
        if (p && DESTINOS[p]) origem = p;
    }

    document.documentElement.setAttribute('data-origem', origem || 'nenhuma');

    var botoes = document.querySelectorAll('[data-voltar]');
    Array.prototype.forEach.call(botoes, function (el) {
        var destino = origem ? DESTINOS[origem] : { url: '/', rotulo: 'Voltar ao inÃ­cio' };
        el.setAttribute('href', destino.url);
        el.setAttribute('aria-label', destino.rotulo);
        el.style.whiteSpace = 'nowrap';
        var texto = el.querySelector('[data-voltar-texto]');
        if (texto) {
            texto.textContent = destino.rotulo;
            texto.style.whiteSpace = 'nowrap';
        }
    });

    /* Links que levam as paginas entre si mantem a origem. */
    var links = document.querySelectorAll('a[data-manter-origem]');
    Array.prototype.forEach.call(links, function (a) {
        if (!origem) return;
        var url = a.getAttribute('href').split('?')[0];
        a.setAttribute('href', url + '?de=' + origem);
    });
})();
