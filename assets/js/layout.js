/* ==============================================
   LAYOUT.JS — v44 (Redirecionamento Novo Ateliê)
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
    const EXTENSOES_FOTO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
    const MENSAGEM_MS = 3000;
    const MENSAGEM_SAIDA_MS = 500;
    const IDS_CONTAINERS = ['container-editar-nome', 'container-editar-senha', 'container-criar-senha', 'container-saiba-mais'];
    const CAMPOS_SENHA = { 'container-editar-senha': ['input-senha-atual', 'input-senha-nova'], 'container-criar-senha': ['input-nova-senha-criar', 'input-confirmar-senha-criar'] };
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

    function verificar(resultado) { if (resultado && resultado.error) throw resultado.error; return resultado ? resultado.data : null; }
    function erroUsuario(texto) { const erro = new Error(texto); erro.paraUsuario = true; return erro; }
    function exigirSessao() { const db = getDb(); if (!db || !perfil.usuario) throw erroUsuario('Usuário não autenticado!'); return db; }

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
        if (!avatarUrl || avatarUrl === 'null') { container.appendChild(criarIniciais(nome)); return; }
        const img = document.createElement('img');
        img.className = 'foto-perfil';
        img.alt = 'Foto de perfil';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => { if (!img.parentNode) return; img.remove(); container.appendChild(criarIniciais(nome)); };
        img.src = avatarUrl;
        container.appendChild(img);
    }

    function valorDe(id) { const campo = $(id); return campo ? campo.value : ''; }
    function limparCampos(ids) { ids.forEach((id) => { const campo = $(id); if (campo) campo.value = ''; }); }
    function irParaLogin() { window.location.replace(PAGINA_LOGIN); }

    function sincronizarTela(forcar) {
        if (!document.body) return;
        if (!forcar && campoEmFoco()) return;
        const raiz = document.documentElement;
        raiz.style.setProperty('--viewport-h', window.innerHeight + 'px');
        const layout = window.innerWidth > window.innerHeight ? 'row' : 'stacked';
        if (raiz.getAttribute('data-layout') !== layout) raiz.setAttribute('data-layout', layout);
    }

    function campoEmFoco() {
        const ativo = document.activeElement;
        return !!ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA');
    }

    function setupTela() {
        let temporizador = null;
        let ultimaLargura = window.innerWidth;
        let ultimaAltura = window.innerHeight;

        function sincronizarSeNecessario() {
            if (campoEmFoco()) return;
            const larguraAtual = window.innerWidth;
            const alturaAtual = window.innerHeight;
            const larguraMudou = larguraAtual !== ultimaLargura;
            const orientacaoMudou = (larguraAtual > alturaAtual) !== (ultimaLargura > ultimaAltura);
            ultimaLargura = larguraAtual; ultimaAltura = alturaAtual;
            if (!larguraMudou && !orientacaoMudou) return;
            sincronizarTela(true);
        }

        window.addEventListener('resize', () => { clearTimeout(temporizador); temporizador = setTimeout(sincronizarSeNecessario, 250); });
        window.addEventListener('orientationchange', () => { setTimeout(sincronizarSeNecessario, 100); setTimeout(sincronizarSeNecessario, 400); });
        sincronizarTela(true);
    }

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
            for (let i = primeiroDiaSemana - 1; i >= 0; i--) { fragmento.appendChild(criarDia(diasMesAnterior - i, 'dia-outro-mes')); celulas++; }
            for (let i = 1; i <= diasNoMes; i++) {
                const ehHoje = i === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear();
                fragmento.appendChild(criarDia(i, ehHoje ? 'dia-atual' : '')); celulas++;
            }
            const faltam = (7 - (celulas % 7)) % 7;
            for (let i = 1; i <= faltam; i++) fragmento.appendChild(criarDia(i, 'dia-outro-mes'));
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

    function removerMensagem() { clearTimeout(temporizadorMensagem); const atual = $('mensagem-sidebar'); if (atual) atual.remove(); }

    function mostrarMensagem(texto, tipo) {
        tipo = tipo || 'sucesso';
        removerMensagem();
        const msg = document.createElement('div');
        msg.id = 'mensagem-sidebar';
        msg.className = 'mensagem-sidebar mensagem-sidebar--' + tipo;
        msg.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
        msg.textContent = texto;
        const referencia = $('container-editar-senha');
        if (referencia && referencia.parentNode) referencia.parentNode.insertBefore(msg, referencia);
        else {
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
            const aberto = ids.some((id) => { const alvo = $(id); return !!alvo && !alvo.hidden; });
            if (ids.every((id) => IDS_CONTAINERS.indexOf(id) !== -1)) gatilho.setAttribute('aria-expanded', String(aberto));
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

    function fecharTodosContainers() { IDS_CONTAINERS.forEach(fecharContainer); sincronizarAria(); }

    function alternarContainer(id) {
        const alvo = $(id);
        if (!alvo) return;
        const estavaAberto = !alvo.hidden;
        IDS_CONTAINERS.forEach(fecharContainer);
        alvo.hidden = estavaAberto;
        sincronizarAria();
    }

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
        } catch (erro) { /* ignora */ }
        finally { perfilCarregandoId = null; }
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

    /* ============================================
       CARDS DE ATELIÊ GLOBAIS NA SIDEBAR
       ============================================ */
    function criarBotaoNovoAtelie() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'sidebar-novo-atelie-btn-global';
        btn.className = 'btn-add-custom';
        btn.innerHTML = `
            <span class="button__text">Novo Ateliê</span>
            <span class="button__icon">
                <svg class="svg" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
                    <line x1="12" x2="12" y1="5" y2="19"></line>
                    <line x1="5" x2="19" y1="12" y2="12"></line>
                </svg>
            </span>
        `;
        btn.addEventListener('click', () => {
            // CORREÇÃO: Se estiver em outra página, manda o parâmetro ?novo=true
            const noAtelie = window.location.pathname.includes('atelie.html');
            const temModal = typeof window.abrirModalCriarAtelie === 'function';
            
            if (noAtelie && temModal) {
                window.abrirModalCriarAtelie();
            } else {
                window.location.href = 'atelie.html?novo=true';
            }
        });
        return btn;
    }

    async function renderizarCardsAtelies() {
        const lista = $('sidebar-atelies-lista');
        if (!lista || !perfil.usuario) return;
        const db = getDb();
        if (!db) return;

        try {
            const { data: atelies, error } = await db
                .from('ateliers')
                .select('id, name, avatar_url, cover_url, handle')
                .eq('owner_id', perfil.usuario.id)
                .order('created_at', { ascending: true });

            if (error) throw error;

            lista.innerHTML = '';

            const btnAntigo = $('sidebar-novo-atelie-btn-global');
            if (btnAntigo) btnAntigo.remove();

            if (atelies && atelies.length > 0) {
                const urlParams = new URLSearchParams(window.location.search);
                const atelieAtivoId = urlParams.get('id')
                    || localStorage.getItem('auloo:atelieAtivo')
                    || (window.estado && window.estado.atelieAtivo ? window.estado.atelieAtivo.id : null);

                atelies.forEach(function (atelie) {
                    const li = document.createElement('li');
                    li.className = 'sidebar-atelie-card' + (atelieAtivoId === atelie.id ? ' ativo' : '');
                    li.title = atelie.name;
                    li.dataset.atelieId = atelie.id;

                    const avatarHtml = atelie.avatar_url
                        ? '<img src="' + atelie.avatar_url + '" alt="Avatar">'
                        : '<span>' + (atelie.name ? atelie.name.substring(0, 2).toUpperCase() : 'AT') + '</span>';

                    li.innerHTML =
                        '<div class="sidebar-atelie-capa">' +
                            (atelie.cover_url ? '<img src="' + atelie.cover_url + '" alt="Capa">' : '') +
                        '</div>' +
                        '<div class="sidebar-atelie-avatar">' + avatarHtml + '</div>' +
                        '<div class="sidebar-atelie-info">' +
                            '<h3 class="sidebar-atelie-nome">' + (atelie.name || 'Sem nome') + '</h3>' +
                        '</div>';

                    li.addEventListener('click', function () {
                        lista.querySelectorAll('.sidebar-atelie-card').forEach(function (c) {
                            c.classList.remove('ativo');
                        });
                        li.classList.add('ativo');

                        if (window.location.pathname.includes('atelie.html') && typeof window.trocarAtelie === 'function') {
                            window.trocarAtelie(atelie.id);
                        } else {
                            window.location.href = 'atelie.html?id=' + atelie.id;
                        }

                        const sidebar = $('sidebar');
                        const overlay = $('gaveta-overlay');
                        if (sidebar) sidebar.classList.remove('aberta');
                        if (overlay) overlay.classList.remove('ativo');
                    });

                    lista.appendChild(li);
                });
            }

            const menu = lista.parentNode;
            if (menu) {
                menu.appendChild(criarBotaoNovoAtelie());
            }

        } catch (err) {
            console.error('Erro ao carregar ateliês na sidebar:', err);
        }
    }

    window.utils = window.utils || {};
    window.utils.renderizarCardsAtelies = renderizarCardsAtelies;

    /* ============================================
       RESTO DO LAYOUT
       ============================================ */
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
        } catch (erro) { /* ignora */ }
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
            } catch (erro) { /* ignora */ }
            finally { clearTimeout(temporizador); }
        }
        limparArmazenamento();
        irParaLogin();
    }

    async function executarAcao(botao, acao) {
        if (botao.disabled) return;
        botao.disabled = true;
        try { await acao(); }
        catch (erro) {
            if (erro && erro.paraUsuario) mostrarMensagem(erro.message, 'erro');
            else mostrarMensagem('Erro: ' + (erro && erro.message ? erro.message : erro), 'erro');
        }
        finally { botao.disabled = false; }
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
        verificar(await db.from('profiles').upsert({
            id: perfil.usuario.id, full_name: novoNome, email: perfil.email, updated_at: new Date().toISOString()
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
        try { await db.storage.from(BUCKET_AVATARES).remove([caminho]); } catch (erro) { /* ignora */ }
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
            cacheControl: '3600', contentType: arquivo.type
        }));
        try {
            const urlPublica = db.storage.from(BUCKET_AVATARES).getPublicUrl(caminho).data.publicUrl;
            verificar(await db.auth.updateUser({ data: { avatar_url: urlPublica } }));
            verificar(await db.from('profiles').upsert({
                id: usuarioId, avatar_url: urlPublica, updated_at: new Date().toISOString()
            }));
            perfil.avatarUrl = urlPublica;
            renderizarPerfil();
            mostrarMensagem('Foto atualizada!');
        } catch (erro) {
            await removerArquivoAvatar(db, caminho);
            throw erro;
        }
        removerArquivoAvatar(db, caminhoDoAvatar(avatarAnterior, usuarioId));
    }

    function ligarFormulario(idForm, idBotao, acao) {
        const formulario = $(idForm);
        const botao = $(idBotao);
        if (!formulario || !botao) return;
        formulario.addEventListener('submit', (e) => { e.preventDefault(); executarAcao(botao, acao); });
    }

    function setupPerfil() {
        let btnSair = $('btn-sair');
        if (!btnSair) {
            const navbarDir = document.querySelector('.navbar-right') || document.querySelector('.editor-topo-dir') || document.querySelector('.navbar-left');
            if (navbarDir) {
                btnSair = document.createElement('button');
                btnSair.type = 'button';
                btnSair.className = 'morph-btn-sair';
                btnSair.id = 'btn-sair';
                btnSair.innerHTML = `
                    <span class="btn-fill"></span>
                    <span class="shadow"></span>
                    <span class="btn-text"><span style="--i:0">S</span><span style="--i:1">a</span><span style="--i:2">i</span><span style="--i:3">r</span></span>
                    <span class="orbit-dots"><span></span><span></span><span></span><span></span></span>
                    <span class="corners"><span></span><span></span><span></span><span></span></span>
                `;
                navbarDir.appendChild(btnSair);
            }
        }
        if (btnSair) btnSair.addEventListener('click', () => { btnSair.disabled = true; fazerLogout(); });

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
                const idContainer = usuarioTemSenha() ? 'container-editar-senha' : 'container-criar-senha';
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
            if (overlay) overlay.classList.toggle('ativa', sidebarAberta() || (mqCompacto.matches && fichaAberta()));
            if (btnHamburger) btnHamburger.setAttribute('aria-expanded', String(sidebarAberta()));
            if (perfilBotao) perfilBotao.setAttribute('aria-expanded', String(fichaAberta()));
        }

        if (perfilBotao) perfilBotao.addEventListener('click', () => {
            if (fichaAberta()) { ficha.classList.remove('ativa'); document.body.classList.remove('ficha-aberta'); fecharTodosContainers(); atualizarEstado(); }
            else { ficha.classList.add('ativa'); document.body.classList.add('ficha-aberta'); ajustarLarguraFicha(); atualizarEstado(); }
        });
        if (fichaFechar) fichaFechar.addEventListener('click', () => {
            ficha.classList.remove('ativa'); document.body.classList.remove('ficha-aberta'); fecharTodosContainers(); atualizarEstado();
        });
        if (btnHamburger) btnHamburger.addEventListener('click', () => {
            if (sidebarAberta()) { sidebar.classList.remove('aberta'); atualizarEstado(); }
            else { sidebar.classList.add('aberta'); atualizarEstado(); }
        });
        if (overlay) overlay.addEventListener('click', () => {
            sidebar.classList.remove('aberta');
            ficha.classList.remove('ativa');
            document.body.classList.remove('ficha-aberta');
            atualizarEstado();
        });

        document.addEventListener('click', (e) => {
            const alvo = e.target;
            if (sidebarAberta() && !sidebar.contains(alvo) && !(btnHamburger && btnHamburger.contains(alvo))) { sidebar.classList.remove('aberta'); atualizarEstado(); }
            if (mqCompacto.matches && fichaAberta() && !ficha.contains(alvo) && !(perfilBotao && perfilBotao.contains(alvo)) && !campoEmFoco()) {
                ficha.classList.remove('ativa'); document.body.classList.remove('ficha-aberta'); atualizarEstado();
            }
        });

        if (sidebar) sidebar.addEventListener('click', (e) => {
            if (mqCompacto.matches && e.target.closest('.sidebar-link')) { sidebar.classList.remove('aberta'); atualizarEstado(); }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            sidebar.classList.remove('aberta');
            ficha.classList.remove('ativa');
            document.body.classList.remove('ficha-aberta');
            atualizarEstado();
        });

        function aoCruzarBreakpoint() {
            sidebar.classList.remove('aberta');
            ficha.classList.remove('ativa');
            document.body.classList.remove('ficha-aberta');
            if (campoEmFoco()) document.activeElement.blur();
            sincronizarTela(true);
            resetarScroll();
            ajustarLarguraFicha();
        }
        if (mqCompacto.addEventListener) mqCompacto.addEventListener('change', aoCruzarBreakpoint);
        else if (mqCompacto.addListener) mqCompacto.addListener(aoCruzarBreakpoint);
    }

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
        if (!db) { irParaLogin(); return; }
        db.auth.onAuthStateChange((evento, sessao) => {
            if (evento === 'SIGNED_OUT') { if (!saindo) irParaLogin(); return; }
            if (sessao && sessao.user) setTimeout(() => aplicarUsuario(sessao.user), 0);
        });
        try {
            const sessao = await aguardarSessao(db);
            if (!sessao) { irParaLogin(); return; }
            aplicarUsuario(sessao.user);
        } catch (erro) { irParaLogin(); }
    }

    if (document.body) sincronizarTela();

    function iniciar() {
        setupTela();
        setupPerfil();
        setupLayout();
        setupCalendario();
        iniciarSessao().then(() => {
            renderizarCardsAtelies();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();