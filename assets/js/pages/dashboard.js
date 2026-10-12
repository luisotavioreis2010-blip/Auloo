/* ==============================================
   DASHBOARD.JS - v19
   Corrige: iPad em pe nao retrocede ao focar input
   ============================================== */
(function () {
    'use strict';

    /* ==============================================
       1. CONSTANTES E ESTADO
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

    /* Breakpoints */
    var mqCompacto = window.matchMedia('(max-width: 1366px)');
    /* iPad em pe / tablet vertical: 768px a 1366px e orientacao portrait */
    var mqTabletRetrato = window.matchMedia(
        '(min-width: 768px) and (max-width: 1366px) and (orientation: portrait)'
    );

    var perfil = { usuario: null, nome: 'Usuario', email: '', avatarUrl: null };

    function $(id) { return document.getElementById(id); }

    function getDb() {
        return window.supabaseClient ||
               (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    /* ==============================================
       2. TELA
       ============================================== */
    function campoEmFoco() {
        var ativo = document.activeElement;
        return !!ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA');
    }

    function emTabletRetrato() {
        return mqTabletRetrato.matches;
    }

    function sincronizarTela(forcar) {
        /* Nunca mexe no layout enquanto um campo esta focado */
        if (!forcar && campoEmFoco()) return;

        var raiz = document.documentElement;
        raiz.style.setProperty('--viewport-h', window.innerHeight + 'px');
        raiz.setAttribute('data-layout', window.innerWidth > window.innerHeight ? 'row' : 'stacked');
    }

    function ajustarLarguraFicha() {
        var calendario = document.querySelector('.calendario-container');
        if (!calendario) return;
        var esquerda = calendario.getBoundingClientRect().left;
        document.documentElement.style.setProperty('--ficha-row-w', (window.innerWidth - esquerda) + 'px');
    }

    function resetarScroll() {
        window.scrollTo(0, 0);
        var main = document.querySelector('.dashboard-main');
        var ficha = $('sidebar-perfil');
        if (main) main.scrollTop = 0;
        if (ficha) ficha.scrollTop = 0;
    }

    function setupTela() {
        var raiz = document.documentElement;
        var temporizador = null;
        var temporizadorQuieto = null;
        var ultimaLargura = window.innerWidth;
        var ultimaAltura = window.innerHeight;

        function reavaliar(forcar) {
            sincronizarTela(forcar);
            ajustarLarguraFicha();
        }

        function aoRedimensionar() {
            /* Em tablet em pe, com o teclado aberto, NAO reavalia nada.
               O teclado virtual reduz a altura e bagunça o layout. */
            if (emTabletRetrato() && campoEmFoco()) return;

            var larguraMudou = window.innerWidth !== ultimaLargura;
            var orientacaoMudou = (window.innerWidth > window.innerHeight) !== (ultimaLargura > ultimaAltura);
            ultimaLargura = window.innerWidth;
            ultimaAltura = window.innerHeight;

            raiz.classList.add('redimensionando');
            clearTimeout(temporizadorQuieto);
            temporizadorQuieto = setTimeout(function () {
                raiz.classList.remove('redimensionando');
            }, 400);

            if (larguraMudou || orientacaoMudou) {
                if (campoEmFoco()) document.activeElement.blur();
                document.body.classList.remove('campo-focado');
                sincronizarTela(true);
                resetarScroll();
            }

            clearTimeout(temporizador);
            temporizador = setTimeout(function () {
                reavaliar(larguraMudou || orientacaoMudou);
                if (larguraMudou || orientacaoMudou) resetarScroll();
            }, 250);
        }

        window.addEventListener('resize', aoRedimensionar);
        window.addEventListener('orientationchange', function () {
            [100, 400, 900].forEach(function (ms) {
                setTimeout(function () { reavaliar(!campoEmFoco()); }, ms);
            });
        });

        document.addEventListener('focusin', function (e) {
            var campo = e.target;
            if (!campo.matches || !campo.matches('input, textarea')) return;
            document.body.classList.add('campo-focado');

            /* Em tablet em pe, nao faz scroll automatico nem reavalia */
            if (emTabletRetrato()) return;

            setTimeout(function () {
                if (document.activeElement === campo) {
                    campo.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
            }, 300);
        });

        document.addEventListener('focusout', function () {
            setTimeout(function () {
                if (campoEmFoco()) return;
                document.body.classList.remove('campo-focado');

                /* Em tablet em pe, nao reavalia ao sair do input */
                if (emTabletRetrato()) return;

                reavaliar(false);
            }, 350);
        });

        if ('ResizeObserver' in window) {
            var observador = new ResizeObserver(function () {
                /* Em tablet em pe com teclado, ignora */
                if (emTabletRetrato() && campoEmFoco()) return;
                ajustarLarguraFicha();
            });
            var alvos = document.querySelectorAll('.ilustracao-container, .calendario-container');
            for (var i = 0; i < alvos.length; i++) observador.observe(alvos[i]);
        }
        ajustarLarguraFicha();
    }

    /* ==============================================
       3. UTILITARIOS
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
        var ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0).toUpperCase() : '';
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
       4. PERFIL
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

    async function carregarPerfil() {
        var db = getDb();
        if (!db) { irParaLogin(); return; }

        try {
            var sessao = verificar(await db.auth.getSession());
            if (!sessao || !sessao.session) { irParaLogin(); return; }

            var usuario = sessao.session.user;
            var meta = usuario.user_metadata || {};
            var nome = meta.full_name || meta.name || null;
            var avatarUrl = meta.avatar_url || meta.picture || null;

            var consulta = await db.from('profiles')
                .select('full_name, avatar_url')
                .eq('id', usuario.id)
                .maybeSingle();

            if (consulta.error) {
                console.warn('Nao foi possivel ler profiles:', consulta.error.message);
            } else if (consulta.data) {
                if (consulta.data.full_name) nome = consulta.data.full_name;
                if (consulta.data.avatar_url) avatarUrl = consulta.data.avatar_url;
            }

            perfil.usuario = usuario;
            perfil.email = usuario.email || '';
            perfil.nome = formatarNome(nome, perfil.email);
            perfil.avatarUrl = avatarUrl;
            renderizarPerfil();
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
                    new Promise(function (resolve) { setTimeout(resolve, TIMEOUT_SIGNOUT_MS); })
                ]);
            }
        } catch (erro) {
            console.warn('Erro no signOut:', erro);
        }

        try {
            CHAVES_LOGOUT.forEach(function (chave) { localStorage.removeItem(chave); });
            Object.keys(localStorage)
                .filter(function (chave) {
                    return chave.indexOf('sb-') === 0 || chave.indexOf('auloo-auth') === 0;
                })
                .forEach(function (chave) { localStorage.removeItem(chave); });
            sessionStorage.clear();
        } catch (erro) {
            console.warn('Erro ao limpar storage:', erro);
        }

        irParaLogin();
    }

    /* ==============================================
       5. MENSAGENS E CONTAINERS EXPANSIVEIS
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
       6. ACOES DO PERFIL
       ============================================== */
    async function salvarNome() {
        var input = $('input-novo-nome');
        var novoNome = input ? input.value.trim() : '';
        if (!novoNome) { mostrarMensagem('Digite um nome valido!', 'erro'); return; }

        var db = getDb();
        if (!db || !perfil.usuario) { mostrarMensagem('Erro: usuario nao autenticado!', 'erro'); return; }

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

        if (!senhaAtual || !senhaNova) { mostrarMensagem('Preencha todos os campos!', 'erro'); return; }
        if (senhaNova.length < 8) { mostrarMensagem('Senha deve ter 8+ caracteres!', 'erro'); return; }

        var db = getDb();
        if (!db || !perfil.usuario) { mostrarMensagem('Erro de configuracao!', 'erro'); return; }

        var login = await db.auth.signInWithPassword({ email: perfil.email, password: senhaAtual });
        if (login.error) {
            var credenciaisInvalidas = login.error.code === 'invalid_credentials' || login.error.status === 400;
            mostrarMensagem(credenciaisInvalidas ? 'Senha atual incorreta!' : 'Erro: ' + login.error.message, 'erro');
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
        if (!db || !perfil.usuario) { mostrarMensagem('Erro: usuario nao autenticado!', 'erro'); return; }

        var extensao = EXTENSOES_FOTO[arquivo.type];
        if (!extensao) { mostrarMensagem('Formato nao suportado!', 'erro'); return; }
        if (arquivo.size > TAMANHO_MAX_FOTO) { mostrarMensagem('Imagem muito grande! Maximo 5MB.', 'erro'); return; }

        try {
            mostrarMensagem('Enviando foto...');
            var caminho = perfil.usuario.id + '/avatar_' + perfil.usuario.id + '_' + Date.now() + '.' + extensao;

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

    function setupPerfil() {
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

        /* Olho de senha */
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
       7. LAYOUT: GAVETA, FICHA E OVERLAY
       ============================================== */
    function setupLayout() {
        var sidebar = $('sidebar');
        var ficha = $('sidebar-perfil');
        var overlay = $('gaveta-overlay');
        var perfilBotao = $('perfil-botao');
        var fichaFechar = $('ficha-fechar');
        var btnHamburger = $('btn-hamburger');

        function sidebarAberta() { return !!sidebar && sidebar.classList.contains('aberta'); }
        function fichaAberta() { return !!ficha && ficha.classList.contains('ativa'); }

        function atualizarEstado() {
            if (overlay) {
                overlay.classList.toggle('ativa', sidebarAberta() || (mqCompacto.matches && fichaAberta()));
            }
            if (btnHamburger) btnHamburger.setAttribute('aria-expanded', String(sidebarAberta()));
            if (perfilBotao) perfilBotao.setAttribute('aria-expanded', String(fichaAberta()));
        }

        function abrirSidebar() { if (sidebar) sidebar.classList.add('aberta'); atualizarEstado(); }
        function fecharSidebar() { if (sidebar) sidebar.classList.remove('aberta'); atualizarEstado(); }

        function abrirFicha() {
            if (!ficha) return;
            ficha.classList.add('ativa');
            document.body.classList.add('ficha-aberta');
            ajustarLarguraFicha();
            atualizarEstado();
        }

        function fecharFicha() {
            if (!ficha) return;
            if (ficha.contains(document.activeElement)) document.activeElement.blur();
            ficha.classList.remove('ativa');
            document.body.classList.remove('ficha-aberta');
            fecharTodosContainers();
            atualizarEstado();
        }

        if (perfilBotao) {
            perfilBotao.addEventListener('click', function () {
                if (fichaAberta()) fecharFicha(); else abrirFicha();
            });
        }

        if (fichaFechar) fichaFechar.addEventListener('click', fecharFicha);

        if (btnHamburger) {
            btnHamburger.addEventListener('click', function () {
                if (sidebarAberta()) fecharSidebar(); else abrirSidebar();
            });
        }

        if (overlay) {
            overlay.addEventListener('click', function () {
                fecharSidebar();
                fecharFicha();
            });
        }

        /* So fecha a ficha se clicar FORA dela, sem teclado aberto,
           e NAO estiver em tablet em pe */
        document.addEventListener('click', function (e) {
            var alvo = e.target;

            if (sidebarAberta() && !sidebar.contains(alvo) &&
                !(btnHamburger && btnHamburger.contains(alvo))) {
                fecharSidebar();
            }

            if (mqCompacto.matches && fichaAberta() &&
                !ficha.contains(alvo) &&
                !(perfilBotao && perfilBotao.contains(alvo)) &&
                !campoEmFoco() &&
                !emTabletRetrato()) {
                fecharFicha();
            }
        });

        if (sidebar) {
            sidebar.addEventListener('click', function (e) {
                if (mqCompacto.matches && e.target.closest('.sidebar-link')) fecharSidebar();
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            fecharSidebar();
            fecharFicha();
        });

        function aoCruzarBreakpoint() {
            fecharSidebar();
            fecharFicha();
            if (campoEmFoco()) document.activeElement.blur();
            document.body.classList.remove('campo-focado');
            sincronizarTela(true);
            resetarScroll();
            ajustarLarguraFicha();
        }

        if (mqCompacto.addEventListener) mqCompacto.addEventListener('change', aoCruzarBreakpoint);
        else if (mqCompacto.addListener) mqCompacto.addListener(aoCruzarBreakpoint);
    }

    /* ==============================================
       8. CALENDARIO
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
                var ehHoje = i === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear();
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
        if (btnAnterior) btnAnterior.addEventListener('click', function () { mudarMes(-1); });
        if (btnProximo) btnProximo.addEventListener('click', function () { mudarMes(1); });

        desenhar();
    }

    /* ==============================================
       9. AUTH LISTENER - OAuth
       ============================================== */
    function setupAuthListener() {
        var db = getDb();
        if (!db) return;

        db.auth.onAuthStateChange(function (evento, sessao) {
            console.log('Auth event:', evento);

            if ((evento === 'SIGNED_IN' || evento === 'INITIAL_SESSION') && sessao && sessao.user) {
                var meta = sessao.user.user_metadata || {};
                perfil.usuario = sessao.user;
                perfil.email = sessao.user.email || '';
                perfil.nome = formatarNome(meta.full_name || meta.name, perfil.email);
                perfil.avatarUrl = meta.avatar_url || meta.picture || null;
                renderizarPerfil();
                carregarPerfil();
            }
        });
    }

    function aguardarOAuthEEntrar() {
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
                    console.log('Sessao encontrada, entrando no dashboard');
                    preencherPerfil(sessao.user);
                } else {
                    tentativas++;
                    if (tentativas >= maxTentativas) {
                        console.log('Nenhuma sessao apos espera, indo para login');
                        irParaLogin();
                        return;
                    }
                    setTimeout(tentar, 200);
                }
            }).catch(function (erro) {
                console.error('Erro getSession:', erro);
                irParaLogin();
            });
        }

        tentar();
    }

    function preencherPerfil(usuario) {
        var meta = usuario.user_metadata || {};
        perfil.usuario = usuario;
        perfil.email = usuario.email || '';
        perfil.nome = formatarNome(meta.full_name || meta.name, perfil.email);
        perfil.avatarUrl = meta.avatar_url || meta.picture || null;
        renderizarPerfil();
        carregarPerfil();
    }

    /* ==============================================
       10. INICIALIZACAO
       ============================================== */
    sincronizarTela();

    function iniciar() {
        setupTela();
        setupPerfil();
        setupLayout();
        setupCalendario();
        setupAuthListener();
        aguardarOAuthEEntrar();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();