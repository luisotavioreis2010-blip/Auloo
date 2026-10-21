/* ==============================================
   LAYOUT.JS — v5 (Funções Puras com Lógica de Tela)
   ============================================== */
(function () {
    'use strict';

    const PAGINA_LOGIN = 'login.html';
    const mqCompacto = window.matchMedia('(max-width: 1366px)');

    const CHAVES_LOGOUT = ['acervo_user', 'acervo_saved_email'];
    const PREFIXOS_STORAGE_AUTH = ['sb-', 'acervo-auth'];
    const TIMEOUT_SIGNOUT_MS = 3000;
    
    const SUPABASE_TENTATIVAS = 40;
    const SUPABASE_INTERVALO_MS = 200;
    const BUCKET_AVATARES = 'avatars';
    const TAMANHO_MAX_FOTO = 5 * 1024 * 1024;
    const EXTENSOES_FOTO = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp'
    };

    const MENSAGEM_MS = 3000;
    const MENSAGEM_SAIDA_MS = 500;
    const REDIMENSIONANDO_MS = 400;

    const IDS_CONTAINERS = ['container-editar-nome', 'container-editar-senha', 'container-criar-senha', 'container-saiba-mais'];
    const CAMPOS_SENHA = {
        'container-editar-senha': ['input-senha-atual', 'input-senha-nova'],
        'container-criar-senha': ['input-nova-senha-criar', 'input-confirmar-senha-criar']
    };

    const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

    const perfil = { usuario: null, nome: 'Usuário', email: '', avatarUrl: null };
    let perfilCarregadoId = null;
    let perfilCarregandoId = null;
    let saindo = false;
    let temporizadorMensagem = null;

    const $ = (id) => document.getElementById(id);
    const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function getDb() {
        return window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    async function aguardarDb() {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const db = getDb();
            if (db) return db;
            await esperar(SUPABASE_INTERVALO_MS);
        }
        return null;
    }

    function verificar(resultado) {
        if (resultado && resultado.error) throw resultado.error;
        return resultado ? resultado.data : null;
    }

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
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => {
            if (!img.parentNode) return;
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
        window.location.href = PAGINA_LOGIN;
    }

    /* ==============================================
       LÓGICA DE TELA (data-layout="row")
       ============================================== */
    function sincronizarTela() {
        const raiz = document.documentElement;
        raiz.style.setProperty('--viewport-h', window.innerHeight + 'px');
        
        const layout = window.innerWidth > window.innerHeight ? 'row' : 'stacked';
        if (raiz.getAttribute('data-layout') !== layout) {
            raiz.setAttribute('data-layout', layout);
        }
    }

    function setupTela() {
        sincronizarTela();
        window.addEventListener('resize', sincronizarTela);
        window.addEventListener('orientationchange', () => {
            setTimeout(sincronizarTela, 100);
            setTimeout(sincronizarTela, 300);
        });
    }

    /* ==============================================
       TELA (LAYOUT E CALENDÁRIO)
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
       MENSAGENS E CONTAINERS
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

    function sincronizarAria() {
        document.querySelectorAll('[aria-controls][aria-expanded]').forEach((gatilho) => {
            const ids = gatilho.getAttribute('aria-controls').split(/\s+/);
            const aberto = ids.some((id) => {
                const alvo = $(id);
                return !!alvo && !alvo.hidden;
            });
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
        container.querySelectorAll('.btn-olho-senha.mostrando').forEach((botao) => alternarVisibilidadeSenha(botao, false));
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
       PERFIL E SESSÃO
       ============================================== */
    function renderizarPerfil() {
        renderizarAvatar($('perfil-usuario'), perfil.avatarUrl, perfil.nome);
        renderizarAvatar($('sidebar-perfil-foto'), perfil.avatarUrl, perfil.nome);
        const nome = $('sidebar-perfil-nome');
        const email = $('sidebar-perfil-email');
        if (nome) nome.textContent = perfil.nome;
        if (email) email.textContent = perfil.email;
    }

    async function carregarPerfilRemoto(usuario, nome, avatarUrl) {
        perfilCarregandoId = usuario.id;
        try {
            const db = getDb();
            const consulta = await db.from('profiles').select('full_name, avatar_url').eq('id', usuario.id).maybeSingle();
            if (!perfil.usuario || perfil.usuario.id !== usuario.id) return;
            if (consulta.error) return;

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

    function aplicarUsuario(usuario) {
        perfil.usuario = usuario;
        perfil.email = usuario.email || '';
        if (perfilCarregadoId === usuario.id || perfilCarregandoId === usuario.id) return;

        const meta = usuario.user_metadata || {};
        const nome = meta.full_name || meta.name || null;
        const avatarUrl = meta.avatar_url || meta.picture || null;

        perfil.nome = formatarNome(nome, perfil.email);
        perfil.avatarUrl = avatarUrl;
        renderizarPerfil();
        carregarPerfilRemoto(usuario, nome, avatarUrl);
    }

    function limparArmazenamento() {
        try {
            CHAVES_LOGOUT.forEach((chave) => localStorage.removeItem(chave));
            Object.keys(localStorage).filter((chave) => PREFIXOS_STORAGE_AUTH.some((prefixo) => chave.indexOf(prefixo) === 0)).forEach((chave) => localStorage.removeItem(chave));
            sessionStorage.clear();
        } catch (erro) { }
    }

    async function fazerLogout() {
        saindo = true;
        const db = getDb();
        if (db) {
            let temporizador;
            try {
                await Promise.race([db.auth.signOut(), new Promise((resolve) => { temporizador = setTimeout(resolve, TIMEOUT_SIGNOUT_MS); })]);
            } catch (erro) { } finally { clearTimeout(temporizador); }
        }
        limparArmazenamento();
        irParaLogin();
    }

    /* ==============================================
       AÇÕES DO PERFIL (Editar Nome, Senha, Foto)
       ============================================== */
    async function executarAcao(botao, acao) {
        if (botao.disabled) return;
        botao.disabled = true;
        try { await acao(); } catch (erro) {
            if (erro && erro.paraUsuario) mostrarMensagem(erro.message, 'erro');
            else mostrarMensagem('Erro: ' + (erro && erro.message ? erro.message : erro), 'erro');
        } finally { botao.disabled = false; }
    }

    function validarNovaSenha(senha) {
        if (typeof validarSenhaForte === 'function') {
            const forca = validarSenhaForte(senha);
            if (!forca.valida) throw erroUsuario(forca.mensagem);
            return;
        }
        if (senha.length < 8) throw erroUsuario('Senha deve ter 8+ caracteres!');
    }

    async function salvarNome() {
        const novoNome = valorDe('input-novo-nome').trim().replace(/\s+/g, ' ');
        if (!novoNome) throw erroUsuario('Digite um nome válido!');
        if (novoNome.length > 60) throw erroUsuario('Nome muito longo!');

        const db = exigirSessao();
        verificar(await db.auth.updateUser({ data: { full_name: novoNome } }));
        verificar(await db.from('profiles').upsert({ id: perfil.usuario.id, full_name: novoNome, email: perfil.email, updated_at: new Date().toISOString() }));

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
        const login = await db.auth.signInWithPassword({ email: perfil.email, password: senhaAtual });
        if (login.error) throw erroUsuario('Senha atual incorreta!');

        verificar(await db.auth.updateUser({ password: senhaNova }));
        limparCampos(CAMPOS_SENHA['container-editar-senha']);
        fecharContainer('container-editar-senha');
        sincronizarAria();
        mostrarMensagem('Senha atualizada!');
    }

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

    function caminhoDoAvatar(url, usuarioId) {
        if (!url) return null;
        const marcador = '/' + BUCKET_AVATARES + '/';
        const indice = url.indexOf(marcador);
        if (indice === -1) return null;
        try {
            const caminho = decodeURIComponent(url.slice(indice + marcador.length).split('?')[0]);
            return caminho.indexOf(usuarioId + '/') === 0 ? caminho : null;
        } catch (erro) { return null; }
    }

    async function removerArquivoAvatar(db, caminho) {
        if (!caminho) return;
        try { await db.storage.from(BUCKET_AVATARES).remove([caminho]); } catch (erro) { }
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

        verificar(await db.storage.from(BUCKET_AVATARES).upload(caminho, arquivo, { cacheControl: '3600', contentType: arquivo.type }));
        try {
            const urlPublica = db.storage.from(BUCKET_AVATARES).getPublicUrl(caminho).data.publicUrl;
            verificar(await db.auth.updateUser({ data: { avatar_url: urlPublica } }));
            verificar(await db.from('profiles').upsert({ id: usuarioId, avatar_url: urlPublica, updated_at: new Date().toISOString() }));

            perfil.avatarUrl = urlPublica;
            renderizarPerfil();
            mostrarMensagem('Foto atualizada!');
        } catch (erro) {
            await removerArquivoAvatar(db, caminho);
            throw erro;
        }
        removerArquivoAvatar(db, caminhoDoAvatar(avatarAnterior, usuarioId));
    }

    /* ==============================================
       EVENTOS DO LAYOUT E DA FICHA
       ============================================== */
    function ligarFormulario(idForm, idBotao, acao) {
        const formulario = $(idForm);
        const botao = $(idBotao);
        if (!formulario || !botao) return;
        formulario.addEventListener('submit', (e) => { e.preventDefault(); executarAcao(botao, acao); });
    }

    function setupFicha() {
        const btnEditarFoto = $('btn-editar-foto');
        const inputFoto = $('input-foto');
        if (btnEditarFoto && inputFoto) {
            btnEditarFoto.addEventListener('click', () => { fecharTodosContainers(); inputFoto.click(); });
            inputFoto.addEventListener('change', () => {
                const arquivo = inputFoto.files[0];
                inputFoto.value = '';
                if (arquivo) executarAcao(btnEditarFoto, () => enviarFoto(arquivo));
            });
        }

        const btnEditarNome = $('btn-editar-nome');
        if (btnEditarNome) {
            btnEditarNome.addEventListener('click', () => {
                alternarContainer('container-editar-nome');
                const campo = $('input-novo-nome');
                if (campo && !$('container-editar-nome').hidden) campo.value = perfil.nome;
            });
        }
        ligarFormulario('container-editar-nome', 'btn-salvar-nome', salvarNome);

        const btnEditarSenha = $('btn-editar-senha');
        if (btnEditarSenha) {
            btnEditarSenha.addEventListener('click', () => {
                const idContainer = 'container-editar-senha';
                alternarContainer(idContainer);
                limparCampos(CAMPOS_SENHA[idContainer]);
            });
        }
        ligarFormulario('container-editar-senha', 'btn-confirmar-senha', alterarSenha);
        ligarFormulario('container-criar-senha', 'btn-confirmar-criar-senha', criarSenha);

        const btnSaibaMais = $('btn-saiba-mais');
        if (btnSaibaMais) btnSaibaMais.addEventListener('click', () => alternarContainer('container-saiba-mais'));

        const ficha = $('sidebar-perfil');
        if (ficha) ficha.addEventListener('click', (e) => {
            const botao = e.target.closest('.btn-olho-senha');
            if (botao) alternarVisibilidadeSenha(botao);
        });
    }

    function setupLayout() {
        const sidebar = $('sidebar');
        const ficha = $('sidebar-perfil');
        const overlay = $('gaveta-overlay');
        const perfilBotao = $('perfil-botao');
        const fichaFechar = $('ficha-fechar');
        const btnHamburger = $('btn-hamburger');
        const btnSair = $('btn-sair');

        if (btnSair) btnSair.addEventListener('click', () => { btnSair.disabled = true; fazerLogout(); });

        const sidebarAberta = () => sidebar && sidebar.classList.contains('aberta');
        const fichaAberta = () => ficha && ficha.classList.contains('ativa');

        function atualizarEstado() {
            if (overlay) overlay.classList.toggle('ativa', sidebarAberta() || (mqCompacto.matches && fichaAberta()));
            if (btnHamburger) btnHamburger.setAttribute('aria-expanded', String(sidebarAberta()));
            if (perfilBotao) perfilBotao.setAttribute('aria-expanded', String(fichaAberta()));
        }

        if (btnHamburger) btnHamburger.addEventListener('click', () => { sidebar.classList.toggle('aberta'); atualizarEstado(); });
        if (perfilBotao) perfilBotao.addEventListener('click', () => { ficha.classList.toggle('ativa'); document.body.classList.toggle('ficha-aberta'); atualizarEstado(); });
        if (fichaFechar) fichaFechar.addEventListener('click', () => { ficha.classList.remove('ativa'); document.body.classList.remove('ficha-aberta'); fecharTodosContainers(); atualizarEstado(); });
        if (overlay) overlay.addEventListener('click', () => { sidebar.classList.remove('aberta'); ficha.classList.remove('ativa'); document.body.classList.remove('ficha-aberta'); atualizarEstado(); });

        if (sidebar) sidebar.addEventListener('click', (e) => {
            const link = e.target.closest('a.sidebar-link');
            if (mqCompacto.matches && link && !link.classList.contains('sidebar-toggle')) { sidebar.classList.remove('aberta'); atualizarEstado(); }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { sidebar.classList.remove('aberta'); ficha.classList.remove('ativa'); document.body.classList.remove('ficha-aberta'); atualizarEstado(); }
        });
    }

    async function iniciarSessao() {
        const db = await aguardarDb();
        if (!db) { irParaLogin(); return; }

        db.auth.onAuthStateChange((evento, sessao) => {
            if (evento === 'SIGNED_OUT' && !saindo) irParaLogin();
            if (sessao && sessao.user) setTimeout(() => aplicarUsuario(sessao.user), 0);
        });

        try {
            const { data: { session } } = await db.auth.getSession();
            if (!session) { irParaLogin(); return; }
            aplicarUsuario(session.user);
        } catch (erro) { irParaLogin(); }
    }

    function iniciar() {
        setupTela(); // Ativa a lógica de data-layout
        setupCalendario();
        setupLayout();
        setupFicha();
        iniciarSessao();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();