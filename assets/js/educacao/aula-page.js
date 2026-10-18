(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const aulaId = params.get('id') || 'fracoes';
    const container = document.getElementById('aula-container');

    const aula = window.CATALOGO_AULAS.find(a => a.id === aulaId);

    if (!aula) {
        container.innerHTML = '<h2 style="color: #5C1A1A; font-family: serif; text-align: center;">Aula não encontrada.</h2>';
        return;
    }

    // Coloca o título da aula na aba do navegador
    document.title = aula.titulo + ' | Auloo';

    const nomeSimulador = 'Simulador' + aula.simulador.charAt(0).toUpperCase() + aula.simulador.slice(1);
    const simulador = window[nomeSimulador];

    if (!simulador) {
        container.innerHTML = '<h2 style="text-align:center; font-family: sans-serif;">Simulador em construção.</h2>';
        return;
    }

    const passos = [
        {
            titulo: 'Passo 1 — O que é uma fração?',
            texto: 'Imagine uma pizza inteira. Ela representa o número 1. Uma fração é quando dividimos essa pizza em partes iguais.',
            requerInteracao: false
        },
        {
            titulo: 'Passo 2 — Dividindo a pizza',
            texto: 'Use o controle deslizante para dividir a pizza em 4 partes iguais. Cada parte agora é chamada de "um quarto" (1/4).',
            requerInteracao: true
        },
        {
            titulo: 'Passo 3 — O Numerador',
            texto: 'A parte de cima da fração é o numerador. Ela diz quantas partes estamos pegando. Veja: 1 fatia pintada de 4 é o mesmo que 1/4.',
            requerInteracao: false
        },
        {
            titulo: 'Passo 4 — Sua vez!',
            texto: 'Agora clique nas fatias da pizza para pintar exatamente 3 partes de 4. Isso representa a fração 3/4.',
            requerInteracao: true
        },
        {
            titulo: 'Passo 5 — Frações Equivalentes',
            texto: 'Se dividirmos a pizza em 8 fatias e pegarmos 5, temos 5/8. Frações diferentes podem representar a mesma quantidade!',
            requerInteracao: false
        }
    ];

    Motor.criar(container, {
        passos: passos,
        simulador: simulador
    });
})();