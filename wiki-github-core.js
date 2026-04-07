/**
 * GitHub版 Wiki 核心系统
 * 功能：前后台模式分离，GitHub存储，存档分享码
 */

const app = {
    // ========== 应用状态 ==========
    data: {
        entries: [],
        chapters: [],
        camps: [],
        synopsis: [],
        currentTimeline: 'latest',
        currentMode: 'view',
        editingId: null,
        editingType: null,
        viewingVersionId: null,
        wikiTitle: '未命名 Wiki',
        wikiSubtitle: '',
        fontFamily: "'Noto Sans SC', sans-serif"
    },
    
    // 运行模式：'backend'(后台/编辑) 或 'frontend'(前台/只读)
    runMode: 'frontend',
    
    // 分享码验证状态
    shareCodeVerified: false,
    verifiedShareCode: null,
    
    // 临时编辑数据
    tempEntry: null,
    tempVersion: null,
    editingVersionId: null,
    
    // 编辑状态追踪
    editState: {
        originalEntry: null,
        originalVersion: null,
        hasChanges: false,
        undoStack: [],
        redoStack: []
    },

    // ========== 初始化 ==========
    init() {
        // 检查是否有保存的分享码
        const savedCode = localStorage.getItem('wiki_verified_sharecode');
        if (savedCode) {
            this.verifiedShareCode = savedCode;
            this.shareCodeVerified = true;
            this.loadDataFromLocal();
            this.router('home');
            return;
        }
        
        // 检查GitHub配置
        if (this.githubStorage && this.githubStorage.init()) {
            this.runMode = 'backend';
            this.loadDataFromGitHub();
        } else {
            // 显示登录界面
            this.showLoginPage();
        }
    },

    // ========== 页面路由 ==========
    router(target, pushState = true) {
        const container = document.getElementById('main-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        // 更新导航状态
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const isActive = btn.dataset.target === target;
            btn.classList.toggle('text-indigo-600', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
        });
        
        // 根据目标渲染不同页面
        switch(target) {
            case 'home':
                this.renderHome(container);
                break;
            case 'characters':
                this.renderList(container, 'character');
                break;
            case 'non-characters':
                this.renderList(container, 'non-character');
                break;
            case 'settings':
                this.renderSettings(container);
                break;
            case 'detail':
                this.renderDetail(container);
                break;
            case 'edit':
                if (this.runMode === 'backend') {
                    this.renderEdit(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('home');
                }
                break;
            default:
                this.renderHome(container);
        }
        
        if (pushState) {
            history.pushState({ target }, '', `#${target}`);
        }
    },

    // ========== 登录页面 ==========
    showLoginPage() {
        const container = document.getElementById('main-container');
        if (!container) return;
        
        const tpl = document.getElementById('tpl-login');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
    },

    // 切换到分享码登录
    enterFrontendMode() {
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('share-code-form').classList.remove('hidden');
    },

    // 返回GitHub登录
    showLoginForm() {
        document.getElementById('share-code-form').classList.add('hidden');
        document.getElementById('login-form').classList.remove('hidden');
    },

    // 连接GitHub
    async connectToGitHub() {
        const owner = document.getElementById('github-owner').value.trim();
        const repo = document.getElementById('github-repo').value.trim();
        const token = document.getElementById('github-token').value.trim();
        const branch = document.getElementById('github-branch').value.trim() || 'main';
        
        if (!owner || !repo || !token) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请填写所有必填项',
                type: 'warning'
            });
            return;
        }
        
        this.githubStorage.saveConfig(owner, repo, token, branch);
        
        const result = await this.githubStorage.testConnection();
        if (result.success) {
            this.runMode = 'backend';
            this.showToast('连接成功', 'success');
            this.loadDataFromGitHub();
        } else {
            this.showAlertDialog({
                title: '连接失败',
                message: result.error || '无法连接到GitHub仓库',
                type: 'error'
            });
            this.githubStorage.clearConfig();
        }
    },

    // 断开GitHub连接
    disconnectGitHub() {
        this.githubStorage.clearConfig();
        location.reload();
    },

    // 验证分享码
    async verifyShareCode() {
        const input = document.getElementById('share-code-input');
        const code = input.value.trim().toUpperCase();
        
        if (!this.shareCodeSystem.validateCode(code)) {
            this.showAlertDialog({
                title: '格式错误',
                message: '分享码应为8位字母数字组合',
                type: 'warning'
            });
            return;
        }
        
        // 先配置GitHub（从前台模式配置中读取）
        const frontendConfig = localStorage.getItem('wiki_frontend_config');
        if (frontendConfig) {
            try {
                const config = JSON.parse(frontendConfig);
                this.githubStorage.saveConfig(
                    config.owner, config.repo, config.token, config.branch, config.dataPath
                );
            } catch (e) {
                this.showAlertDialog({
                    title: '配置错误',
                    message: '前台模式配置无效，请联系管理员',
                    type: 'error'
                });
                return;
            }
        } else {
            this.showAlertDialog({
                title: '配置缺失',
                message: '前台模式需要预配置，请联系管理员',
                type: 'error'
            });
            return;
        }
        
        const isValid = await this.shareCodeSystem.verifyCode(code);
        
        if (isValid) {
            this.shareCodeVerified = true;
            this.verifiedShareCode = code;
            localStorage.setItem('wiki_verified_sharecode', code);
            this.showToast('验证成功', 'success');
            this.loadDataFromGitHub();
        } else {
            this.showAlertDialog({
                title: '验证失败',
                message: '分享码无效或已过期',
                type: 'error'
            });
        }
    },

    // ========== 数据加载 ==========
    async loadDataFromGitHub() {
        try {
            const data = await this.githubStorage.loadWikiData();
            if (data) {
                this.data = { ...this.data, ...data };
                this.applyFont();
                this.updateUIForMode();
                this.router('home');
            } else {
                // 首次使用，创建空数据
                this.data.entries = [];
                this.data.chapters = [];
                this.data.camps = ['主角团', '反派', '中立'];
                this.data.synopsis = [];
                this.updateUIForMode();
                this.router('home');
            }
        } catch (error) {
            console.error('加载数据失败:', error);
            this.showAlertDialog({
                title: '加载失败',
                message: '无法从GitHub加载数据',
                type: 'error'
            });
        }
    },

    loadDataFromLocal() {
        const saved = localStorage.getItem('wiki_data_backup');
        if (saved) {
            try {
                this.data = JSON.parse(saved);
            } catch (e) {
                console.error('本地数据解析失败');
            }
        }
        this.updateUIForMode();
    },

    // ========== 根据模式更新UI ==========
    updateUIForMode() {
        // 更新模式徽章
        const badge = document.getElementById('mode-badge');
        if (badge) {
            badge.classList.remove('hidden');
            badge.className = `mode-badge ${this.runMode}`;
            badge.textContent = this.runMode === 'backend' ? '后台模式' : '前台模式';
        }
        
        // 显示/隐藏编辑相关元素
        document.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        // 显示/隐藏模式切换
        const modeSwitch = document.getElementById('mode-switch-container');
        if (modeSwitch) {
            modeSwitch.classList.toggle('hidden', this.runMode !== 'backend');
        }
        
        // 更新标题
        document.getElementById('wiki-title-display').textContent = this.data.wikiTitle || '未命名 Wiki';
    },

    // ========== 页面渲染 ==========
    renderHome(container) {
        const tpl = document.getElementById('tpl-home');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        // 更新欢迎信息
        clone.getElementById('welcome-title').textContent = this.data.wikiTitle || '欢迎来到 Wiki';
        clone.getElementById('welcome-subtitle').textContent = this.data.wikiSubtitle || '探索角色、世界观与错综复杂的关系网。';
        
        // 显示/隐藏编辑按钮
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        container.appendChild(clone);
    },

    renderList(container, type) {
        const tpl = document.getElementById('tpl-list');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        const masonry = clone.getElementById('masonry-container');
        const countBadge = clone.getElementById('list-count');
        const title = clone.getElementById('list-title');
        
        title.textContent = type === 'character' ? '角色' : '设定';
        
        // 显示/隐藏编辑按钮
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        let items = this.data.entries.filter(e => e.type === type);
        if (countBadge) countBadge.textContent = items.length;
        
        if (items.length === 0) {
            masonry.innerHTML = '<div class="col-span-full text-center py-10 text-gray-400">暂无数据</div>';
        } else {
            items.forEach(entry => {
                const version = this.getVisibleVersion(entry) || entry.versions?.[0];
                if (version) {
                    const card = this.createEntryCard(entry, version);
                    if (card) masonry.appendChild(card);
                }
            });
        }
        
        container.appendChild(clone);
    },

    renderSettings(container) {
        const tpl = document.getElementById('tpl-settings');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        // 显示/隐藏编辑相关设置
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        // 更新GitHub仓库显示
        if (this.runMode === 'backend' && this.githubStorage.isConfigured()) {
            const repoDisplay = clone.getElementById('github-repo-display');
            if (repoDisplay) {
                repoDisplay.textContent = `${this.githubStorage.config.owner}/${this.githubStorage.config.repo}`;
            }
            
            // 加载分享码列表
            this.loadShareCodeList(clone.getElementById('share-code-list'));
        }
        
        container.appendChild(clone);
    },

    renderDetail(container) {
        const entry = this.data.entries.find(e => e.id === this.data.editingId);
        if (!entry) {
            container.innerHTML = '<div class="p-4 text-red-600">条目不存在</div>';
            return;
        }
        
        const version = this.getVisibleVersion(entry) || entry.versions?.[entry.versions.length - 1];
        if (!version) {
            container.innerHTML = '<div class="p-4 text-red-600">该条目没有内容</div>';
            return;
        }
        
        const tpl = document.getElementById('tpl-detail-view');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        clone.getElementById('detail-code').textContent = entry.code;
        
        // 显示/隐藏编辑按钮
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        const contentEl = clone.getElementById('detail-content');
        
        // 渲染内容
        let contentHtml = `
            <div class="flex flex-col md:flex-row gap-6 mb-6">
                <div class="flex-1">
                    <h1 class="text-3xl font-bold text-gray-900 mb-3">${version.title}</h1>
                    ${version.subtitle ? `<p class="text-lg italic text-gray-600 border-l-4 border-indigo-300 pl-4">${version.subtitle}</p>` : ''}
                </div>
        `;
        
        // 图片
        const img = version.images?.card || version.images?.avatar || version.image;
        if (img) {
            contentHtml += `
                <div class="w-48 shrink-0">
                    <div class="aspect-[3/4] rounded-xl overflow-hidden shadow-lg bg-gray-100">
                        <img src="${img}" class="w-full h-full object-cover" alt="${version.title}">
                    </div>
                </div>
            `;
        }
        
        contentHtml += '</div>';
        
        // 正文块
        contentHtml += '<div class="prose prose-sm max-w-none">';
        if (version.blocks && version.blocks.length > 0) {
            version.blocks.forEach(block => {
                if (block.type === 'h2') {
                    contentHtml += `<h2 class="text-xl font-bold text-gray-800 mt-8 mb-4 border-b pb-2">${block.text}</h2>`;
                } else if (block.type === 'h3') {
                    contentHtml += `<h3 class="text-lg font-bold text-gray-700 mt-6 mb-3">${block.text}</h3>`;
                } else {
                    // 处理链接
                    let text = block.text || '';
                    text = text.replace(/\[\[(.*?)\]\]/g, '<a href="#" onclick="app.searchAndOpen(\'$1\'); return false;" class="text-indigo-600 hover:underline">$1</a>');
                    contentHtml += `<p class="text-gray-600 leading-relaxed mb-4 break-all">${text}</p>`;
                }
            });
        }
        contentHtml += '</div>';
        
        contentEl.innerHTML = contentHtml;
        container.appendChild(clone);
    },

    // ========== 词条卡片 ==========
    createEntryCard(entry, version) {
        const div = document.createElement('div');
        div.className = 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-300 active:scale-95 flex flex-col w-3/4 mx-auto';
        div.onclick = () => this.openEntry(entry.id);
        
        // 删除按钮（仅后台模式）
        if (this.runMode === 'backend') {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'absolute top-8 right-2 w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg z-30 transition-all transform hover:scale-110 border-2 border-white';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can text-xs"></i>';
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                const confirmed = await this.showConfirmDialog({
                    title: '删除确认',
                    message: `确定删除 "${version.title}" (${entry.code})？`,
                    confirmText: '删除',
                    cancelText: '取消',
                    type: 'danger'
                });
                if (confirmed) {
                    this.deleteEntry(entry.id);
                }
            };
            div.appendChild(deleteBtn);
        }
        
        const img = version.images?.card || version.images?.avatar || version.image || '';
        const hasImage = img && (img.startsWith('data:') || img.startsWith('http'));
        
        div.innerHTML = `
            <div class="relative aspect-[3/4] overflow-hidden bg-gray-100 shrink-0">
                ${hasImage ? 
                    `<img src="${img}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-110" alt="${version.title}">` :
                    `<div class="w-full h-full flex items-center justify-center text-gray-300"><i class="fa-solid fa-user text-4xl"></i></div>`
                }
                <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
                    <div class="text-white font-bold text-sm truncate">${version.title}</div>
                    <div class="text-white/80 text-xs font-mono truncate">${entry.code}</div>
                </div>
            </div>
            <div class="p-3 flex-1 flex flex-col justify-between min-h-[60px]">
                <p class="text-xs text-gray-500 line-clamp-2">${version.subtitle || ''}</p>
            </div>
        `;
        
        return div;
    },

    // ========== 词条操作 ==========
    openEntry(id) {
        this.data.editingId = id;
        this.router('detail');
    },

    createEntry(type) {
        this.data.editingType = type;
        this.data.editingId = null;
        this.router('edit');
    },

    createEntryFromList() {
        const type = this.data.currentTarget === 'characters' ? 'character' : 'non-character';
        this.createEntry(type);
    },

    editCurrentEntry() {
        this.router('edit');
    },

    // ========== 保存词条 ==========
    async saveEntry() {
        if (!this.tempEntry || !this.tempVersion) return;
        
        // 收集表单数据
        this.tempVersion.title = document.getElementById('edit-title').value.trim();
        this.tempVersion.subtitle = document.getElementById('edit-subtitle').value.trim();
        
        if (!this.tempVersion.title) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请输入版本名称',
                type: 'warning'
            });
            return;
        }
        
        // 更新或添加词条
        const existingIndex = this.data.entries.findIndex(e => e.id === this.tempEntry.id);
        if (existingIndex >= 0) {
            this.data.entries[existingIndex] = this.tempEntry;
        } else {
            this.data.entries.push(this.tempEntry);
        }
        
        // 保存到GitHub
        try {
            await this.githubStorage.saveWikiData(this.data);
            this.showToast('保存成功', 'success');
            this.editState.hasChanges = false;
            this.tempEntry = null;
            this.tempVersion = null;
            this.router('home');
        } catch (error) {
            console.error('保存失败:', error);
            this.showAlertDialog({
                title: '保存失败',
                message: '无法保存到GitHub，请检查网络连接',
                type: 'error'
            });
        }
    },

    // ========== 删除词条 ==========
    async deleteEntry(id) {
        const index = this.data.entries.findIndex(e => e.id === id);
        if (index >= 0) {
            this.data.entries.splice(index, 1);
            
            try {
                await this.githubStorage.saveWikiData(this.data);
                this.showToast('删除成功', 'success');
                this.router('home');
            } catch (error) {
                console.error('删除失败:', error);
                this.showAlertDialog({
                    title: '删除失败',
                    message: '无法保存更改',
                    type: 'error'
                });
            }
        }
    },

    // ========== 取消编辑 ==========
    async cancelEdit() {
        if (!this.editState.hasChanges && this.editState.undoStack.length === 0) {
            this.tempEntry = null;
            this.tempVersion = null;
            this.data.editingType = null;
            this.router('home');
            return;
        }
        
        const confirmed = await this.showConfirmDialog({
            title: '放弃编辑',
            message: '确定放弃当前编辑？\n未保存的修改将丢失。',
            confirmText: '放弃',
            cancelText: '继续编辑',
            type: 'warning'
        });
        
        if (confirmed) {
            this.tempEntry = null;
            this.tempVersion = null;
            this.data.editingType = null;
            this.editState.hasChanges = false;
            this.editState.undoStack = [];
            this.editState.redoStack = [];
            this.router('home');
        }
    },

    // ========== 分享码管理 ==========
    async generateShareCode() {
        const codeInput = document.getElementById('new-share-code');
        const descInput = document.getElementById('share-code-desc');
        
        let code = codeInput.value.trim().toUpperCase();
        if (!code) {
            code = this.shareCodeSystem.generateCode();
        }
        
        if (!this.shareCodeSystem.validateCode(code)) {
            this.showAlertDialog({
                title: '格式错误',
                message: '分享码应为8位字母数字组合',
                type: 'warning'
            });
            return;
        }
        
        const success = await this.shareCodeSystem.saveShareCode(code, descInput.value);
        
        if (success) {
            this.showToast('分享码已生成', 'success');
            codeInput.value = '';
            descInput.value = '';
            this.loadShareCodeList(document.getElementById('share-code-list'));
        } else {
            this.showAlertDialog({
                title: '生成失败',
                message: '无法保存分享码',
                type: 'error'
            });
        }
    },

    async loadShareCodeList(container) {
        if (!container) return;
        
        const codes = await this.shareCodeSystem.loadShareCodes();
        container.innerHTML = '';
        
        Object.entries(codes).forEach(([code, info]) => {
            const item = document.createElement('div');
            item.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg';
            item.innerHTML = `
                <div class="flex items-center gap-3">
                    <span class="font-mono font-bold text-amber-600">${code}</span>
                    ${info.description ? `<span class="text-xs text-gray-500">${info.description}</span>` : ''}
                </div>
                <div class="flex gap-2">
                    <button onclick="app.copyShareCode('${code}')" class="text-gray-500 hover:text-indigo-600 p-1" title="复制">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                    <button onclick="app.deleteShareCode('${code}')" class="text-gray-500 hover:text-red-600 p-1" title="删除">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            container.appendChild(item);
        });
        
        if (Object.keys(codes).length === 0) {
            container.innerHTML = '<p class="text-center text-gray-400 text-sm py-4">暂无分享码</p>';
        }
    },

    async deleteShareCode(code) {
        const confirmed = await this.showConfirmDialog({
            title: '删除确认',
            message: `确定删除分享码 ${code}？`,
            confirmText: '删除',
            cancelText: '取消',
            type: 'danger'
        });
        
        if (confirmed) {
            await this.shareCodeSystem.deleteCode(code);
            this.loadShareCodeList(document.getElementById('share-code-list'));
        }
    },

    copyShareCode(code) {
        navigator.clipboard.writeText(code).then(() => {
            this.showToast('已复制到剪贴板', 'success');
        });
    },

    // ========== 数据导出 ==========
    exportData() {
        const dataStr = JSON.stringify(this.data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wiki-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('数据已导出', 'success');
    },

    async exportZipBackup() {
        const JSZip = window.JSZip;
        if (!JSZip) {
            this.showToast('ZIP库未加载', 'error');
            return;
        }
        
        const zip = new JSZip();
        zip.file('data.json', JSON.stringify(this.data, null, 2));
        
        // 添加图片
        const imagesFolder = zip.folder('images');
        const imageList = await this.githubStorage.getImageList();
        
        for (const filename of imageList) {
            const imgUrl = await this.githubStorage.loadImage(filename);
            if (imgUrl) {
                try {
                    const response = await fetch(imgUrl);
                    const blob = await response.blob();
                    imagesFolder.file(filename, blob);
                } catch (e) {
                    console.warn('无法下载图片:', filename);
                }
            }
        }
        
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wiki-backup-${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('备份已导出', 'success');
    },

    // ========== 字体设置 ==========
    changeFont(font) {
        this.data.fontFamily = font;
        document.documentElement.style.setProperty('--custom-font', font);
        this.applyFont();
    },

    applyFont() {
        document.body.style.fontFamily = this.data.fontFamily;
    },

    // ========== 辅助函数 ==========
    getVisibleVersion(entry) {
        if (!entry || !entry.versions) return null;
        
        if (this.data.currentTimeline === 'latest') {
            return entry.versions[entry.versions.length - 1];
        }
        
        const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
        if (!currentCh) return entry.versions[entry.versions.length - 1];
        
        return entry.versions.find(v => {
            const fromOrder = this.getChapterOrder(v.chapterFrom);
            const toOrder = this.getChapterOrder(v.chapterTo);
            return currentCh.order >= fromOrder && currentCh.order <= toOrder;
        }) || entry.versions[entry.versions.length - 1];
    },

    getChapterOrder(chapterId) {
        if (!chapterId) return -1;
        const chapter = this.data.chapters.find(c => c.id === chapterId);
        return chapter ? chapter.order : -1;
    },

    searchAndOpen(name) {
        const entry = this.data.entries.find(e => {
            const v = this.getVisibleVersion(e);
            return v && v.title === name;
        });
        
        if (entry) {
            this.openEntry(entry.id);
        } else {
            this.showToast('未找到该词条', 'warning');
        }
    },

    // ========== 弹窗系统 ==========
    showConfirmDialog(options) {
        return new Promise((resolve) => {
            const { title = '确认', message, confirmText = '确认', cancelText = '取消', type = 'info' } = options;
            
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay fade-in';
            
            const iconColors = {
                info: 'text-blue-600 bg-blue-100',
                warning: 'text-amber-600 bg-amber-100',
                danger: 'text-red-600 bg-red-100',
                success: 'text-green-600 bg-green-100'
            };
            
            const icons = {
                info: 'fa-circle-info',
                warning: 'fa-triangle-exclamation',
                danger: 'fa-circle-exclamation',
                success: 'fa-check-circle'
            };
            
            overlay.innerHTML = `
                <div class="modal-content p-6">
                    <div class="text-center mb-6">
                        <div class="w-16 h-16 ${iconColors[type]} rounded-full flex items-center justify-center mx-auto mb-4">
                            <i class="fa-solid ${icons[type]} text-2xl"></i>
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>
                        <p class="text-gray-600 text-sm whitespace-pre-wrap">${message}</p>
                    </div>
                    <div class="flex gap-3">
                        <button id="confirm-cancel" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">
                            ${cancelText}
                        </button>
                        <button id="confirm-ok" class="flex-1 py-2.5 ${type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white rounded-lg transition font-medium shadow-lg">
                            ${confirmText}
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            overlay.querySelector('#confirm-cancel').onclick = () => {
                overlay.remove();
                resolve(false);
            };
            
            overlay.querySelector('#confirm-ok').onclick = () => {
                overlay.remove();
                resolve(true);
            };
            
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(false);
                }
            };
        });
    },

    showAlertDialog(options) {
        return new Promise((resolve) => {
            const { title = '提示', message, confirmText = '确定', type = 'info' } = options;
            
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay fade-in';
            
            const iconColors = {
                info: 'text-blue-600 bg-blue-100',
                warning: 'text-amber-600 bg-amber-100',
                danger: 'text-red-600 bg-red-100',
                success: 'text-green-600 bg-green-100'
            };
            
            const icons = {
                info: 'fa-circle-info',
                warning: 'fa-triangle-exclamation',
                danger: 'fa-circle-exclamation',
                success: 'fa-check-circle'
            };
            
            overlay.innerHTML = `
                <div class="modal-content p-6">
                    <div class="text-center mb-6">
                        <div class="w-16 h-16 ${iconColors[type]} rounded-full flex items-center justify-center mx-auto mb-4">
                            <i class="fa-solid ${icons[type]} text-2xl"></i>
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>
                        <p class="text-gray-600 text-sm whitespace-pre-wrap">${message}</p>
                    </div>
                    <button id="alert-ok" class="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium shadow-lg">
                        ${confirmText}
                    </button>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            overlay.querySelector('#alert-ok').onclick = () => {
                overlay.remove();
                resolve(true);
            };
            
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(true);
                }
            };
        });
    },

    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `fixed top-20 left-1/2 transform -translate-x-1/2 z-[99999] px-4 py-2 rounded-lg shadow-lg text-white text-sm flex items-center gap-2 fade-in`;
        
        const colors = {
            info: 'bg-blue-600',
            success: 'bg-green-600',
            warning: 'bg-amber-600',
            error: 'bg-red-600'
        };
        
        toast.classList.add(colors[type] || colors.info);
        
        const icons = {
            info: 'fa-circle-info',
            success: 'fa-check-circle',
            warning: 'fa-triangle-exclamation',
            error: 'fa-circle-exclamation'
        };
        
        toast.innerHTML = `
            <i class="fa-solid ${icons[type]}"></i>
            <span>${message}</span>
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    // ========== 搜索功能 ==========
    handleSearchInput(value) {
        const dropdown = document.getElementById('search-dropdown');
        if (!value.trim()) {
            dropdown.classList.add('hidden');
            return;
        }
        
        const results = this.data.entries.filter(e => {
            const v = this.getVisibleVersion(e);
            return v && (e.code.toLowerCase().includes(value.toLowerCase()) || 
                        v.title.toLowerCase().includes(value.toLowerCase()));
        }).slice(0, 8);
        
        if (results.length === 0) {
            dropdown.innerHTML = '<div class="p-3 text-center text-gray-400 text-sm">无结果</div>';
        } else {
            dropdown.innerHTML = results.map(e => {
                const v = this.getVisibleVersion(e);
                return `
                    <div class="p-3 hover:bg-gray-50 cursor-pointer flex items-center gap-3" onclick="app.openEntry('${e.id}'); app.hideSearchDropdown();">
                        <span class="font-mono text-xs text-gray-400">${e.code}</span>
                        <span class="text-sm text-gray-700">${v.title}</span>
                    </div>
                `;
            }).join('');
        }
        
        dropdown.classList.remove('hidden');
    },

    showSearchDropdown() {
        const dropdown = document.getElementById('search-dropdown');
        const input = document.getElementById('global-search');
        if (input && input.value.trim()) {
            dropdown.classList.remove('hidden');
        }
    },

    hideSearchDropdown() {
        setTimeout(() => {
            const dropdown = document.getElementById('search-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
        }, 200);
    },

    // ========== 编辑页面渲染 ==========
    renderEdit(container) {
        const isNew = !this.data.editingId;
        
        // 初始化临时数据
        if (isNew) {
            const type = this.data.editingType || 'character';
            const code = this.generateCode(type);
            
            this.tempEntry = {
                id: (type === 'character' ? 'char-' : 'non-') + Date.now(),
                type: type,
                code: code,
                versions: []
            };
            
            this.tempVersion = {
                vid: 'v-' + Date.now(),
                title: '',
                subtitle: '',
                level: 5,
                images: { avatar: null, card: null, cover: null },
                chapterFrom: null,
                chapterTo: null,
                blocks: [],
                createdAt: Date.now()
            };
            
            this.tempEntry.versions.push(this.tempVersion);
            this.editingVersionId = this.tempVersion.vid;
            this.editState.hasChanges = true;
        } else {
            const entry = this.data.entries.find(e => e.id === this.data.editingId);
            this.tempEntry = JSON.parse(JSON.stringify(entry));
            this.tempVersion = JSON.parse(JSON.stringify(entry.versions[entry.versions.length - 1]));
            this.editingVersionId = this.tempVersion.vid;
            this.editState.originalEntry = JSON.parse(JSON.stringify(entry));
            this.editState.originalVersion = JSON.parse(JSON.stringify(this.tempVersion));
            this.editState.hasChanges = false;
        }
        
        this.editState.undoStack = [];
        this.editState.redoStack = [];
        
        const tpl = document.getElementById('tpl-detail-edit');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        clone.getElementById('edit-breadcrumb-title').textContent = isNew ? '新词条' : this.tempVersion.title;
        clone.getElementById('edit-title').value = this.tempVersion.title;
        clone.getElementById('edit-code').value = this.tempEntry.code;
        clone.getElementById('edit-subtitle').value = this.tempVersion.subtitle || '';
        
        // 绑定键盘快捷键
        this.bindEditKeyboardShortcuts();
        
        container.appendChild(clone);
    },

    bindEditKeyboardShortcuts() {
        const handler = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                this.saveEntry();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
            }
        };
        
        document.addEventListener('keydown', handler);
        this._editKeyHandler = handler;
    },

    undo() {
        this.showToast('撤销功能开发中', 'info');
    },

    // ========== 编号生成 ==========
    generateCode(type) {
        const prefix = type === 'character' ? 'C' : 'S';
        const existing = this.data.entries.filter(e => e.type === type);
        const maxNum = existing.reduce((max, e) => {
            const match = e.code.match(/\d+/);
            return match ? Math.max(max, parseInt(match[0])) : max;
        }, 0);
        return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
    },

    // ========== 模式切换 ==========
    setMode(mode) {
        this.data.currentMode = mode;
        document.getElementById('btn-mode-view').className = mode === 'view' 
            ? 'px-3 py-1.5 rounded-md bg-white shadow-sm text-gray-800 transition-all'
            : 'px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800 transition-all';
        document.getElementById('btn-mode-edit').className = mode === 'edit'
            ? 'px-3 py-1.5 rounded-md bg-white shadow-sm text-gray-800 transition-all'
            : 'px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800 transition-all';
    }
};

console.log('GitHub Wiki Core 加载完成');
