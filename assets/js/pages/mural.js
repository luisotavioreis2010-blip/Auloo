/* ==============================================
   MURAL.JS — Lógica da Página do Mural
   ============================================== */
(function() {
    'use strict';

    // Expande o texto do post ao clicar em "Continuar Lendo"
    window.expandirTexto = function(idTexto, botao) {
        const texto = document.getElementById(idTexto);
        if (texto) {
            texto.classList.add('expandido');
            botao.style.display = 'none'; // Esconde o botão
        }
    };
})();