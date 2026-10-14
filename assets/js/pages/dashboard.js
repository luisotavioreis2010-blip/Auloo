/* ==============================================
   DASHBOARD.JS — v23
   Perfil, sessão (Supabase), layout responsivo e calendário.
   Sintaxe limitada a ES2017 (sem ?. nem ??) por causa de iPads antigos.
   ============================================== */
(function () {
    'use strict';

    /* ==============================================
       1. CONSTANTES E ESTADO
       ============================================== */
    const PAGINA_LOGIN = '/login.html';

    const CHAVES_LOGOUT = ['auloo_user', 'auloo_saved_email'];
    const PREFIXOS_STORAGE_AUTH = ['sb-', 'auloo-auth'];
    const TIMEOUT_SIGNOUT_MS = 3000;

    const SUPABASE_TENTATIVAS = 40;
    const SUPABASE_INTERVALO_MS = 200;

    const BUCKET_AVATARES = 'avatars';
    const TAMANHO_MAX_FOTO = 5 * 1024 * 1024;
    const EXTENSOES_FOTO = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp'
    };

    const TAMANHO_MIN_SENHA = 8;
    const TAMANHO_MAX_NOME = 60;

    const MENSAGEM_MS = 3000;
    const MENSAGEM_SAIDA_MS = 500;
    const LIMITE_TECLADO_PX = 100;
    const REDIMENSIONANDO_MS = 400;

    const IDS_CONTAINERS = [
        'container-editar-nome',
        'container-editar-senha',
        'container-criar-senha',
        'container-saiba-mais'
    ];

    /* Campos que devem ser limpos sempre que o formulário de senha abre/fecha */
    const CAMPOS_SENHA = {
        'container-editar-senha': ['input-senha-atual', 'input-senha-nova'],
        'container-criar-senha': ['input-nova-senha-criar', 'input-confirmar-senha-criar']
    };

    const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                   'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
                         'Quinta-feira', 'Sexta-feira', 'Sábado'];

    const mqCompacto = window.matchMedia('(max-width: 1366px)');

    const perfil = { usuario: null, nome: 'Usuário', email: '', avatarUrl: null };

    let perfilCarregadoId = null;   // id cujo perfil remoto já foi lido
    let perfilCarregandoId = null;  // id com leitura em andamento
    let saindo = false;             // true durante o logout (evita redirecionar duas vezes)
    let temporizadorMensagem = null;

    /* ==============================================
       2. UTILITÁRIOS
       ============================================== */
    const $ = (id) => document.getElementById(id);
    const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function getDb() {
        return window.supabaseClient ||
               (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    /* Espera o client do Supabase existir (config.js pode inicializar depois) */
    async function aguardarDb() {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const db = getDb();
            if (db) return db;
            await esperar(SUPABASE_INTERVALO_MS);
        }
        return null;
    }

    /* Lança o erro do Supabase (se houver) e devolve `data` */
    function verificar(resultado) {
        if (resultado && resultado.error) throw resultado.error;
        return resultado ? resultado.data : null;
    }

    /* Erro com mensagem já pronta para o usuário (sem o prefixo "Erro:") */
    function erroUsuario(texto) {
        const erro = new Error(texto);
        erro.paraUsuario = true;
        return erro;
    }

    function exigirSessao() {
        const db = getDb();
        if (!db || !perfil.usuario) throw erroUsuario('Usuário não autenticado!');
        return db;
    }

    function formatarNome(nome, email) {
        let texto = (nome || '').trim() || email || '';
        if (texto.indexOf('@') !== -1) texto = texto.split('@')[0];
        if (!texto) return 'Usuário';
        return texto.charAt(0).toUpperCase() + texto.slice(1);
    }

    function criarIniciais(nome) {
        const partes = (nome || 'Usuário').trim().split(/\s+/);
        const inicial = (texto) => (Array.from(texto)[0] || '').toUpperCase();
        const span = document.createElement('span');
        span.className = 'avatar-iniciais';
        span.textContent = inicial(partes[0]) + (partes.length > 1 ? inicial(partes[partes.length - 1]) : '');
        return span;
    }

    function renderizarAvatar(container, avatarUrl, nome) {
        if (!container) return;
        container.textContent = '';
        if (!avatarUrl || avatarUrl === 'null') {
            container.appendChild(criarIniciais(nome));
            return;
        }
        const img = document.createElement('img');
        img.className = 'foto-perfil';
        img.alt = 'Foto de perfil';
        img.decoding = 'async';
        /* Fotos do Google costumam dar 403/429 quando enviam o Referer */
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => {
            if (!img.parentNode) return; // o container já foi redesenhado
            img.remove();
            container.appendChild(criarIniciais(nome));
        };
        img.src = avatarUrl;
        container.appendChild(img);
    }

    function valorDe(id) {
        const campo = $(id);
        return campo ? campo.value : '';
    }

    function limparCampos(ids) {
        ids.forEach((id) => {
            const campo = $(id);
            if (campo) campo.value = '';
        });
    }

    function irParaLogin() {
        /* replace: o dashboard não fica no histórico (botão "voltar" não cai num loop) */
        window.location.replace(PAGINA_LOGIN);
    }

    /* ==============================================
       3. TELA (viewport, layout, teclado virtual)
       ============================================== */
    function campoEmFoco() {
        const ativo = document.activeElement;
        return !!ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA');
    }

    /* Detecta se a mudança de viewport veio do teclado virtual */
    function veioDoTeclado() {
        const vv = window.visualViewport;
        return !!vv && (window.innerHeight - vv.height) > LIMITE_TECLADO_PX;
    }

    function sincronizarTela(forcar) {
        if (!forcar && campoEmFoco()) return;
        const raiz = document.documentElement;
        raiz.style.setProperty('--viewport-h', window.innerHeight + 'px');
        raiz.setAttribute('data-layout', window.innerWidth > window.innerHeight ? 'row' : 'stacked');
    }

    /* No layout em linha a ficha ocupa o espaço à direita do calendário */
    function ajustarLarguraFicha() {
        const calendario = document.querySelector('.calendario-container');
        if (!calendario) return;
        const esquerda = calendario.getBoundingClientRect().left;
        document.documentElement.style.setProperty('--ficha-row-w', (window.innerWidth - esquerda) + 'px');
    }

    function resetarScroll() {
        window.scrollTo(0, 0);
        const main = document.querySelector('.dashboard-main');
        const ficha = $('sidebar-perfil');
        if (main) main.scrollTop = 0;
        if (ficha) ficha.scrollTop = 0;
    }

    function setupTela() {
        const raiz = document.documentElement;
        let temporizador = null;
        let temporizadorTransicao = null;
        let ultimaLargura = window.innerWidth;
        let ultimaAltura = window.innerHeight;

        /* Nunca reavalia com campo focado ou teclado aberto */
        const bloqueado = () => campoEmFoco() || veioDoTeclado();

        function sincronizarSeNecessario() {
            if (bloqueado()) return;

            const larguraAtual = window.innerWidth;
            const alturaAtual = window.innerHeight;

            /* Só mexe no layout se a LARGURA ou a ORIENTAÇÃO mudou de verdade */
            const larguraMudou = larguraAtual !== ultimaLargura;
            const orientacaoMudou = (larguraAtual > alturaAtual) !== (ultimaLargura > ultimaAltura);

            ultimaLargura = larguraAtual;
            ultimaAltura = alturaAtual;

            if (!larguraMudou && !orientacaoMudou) return;

            raiz.classList.add('redimensionando');
            sincronizarTela(true);
            ajustarLarguraFicha();
            resetarScroll();

            clearTimeout(temporizadorTransicao);
            temporizadorTransicao = setTimeout(() => {
                raiz.classList.remove('redimensionando');
            }, REDIMENSIONANDO_MS);
        }

        window.addEventListener('resize', () => {
            if (bloqueado()) return;
            clearTimeout(temporizador);
            temporizador = setTimeout(sincronizarSeNecessario, 250);
        });

        /* O iOS demora a atualizar as dimensões depois de girar a tela */
        window.addEventListener('orientationchange', () => {
            [100, 400, 900].forEach((ms) => setTimeout(sincronizarSeNecessario, ms));
        });

        /* Foco: só marca o body com campo-focado, NÃO reavalia o layout */
        document.addEventListener('focusin', (e) => {
            const campo = e.target;
            if (campo && campo.matches && campo.matches('input, textarea')) {
                document.body.classList.add('campo-focado');
            }
        });

        document.addEventListener('focusout', () => {
            setTimeout(() => {
                if (!campoEmFoco()) document.body.classList.remove('campo-focado');
            }, 350);
        });

        /* ResizeObserver: só ajusta a largura da ficha, sem reavaliar o layout */
        if ('ResizeObserver' in window) {
            const observador = new ResizeObserver(() => {
                if (!bloqueado()) ajustarLarguraFicha();
            });
            document.querySelectorAll('.ilustracao-container, .calendario-container')
                .forEach((alvo) => observador.observe(alvo));
        }

        sincronizarTela(true);
        ajustarLarguraFicha();
    }

    /* ==============================================
       4. MENSAGENS E CONTAINERS EXPANSÍVEIS
       ============================================== */
    function removerMensagem() {
        clearTimeout(temporizadorMensagem);
        const atual = $('mensagem-sidebar');
        if (atual) atual.remove();
    }

    function mostrarMensagem(texto, tipo) {
        tipo = tipo || 'sucesso';
        removerMensagem();

        const msg = document.createElement('div');
        msg.id = 'mensagem-sidebar';
        msg.className = 'mensagem-sidebar mensagem-sidebar--' + tipo;
        msg.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
        msg.textContent = texto;

        const referencia = $('container-editar-senha');
        if (referencia && referencia.parentNode) {
            referencia.parentNode.insertBefore(msg, referencia);
        } else {
            const menu = document.querySelector('.ficha-menu');
            if (menu) menu.insertBefore(msg, menu.firstChild);
        }

        temporizadorMensagem = setTimeout(() => {
            msg.classList.add('saindo');
            temporizadorMensagem = setTimeout(() => msg.remove(), MENSAGEM_SAIDA_MS);
        }, MENSAGEM_MS);
    }

    /* Mantém aria-expanded dos botões em sincronia com os containers */
    function sincronizarAria() {
        document.querySelectorAll('[aria-controls][aria-expanded]').forEach((gatilho) => {
            const ids = gatilho.getAttribute('aria-controls').split(/\s+/);
            const aberto = ids.some((id) => {
                const alvo = $(id);
                return !!alvo && !alvo.hidden;
            });
            /* Só os gatilhos dos containers; hambúrguer e perfil são tratados no layout */
            if (ids.every((id) => IDS_CONTAINERS.indexOf(id) !== -1)) {
                gatilho.setAttribute('aria-expanded', String(aberto));
            }
        });
    }

    function alternarVisibilidadeSenha(botao, mostrar) {
        const input = $(botao.getAttribute('data-target'));
        if (!input) return;
        const exibir = typeof mostrar === 'boolean' ? mostrar : input.type === 'password';
        input.type = exibir ? 'text' : 'password';
        botao.classList.toggle('mostrando', exibir);
        botao.setAttribute('aria-pressed', String(exibir));
    }

    function fecharContainer(id) {
        const container = $(id);
        if (!container || container.hidden) return;
        container.hidden = true;
        /* Senha nunca deve reabrir "revelada" */
        container.querySelectorAll('.btn-olho-senha.mostrando')
            .forEach((botao) => alternarVisibilidadeSenha(botao, false));
    }

    function fecharTodosContainers() {
        IDS_CONTAINERS.forEach(fecharContainer);
        sincronizarAria();
    }

    function alternarContainer(id) {
        const alvo = $(id);
        if (!alvo) return;
        const estavaAberto = !alvo.hidden;
        IDS_CONTAINERS.forEach(fecharContainer);
        alvo.hidden = estavaAberto;
        sincronizarAria();
    }

    /* ==============================================
       5. PERFIL (leitura, exibição, logout)
       ============================================== */
    function renderizarPerfil() {
        renderizarAvatar($('perfil-usuario'), perfil.avatarUrl, perfil.nome);
        renderizarAvatar($('sidebar-perfil-foto'), perfil.avatarUrl, perfil.nome);
        const nome = $('sidebar-perfil-nome');
        const email = $('sidebar-perfil-email');
        if (nome) nome.textContent = perfil.nome;
        if (email) email.textContent = perfil.email;
    }

    /* Lê a tabela `profiles` (nome/foto editados pelo usuário têm prioridade sobre o provedor) */
    async function carregarPerfilRemoto(usuario, nome, avatarUrl) {
        perfilCarregandoId = usuario.id;
        try {
            const db = getDb();
            const consulta = await db.from('profiles')
                .select('full_name, avatar_url')
                .eq('id', usuario.id)
                .maybeSingle();

            /* Outro usuário assumiu a sessão enquanto a consulta rodava */
            if (!perfil.usuario || perfil.usuario.id !== usuario.id) return;

            if (consulta.error) {
                console.warn('Não foi possível ler profiles:', consulta.error.message);
                return; // perfilCarregadoId fica nulo: o próximo evento tenta de novo
            }

            if (consulta.data) {
                if (consulta.data.full_name) nome = consulta.data.full_name;
                if (consulta.data.avatar_url) avatarUrl = consulta.data.avatar_url;
            }

            perfil.nome = formatarNome(nome, perfil.email);
            perfil.avatarUrl = avatarUrl;
            perfilCarregadoId = usuario.id;
            renderizarPerfil();
        } catch (erro) {
            console.error('Erro ao carregar perfil:', erro);
        } finally {
            perfilCarregandoId = null;
        }
    }

    /* Ponto único de entrada: chamado pelo getSession e pelo onAuthStateChange */
    function aplicarUsuario(usuario) {
        perfil.usuario = usuario;
        perfil.email = usuario.email || '';

        /* Perfil já lido (ou sendo lido) para este usuário: só renova o objeto da sessão */
        if (perfilCarregadoId === usuario.id || perfilCarregandoId === usuario.id) return;

        const meta = usuario.user_metadata || {};
        const nome = meta.full_name || meta.name || null;
        const avatarUrl = meta.avatar_url || meta.picture || null;

        /* Mostra já o que o provedor entregou; a tabela `profiles` refina depois */
        perfil.nome = formatarNome(nome, perfil.email);
        perfil.avatarUrl = avatarUrl;
        renderizarPerfil();

        carregarPerfilRemoto(usuario, nome, avatarUrl);
    }

    /* O usuário tem senha própria (login por e-mail), ou entrou só por OAuth? */
    function usuarioTemSenha() {
        const usuario = perfil.usuario;
        if (!usuario) return false;

        const identities = usuario.identities || [];
        if (identities.some((i) => i.provider === 'email')) return true;

        const appMeta = usuario.app_metadata || {};
        const provedores = appMeta.providers || [];
        return appMeta.provider === 'email' || provedores.indexOf('email') !== -1;
    }

    function limparArmazenamento() {
        try {
            CHAVES_LOGOUT.forEach((chave) => localStorage.removeItem(chave));
            Object.keys(localStorage)
                .filter((chave) => PREFIXOS_STORAGE_AUTH.some((prefixo) => chave.indexOf(prefixo) === 0))
                .forEach((chave) => localStorage.removeItem(chave));
            sessionStorage.clear();
        } catch (erro) {
            console.warn('Erro ao limpar storage:', erro);
        }
    }

    async function fazerLogout() {
        saindo = true;
        const db = getDb();

        if (db) {
            let temporizador;
            try {
                await Promise.race([
                    db.auth.signOut(),
                    new Promise((resolve) => { temporizador = setTimeout(resolve, TIMEOUT_SIGNOUT_MS); })
                ]);
            } catch (erro) {
                console.warn('Erro no signOut:', erro);
            } finally {
                clearTimeout(temporizador);
            }
        }

        limparArmazenamento();
        irParaLogin();
    }

    /* ==============================================
       6. AÇÕES DO PERFIL
       ============================================== */
    /* Executa uma ação com o botão travado e trata erro de forma uniforme */
    async function executarAcao(botao, acao) {
        if (botao.disabled) return;
        botao.disabled = true;
        try {
            await acao();
        } catch (erro) {
            if (erro && erro.paraUsuario) {
                mostrarMensagem(erro.message, 'erro');
            } else {
                console.error(erro);
                mostrarMensagem('Erro: ' + (erro && erro.message ? erro.message : erro), 'erro');
            }
        } finally {
            botao.disabled = false;
        }
    }

    /* Usa a mesma regra do cadastro (auth.js) quando disponível */
    function validarNovaSenha(senha) {
        if (typeof validarSenhaForte === 'function') {
            const forca = validarSenhaForte(senha);
            if (!forca.valida) throw erroUsuario(forca.mensagem);
            return;
        }
        if (senha.length < TAMANHO_MIN_SENHA) throw erroUsuario('Senha deve ter 8+ caracteres!');
    }

    async function salvarNome() {
        const novoNome = valorDe('input-novo-nome').trim().replace(/\s+/g, ' ');
        if (!novoNome) throw erroUsuario('Digite um nome válido!');
        if (novoNome.length > TAMANHO_MAX_NOME) {
            throw erroUsuario('Nome muito longo! Máximo ' + TAMANHO_MAX_NOME + ' caracteres.');
        }

        const db = exigirSessao();

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
        sincronizarAria();
        mostrarMensagem('Nome atualizado!');
    }

    async function alterarSenha() {
        const senhaAtual = valorDe('input-senha-atual');
        const senhaNova = valorDe('input-senha-nova');

        if (!senhaAtual || !senhaNova) throw erroUsuario('Preencha todos os campos!');
        validarNovaSenha(senhaNova);
        if (senhaNova === senhaAtual) throw erroUsuario('A nova senha deve ser diferente da atual!');

        const db = exigirSessao();

        /* Reautentica para confirmar que quem está na tela conhece a senha atual */
        const login = await db.auth.signInWithPassword({ email: perfil.email, password: senhaAtual });
        if (login.error) {
            const credenciaisInvalidas = login.error.code === 'invalid_credentials' || login.error.status === 400;
            throw credenciaisInvalidas
                ? erroUsuario('Senha atual incorreta!')
                : erroUsuario('Erro: ' + login.error.message);
        }

        verificar(await db.auth.updateUser({ password: senhaNova }));

        limparCampos(CAMPOS_SENHA['container-editar-senha']);
        fecharContainer('container-editar-senha');
        sincronizarAria();
        mostrarMensagem('Senha atualizada!');
    }

    /* Cria senha para quem entrou apenas com Google/OAuth */
    async function criarSenha() {
        const senha = valorDe('input-nova-senha-criar');
        const confirmacao = valorDe('input-confirmar-senha-criar');

        if (!senha || !confirmacao) throw erroUsuario('Preencha todos os campos!');
        validarNovaSenha(senha);
        if (senha !== confirmacao) throw erroUsuario('As senhas não coincidem!');

        const db = exigirSessao();
        const dados = verificar(await db.auth.updateUser({ password: senha }));

        if (dados && dados.user) perfil.usuario = dados.user;

        limparCampos(CAMPOS_SENHA['container-criar-senha']);
        fecharContainer('container-criar-senha');
        sincronizarAria();
        mostrarMensagem('Senha criada!');
    }

    /* Extrai o caminho dentro do bucket a partir da URL pública (só se for do próprio usuário) */
    function caminhoDoAvatar(url, usuarioId) {
        if (!url) return null;
        const marcador = '/' + BUCKET_AVATARES + '/';
        const indice = url.indexOf(marcador);
        if (indice === -1) return null;
        try {
            const caminho = decodeURIComponent(url.slice(indice + marcador.length).split('?')[0]);
            return caminho.indexOf(usuarioId + '/') === 0 ? caminho : null;
        } catch (erro) {
            return null;
        }
    }

    /* Remove arquivo do bucket sem nunca interromper o fluxo do usuário */
    async function removerArquivoAvatar(db, caminho) {
        if (!caminho) return;
        try {
            await db.storage.from(BUCKET_AVATARES).remove([caminho]);
        } catch (erro) {
            console.warn('Não foi possível remover avatar:', erro);
        }
    }

    async function enviarFoto(arquivo) {
        const extensao = EXTENSOES_FOTO[arquivo.type];
        if (!extensao) throw erroUsuario('Formato não suportado!');
        if (arquivo.size > TAMANHO_MAX_FOTO) throw erroUsuario('Imagem muito grande! Máximo 5MB.');

        const db = exigirSessao();
        const usuarioId = perfil.usuario.id;
        const avatarAnterior = perfil.avatarUrl;
        const caminho = usuarioId + '/avatar_' + usuarioId + '_' + Date.now() + '.' + extensao;

        mostrarMensagem('Enviando foto...');

        verificar(await db.storage.from(BUCKET_AVATARES).upload(caminho, arquivo, {
            cacheControl: '3600',
            contentType: arquivo.type
        }));

        try {
            const urlPublica = db.storage.from(BUCKET_AVATARES).getPublicUrl(caminho).data.publicUrl;

            verificar(await db.auth.updateUser({ data: { avatar_url: urlPublica } }));
            verificar(await db.from('profiles').upsert({
                id: usuarioId,
                avatar_url: urlPublica,
                updated_at: new Date().toISOString()
            }));

            perfil.avatarUrl = urlPublica;
            renderizarPerfil();
            mostrarMensagem('Foto atualizada!');
        } catch (erro) {
            /* Falhou depois do upload: não deixa o arquivo órfão no bucket */
            await removerArquivoAvatar(db, caminho);
            throw erro;
        }

        /* Foto antiga já não é referenciada por ninguém */
        removerArquivoAvatar(db, caminhoDoAvatar(avatarAnterior, usuarioId));
    }

    /* ==============================================
       7. LIGAÇÃO DOS EVENTOS DO PERFIL
       ============================================== */
    function ligarFormulario(idForm, idBotao, acao) {
        const formulario = $(idForm);
        const botao = $(idBotao);
        if (!formulario || !botao) return;
        formulario.addEventListener('submit', (e) => {
            e.preventDefault();
            executarAcao(botao, acao);
        });
    }

    function setupPerfil() {
        /* Sair */
        const btnSair = $('btn-sair');
        if (btnSair) {
            btnSair.addEventListener('click', () => {
                btnSair.disabled = true;
                fazerLogout();
            });
        }

        /* Mudar foto */
        const btnEditarFoto = $('btn-editar-foto');
        const inputFoto = $('input-foto');
        if (btnEditarFoto && inputFoto) {
            btnEditarFoto.addEventListener('click', () => {
                fecharTodosContainers();
                inputFoto.click();
            });
            inputFoto.addEventListener('change', () => {
                const arquivo = inputFoto.files[0];
                inputFoto.value = '';
                if (arquivo) executarAcao(btnEditarFoto, () => enviarFoto(arquivo));
            });
        }

        /* Editar nome */
        const btnEditarNome = $('btn-editar-nome');
        if (btnEditarNome) {
            btnEditarNome.addEventListener('click', () => {
                alternarContainer('container-editar-nome');
                const campo = $('input-novo-nome');
                if (campo && !$('container-editar-nome').hidden) campo.value = perfil.nome;
            });
        }
        ligarFormulario('container-editar-nome', 'btn-salvar-nome', salvarNome);

        /* Botão "Senha": abre "alterar" (tem senha) ou "criar" (só OAuth) */
        const btnEditarSenha = $('btn-editar-senha');
        if (btnEditarSenha) {
            btnEditarSenha.addEventListener('click', () => {
                const idContainer = usuarioTemSenha() ? 'container-editar-senha' : 'container-criar-senha';
                alternarContainer(idContainer);
                limparCampos(CAMPOS_SENHA[idContainer]);
            });
        }
        ligarFormulario('container-editar-senha', 'btn-confirmar-senha', alterarSenha);
        ligarFormulario('container-criar-senha', 'btn-confirmar-criar-senha', criarSenha);

        /* Saiba mais */
        const btnSaibaMais = $('btn-saiba-mais');
        if (btnSaibaMais) {
            btnSaibaMais.addEventListener('click', () => alternarContainer('container-saiba-mais'));
        }

        /* Olho da senha (delegação: vale para qualquer campo da ficha) */
        const ficha = $('sidebar-perfil');
        if (ficha) {
            ficha.addEventListener('click', (e) => {
                const botao = e.target.closest('.btn-olho-senha');
                if (botao) alternarVisibilidadeSenha(botao);
            });
        }
    }

    /* ==============================================
       8. LAYOUT (gaveta, ficha, overlay)
       ============================================== */
    function setupLayout() {
        const sidebar = $('sidebar');
        const ficha = $('sidebar-perfil');
        const overlay = $('gaveta-overlay');
        const perfilBotao = $('perfil-botao');
        const fichaFechar = $('ficha-fechar');
        const btnHamburger = $('btn-hamburger');

        const sidebarAberta = () => !!sidebar && sidebar.classList.contains('aberta');
        const fichaAberta = () => !!ficha && ficha.classList.contains('ativa');

        function atualizarEstado() {
            if (overlay) {
                overlay.classList.toggle('ativa', sidebarAberta() || (mqCompacto.matches && fichaAberta()));
            }
            if (btnHamburger) btnHamburger.setAttribute('aria-expanded', String(sidebarAberta()));
            if (perfilBotao) perfilBotao.setAttribute('aria-expanded', String(fichaAberta()));
        }

        function abrirSidebar() {
            if (sidebar) sidebar.classList.add('aberta');
            atualizarEstado();
        }

        function fecharSidebar() {
            if (sidebar) sidebar.classList.remove('aberta');
            atualizarEstado();
        }

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
            perfilBotao.addEventListener('click', () => {
                if (fichaAberta()) fecharFicha(); else abrirFicha();
            });
        }

        if (fichaFechar) fichaFechar.addEventListener('click', fecharFicha);

        if (btnHamburger) {
            btnHamburger.addEventListener('click', () => {
                if (sidebarAberta()) fecharSidebar(); else abrirSidebar();
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                fecharSidebar();
                fecharFicha();
            });
        }

        /* Clique fora fecha a gaveta e (no modo compacto) a ficha */
        document.addEventListener('click', (e) => {
            const alvo = e.target;
            if (sidebarAberta() && !sidebar.contains(alvo) &&
                !(btnHamburger && btnHamburger.contains(alvo))) {
                fecharSidebar();
            }
            if (mqCompacto.matches && fichaAberta() && !ficha.contains(alvo) &&
                !(perfilBotao && perfilBotao.contains(alvo)) && !campoEmFoco()) {
                fecharFicha();
            }
        });

        if (sidebar) {
            sidebar.addEventListener('click', (e) => {
                if (mqCompacto.matches && e.target.closest('.sidebar-link')) fecharSidebar();
            });
        }

        document.addEventListener('keydown', (e) => {
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

        /* addListener: Safari < 14 */
        if (mqCompacto.addEventListener) mqCompacto.addEventListener('change', aoCruzarBreakpoint);
        else if (mqCompacto.addListener) mqCompacto.addListener(aoCruzarBreakpoint);
    }

    /* ==============================================
       9. CALENDÁRIO
       ============================================== */
    function setupCalendario() {
        const titulo = $('calendario-titulo');
        const subtitulo = $('calendario-subtitulo');
        const diasContainer = $('calendario-dias');
        if (!titulo || !diasContainer) return;

        const agora = new Date();
        let mes = agora.getMonth();
        let ano = agora.getFullYear();

        function criarDia(numero, classe) {
            const dia = document.createElement('span');
            if (classe) dia.className = classe;
            dia.textContent = numero;
            return dia;
        }

        function desenhar() {
            const hoje = new Date();
            const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
            const diasNoMes = new Date(ano, mes + 1, 0).getDate();
            const diasMesAnterior = new Date(ano, mes, 0).getDate();
            const fragmento = document.createDocumentFragment();
            let celulas = 0;

            titulo.textContent = MESES[mes] + ' ' + ano;
            if (subtitulo) subtitulo.textContent = DIAS_SEMANA[hoje.getDay()];

            for (let i = primeiroDiaSemana - 1; i >= 0; i--) {
                fragmento.appendChild(criarDia(diasMesAnterior - i, 'dia-outro-mes'));
                celulas++;
            }
            for (let i = 1; i <= diasNoMes; i++) {
                const ehHoje = i === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear();
                fragmento.appendChild(criarDia(i, ehHoje ? 'dia-atual' : ''));
                celulas++;
            }
            const faltam = (7 - (celulas % 7)) % 7;
            for (let i = 1; i <= faltam; i++) {
                fragmento.appendChild(criarDia(i, 'dia-outro-mes'));
            }

            diasContainer.textContent = '';
            diasContainer.appendChild(fragmento);
        }

        function mudarMes(delta) {
            mes += delta;
            if (mes < 0) { mes = 11; ano--; }
            if (mes > 11) { mes = 0; ano++; }
            desenhar();
        }

        const btnAnterior = $('btn-mes-anterior');
        const btnProximo = $('btn-proximo-mes');
        if (btnAnterior) btnAnterior.addEventListener('click', () => mudarMes(-1));
        if (btnProximo) btnProximo.addEventListener('click', () => mudarMes(1));

        desenhar();
    }

    /* ==============================================
       10. SESSÃO (Supabase)
       ============================================== */
    /* Aguarda a sessão: no retorno do OAuth o supabase-js ainda pode estar trocando o código */
    async function aguardarSessao(db) {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const resultado = await db.auth.getSession();
            if (resultado.error) throw resultado.error;
            const sessao = resultado.data && resultado.data.session;
            if (sessao && sessao.user) return sessao;
            await esperar(SUPABASE_INTERVALO_MS);
        }
        return null;
    }

    async function iniciarSessao() {
        const db = await aguardarDb();
        if (!db) {
            console.error('Supabase não inicializou');
            irParaLogin();
            return;
        }

        db.auth.onAuthStateChange((evento, sessao) => {
            /* Logout em outra aba, refresh token inválido, etc. */
            if (evento === 'SIGNED_OUT') {
                if (!saindo) irParaLogin();
                return;
            }
            if (sessao && sessao.user) {
                /* Não chamar o Supabase dentro deste callback (risco de deadlock): adia um tick */
                setTimeout(() => aplicarUsuario(sessao.user), 0);
            }
        });

        try {
            const sessao = await aguardarSessao(db);
            if (!sessao) {
                irParaLogin();
                return;
            }
            aplicarUsuario(sessao.user);
        } catch (erro) {
            console.error('Erro getSession:', erro);
            irParaLogin();
        }
    }

    /* ==============================================
       11. INICIALIZAÇÃO
       ============================================== */
    sincronizarTela(); // antes do DOM ficar pronto, para o layout não "pular"

    function iniciar() {
        setupTela();
        setupPerfil();
        setupLayout();
        setupCalendario();
        iniciarSessao();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();