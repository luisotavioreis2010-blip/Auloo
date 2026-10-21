(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;
    let arquivoCapa = null;
    let rascunhoSalvo = false;

    /* ===== Compressão via canvas ===== */
    function comprimirImagem(file, maxLado, qualidade) {
        return new Promise((resolve) => {
            if (!file || !/^image\//.test(file.type)) return resolve(file);
            if (file.type === 'image/gif') return resolve(file); // não recomprime gif

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let { width, height } = img;
                    if (width > maxLado || height > maxLado) {
                        const escala = Math.min(maxLado / width, maxLado / height);
                        width = Math.round(width * escala);
                        height = Math.round(height * escala);
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const tipoSaida = 'image/jpeg';
                    canvas.toBlob((blob) => {
                        if (!blob) return resolve(file);
                        const novo = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                            type: tipoSaida,
                            lastModified: Date.now()
                        });
                        resolve(novo.size < file.size ? novo : file);
                    }, tipoSaida, qualidade);
                };
                img.onerror = () => resolve(file);
                img.src = e.target.result;
            };
            reader.onerror = () => resolve(file);
            reader.readAsDataURL(file);
        });
    }

    /* ===== Sanitização do conteúdo ===== */
    function sanitizarHtml(html) {
        if (!html) return '';
        const doc = new DOMParser().parseFromString('<div id="__r">' + html + '</div>', 'text/html');
        const root = doc.getElementById('__r');
        if (!root) return '';

        const PROIBIDAS = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'style', 'link', 'meta'];
        PROIBIDAS.forEach((tag) => {
            Array.prototype.forEach.call(root.querySelectorAll(tag), (el) => el.remove());
        });

        Array.prototype.forEach.call(root.querySelectorAll('*'), (el) => {
            Array.prototype.slice.call(el.attributes).forEach((attr) => {
                const nome = attr.name.toLowerCase();
                if (nome.indexOf('on') === 0) el.removeAttribute(attr.name);
                if (nome === 'href' || nome === 'src' || nome === 'xlink:href') {
                    const v = String(attr.value || '').trim().toLowerCase();
                    if (v.indexOf('javascript:') === 0 || v.indexOf('data:text/html') === 0) {
                        el.removeAttribute(attr.name);
                    }
                }
            });
        });

        return root.innerHTML;
    }

    /* ===== Placeholder ===== */
    function limparPlaceholder() {
        const editor = $('input-conteudo');
        if (editor && editor.textContent.trim() === 'Comece a escrever sua história...') {
            editor.innerHTML = '';
        }
    }

    function conteudoValido() {
        const editor = $('input-conteudo');
        if (!editor) return false;
        const texto = (editor.textContent || '').trim();
        if (!texto) return false;
        if (texto === 'Comece a escrever sua história...') return false;
        return true;
    }

    async function aguardarSupabase() {
        for (let i = 0; i < 30; i++) {
            if (window.supabaseClient) return window.supabaseClient;
            await new Promise(r => setTimeout(r, 200));
        }
        return null;
    }

    async function iniciar() {
        db = await aguardarSupabase();
        if (!db) return console.error('Supabase não carregado.');

        const { data: { session } } = await db.auth.getSession();
        if (!session) return window.location.href = 'login.html';
        usuarioLogado = session.user;

        configurarToolbar();
        configurarCapa();
        configurarPublicacao();
        marcarStatus('Rascunho', false);
    }

    function marcarStatus(texto, sujo) {
        const el = $('editor-status');
        if (!el) return;
        el.textContent = texto;
        el.style.color = sujo ? 'var(--erro)' : 'var(--tinta-clara)';
    }

    function configurarToolbar() {
        const botoes = document.querySelectorAll('.editor-toolbar button[data-cmd]');
        const editor = $('input-conteudo');

        botoes.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                limparPlaceholder();
                const cmd = btn.getAttribute('data-cmd');
                const value = btn.getAttribute('data-value') || null;
                document.execCommand(cmd, false, value);
                editor.focus();
                marcarStatus('Rascunho não salvo', true);
            });
        });

        const btnImg = $('btn-inserir-img');
        const inputImg = $('input-img');

        btnImg.addEventListener('click', (e) => {
            e.preventDefault();
            inputImg.click();
        });

        inputImg.addEventListener('change', async () => {
            const fileOriginal = inputImg.files[0];
            inputImg.value = '';
            if (!fileOriginal) return;

            btnImg.disabled = true;
            const textoOriginal = btnImg.textContent;
            btnImg.textContent = '⏳';

            try {
                const file = await comprimirImagem(fileOriginal, 1400, 0.82);
                const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
                const path = usuarioLogado.id + '/img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;

                const { error } = await db.storage.from('avatars').upload(path, file, {
                    cacheControl: '3600',
                    contentType: file.type
                });

                if (error) throw error;

                const url = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                limparPlaceholder();
                document.execCommand('insertImage', false, url);
                marcarStatus('Rascunho não salvo', true);
            } catch (err) {
                console.error(err);
                alert('Erro ao inserir imagem.');
            } finally {
                btnImg.disabled = false;
                btnImg.textContent = textoOriginal;
            }
        });

        /* FIX: limpa placeholder no primeiro foco */
        if (editor) {
            editor.addEventListener('focus', limparPlaceholder, { once: true });
            editor.addEventListener('input', () => {
                marcarStatus('Rascunho não salvo', true);
                rascunhoSalvo = false;
            });
        }
    }

    function configurarCapa() {
        const capaEl = $('editor-capa');
        const inputCapa = document.createElement('input');
        inputCapa.type = 'file';
        inputCapa.accept = 'image/*';

        capaEl.addEventListener('click', () => inputCapa.click());

        inputCapa.addEventListener('change', async () => {
            const file = inputCapa.files[0];
            if (!file) return;

            try {
                const comprimida = await comprimirImagem(file, 1600, 0.82);
                arquivoCapa = comprimida;

                const reader = new FileReader();
                reader.onload = (e) => {
                    capaEl.style.backgroundImage = `url('${e.target.result}')`;
                    capaEl.style.backgroundSize = 'cover';
                    capaEl.style.backgroundPosition = 'center';
                    capaEl.innerHTML = '';
                };
                reader.readAsDataURL(comprimida);
                marcarStatus('Rascunho não salvo', true);
            } catch (err) {
                console.error(err);
            }
        });
    }

    function configurarPublicacao() {
        const btn = $('btn-publicar');
        const tituloEl = $('input-titulo');
        const conteudoEl = $('input-conteudo');

        [tituloEl, conteudoEl].forEach(el => {
            el.addEventListener('input', () => marcarStatus('Rascunho não salvo', true));
        });

        btn.addEventListener('click', async () => {
            const titulo = tituloEl.value.trim();
            const htmlCru = conteudoEl.innerHTML;

            if (!titulo) {
                alert('Adicione um título!');
                tituloEl.focus();
                return;
            }
            if (!conteudoValido()) {
                alert('Escreva algo no conteúdo!');
                conteudoEl.focus();
                return;
            }

            const conteudoSanitizado = sanitizarHtml(htmlCru);

            btn.disabled = true;
            btn.textContent = 'Publicando...';
            marcarStatus('Salvando...', false);

            try {
                let capaUrl = null;

                if (arquivoCapa) {
                    const ext = (arquivoCapa.name.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
                    const pathCapa = usuarioLogado.id + '/capa_' + Date.now() + '.' + ext;
                    const up = await db.storage.from('avatars').upload(pathCapa, arquivoCapa, {
                        contentType: arquivoCapa.type,
                        cacheControl: '3600'
                    });
                    if (up.error) throw up.error;
                    capaUrl = db.storage.from('avatars').getPublicUrl(pathCapa).data.publicUrl;
                }

                const categoria = $('input-categoria').value;

                const { error } = await db.from('posts').insert([{
                    author_id: usuarioLogado.id,
                    title: titulo,
                    content: conteudoSanitizado,
                    cover_url: capaUrl,
                    category: categoria
                }]);

                if (error) throw error;

                rascunhoSalvo = true;
                marcarStatus('Publicado com sucesso!', false);
                $('editor-status').style.color = 'var(--sucesso, #2E7D4F)';

                setTimeout(() => {
                    window.location.href = 'comunidade.html';
                }, 900);

            } catch (err) {
                console.error(err);
                alert('Erro ao publicar. Tente novamente.');
                btn.disabled = false;
                btn.textContent = 'Publicar';
                marcarStatus('Rascunho não salvo', true);
            }
        });

        /* Aviso ao sair com alterações */
        window.addEventListener('beforeunload', (e) => {
            if (rascunhoSalvo) return;
            const temTitulo = tituloEl.value.trim().length > 0;
            if (!temTitulo && !conteudoValido()) return;
            e.preventDefault();
            e.returnValue = '';
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();