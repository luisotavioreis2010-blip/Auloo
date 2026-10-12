/* ==============================================
   DASHBOARD.JS — v21 (arquitetura limpa)

   Princípio:
   - A ficha do leitor e' um overlay. Ela nao reage a resize/teclado.
   - O layout do dashboard so' muda quando o USUARIO muda (abrir/fechar gaveta, ficha).
   - O viewport e' sincronizado 1x, e depois so' quando ha' mudanca real (fora de foco).

   Secoes:
   1. Estado
   2. Utilitarios de tela
   3. Sincronizacao de viewport (unica fonte da verdade)
   4. Utilidades
   5. Perfil (carregar / renderizar / logout)
   6. Mensagens e containers expansivos
   7. Acoes do perfil (nome / senha / foto)
   8. Ficha do leitor (abrir / fechar / overlay)
   9. Gaveta lateral (abrir / fechar)
   10. Calendario
   11. Auth (OAuth listener)
   12. Inicializacao
   ============================================== */
(function () {
    'use strict';

    /* ==============================================
       1. ESTADO
       ============================================== */
    var PAGINA_LOGIN = '/login.html';

    var CHAVES_LOGOUT = ['auloo_user', 'auloo_saved_email'];
    var TIMEOUT_SIGNOUT_MS = 3000;
    var TAMANHO_MAX_FOTO = 5 * 1024 * 1024;
    var EXTENSOES_FOTO = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp'
    };

    var IDS_CONTAINERS = [
        'container-editar-nome',
        'container-editar-senha',
        'container-saiba-mais'
    ];

    var MESES = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
                 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    var DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terca-feira', 'Quarta-feira',
                       'Quinta-feira', 'Sexta-feira', 'Sabado'];

    /* Breakpoint unico: abaixo disso o dashboard esta em modo compacto */
    var mqCompacto = window.matchMedia('(max-width: 1366px)');

    /* Estado do usuario (nunca lido de classes CSS) */
    var perfil = {
        usuario: null,
        nome: 'Usuario',
        email: '',
        avatarUrl: null
    };

    var estado = {
        fichaAberta: false,
        gavetaAberta: false
    };

    function $(id) { return document.getElementById(id); }

    function getDb() {
        return window.supabaseClient ||
               (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    /* ==============================================
       2. UTILITARIOS DE TELA
       ============================================== */

    /* Ha um campo de texto focado? */
    function campoEmFoco() {
        var ativo = document.activeElement;
        return !!ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA');
    }

    /* A viewport atual e' mais larga do que alta? */
    function ehPaisagem() {
        return window.innerWidth > window.innerHeight;
    }

    /* Escreve --viewport-h e data-layout no <html> */
    function aplicarViewport() {
        var raiz = document.documentElement;
        raiz.style.setProperty('--viewport-h', window.innerHeight + 'px');
        raiz.setAttribute('data-layout', ehPaisagem() ? 'row' : 'stacked');
    }

    /* Largura da ficha no modo "row": da esquerda do calendario ate a borda */
    function aplicarLarguraFichaRow() {
        var calendario = document.querySelector('.calendario-container');
        if (!calendario) return;
        var esquerda = calendario.getBoundingClientRect().left;
        document.documentElement.style.setProperty(
            '--ficha-row-w',
            (window.innerWidth - esquerda) + 'px'
        );
    }

    /* Reseta scroll de tudo (usado ao trocar de layout) */
    function resetarScroll() {
        window.scrollTo(0, 0);
        var main = document.querySelector('.dashboard-main');
        var ficha = $('sidebar-perfil');
        if (main) main.scrollTop = 0;
        if (ficha) ficha.scrollTop = 0;
    }

    /* ==============================================
       3. SINCRONIZACAO DE VIEWPORT
       ============================================== */

    /*
       Esta e' a UNICA funcao que escreve --viewport-h e data-layout.
       Ela e' chamada em 3 situacoes especificas:
         1. No boot
         2. Quando a janela muda de tamanho E o usuario NAO esta digitando
         3. Quando a orientacao muda de verdade

       Ela NAO e' chamada em:
         - focusin / focusout
         - teclado virtual abrindo/fechando
         - resize causado por teclado
    */

    var ultimaLargura = 0;
    var ultimaAltura = 0;
    var timerResize = null;
    var timerFimResize = null;

    function sincronizarViewport(forcar) {
        /* Nunca mexe no layout enquanto o usuario esta digitando */
        if (!forcar && campoEmFoco()) return;

        var larguraAtual = window.innerWidth;
        var alturaAtual = window.innerHeight;

        /* Ignora mudancas puramente de altura (teclado virtual) */
        var larguraMudou = larguraAtual !== ultimaLargura;
        var orientacaoMudou = (larguraAtual > alturaAtual) !== (ultimaLargura > ultimaAltura);

        ultimaLargura = larguraAtual;
        ultimaAltura = alturaAtual;

        if (!forcar && !larguraMudou && !orientacaoMudou) return;

        aplicarViewport();
        aplicarLarguraFichaRow();
    }

    function ligarSincronizacaoViewport() {
        /* Estado inicial */
        ultimaLargura = window.innerWidth;
        ultimaAltura = window.innerHeight;
        aplicarViewport();
        aplicarLarguraFichaRow();

        /* Resize com debounce */
        window.addEventListener('resize', function () {
            /* Se ha campo focado, NADA acontece */
            if (campoEmFoco()) return;

            clearTimeout(timerResize);
            clearTimeout(timerFimResize);

            /* Marca o <html> para desligar transicoes durante o resize */
            document.documentElement.classList.add('redimensionando');

            timerResize = setTimeout(function () {
                sincronizarViewport(false);
            }, 150);

            /* Depois que o usuario para de redimensionar, tira a classe */
            timerFimResize = setTimeout(function () {
                document.documentElement.classList.remove('redimensionando');
            }, 400);
        });

        /* Orientation change: o navegador demora a atualizar as dimensoes */
        window.addEventListener('orientationchange', function () {
            [100, 300, 600].forEach(function (ms) {
                setTimeout(function () {
                    if (campoEmFoco()) return;
                    sincronizarViewport(true);
                    resetarScroll();
                }, ms);
            });
        });
    }

    /* ==============================================
       4. UTILIDADES
       ============================================== */
    function verificar(resultado) {
        if (resultado && resultado.error) throw resultado.error;
        return resultado ? resultado.data : null;
    }

    function formatarNome(nome, email) {
        var texto = (nome || '').trim() || email || '';
        if (texto.indexOf('@') !== -1) texto = texto.split('@')[0];
        if (!texto) return 'Usuario';
        return texto.charAt(0).toUpperCase() + texto.slice(1);
    }

    function criarIniciais(nome) {
        var partes = (nome || 'Usuario').trim().split(/\s+/);
        var primeira = partes[0].charAt(0).toUpperCase();
        var ultima = partes.length > 1
            ? partes[partes.length - 1].charAt(0).toUpperCase()
            : '';
        var span = document.createElement('span');
        span.className = 'avatar-iniciais';
        span.textContent = primeira + ultima;
        return span;
    }

    function renderizarAvatar(container, avatarUrl, nome) {
        if (!container) return;
        container.textContent = '';

        if (!avatarUrl || avatarUrl === 'null') {
            container.appendChild(criarIniciais(nome));
            return;
        }

        var img = document.createElement('img');
        img.className = 'foto-perfil';
        img.alt = 'Foto de perfil';
        img.onerror = function () {
            img.remove();
            container.appendChild(criarIniciais(nome));
        };
        img.src = avatarUrl;
        container.appendChild(img);
    }

    async function executarAcao(botao, acao) {
        if (botao.disabled) return;
        botao.disabled = true;
        try {
            await acao();
        } catch (erro) {
            mostrarMensagem('Erro: ' + (erro && erro.message ? erro.message : erro), 'erro');
        } finally {
            botao.disabled = false;
        }
    }

    /* ==============================================
       5. PERFIL
       ============================================== */
    function renderizarPerfil() {
        renderizarAvatar($('perfil-usuario'), perfil.avatarUrl, perfil.nome);
        renderizarAvatar($('sidebar-perfil-foto'), perfil.avatarUrl, perfil.nome);

        var nome = $('sidebar-perfil-nome');
        var email = $('sidebar-perfil-email');
        if (nome) nome.textContent = perfil.nome;
        if (email) email.textContent = perfil.email;
    }

    function irParaLogin() {
        window.location.href = PAGINA_LOGIN;
    }

    function aplicarDadosPerfil(usuario) {
        var meta = usuario.user_metadata || {};
        perfil.usuario = usuario;
        perfil.email = usuario.email || '';
        perfil.nome = formatarNome(meta.full_name || meta.name, perfil.email);
        perfil.avatarUrl = meta.avatar_url || meta.picture || null;
        renderizarPerfil();
    }

    async function carregarPerfil() {
        var db = getDb();
        if (!db) { irParaLogin(); return; }

        try {
            var sessao = verificar(await db.auth.getSession());
            if (!sessao || !sessao.session) { irParaLogin(); return; }

            var usuario = sessao.session.user;
            aplicarDadosPerfil(usuario);

            /* Busca dados atualizados do banco (opcional) */
            var consulta = await db.from('profiles')
                .select('full_name, avatar_url')
                .eq('id', usuario.id)
                .maybeSingle();

            if (!consulta.error && consulta.data) {
                if (consulta.data.full_name) {
                    perfil.nome = formatarNome(consulta.data.full_name, perfil.email);
                }
                if (consulta.data.avatar_url) {
                    perfil.avatarUrl = consulta.data.avatar_url;
                }
                renderizarPerfil();
            }
        } catch (erro) {
            console.error('Erro ao carregar perfil:', erro);
        }
    }

    async function fazerLogout() {
        var db = getDb();
        try {
            if (db) {
                await Promise.race([
                    db.auth.signOut(),
                    new Promise(function (r) { setTimeout(r, TIMEOUT_SIGNOUT_MS); })
                ]);
            }
        } catch (erro) {
            console.warn('Erro no signOut:', erro);
        }

        try {
            CHAVES_LOGOUT.forEach(function (c) { localStorage.removeItem(c); });
            Object.keys(localStorage)
                .filter(function (c) {
                    return c.indexOf('sb-') === 0 || c.indexOf('auloo-auth') === 0;
                })
                .forEach(function (c) { localStorage.removeItem(c); });
            sessionStorage.clear();
        } catch (erro) {
            console.warn('Erro ao limpar storage:', erro);
        }

        irParaLogin();
    }

    /* ==============================================
       6. MENSAGENS E CONTAINERS EXPANSIVOS
       ============================================== */
    var temporizadorMensagem = null;

    function mostrarMensagem(texto, tipo) {
        tipo = tipo || 'sucesso';
        clearTimeout(temporizadorMensagem);

        var anterior = $('mensagem-sidebar');
        if (anterior) anterior.remove();

        var msg = document.createElement('div');
        msg.id = 'mensagem-sidebar';
        msg.className = 'mensagem-sidebar mensagem-sidebar--' + tipo;
        msg.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
        msg.textContent = texto;

        var referencia = $('container-editar-senha');
        if (referencia && referencia.parentNode) {
            referencia.parentNode.insertBefore(msg, referencia);
        } else {
            var menu = document.querySelector('.ficha-menu');
            if (menu) menu.insertBefore(msg, menu.firstChild);
        }

        temporizadorMensagem = setTimeout(function () {
            msg.classList.add('saindo');
            setTimeout(function () { msg.remove(); }, 500);
        }, 3000);
    }

    function fecharContainer(id) {
        var container = $(id);
        if (container) {
            container.style.display = 'none';
            container.classList.remove('aberto');
        }
    }

    function fecharTodosContainers() {
        IDS_CONTAINERS.forEach(fecharContainer);
    }

    function alternarContainer(id) {
        var alvo = $(id);
        if (!alvo) return;

        var jaAberto = alvo.classList.contains('aberto') || alvo.style.display === 'block';
        fecharTodosContainers();

        if (!jaAberto) {
            alvo.style.display = 'block';
            alvo.classList.add('aberto');
        }
    }

    /* ==============================================
       7. ACOES DO PERFIL
       ============================================== */
    async function salvarNome() {
        var input = $('input-novo-nome');
        var novoNome = input ? input.value.trim() : '';
        if (!novoNome) { mostrarMensagem('Digite um nome valido!', 'erro'); return; }

        var db = getDb();
        if (!db || !perfil.usuario) {
            mostrarMensagem('Erro: usuario nao autenticado!', 'erro');
            return;
        }

        verificar(await db.auth.updateUser({ data: { full_name: novoNome } }));
        verificar(await db.from('profiles').upsert({
            id: perfil.usuario.id,
            full_name: novoNome,
            email: perfil.email,
            updated_at: new Date().toISOString()
        }));

        perfil.nome = formatarNome(novoNome, perfil.email);
        renderizarPerfil();
        fecharContainer('container-editar-nome');
        mostrarMensagem('Nome atualizado!');
    }

    async function alterarSenha() {
        var inputAtual = $('input-senha-atual');
        var inputNova = $('input-senha-nova');
        var senhaAtual = inputAtual ? inputAtual.value : '';
        var senhaNova = inputNova ? inputNova.value : '';

        if (!senhaAtual || !senhaNova) {
            mostrarMensagem('Preencha todos os campos!', 'erro');
            return;
        }
        if (senhaNova.length < 8) {
            mostrarMensagem('Senha deve ter 8+ caracteres!', 'erro');
            return;
        }

        var db = getDb();
        if (!db || !perfil.usuario) {
            mostrarMensagem('Erro de configuracao!', 'erro');
            return;
        }

        var login = await db.auth.signInWithPassword({
            email: perfil.email,
            password: senhaAtual
        });

        if (login.error) {
            var credenciaisInvalidas =
                login.error.code === 'invalid_credentials' ||
                login.error.status === 400;
            mostrarMensagem(
                credenciaisInvalidas
                    ? 'Senha atual incorreta!'
                    : 'Erro: ' + login.error.message,
                'erro'
            );
            return;
        }

        verificar(await db.auth.updateUser({ password: senhaNova }));

        if (inputAtual) inputAtual.value = '';
        if (inputNova) inputNova.value = '';
        fecharContainer('container-editar-senha');
        mostrarMensagem('Senha atualizada!');
    }

    async function enviarFoto(arquivo) {
        var db = getDb();
        if (!db || !perfil.usuario) {
            mostrarMensagem('Erro: usuario nao autenticado!', 'erro');
            return;
        }

        var extensao = EXTENSOES_FOTO[arquivo.type];
        if (!extensao) { mostrarMensagem('Formato nao suportado!', 'erro'); return; }
        if (arquivo.size > TAMANHO_MAX_FOTO) {
            mostrarMensagem('Imagem muito grande! Maximo 5MB.', 'erro');
            return;
        }

        try {
            mostrarMensagem('Enviando foto...');

            var caminho = perfil.usuario.id +
                          '/avatar_' + perfil.usuario.id + '_' + Date.now() + '.' + extensao;

            verificar(await db.storage.from('avatars').upload(caminho, arquivo, {
                cacheControl: '3600',
                contentType: arquivo.type
            }));

            var urlPublica = db.storage.from('avatars').getPublicUrl(caminho).data.publicUrl;

            verificar(await db.auth.updateUser({ data: { avatar_url: urlPublica } }));
            verificar(await db.from('profiles').upsert({
                id: perfil.usuario.id,
                avatar_url: urlPublica,
                updated_at: new Date().toISOString()
            }));

            perfil.avatarUrl = urlPublica;
            renderizarPerfil();
            mostrarMensagem('Foto atualizada!');
        } catch (erro) {
            mostrarMensagem('Erro: ' + (erro && erro.message ? erro.message : erro), 'erro');
        }
    }

    function ligarBotoesPerfil() {
        /* Sair */
        var btnSair = $('btn-sair');
        if (btnSair) {
            btnSair.addEventListener('click', function () {
                btnSair.disabled = true;
                fazerLogout();
            });
        }

        /* Mudar foto */
        var btnEditarFoto = $('btn-editar-foto');
        var inputFoto = $('input-foto');
        if (btnEditarFoto && inputFoto) {
            btnEditarFoto.addEventListener('click', function () {
                fecharTodosContainers();
                inputFoto.click();
            });
            inputFoto.addEventListener('change', function () {
                var arquivo = inputFoto.files[0];
                inputFoto.value = '';
                if (arquivo) enviarFoto(arquivo);
            });
        }

        /* Editar nome */
        var btnEditarNome = $('btn-editar-nome');
        if (btnEditarNome) {
            btnEditarNome.addEventListener('click', function (e) {
                e.preventDefault();
                alternarContainer('container-editar-nome');
                var input = $('input-novo-nome');
                if (input) input.value = perfil.nome;
            });
        }

        /* Salvar nome */
        var btnSalvarNome = $('btn-salvar-nome');
        if (btnSalvarNome) {
            btnSalvarNome.addEventListener('click', function (e) {
                e.preventDefault();
                executarAcao(btnSalvarNome, salvarNome);
            });
        }

        /* Editar senha */
        var btnEditarSenha = $('btn-editar-senha');
        if (btnEditarSenha) {
            btnEditarSenha.addEventListener('click', function (e) {
                e.preventDefault();
                alternarContainer('container-editar-senha');
                var atual = $('input-senha-atual');
                var nova = $('input-senha-nova');
                if (atual) atual.value = '';
                if (nova) nova.value = '';
            });
        }

        /* Confirmar senha */
        var btnConfirmarSenha = $('btn-confirmar-senha');
        if (btnConfirmarSenha) {
            btnConfirmarSenha.addEventListener('click', function (e) {
                e.preventDefault();
                executarAcao(btnConfirmarSenha, alterarSenha);
            });
        }

        /* Saiba mais */
        var btnSaibaMais = $('btn-saiba-mais');
        if (btnSaibaMais) {
            btnSaibaMais.addEventListener('click', function (e) {
                e.preventDefault();
                alternarContainer('container-saiba-mais');
            });
        }

        /* Olhos de senha */
        var olhos = document.querySelectorAll('.btn-olho-senha');
        Array.prototype.forEach.call(olhos, function (botao) {
            botao.addEventListener('click', function () {
                var input = $(botao.getAttribute('data-target'));
                var aberto = botao.querySelector('.icone-olho-aberto');
                var fechado = botao.querySelector('.icone-olho-fechado');
                if (!input || !aberto || !fechado) return;

                var mostrar = input.type === 'password';
                input.type = mostrar ? 'text' : 'password';
                aberto.style.display = mostrar ? 'block' : 'none';
                fechado.style.display = mostrar ? 'none' : 'block';
            });
        });
    }

    /* ==============================================
       8. FICHA DO LEITOR (abrir / fechar / overlay)
       ============================================== */

    function atualizarOverlay() {
        var overlay = $('gaveta-overlay');
        if (!overlay) return;

        var deveMostrar = estado.gavetaAberta ||
                          (mqCompacto.matches && estado.fichaAberta);

        overlay.classList.toggle('ativa', deveMostrar);
    }

    function abrirFicha() {
        var ficha = $('sidebar-perfil');
        if (!ficha) return;

        estado.fichaAberta = true;
        ficha.classList.add('ativa');
        document.body.classList.add('ficha-aberta');
        aplicarLarguraFichaRow();
        atualizarOverlay();

        var perfilBotao = $('perfil-botao');
        if (perfilBotao) perfilBotao.setAttribute('aria-expanded', 'true');
    }

    function fecharFicha() {
        var ficha = $('sidebar-perfil');
        if (!ficha) return;

        estado.fichaAberta = false;
        ficha.classList.remove('ativa');
        document.body.classList.remove('ficha-aberta');
        fecharTodosContainers();
        atualizarOverlay();

        var perfilBotao = $('perfil-botao');
        if (perfilBotao) perfilBotao.setAttribute('aria-expanded', 'false');

        /* Blur fora da ficha, se necessario */
        if (ficha.contains(document.activeElement)) {
            document.activeElement.blur();
        }
    }

    function alternarFicha() {
        if (estado.fichaAberta) fecharFicha();
        else abrirFicha();
    }

    /* ==============================================
       9. GAVETA LATERAL (abrir / fechar)
       ============================================== */
    function abrirGaveta() {
        var sidebar = $('sidebar');
        if (!sidebar) return;

        estado.gavetaAberta = true;
        sidebar.classList.add('aberta');
        atualizarOverlay();

        var btnHamburger = $('btn-hamburger');
        if (btnHamburger) btnHamburger.setAttribute('aria-expanded', 'true');
    }

    function fecharGaveta() {
        var sidebar = $('sidebar');
        if (!sidebar) return;

        estado.gavetaAberta = false;
        sidebar.classList.remove('aberta');
        atualizarOverlay();

        var btnHamburger = $('btn-hamburger');
        if (btnHamburger) btnHamburger.setAttribute('aria-expanded', 'false');
    }

    function alternarGaveta() {
        if (estado.gavetaAberta) fecharGaveta();
        else abrirGaveta();
    }

    /* ==============================================
       10. LIGAR BOTOES E EVENTOS DA FICHA/GAVETA
       ============================================== */
    function ligarFichaEGaveta() {
        var perfilBotao = $('perfil-botao');
        var fichaFechar = $('ficha-fechar');
        var btnHamburger = $('btn-hamburger');
        var overlay = $('gaveta-overlay');
        var sidebar = $('sidebar');
        var ficha = $('sidebar-perfil');

        /* Botao do avatar */
        if (perfilBotao) {
            perfilBotao.addEventListener('click', alternarFicha);
        }

        /* Botao X da ficha */
        if (fichaFechar) {
            fichaFechar.addEventListener('click', fecharFicha);
        }

        /* Botao hamburger */
        if (btnHamburger) {
            btnHamburger.addEventListener('click', alternarGaveta);
        }

        /* Overlay: fecha os dois */
        if (overlay) {
            overlay.addEventListener('click', function () {
                fecharGaveta();
                fecharFicha();
            });
        }

        /* Fecha a ficha ao clicar fora dela.
           Nao fecha se:
             - o clique foi dentro da ficha
             - o clique foi no proprio botao que abre
             - o clique foi no overlay (ja tratado acima)
             - ha um campo focado (teclado virtual aberto)
        */
        document.addEventListener('click', function (e) {
            var alvo = e.target;

            /* Gaveta: fecha ao clicar fora */
            if (estado.gavetaAberta &&
                sidebar && !sidebar.contains(alvo) &&
                !(btnHamburger && btnHamburger.contains(alvo))) {
                fecharGaveta();
            }

            /* Ficha: fecha ao clicar fora, MAS apenas em modo compacto */
            if (mqCompacto.matches && estado.fichaAberta &&
                ficha && !ficha.contains(alvo) &&
                !(perfilBotao && perfilBotao.contains(alvo)) &&
                !(overlay && overlay.contains(alvo)) &&
                !campoEmFoco()) {
                fecharFicha();
            }
        });

        /* Item do menu: fecha a gaveta em modo compacto */
        if (sidebar) {
            sidebar.addEventListener('click', function (e) {
                if (mqCompacto.matches && e.target.closest('.sidebar-link')) {
                    fecharGaveta();
                }
            });
        }

        /* Esc fecha tudo */
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            fecharGaveta();
            fecharFicha();
        });

        /* Ao cruzar o breakpoint desktop <-> compacto, reseta tudo */
        function aoCruzarBreakpoint() {
            fecharGaveta();
            fecharFicha();
            if (campoEmFoco()) document.activeElement.blur();
            document.body.classList.remove('campo-focado');
            aplicarViewport();
            aplicarLarguraFichaRow();
            resetarScroll();
        }

        if (mqCompacto.addEventListener) {
            mqCompacto.addEventListener('change', aoCruzarBreakpoint);
        } else if (mqCompacto.addListener) {
            mqCompacto.addListener(aoCruzarBreakpoint);
        }
    }

    /* ==============================================
       11. CALENDARIO
       ============================================== */
    function setupCalendario() {
        var titulo = $('calendario-titulo');
        var subtitulo = $('calendario-subtitulo');
        var diasContainer = $('calendario-dias');
        if (!titulo || !diasContainer) return;

        var agora = new Date();
        var mes = agora.getMonth();
        var ano = agora.getFullYear();

        function desenhar() {
            var hoje = new Date();
            var primeiroDiaSemana = new Date(ano, mes, 1).getDay();
            var diasNoMes = new Date(ano, mes + 1, 0).getDate();
            var diasMesAnterior = new Date(ano, mes, 0).getDate();
            var celulas = [];
            var i;

            titulo.textContent = MESES[mes] + ' ' + ano;
            if (subtitulo) subtitulo.textContent = DIAS_SEMANA[hoje.getDay()];

            for (i = primeiroDiaSemana - 1; i >= 0; i--) {
                celulas.push('<span class="dia-outro-mes">' + (diasMesAnterior - i) + '</span>');
            }
            for (i = 1; i <= diasNoMes; i++) {
                var ehHoje = i === hoje.getDate() &&
                             mes === hoje.getMonth() &&
                             ano === hoje.getFullYear();
                celulas.push('<span' + (ehHoje ? ' class="dia-atual"' : '') + '>' + i + '</span>');
            }
            var faltam = (7 - (celulas.length % 7)) % 7;
            for (i = 1; i <= faltam; i++) {
                celulas.push('<span class="dia-outro-mes">' + i + '</span>');
            }

            diasContainer.innerHTML = celulas.join('');
        }

        function mudarMes(delta) {
            mes += delta;
            if (mes < 0) { mes = 11; ano--; }
            if (mes > 11) { mes = 0; ano++; }
            desenhar();
        }

        var btnAnterior = $('btn-mes-anterior');
        var btnProximo = $('btn-proximo-mes');
        if (btnAnterior) {
            btnAnterior.addEventListener('click', function () { mudarMes(-1); });
        }
        if (btnProximo) {
            btnProximo.addEventListener('click', function () { mudarMes(1); });
        }

        desenhar();
    }

    /* ==============================================
       12. AUTH (OAuth listener + boot)
       ============================================== */

    function ligarAuthListener() {
        var db = getDb();
        if (!db) return;

        db.auth.onAuthStateChange(function (evento, sessao) {
            console.log('Auth event:', evento);

            var relevante = (evento === 'SIGNED_IN' || evento === 'INITIAL_SESSION');
            if (!relevante || !sessao || !sessao.user) return;

            aplicarDadosPerfil(sessao.user);
            carregarPerfil();
        });
    }

    function aguardarSessao() {
        var tentativas = 0;
        var maxTentativas = 40;

        function tentar() {
            var db = getDb();
            if (!db) {
                tentativas++;
                if (tentativas >= maxTentativas) {
                    console.error('Supabase nao inicializou');
                    irParaLogin();
                    return;
                }
                setTimeout(tentar, 200);
                return;
            }

            db.auth.getSession().then(function (resultado) {
                var sessao = resultado && resultado.data ? resultado.data.session : null;

                if (sessao && sessao.user) {
                    aplicarDadosPerfil(sessao.user);
                    carregarPerfil();
                    return;
                }

                tentativas++;
                if (tentativas >= maxTentativas) {
                    irParaLogin();
                    return;
                }
                setTimeout(tentar, 200);
            }).catch(function (erro) {
                console.error('Erro getSession:', erro);
                irParaLogin();
            });
        }

        tentar();
    }

    /* ==============================================
       13. INICIALIZACAO
       ============================================== */

    function iniciar() {
        /* 1. Viewport primeiro (para o CSS ter os valores certos) */
        ligarSincronizacaoViewport();

        /* 2. Ligar todos os botoes e eventos */
        ligarBotoesPerfil();
        ligarFichaEGaveta();

        /* 3. Componentes visuais */
        setupCalendario();

        /* 4. Auth */
        ligarAuthListener();
        aguardarSessao();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();