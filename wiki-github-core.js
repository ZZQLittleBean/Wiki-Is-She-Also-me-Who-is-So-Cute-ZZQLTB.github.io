/**
 * GitHub版 Wiki 核心系统 v2.6
 * 修复：数据导入格式兼容、分享码改为仅保护导出功能
 */

// 确保 app 对象存在
if (typeof window.app === 'undefined') {
    window.app = {};
}
// ========== 防御性修复：确保 shareCodeSystem 命名空间存在 ==========
// 防止 Object.assign 失败或调用时序错误导致 undefined
if (!window.app.shareCodeSystem) {
    window.app.shareCodeSystem = {
        generateCode: function() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
            return code;
        },
        validateCode: function(code) { return /^[A-Z0-9]{8}$/.test(code); },
        verifyCode: async function() { return false; },      // 占位，将被 Object.assign 覆盖
        loadShareCodes: async function() { return {}; },     // 占位
        saveShareCode: async function() { return false; },  // 占位
        deleteCode: async function() { return false; }      // 占位
    };
}
// ===================================================================
Object.assign(window.app, {
    data: {
        entries: [],
        chapters: [],
        camps: [],
        synopsis: [],
        announcements: [],
        currentTimeline: 'latest',
        currentMode: 'view',
        editingId: null,
        editingType: null,
        viewingVersionId: null,
        wikiTitle: '未命名 Wiki',
        wikiSubtitle: '',
        fontFamily: "'Noto Sans SC', sans-serif",
        customFields: {},
        homeContent: []
    },
    
    // 运行模式：'backend'(后台/编辑) 或 'frontend'(前台/只读)
    runMode: 'frontend',
    
    // 后台模式登录状态
    backendLoggedIn: false,
    backendPassword: null,
    
    // 前台模式：仅导出时需要分享码验证
    shareCodeVerified: false,
    verifiedShareCode: null,
    
    // 临时编辑数据
    tempEntry: null,
    tempVersion: null,
    editingVersionId: null,
    
    editState: {
        originalEntry: null,
        originalVersion: null,
        hasChanges: false,
        undoStack: [],
        redoStack: []
    },

    // 分享码系统 - 仅用于保护数据导出
    shareCodeSystem: {
        generateCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 8; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
        },
        
        validateCode(code) {
            return /^[A-Z0-9]{8}$/.test(code);
        },
        
        // 验证分享码是否有效
        async verifyCode(code) {
            const codes = await this.loadShareCodes();
            return codes.hasOwnProperty(code);
        },
        
        // 加载所有分享码
        async loadShareCodes() {
            try {
                const content = await window.WikiGitHubStorage.getFile('share-codes.json');
                if (content) {
                    return JSON.parse(content.content);
                }
            } catch (e) {
                console.warn('无法加载分享码列表:', e);
            }
            return {};
        },
        
        // 保存分享码
        async saveShareCode(code, description = '') {
            try {
                const codes = await this.loadShareCodes();
                codes[code] = {
                    description,
                    createdAt: Date.now(),
                    createdBy: window.app.backendLoggedIn ? 'backend' : 'frontend'
                };
                await window.WikiGitHubStorage.putFile('share-codes.json', JSON.stringify(codes, null, 2), 'Add share code');
                return true;
            } catch (e) {
                console.error('保存分享码失败:', e);
                return false;
            }
        },
        
        // 删除分享码
        async deleteCode(code) {
            try {
                const codes = await this.loadShareCodes();
                delete codes[code];
                await window.WikiGitHubStorage.putFile('share-codes.json', JSON.stringify(codes, null, 2), 'Delete share code');
                return true;
            } catch (e) {
                console.error('删除分享码失败:', e);
                return false;
            }
        }
    },

    // ========== 初始化 ==========
    init() {
        this.githubStorage = window.WikiGitHubStorage;
        this.confirmedFutureEntries = new Set();
        
        // 检查是否有保存的后台登录状态
        const savedLogin = localStorage.getItem('wiki_backend_login');
        if (savedLogin) {
            try {
                const loginData = JSON.parse(savedLogin);
                if (loginData.expires > Date.now()) {
                    this.backendLoggedIn = true;
                    this.runMode = 'backend';
                }
            } catch (e) {
                localStorage.removeItem('wiki_backend_login');
            }
        }
        
        // 检查是否有保存的分享码（用于导出验证）
        const savedCode = localStorage.getItem('wiki_verified_sharecode');
        if (savedCode) {
            this.verifiedShareCode = savedCode;
            this.shareCodeVerified = true;
        }
        
        // 检查GitHub配置
        if (this.githubStorage && this.githubStorage.init()) {
            // 直接加载数据，不再要求分享码验证
            this.loadDataFromGitHub();
        } else {
            this.showLoginPage();
        }
    },

    // ========== 登录页面（仅用于后台模式） ==========
    showLoginPage() {
        const container = document.getElementById('main-container');
        if (!container) return;
        
        const tpl = document.getElementById('tpl-login');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        container.innerHTML = '';
        container.appendChild(clone);
        
        // 默认显示前台模式入口（直接查看）
        document.getElementById('login-options').classList.add('hidden');
        document.getElementById('share-code-form').classList.remove('hidden');
        
        // 修改提示文字 - 分享码仅用于导出
        const descText = document.querySelector('#share-code-form p.text-gray-500');
        if (descText) {
            descText.textContent = '输入分享码以导出完整数据备份';
        }
        
        // 添加"直接浏览"按钮
        const shareForm = document.getElementById('share-code-form');
        
        // 清空原有按钮，重建布局
        const existingButtons = shareForm.querySelectorAll('button:not([onclick*="showLoginOptions"])');
        existingButtons.forEach(btn => btn.remove());
        
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'space-y-3 mt-4';
        buttonContainer.innerHTML = `
            <button onclick="app.enterDirectView()" class="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition">
                <i class="fa-solid fa-book-open mr-2"></i>直接浏览 Wiki
            </button>
            <div class="relative">
                <div class="absolute inset-0 flex items-center">
                    <div class="w-full border-t border-gray-200"></div>
                </div>
                <div class="relative flex justify-center text-sm">
                    <span class="px-2 bg-white text-gray-500">或</span>
                </div>
            </div>
            <button onclick="app.showExportCodeInput()" class="w-full py-3 bg-amber-100 text-amber-700 rounded-lg font-medium hover:bg-amber-200 transition">
                <i class="fa-solid fa-download mr-2"></i>导出数据（需分享码）
            </button>
            <button onclick="app.showBackendLogin()" class="w-full py-2 text-gray-400 hover:text-indigo-600 transition text-sm flex items-center justify-center gap-1">
                <i class="fa-solid fa-lock text-xs"></i>
                后台模式登录
            </button>
        `;
        
        // 插入到返回按钮之前
        const returnBtn = shareForm.querySelector('button[onclick="app.showLoginOptions()"]');
        if (returnBtn) {
            shareForm.insertBefore(buttonContainer, returnBtn);
        } else {
            shareForm.appendChild(buttonContainer);
        }
        
        // 隐藏原来的输入框和验证按钮（移到导出功能中）
        const input = document.getElementById('share-code-input');
        if (input) input.parentElement.classList.add('hidden');
    },

    // 直接进入浏览模式（无需分享码）
    async enterDirectView() {
        if (this.githubStorage.isConfigured()) {
            await this.loadDataFromGitHub();
        } else {
            // 如果没有配置，提示需要配置GitHub
            this.showAlertDialog({
                title: '未配置GitHub',
                message: '请先配置GitHub仓库信息，或联系管理员获取访问链接。',
                type: 'warning'
            });
        }
    },

    // 显示导出数据时的分享码输入
    showExportCodeInput() {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                <div class="text-center mb-6">
                    <div class="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i class="fa-solid fa-lock text-2xl"></i>
                    </div>
                    <h3 class="text-xl font-bold text-gray-800 mb-2">验证分享码</h3>
                    <p class="text-gray-600 text-sm">导出完整数据需要输入有效的分享码</p>
                </div>
                <div class="mb-4">
                    <input type="text" id="export-code-input" 
                        class="share-code-input w-full p-4 border-2 border-gray-200 rounded-lg text-center text-2xl font-bold tracking-widest uppercase focus:border-amber-500 focus:ring-0 outline-none transition" 
                        placeholder="XXXXXXXX"
                        maxlength="8">
                </div>
                <div class="flex gap-3">
                    <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
                        取消
                    </button>
                    <button onclick="app.verifyExportCode()" class="flex-1 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition font-medium shadow-lg">
                        验证并导出
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        setTimeout(() => document.getElementById('export-code-input')?.focus(), 100);
    },

    // 验证导出分享码
    async verifyExportCode() {
        const input = document.getElementById('export-code-input');
        const code = input.value.trim().toUpperCase();
        
        if (!this.shareCodeSystem.validateCode(code)) {
            this.showAlertDialog({
                title: '格式错误',
                message: '分享码应为8位字母数字组合',
                type: 'warning'
            });
            return;
        }
        
        const isValid = await this.shareCodeSystem.verifyCode(code);
        
        if (isValid) {
            this.shareCodeVerified = true;
            this.verifiedShareCode = code;
            localStorage.setItem('wiki_verified_sharecode', code);
            
            // 关闭弹窗
            document.querySelector('.fixed.inset-0')?.remove();
            this.showToast('验证成功，现在可以导出数据', 'success');
            
            // 直接进入并打开设置页面
            await this.loadDataFromGitHub();
            setTimeout(() => this.router('settings'), 100);
        } else {
            this.showAlertDialog({
                title: '验证失败',
                message: '分享码无效或已过期',
                type: 'error'
            });
        }
    },

    // 从主页进入后台登录
    showBackendLoginFromHome() {
        this.showLoginPage();
        setTimeout(() => {
            this.showBackendLogin();
        }, 50);
    },

    // 显示后台登录
    showBackendLogin() {
        document.getElementById('share-code-form')?.classList.add('hidden');
        document.getElementById('backend-login-form')?.classList.remove('hidden');
    },

    // 返回登录选项
    showLoginOptions() {
        document.getElementById('backend-login-form')?.classList.add('hidden');
        document.getElementById('share-code-form')?.classList.remove('hidden');
    },

    // 后台模式登录
    async loginBackend() {
        const owner = document.getElementById('github-owner').value.trim();
        const repo = document.getElementById('github-repo').value.trim();
        const token = document.getElementById('github-token').value.trim();
        const password = document.getElementById('backend-password').value.trim();
        const branch = document.getElementById('github-branch').value.trim() || 'main';
        
        if (!owner || !repo || !token) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请填写GitHub用户名、仓库名称和Token',
                type: 'warning'
            });
            return;
        }
        
        this.githubStorage.saveConfig(owner, repo, token, branch);
        
        const result = await this.githubStorage.testConnection();
        if (!result.success) {
            this.showAlertDialog({
                title: '连接失败',
                message: result.error || '无法连接到GitHub仓库',
                type: 'error'
            });
            this.githubStorage.clearConfig();
            return;
        }
        
        if (password) {
            this.backendPassword = password;
            localStorage.setItem('wiki_backend_login', JSON.stringify({
                password: password,
                expires: Date.now() + 7 * 24 * 60 * 60 * 1000
            }));
        }
        
        this.backendLoggedIn = true;
        this.runMode = 'backend';
        this.showToast('后台模式登录成功', 'success');
        this.loadDataFromGitHub();
    },

    // 退出后台模式
    logoutBackend() {
        this.backendLoggedIn = false;
        this.runMode = 'frontend';
        this.backendPassword = null;
        localStorage.removeItem('wiki_backend_login');
        this.showToast('已退出后台模式', 'info');
        this.router('home');
        this.updateUIForMode();
    },

    // ========== 数据加载 ==========
    async loadDataFromGitHub() {
        try {
            // 尝试加载 wiki-manifest.json 或 data.json
            let data = await this.githubStorage.loadWikiData('wiki-manifest.json');
            
            if (!data) {
                data = await this.githubStorage.loadWikiData('data.json');
            }
            
            if (data) {
                // 处理不同格式的数据
                if (data.data) {
                    // 如果是嵌套格式 {data: {...}}
                    this.data = { ...this.data, ...data.data };
                } else {
                    // 如果是扁平格式
                    this.data = { ...this.data, ...data };
                }
                
                // 确保所有必要字段存在
                if (!this.data.entries) this.data.entries = [];
                if (!this.data.chapters) this.data.chapters = [];
                if (!this.data.camps) this.data.camps = ['主角团', '反派', '中立'];
                if (!this.data.synopsis) this.data.synopsis = [];
                if (!this.data.announcements) this.data.announcements = [];
                if (!this.data.customFields) this.data.customFields = {};
                if (!this.data.homeContent) this.data.homeContent = [];
            } else {
                // 首次使用，创建空数据
                this.data.entries = [];
                this.data.chapters = [];
                this.data.camps = ['主角团', '反派', '中立'];
                this.data.synopsis = [];
                this.data.announcements = [];
                this.data.customFields = {};
                this.data.homeContent = [];
            }
            
            this.applyFont();
            this.updateUIForMode();
            this.router('home');
        } catch (error) {
            console.error('加载数据失败:', error);
            this.showAlertDialog({
                title: '加载失败',
                message: '无法从GitHub加载数据: ' + error.message,
                type: 'error'
            });
        }
    },

    // ========== 根据模式更新UI ==========
    updateUIForMode() {
        // 更新模式徽章
        const badge = document.getElementById('mode-badge');
        if (badge) {
            if (this.runMode === 'backend') {
                badge.classList.remove('hidden');
                badge.className = 'mode-badge backend';
                badge.textContent = '后台模式';
            } else {
                badge.classList.add('hidden');
            }
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
        
        // 显示/隐藏退出后台按钮
        const logoutBtn = document.getElementById('logout-backend-btn');
        if (logoutBtn) {
            logoutBtn.classList.toggle('hidden', this.runMode !== 'backend');
        }
        
        // 更新标题
        const titleEl = document.getElementById('wiki-title-display');
        if (titleEl) {
            titleEl.textContent = this.data.wikiTitle || '未命名 Wiki';
        }
        
        // 更新首页的后台入口显示
        const backendEntry = document.getElementById('backend-entry-section');
        if (backendEntry) {
            backendEntry.classList.toggle('hidden', this.runMode === 'backend');
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
            case 'synopsis':
                this.renderSynopsis(container);
                break;
            case 'synopsis-edit':
                if (this.runMode === 'backend') {
                    this.renderSynopsisEdit(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('synopsis');
                }
                break;
            case 'graph':
                this.renderGraph(container);
                break;
            case 'timeline-settings':
                if (this.runMode === 'backend') {
                    this.renderTimelineSettings(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('settings');
                }
                break;
            case 'announcement-edit':
                if (this.runMode === 'backend') {
                    this.renderAnnouncementEdit(container);
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

    // ========== 页面渲染函数 ==========
    renderHome(container) {
        const tpl = document.getElementById('tpl-home');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        const titleEl = clone.getElementById('welcome-title');
        const subtitleEl = clone.getElementById('welcome-subtitle');
        if (titleEl) titleEl.textContent = this.data.wikiTitle || '欢迎来到 Wiki';
        if (subtitleEl) subtitleEl.textContent = this.data.wikiSubtitle || '探索角色、世界观与错综复杂的关系网。';
        
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        const backendEntry = clone.getElementById('backend-entry-section');
        if (backendEntry) {
            backendEntry.classList.toggle('hidden', this.runMode === 'backend');
        }
        
        container.appendChild(clone);
        this.renderHomeCustomContent();
    },

    renderHomeCustomContent() {
        const container = document.getElementById('home-custom-content');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!this.data.homeContent || this.data.homeContent.length === 0) {
            container.innerHTML = '<p class="text-gray-400 text-center py-4 text-sm">暂无自定义内容</p>';
            return;
        }
        
        this.data.homeContent.forEach((item, idx) => {
            if (item.type === 'text') {
                const div = document.createElement('div');
                div.className = 'bg-white p-4 rounded-xl shadow-sm border border-gray-100';
                if (this.runMode === 'backend') {
                    div.innerHTML = `
                        <textarea class="w-full p-2 border border-gray-200 rounded-lg text-sm resize-none" rows="3"
                            placeholder="输入文本内容..."
                            onchange="app.updateHomeText(${idx}, this.value)" data-idx="${idx}">${item.content || ''}</textarea>
                        <button onclick="app.removeHomeItem(${idx})" class="mt-2 text-red-500 text-xs hover:text-red-700">
                            <i class="fa-solid fa-trash"></i> 删除
                        </button>
                    `;
                } else {
                    div.innerHTML = `<p class="text-gray-700 leading-relaxed">${item.content || ''}</p>`;
                }
                container.appendChild(div);
            } else if (item.type === 'entry-ref') {
                const entry = this.data.entries.find(e => e.id === item.entryId);
                if (!entry) return;
                
                const div = document.createElement('div');
                div.className = 'bg-indigo-50 p-4 rounded-xl border border-indigo-100 cursor-pointer hover:bg-indigo-100 transition';
                div.onclick = () => this.openEntry(entry.id);
                div.innerHTML = `
                    <div class="flex items-center gap-3">
                        <i class="fa-solid fa-book text-indigo-500"></i>
                        <span class="font-medium text-indigo-700">${item.title || entry.code}</span>
                    </div>
                `;
                container.appendChild(div);
            }
        });
    },

    renderList(container, type) {
        const tpl = document.getElementById('tpl-list');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        const masonry = clone.getElementById('masonry-container');
        const countBadge = clone.getElementById('list-count');
        const title = clone.getElementById('list-title');
        
        title.textContent = type === 'character' ? '角色' : '设定';
        
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        let items = this.data.entries.filter(e => e.type === type);
        if (countBadge) countBadge.textContent = items.length;
        
        if (items.length === 0) {
            masonry.innerHTML = '<div class="col-span-full text-center py-10 text-gray-400">暂无数据</div>';
        } else {
            items.sort((a, b) => {
                const vA = this.getVisibleVersion(a);
                const vB = this.getVisibleVersion(b);
                return (vA?.level || 5) - (vB?.level || 5);
            });
            
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

    renderDetail(container) {
        const entry = this.data.entries.find(e => e.id === this.data.editingId);
        if (!entry) {
            container.innerHTML = '<div class="p-4 text-red-600">条目不存在或已被删除</div>';
            return;
        }
        
        let version = entry.versions.find(v => v.vid === this.data.viewingVersionId) || 
                    this.getVisibleVersion(entry) || 
                    entry.versions[entry.versions.length - 1];
        
        if (!version) {
            container.innerHTML = '<div class="p-4 text-red-600">该条目没有内容版本</div>';
            return;
        }
        
        const timeStatus = this.getVersionTimeStatus(entry, version);
        
        // Layer 2: 检查是否需要显示未来警告
        const confirmKey = `${entry.id}_${version.vid}`;
        if (timeStatus === 'future' && !(this.confirmedFutureEntries && this.confirmedFutureEntries.has(confirmKey))) {
            this.showFutureConfirmDialog(entry, version, confirmKey);
            return;
        }
        
        const tpl = document.getElementById('tpl-detail-view');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        const codeEl = clone.getElementById('detail-code');
        const versionBadge = clone.getElementById('detail-version-badge');
        const versionName = clone.getElementById('detail-version-name');
        const contentEl = clone.getElementById('detail-content');
        
        if (codeEl) codeEl.textContent = entry.code;
        
        if (versionBadge && versionName && entry.versions.length > 1) {
            versionBadge.classList.remove('hidden');
            const vIndex = entry.versions.findIndex(v => v.vid === version.vid);
            versionName.textContent = `版本 ${vIndex + 1}/${entry.versions.length}`;
        }
        
        // 处理图片引用（支持 {{IMG:filename}} 格式）
        let cardImg = version.images?.card || version.images?.avatar || version.image;
        if (cardImg && cardImg.startsWith('{{IMG:')) {
            const match = cardImg.match(/\{\{IMG:(.+?)\}\}/);
            if (match && this.storageManager) {
                const cached = this.storageManager.memoryCache && this.storageManager.memoryCache.get(match[1]);
                if (cached) cardImg = cached;
            }
        }
        const hasImage = cardImg && (cardImg.startsWith('data:') || cardImg.startsWith('blob:') || cardImg.startsWith('http'));
        
        // 标题区域
        let headerHtml = `
            <div class="flex-1 min-w-0">
                <h1 class="text-3xl font-bold text-gray-900 mb-3 leading-tight">${version.title}</h1>
                ${version.subtitle ? `<div class="text-lg italic text-gray-600 border-l-4 border-indigo-300 pl-4 whitespace-pre-line leading-relaxed">${version.subtitle}</div>` : ''}
            </div>
        `;
        
        // 图片区域
        const imageHtml = hasImage ? `
            <div class="w-56 shrink-0">
                <div class="aspect-[3/4] rounded-xl overflow-hidden shadow-lg bg-gray-100 border border-gray-200 sticky top-24">
                    <img src="${cardImg}" class="w-full h-full object-cover" 
                        onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-gray-300\\'><i class=\\'fa-solid fa-image text-4xl\\'></i></div>'" 
                        alt="${version.title}">
                </div>
                ${entry.level <= 2 ? `
                    <div class="text-center mt-3">
                        <span class="inline-block px-4 py-1.5 ${entry.level === 1 ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-blue-100 text-blue-800 border-blue-200'} border rounded-full text-sm font-bold">
                            ${entry.level === 1 ? '★ 主角' : '重要角色'}
                        </span>
                    </div>
                ` : ''}
            </div>
        ` : '';
        
        // 正文内容 - 支持角色引用和剧情梗概引用
        let contentBlocksHtml = '<div class="prose prose-sm max-w-none mt-6">';
        if (version.blocks && version.blocks.length > 0) {
            version.blocks.forEach(block => {
                if (block.type === 'h2') {
                    contentBlocksHtml += `<h2 class="text-xl font-bold text-gray-800 mt-8 mb-4 border-b pb-2">${block.text}</h2>`;
                } else if (block.type === 'h3') {
                    contentBlocksHtml += `<h3 class="text-lg font-bold text-gray-700 mt-6 mb-3">${block.text}</h3>`;
                } else if (block.type === 'p') {
                    let text = block.text || '';
                    // 支持词条链接 [[名称]]
                    text = text.replace(/\[\[(.*?)\]\]/g, '<a href="#" onclick="app.searchAndOpen(\'$1\'); return false;" class="text-indigo-600 hover:underline">$1</a>');
                    // 支持剧情梗概引用 {{synopsis:chapterId:title}}
                    text = text.replace(/\{\{synopsis:([^:]+):([^}]+)\}\}/g, (match, chapterId, title) => {
                        return `<span class="synopsis-ref-inline cursor-pointer text-indigo-600 font-medium border-b-2 border-indigo-300 hover:bg-indigo-50 px-1 rounded transition" onclick="app.router('synopsis')"><i class="fa-solid fa-film text-xs mr-1"></i>${title}</span>`;
                    });
                    // 支持角色引用 @名称[代码]（通常在剧情梗概中使用，但词条内也可能引用）
                    text = text.replace(/@([^\[]+)\[([^\]]+)\]/g, '<span class="synopsis-entry-ref" data-entry-code="$2" onclick="app.openEntryByCode(\'$2\')" onmouseenter="app.handleSynopsisRefHover(this)" onmouseleave="app.handleSynopsisRefLeave(this)"><i class="fa-solid fa-user"></i>$1</span>');
                    
                    // 关键修复：添加break-all实现长文本自动换行
                    contentBlocksHtml += `<p class="text-gray-600 leading-relaxed mb-4 break-all" style="word-break: break-all; overflow-wrap: break-word;">${text}</p>`;
                }
            });
        } else {
            contentBlocksHtml += '<div class="text-gray-400 italic">暂无详细内容</div>';
        }
        contentBlocksHtml += '</div>';
        
        if (contentEl) {
            contentEl.innerHTML = `
                <div class="flex flex-col md:flex-row gap-6 mb-2">
                    ${headerHtml}
                    ${imageHtml}
                </div>
                ${contentBlocksHtml}
            `;
        }
        
        // 相关角色
        const relatedSection = clone.getElementById('related-characters-section');
        const relatedList = clone.getElementById('related-characters-list');
        if (relatedSection && relatedList && version.relatedCharacters && version.relatedCharacters.length > 0) {
            relatedSection.classList.remove('hidden');
            version.relatedCharacters.forEach(rc => {
                const charEntry = this.data.entries.find(e => e.id === rc.charId);
                if (!charEntry) return;
                const charVersion = this.getVisibleVersion(charEntry);
                const tag = document.createElement('span');
                tag.className = 'inline-flex items-center gap-1 px-3 py-1 bg-gray-100 hover:bg-indigo-100 rounded-full text-xs cursor-pointer transition';
                tag.innerHTML = `<span class="font-medium">${charVersion && charVersion.title ? charVersion.title : charEntry.code}</span><span class="text-gray-400">·${rc.relationName}</span>`;
                tag.onclick = () => this.openEntry(charEntry.id);
                relatedList.appendChild(tag);
            });
        }
        
        // 版本切换提示
        const versionHint = clone.getElementById('version-switch-hint');
        const versionList = clone.getElementById('version-switch-list');
        if (versionHint && versionList && entry.versions.length > 1) {
            const otherVersions = entry.versions.filter(v => v.vid !== version.vid);
            if (otherVersions.length > 0) {
                versionHint.classList.remove('hidden');
                otherVersions.forEach(v => {
                    const vStatus = this.getVersionTimeStatus(entry, v);
                    const btn = document.createElement('button');
                    btn.className = `text-xs px-3 py-1 rounded-full border transition ${vStatus === 'current' ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`;
                    btn.innerHTML = `${v.title} ${vStatus !== 'current' ? `<span class="text-[10px] opacity-70">(${vStatus === 'past' ? '过去' : '未来'})</span>` : ''}`;
                    btn.onclick = () => {
                        if (vStatus === 'future') {
                            const vConfirmKey = `${entry.id}_${v.vid}`;
                            this.data.viewingVersionId = v.vid;
                            if (this.confirmedFutureEntries && this.confirmedFutureEntries.has(vConfirmKey)) {
                                this.router('detail', false);
                            } else {
                                this.showFutureConfirmDialog(entry, v, vConfirmKey);
                            }
                        } else {
                            this.data.viewingVersionId = v.vid;
                            this.router('detail', false);
                        }
                    };
                    versionList.appendChild(btn);
                });
            }
        }
        
        container.appendChild(clone);
    },

    renderEdit(container) {
        const isNew = !this.data.editingId;
        
        if (isNew) {
            const type = this.data.editingType || 'character';
            const code = this.generateCode(type);
            
            this.tempEntry = {
                id: (type === 'character' ? 'char-' : 'non-') + Date.now(),
                type: type,
                code: code,
                versions: [],
                pinned: false,
                pinStartChapter: null,
                pinEndChapter: null,
                pinnedVersions: {},
                missingIntervalVersion: null,
                defaultPinnedVersion: null
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
                relatedCharacters: [],
                relatedVersions: [],
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
        
        const titleInput = clone.getElementById('edit-title');
        const codeInput = clone.getElementById('edit-code');
        const subtitleInput = clone.getElementById('edit-subtitle');
        
        if (titleInput) titleInput.value = this.tempVersion.title;
        if (codeInput) codeInput.value = this.tempEntry.code;
        if (subtitleInput) subtitleInput.value = this.tempVersion.subtitle || '';
        
        this.bindEditKeyboardShortcuts();
        
        container.appendChild(clone);
    },

    renderSettings(container) {
        const tpl = document.getElementById('tpl-settings');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        // 前台模式：显示导出需要分享码的提示
        if (this.runMode === 'frontend') {
            const exportSection = clone.querySelector('.bg-white.rounded-xl.shadow-sm:has(.fa-database)');
            if (exportSection && !this.shareCodeVerified) {
                const warningDiv = document.createElement('div');
                warningDiv.className = 'mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800';
                warningDiv.innerHTML = `
                    <i class="fa-solid fa-info-circle mr-1"></i>
                    导出数据需要分享码验证。如需导出，请返回登录页面选择"导出数据"。
                `;
                exportSection.insertBefore(warningDiv, exportSection.firstChild);
            }
        }
        
        if (this.runMode === 'backend' && this.githubStorage.isConfigured()) {
            const repoDisplay = clone.getElementById('github-repo-display');
            if (repoDisplay) {
                repoDisplay.textContent = `${this.githubStorage.config.owner}/${this.githubStorage.config.repo}`;
            }
            
            this.loadShareCodeList(clone.getElementById('share-code-list'));
        }
        
        container.appendChild(clone);
        
        // 前台模式下，如果未验证分享码，禁用导出按钮
        if (this.runMode === 'frontend' && !this.shareCodeVerified) {
            const exportBtns = container.querySelectorAll('button[onclick^="app.export"]');
            exportBtns.forEach(btn => {
                btn.disabled = true;
                btn.classList.add('opacity-50', 'cursor-not-allowed');
                btn.title = '需要分享码才能导出';
            });
        }
    },

    // ========== 数据导入（修复版） ==========
    async handleImportFolder(input) {
        const files = input.files;
        if (!files || files.length === 0) {
            this.showImportStatus('请选择文件夹', 'error');
            return;
        }

        this.showImportStatus('正在读取文件...', 'info');

        let dataFile = null;
        const imageFiles = [];
        // 在导入处理中修改图片保存部分
        for (const file of files) {
            const path = file.webkitRelativePath || file.name;
            // 支持多种路径格式
            if ((path.endsWith('data.json') || path.endsWith('wiki-manifest.json')) && !path.includes('/wiki-images/')) {
                dataFile = file;
            }
            if ((path.includes('/images/') || path.includes('/wiki-images/')) && file.type.startsWith('image/')) {
                // 统一文件名处理，去除路径前缀
                const fileName = file.name;
                imageFiles.push({file, fileName});
            }
        }

        if (!dataFile) {
            this.showImportStatus('未找到数据文件（data.json 或 wiki-manifest.json），请确保选择了正确的文件夹', 'error');
            return;
        }

        try {
            const dataText = await dataFile.text();
            let importedData;
            
            try {
                importedData = JSON.parse(dataText);
            } catch (e) {
                this.showImportStatus('JSON解析失败：文件格式错误', 'error');
                return;
            }

            // 修复：更健壮的数据验证逻辑
            // 支持多种格式：
            // 1. {entries: [...], chapters: [...]} - 扁平格式
            // 2. {data: {entries: [...], ...}} - 嵌套格式
            // 3. 只要有entries数组或data.entries数组即可
            
            let entries = null;
            let chapters = null;
            let camps = null;
            let synopsis = null;
            let announcements = null;
            let wikiTitle = null;
            let wikiSubtitle = null;

            // 检查各种可能的格式
            if (importedData.entries && Array.isArray(importedData.entries)) {
                // 格式1：扁平格式
                entries = importedData.entries;
                chapters = importedData.chapters;
                camps = importedData.camps;
                synopsis = importedData.synopsis;
                announcements = importedData.announcements;
                wikiTitle = importedData.wikiTitle;
                wikiSubtitle = importedData.wikiSubtitle;
            } else if (importedData.data && importedData.data.entries && Array.isArray(importedData.data.entries)) {
                // 格式2：嵌套格式
                entries = importedData.data.entries;
                chapters = importedData.data.chapters;
                camps = importedData.data.camps;
                synopsis = importedData.data.synopsis;
                announcements = importedData.data.announcements;
                wikiTitle = importedData.wikiTitle || importedData.data.wikiTitle;
                wikiSubtitle = importedData.wikiSubtitle || importedData.data.wikiSubtitle;
            }

            // 验证是否找到entries
            if (!entries || !Array.isArray(entries)) {
                this.showImportStatus('数据格式错误：未找到有效的 entries 数组。支持的格式：\n1. {entries: [...], ...}\n2. {data: {entries: [...], ...}}', 'error');
                return;
            }

            this.showImportStatus(`找到 ${entries.length} 个词条，${imageFiles.length} 张图片，正在导入...`, 'info');

            // 合并数据
            const existingIds = new Set(this.data.entries.map(e => e.id));
            let addedCount = 0;
            let skippedCount = 0;

            for (const entry of entries) {
                if (!existingIds.has(entry.id)) {
                    this.data.entries.push(entry);
                    addedCount++;
                } else {
                    skippedCount++;
                }
            }

            // 合并其他数据（如果存在）
            if (chapters && Array.isArray(chapters)) {
                const existingChapterIds = new Set(this.data.chapters.map(c => c.id));
                for (const chapter of chapters) {
                    if (!existingChapterIds.has(chapter.id)) {
                        this.data.chapters.push(chapter);
                    }
                }
            }

            if (camps && Array.isArray(camps)) {
                for (const camp of camps) {
                    if (!this.data.camps.includes(camp)) {
                        this.data.camps.push(camp);
                    }
                }
            }

            if (synopsis && Array.isArray(synopsis)) {
                const existingSynopsisIds = new Set(this.data.synopsis.map(s => s.id));
                for (const syn of synopsis) {
                    if (!existingSynopsisIds.has(syn.id)) {
                        this.data.synopsis.push(syn);
                    }
                }
            }

            if (announcements && Array.isArray(announcements)) {
                const existingAnnIds = new Set(this.data.announcements.map(a => a.id));
                for (const ann of announcements) {
                    if (!existingAnnIds.has(ann.id)) {
                        this.data.announcements.push(ann);
                    }
                }
            }

            if (wikiTitle) this.data.wikiTitle = wikiTitle;
            if (wikiSubtitle) this.data.wikiSubtitle = wikiSubtitle;

            // 上传图片
            let uploadedImages = 0;
            if (imageFiles.length > 0) {
                for (const imgFile of imageFiles) {
                    try {
                        const reader = new FileReader();
                        const dataUrl = await new Promise((resolve, reject) => {
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(imgFile);
                        });

                        await this.githubStorage.saveImage(imgFile.name, dataUrl);
                        uploadedImages++;
                    } catch (e) {
                        console.warn('图片上传失败:', imgFile.name, e);
                    }
                }
            }

            await this.githubStorage.saveWikiData(this.data);

            this.showImportStatus(
                `导入成功！新增 ${addedCount} 个词条${skippedCount > 0 ? `（跳过 ${skippedCount} 个重复）` : ''}，上传 ${uploadedImages}/${imageFiles.length} 张图片`,
                'success'
            );

            this.updateUIForMode();
            this.showToast('数据导入成功', 'success');

        } catch (error) {
            console.error('导入失败:', error);
            this.showImportStatus('导入失败: ' + error.message, 'error');
        }

        input.value = '';
    },

    showImportStatus(message, type) {
        const statusEl = document.getElementById('import-status');
        if (!statusEl) return;

        statusEl.classList.remove('hidden', 'bg-green-100', 'text-green-700', 'bg-red-100', 'text-red-700', 'bg-blue-100', 'text-blue-700');
        statusEl.classList.add('whitespace-pre-line'); // 支持换行

        const colors = {
            success: ['bg-green-100', 'text-green-700'],
            error: ['bg-red-100', 'text-red-700'],
            info: ['bg-blue-100', 'text-blue-700']
        };

        statusEl.classList.add(...(colors[type] || colors.info));
        statusEl.textContent = message;
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
                <div class="flex items-center gap-3 overflow-hidden">
                    <span class="font-mono font-bold text-amber-600 shrink-0">${code}</span>
                    ${info.description ? `<span class="text-xs text-gray-500 truncate">${info.description}</span>` : ''}
                </div>
                <div class="flex gap-2 shrink-0">
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

    // ========== 数据导出（前台模式需要分享码） ==========
    async exportData() {
        if (this.runMode === 'frontend' && !this.shareCodeVerified) {
            this.showAlertDialog({
                title: '需要分享码',
                message: '前台模式导出数据需要输入有效的分享码。请在设置页面点击"输入分享码"进行验证。',
                type: 'warning'
            });
            return;
        }
        
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
        if (this.runMode === 'frontend' && !this.shareCodeVerified) {
            this.showAlertDialog({
                title: '需要分享码',
                message: '前台模式导出数据需要输入有效的分享码。请在设置页面点击"输入分享码"进行验证。',
                type: 'warning'
            });
            return;
        }
        
        const JSZip = window.JSZip;
        if (!JSZip) {
            this.showToast('ZIP库未加载', 'error');
            return;
        }
        
        const zip = new JSZip();
        zip.file('wiki-manifest.json', JSON.stringify(this.data, null, 2));
        
        const imagesFolder = zip.folder('wiki-images');
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

    // 显示分享码输入框（在设置页面使用）
    showShareCodeInput() {
        this.showExportCodeInput();
    },

    // ========== 其他辅助函数 ==========
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

    formatChapterNum(num) {
        if (num === undefined || num === null) return '';
        if (typeof num === 'string') return num;
        return `第${num}章`;
    },

    generateCode(type) {
        const prefix = type === 'character' ? 'C' : 'S';
        const existing = this.data.entries.filter(e => e.type === type);
        const maxNum = existing.reduce((max, e) => {
            const match = e.code.match(/\d+/);
            return match ? Math.max(max, parseInt(match[0])) : max;
        }, 0);
        return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
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

    unbindEditKeyboardShortcuts() {
        if (this._editKeyHandler) {
            document.removeEventListener('keydown', this._editKeyHandler);
            this._editKeyHandler = null;
        }
    },

    undo() {
        this.showToast('撤销功能开发中', 'info');
    },

    showConfirmDialog(options) {
        return new Promise((resolve) => {
            const { title = '确认', message, confirmText = '确认', cancelText = '取消', type = 'info' } = options;
            
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
            
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
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
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
            overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
            
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
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
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

    addHomeTextBox() {
        if (!this.data.homeContent) this.data.homeContent = [];
        this.data.homeContent.push({ type: 'text', content: '' });
        this.renderHomeCustomContent();
    },

    addHomeEntryRef() {
        this.showEntrySelectDialog((entry) => {
            if (!entry) return;
            const visibleVersion = this.getVisibleVersion(entry);
            const title = visibleVersion ? visibleVersion.title : entry.code;
            if (!this.data.homeContent) this.data.homeContent = [];
            this.data.homeContent.push({ type: 'entry-ref', entryId: entry.id, title: title });
            this.renderHomeCustomContent();
        });
    },

    showEntrySelectDialog(callback) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
                <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold text-lg text-gray-800">选择词条</h3>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="p-4">
                    <input type="text" id="entry-search-input" placeholder="搜索词条名称或编号..." 
                        class="w-full p-2 border border-gray-200 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-indigo-500 outline-none">
                    <div id="entry-select-list" class="space-y-1 max-h-[50vh] overflow-y-auto"></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        const list = overlay.querySelector('#entry-select-list');
        const searchInput = overlay.querySelector('#entry-search-input');
        
        const renderEntries = (filter = '') => {
            list.innerHTML = '';
            this.data.entries.forEach(entry => {
                const visibleVersion = this.getVisibleVersion(entry);
                const title = visibleVersion ? visibleVersion.title : entry.code;
                if (filter && !entry.code.toLowerCase().includes(filter.toLowerCase()) && !title.toLowerCase().includes(filter.toLowerCase())) return;
                
                const item = document.createElement('div');
                item.className = 'p-3 hover:bg-indigo-50 cursor-pointer rounded-lg border-b border-gray-100 flex items-center gap-3 transition';
                item.innerHTML = `
                    <span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold">${entry.code}</span>
                    <span class="text-sm text-gray-700">${title}</span>
                `;
                item.onclick = () => { overlay.remove(); callback(entry); };
                list.appendChild(item);
            });
        };
        
        renderEntries();
        searchInput.oninput = (e) => renderEntries(e.target.value);
        searchInput.focus();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    updateHomeText(idx, value) {
        if (this.data.homeContent && this.data.homeContent[idx]) {
            this.data.homeContent[idx].content = value;
        }
    },

    removeHomeItem(idx) {
        if (this.data.homeContent) {
            this.data.homeContent.splice(idx, 1);
            this.renderHomeCustomContent();
        }
    },

    saveHomeContent() {
        this.saveData();
        this.showToast('首页内容已保存', 'success');
    },

    showVersionManager() {
        this.showToast('版本管理器功能开发中', 'info');
    },

    async saveData() {
        try {
            await this.githubStorage.saveWikiData(this.data);
        } catch (error) {
            console.error('保存失败:', error);
        }
    },

    setMode(mode) {
        this.data.currentMode = mode;
        const viewBtn = document.getElementById('btn-mode-view');
        const editBtn = document.getElementById('btn-mode-edit');
        
        if (viewBtn) {
            viewBtn.className = mode === 'view' 
                ? 'px-3 py-1.5 rounded-md bg-white shadow-sm text-gray-800 transition-all'
                : 'px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800 transition-all';
        }
        if (editBtn) {
            editBtn.className = mode === 'edit'
                ? 'px-3 py-1.5 rounded-md bg-white shadow-sm text-gray-800 transition-all'
                : 'px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800 transition-all';
        }
    },

    // 剧情梗概相关函数
    renderSynopsis(container) {
        const tpl = document.getElementById('tpl-synopsis-view');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">剧情梗概模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        this.syncSynopsisWithChapters();
        
        const list = document.getElementById('synopsis-view-list');
        if (list) {
            this.data.synopsis.forEach(chapter => {
                const item = document.createElement('div');
                item.className = 'synopsis-chapter-item p-6 border-b border-gray-200 bg-white mb-4 rounded-xl shadow-sm';
                item.innerHTML = `
                    <h3 class="text-xl font-bold text-gray-800 mb-3">
                        <span class="text-indigo-600 mr-2">${this.formatChapterNum(chapter.num)}</span>
                        ${chapter.title}
                    </h3>
                    <div class="prose prose-sm max-w-none text-gray-600 leading-relaxed">
                        ${chapter.content ? this.markdownToHtml(chapter.content) : '<p class="text-gray-400 italic">暂无内容</p>'}
                    </div>
                `;
                list.appendChild(item);
            });
        }
    },

    renderSynopsisEdit(container) {
        const tpl = document.getElementById('tpl-synopsis-edit');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">剧情梗概编辑模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        this.syncSynopsisWithChapters();
        
        const list = document.getElementById('synopsis-chapters-list');
        if (list) {
            this.data.synopsis.forEach(chapter => {
                const item = document.createElement('div');
                item.className = 'bg-white rounded-lg border border-gray-200 mb-4 overflow-hidden';
                item.innerHTML = `
                    <div class="flex items-center gap-3 p-3 bg-gray-50 border-b border-gray-200">
                        <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold">${this.formatChapterNum(chapter.num)}</span>
                        <input type="text" class="flex-1 bg-transparent border-none outline-none text-sm font-medium" 
                            value="${chapter.title}" onchange="app.updateSynopsisTitle('${chapter.id}', this.value)">
                        <button onclick="app.removeSynopsisChapter('${chapter.id}')" class="text-red-500 hover:text-red-700 p-1.5">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                    <div class="p-3">
                        <textarea class="w-full p-2 border border-gray-200 rounded-lg text-sm resize-none" rows="4"
                            onchange="app.updateSynopsisContent('${chapter.id}', this.value)">${chapter.content || ''}</textarea>
                    </div>
                `;
                list.appendChild(item);
            });
        }
    },

    syncSynopsisWithChapters() {
        const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
        const existingSynopsis = {};
        this.data.synopsis.forEach(s => { existingSynopsis[s.chapterId] = s; });

        const newSynopsis = [];
        sortedChapters.forEach(ch => {
            if (existingSynopsis[ch.id]) {
                newSynopsis.push(existingSynopsis[ch.id]);
            } else {
                newSynopsis.push({
                    id: 'syn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                    chapterId: ch.id,
                    num: ch.num,
                    title: ch.title || `第${ch.num}章`,
                    content: '',
                    image: null
                });
            }
        });
        this.data.synopsis = newSynopsis;
    },

    updateSynopsisTitle(chapterId, title) {
        const chapter = this.data.synopsis.find(s => s.id === chapterId);
        if (chapter) chapter.title = title;
    },

    updateSynopsisContent(chapterId, content) {
        const chapter = this.data.synopsis.find(s => s.id === chapterId);
        if (chapter) chapter.content = content;
    },

    removeSynopsisChapter(chapterId) {
        this.showConfirmDialog({
            title: '删除确认',
            message: '确定删除此章节的剧情梗概？',
            confirmText: '删除',
            cancelText: '取消',
            type: 'warning'
        }).then(confirmed => {
            if (confirmed) {
                this.data.synopsis = this.data.synopsis.filter(s => s.id !== chapterId);
                this.renderSynopsisEdit(document.getElementById('main-container'));
            }
        });
    },

    addSynopsisChapter() {
        const num = this.data.chapters.length + 1;
        const chapterId = 'ch-' + Date.now();
        
        this.data.chapters.push({
            id: chapterId,
            num: num,
            title: `第${num}章`,
            order: num
        });
        
        this.data.synopsis.push({
            id: 'syn-' + Date.now(),
            chapterId: chapterId,
            num: num,
            title: `第${num}章`,
            content: '',
            image: null
        });
        
        this.renderSynopsisEdit(document.getElementById('main-container'));
    },

    saveSynopsis() {
        this.saveData();
        this.showToast('剧情梗概已保存', 'success');
    },

    renderTimelineSettings(container) {
        const tpl = document.getElementById('tpl-timeline-settings');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">章节管理模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        const list = document.getElementById('timeline-chapters-list');
        if (list) {
            const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
            sortedChapters.forEach((ch, idx) => {
                const item = document.createElement('div');
                item.className = 'flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200';
                item.innerHTML = `
                    <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold font-mono w-16 text-center">${this.formatChapterNum(ch.num)}</span>
                    <input type="text" class="flex-1 bg-transparent border border-gray-200 rounded px-2 py-1 text-sm" 
                        value="${ch.title}" onchange="app.updateChapterTitle('${ch.id}', this.value)">
                    <button onclick="app.moveChapter('${ch.id}', -1)" class="text-gray-400 hover:text-gray-600 p-1" ${idx === 0 ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-up"></i>
                    </button>
                    <button onclick="app.moveChapter('${ch.id}', 1)" class="text-gray-400 hover:text-gray-600 p-1" ${idx === sortedChapters.length - 1 ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-down"></i>
                    </button>
                    <button onclick="app.deleteChapter('${ch.id}')" class="text-red-400 hover:text-red-600 p-1">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                `;
                list.appendChild(item);
            });
        }
    },

    updateChapterTitle(chapterId, title) {
        const chapter = this.data.chapters.find(c => c.id === chapterId);
        if (chapter) {
            chapter.title = title;
            const synopsis = this.data.synopsis.find(s => s.chapterId === chapterId);
            if (synopsis) synopsis.title = title;
        }
    },

    moveChapter(chapterId, direction) {
        const idx = this.data.chapters.findIndex(c => c.id === chapterId);
        if (idx === -1) return;
        
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= this.data.chapters.length) return;
        
        const temp = this.data.chapters[idx];
        this.data.chapters[idx] = this.data.chapters[newIdx];
        this.data.chapters[newIdx] = temp;
        
        this.data.chapters.forEach((c, i) => c.order = i + 1);
        
        this.renderTimelineSettings(document.getElementById('main-container'));
    },

    deleteChapter(chapterId) {
        this.showConfirmDialog({
            title: '删除确认',
            message: '确定删除此章节？相关的剧情梗概也会被删除。',
            confirmText: '删除',
            cancelText: '取消',
            type: 'danger'
        }).then(confirmed => {
            if (confirmed) {
                this.data.chapters = this.data.chapters.filter(c => c.id !== chapterId);
                this.data.synopsis = this.data.synopsis.filter(s => s.chapterId !== chapterId);
                this.renderTimelineSettings(document.getElementById('main-container'));
            }
        });
    },

    addChapter() {
        const num = this.data.chapters.length + 1;
        const chapterId = 'ch-' + Date.now();
        
        this.data.chapters.push({
            id: chapterId,
            num: num,
            title: `第${num}章`,
            order: num
        });
        
        this.data.synopsis.push({
            id: 'syn-' + Date.now(),
            chapterId: chapterId,
            num: num,
            title: `第${num}章`,
            content: '',
            image: null
        });
        
        this.renderTimelineSettings(document.getElementById('main-container'));
    },

    saveTimelineSettings() {
        this.saveData();
        this.showToast('章节设置已保存', 'success');
    },

    renderGraph(container) {
        const tpl = document.getElementById('tpl-graph');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">关系图模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        const graphContainer = document.getElementById('graph-container');
        if (graphContainer) {
            const characters = this.data.entries.filter(e => e.type === 'character');
            
            if (characters.length === 0) {
                graphContainer.innerHTML = '<div class="text-center text-gray-400 py-10">暂无角色数据</div>';
                return;
            }
            
            characters.forEach(entry => {
                const version = this.getVisibleVersion(entry);
                if (!version) return;
                
                const node = document.createElement('div');
                node.className = 'absolute bg-white rounded-lg shadow-md border border-gray-200 p-3 cursor-pointer hover:shadow-lg transition';
                node.style.left = `${Math.random() * 60 + 10}%`;
                node.style.top = `${Math.random() * 60 + 10}%`;
                node.innerHTML = `
                    <div class="text-sm font-medium text-gray-800">${version.title}</div>
                    <div class="text-xs text-gray-500">${entry.code}</div>
                `;
                node.onclick = () => this.openEntry(entry.id);
                graphContainer.appendChild(node);
            });
        }
    },

    renderAnnouncementEdit(container) {
        const tpl = document.getElementById('tpl-announcement-edit');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">公告编辑模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
    },

    saveAnnouncement() {
        const title = document.getElementById('announcement-edit-title')?.value;
        const author = document.getElementById('announcement-edit-author')?.value;
        const content = document.getElementById('announcement-edit-content')?.value;

        if (!title) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请输入公告标题',
                type: 'warning'
            });
            return;
        }

        const newAnn = {
            id: 'ann-' + Date.now(),
            title,
            author,
            content,
            createdAt: Date.now(),
            date: new Date().toLocaleDateString('zh-CN'),
            isActive: true
        };
        
        this.data.announcements.forEach(a => a.isActive = false);
        this.data.announcements.unshift(newAnn);

        this.saveData();
        this.showToast('公告已发布', 'success');
        this.router('home');
    },

    createAnnouncement() {
        this.data.currentAnnouncement = null;
        this.router('announcement-edit');
    },

    viewAnnouncement() {
        const ann = this.data.announcements?.find(a => a.isActive);
        if (!ann) {
            this.showToast('当前没有生效的公告', 'info');
            return;
        }
        
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
                <div class="p-4 border-b bg-gradient-to-r from-orange-50 to-amber-50 flex justify-between items-center">
                    <div>
                        <h3 class="font-bold text-lg text-gray-800">${ann.title || '公告'}</h3>
                        <p class="text-xs text-gray-500">${ann.author || '匿名'} · ${ann.date}</p>
                    </div>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="p-6 overflow-y-auto prose prose-sm max-w-none">
                    ${ann.content || ''}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    viewAnnouncementHistory() {
        if (!this.data.announcements || this.data.announcements.length === 0) {
            this.showToast('暂无历史公告', 'info');
            return;
        }
        
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
                <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold text-lg text-gray-800">历史公告</h3>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="p-4 overflow-y-auto space-y-3">
                    ${this.data.announcements.map(ann => `
                        <div class="p-3 bg-gray-50 rounded-lg border ${ann.isActive ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}">
                            <div class="flex justify-between items-start">
                                <h4 class="font-medium text-gray-800">${ann.title || '无标题'}</h4>
                                ${ann.isActive ? '<span class="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">生效中</span>' : ''}
                            </div>
                            <p class="text-xs text-gray-500 mt-1">${ann.author || '匿名'} · ${ann.date}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    createEntryCard(entry, version) {
        const div = document.createElement('div');
        div.className = 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-300 active:scale-95 flex flex-col w-full';
        div.onclick = () => this.openEntry(entry.id);
        
        const img = version.images?.card || version.images?.avatar || version.image || '';
        const hasImage = img && (img.startsWith('data:') || img.startsWith('http'));
        
        div.innerHTML = `
            <div class="relative aspect-[3/4] overflow-hidden bg-gray-100 shrink-0">
                ${hasImage ? 
                    `<img src="${img}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-110" alt="${version.title}" loading="lazy">` :
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

    switchToVersion(entryId, versionId) {
        this.data.editingId = entryId;
        this.data.viewingVersionId = versionId;
        this.router('detail', false);
    },

    async saveEntry() {
        if (!this.tempEntry || !this.tempVersion) return;
        
        this.tempVersion.title = document.getElementById('edit-title')?.value?.trim() || '';
        this.tempVersion.subtitle = document.getElementById('edit-subtitle')?.value?.trim() || '';
        
        if (!this.tempVersion.title) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请输入版本名称',
                type: 'warning'
            });
            return;
        }
        
        const existingIndex = this.data.entries.findIndex(e => e.id === this.tempEntry.id);
        if (existingIndex >= 0) {
            this.data.entries[existingIndex] = this.tempEntry;
        } else {
            this.data.entries.push(this.tempEntry);
        }
        
        try {
            await this.githubStorage.saveWikiData(this.data);
            this.showToast('保存成功', 'success');
            this.editState.hasChanges = false;
            this.unbindEditKeyboardShortcuts();
            this.tempEntry = null;
            this.tempVersion = null;
            this.router('home');
        } catch (error) {
            console.error('保存失败:', error);
            this.showAlertDialog({
                title: '保存失败',
                message: '无法保存到GitHub: ' + error.message,
                type: 'error'
            });
        }
    },

    async cancelEdit() {
        if (!this.editState.hasChanges && this.editState.undoStack.length === 0) {
            this.unbindEditKeyboardShortcuts();
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
            this.unbindEditKeyboardShortcuts();
            this.tempEntry = null;
            this.tempVersion = null;
            this.data.editingType = null;
            this.editState.hasChanges = false;
            this.editState.undoStack = [];
            this.editState.redoStack = [];
            this.router('home');
        }
    },

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

    changeFont(font) {
        this.data.fontFamily = font;
        document.documentElement.style.setProperty('--custom-font', font);
        this.applyFont();
    },

    applyFont() {
        document.body.style.fontFamily = this.data.fontFamily;
    },

    disconnectGitHub() {
        this.showConfirmDialog({
            title: '断开连接',
            message: '确定断开GitHub连接？',
            type: 'warning'
        }).then(confirmed => {
            if (confirmed) {
                this.githubStorage.clearConfig();
                localStorage.removeItem('wiki_backend_login');
                localStorage.removeItem('wiki_verified_sharecode');
                this.backendLoggedIn = false;
                this.runMode = 'frontend';
                this.shareCodeVerified = false;
                window.location.reload();
            }
        });
    },
    // ========== 剧情梗概增强功能 ==========

    /**
     * 渲染剧情梗概查看页面（支持角色引用）
     */
    renderSynopsis: function(container) {
        const tpl = document.getElementById('tpl-synopsis-view');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">剧情梗概模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        // 同步章节数据
        this.syncSynopsisWithChapters();
        
        const list = document.getElementById('synopsis-view-list');
        if (!list) return;
        
        if (!this.data.synopsis || this.data.synopsis.length === 0) {
            list.innerHTML = '<div class="text-center py-10 text-gray-400">暂无剧情梗概</div>';
            return;
        }
        
        this.data.synopsis.forEach(chapter => {
            const item = document.createElement('div');
            item.className = 'synopsis-chapter-item bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4';
            
            // 处理图片
            let imageHtml = '';
            if (chapter.image) {
                imageHtml = `
                    <div class="mb-4 rounded-xl overflow-hidden bg-gray-100">
                        <img src="${chapter.image}" class="w-full h-48 object-cover" alt="${chapter.title}" 
                            onerror="this.style.display='none'">
                    </div>
                `;
            }
            
            // 处理内容（支持角色引用）
            const contentHtml = chapter.content ? this.markdownToHtml(chapter.content) : '<p class="text-gray-400 italic">暂无内容</p>';
            
            item.innerHTML = `
                <div class="flex items-center gap-3 mb-4 border-b border-gray-100 pb-3">
                    <span class="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-sm font-bold">
                        ${this.formatChapterNum(chapter.num)}
                    </span>
                    <h3 class="text-xl font-bold text-gray-800">${chapter.title}</h3>
                </div>
                ${imageHtml}
                <div class="prose prose-sm max-w-none text-gray-600 leading-relaxed synopsis-content">
                    ${contentHtml}
                </div>
            `;
            
            list.appendChild(item);
        });
    },

    /**
     * Markdown转HTML（支持角色引用 @名称[代码]）
     */
    markdownToHtml: function(text) {
        if (!text) return '';
        
        // 处理角色引用 @名称[代码]
        // 注意：不显示代码，只显示名称
        text = text.replace(/@([^\[]+)\[([^\]]+)\]/g, '<span class="synopsis-entry-ref" data-entry-code="$2" onclick="app.openEntryByCode(\'$2\')" onmouseenter="app.handleSynopsisRefHover(this)" onmouseleave="app.handleSynopsisRefLeave(this)"><i class="fa-solid fa-user"></i>$1</span>');
        
        // 处理粗体、斜体
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
        text = text.replace(/__(.+?)__/g, '<u>$1</u>');
        
        // 处理词条链接 [[名称]]
        text = text.replace(/\[\[(.+?)\]\]/g, '<a href="#" onclick="app.searchAndOpen(\'$1\'); return false;" class="text-indigo-600 hover:underline">$1</a>');
        
        return text.replace(/\n/g, '<br>');
    },

    /**
     * 通过代码打开词条
     */
    openEntryByCode: function(code) {
        // 清理转义字符
        const cleanCode = code.replace(/\\/g, '');
        const entry = this.data.entries.find(e => e.code === cleanCode);
        if (entry) {
            this.openEntry(entry.id);
        } else {
            this.showToast('未找到该角色: ' + cleanCode, 'warning');
        }
    },

    /**
     * 处理角色引用悬停（显示预览弹窗）
     */
    handleSynopsisRefHover: function(element) {
        const code = element.getAttribute('data-entry-code');
        if (!code) return;
        
        const entry = this.data.entries.find(e => e.code === code.replace(/\\/g, ''));
        if (!entry) return;
        
        const version = this.getVisibleVersion(entry);
        if (!version) return;
        
        // 移除已存在的弹窗
        this.closeSynopsisTooltip();
        
        // 创建弹窗
        const popup = document.createElement('div');
        popup.className = 'synopsis-hover-popup';
        popup.id = 'synopsis-hover-popup';
        
        // 获取图片
        let imgUrl = version.images?.avatar || version.images?.card || '';
        if (imgUrl && imgUrl.startsWith('{{IMG:')) {
            const match = imgUrl.match(/\{\{IMG:(.+?)\}\}/);
            if (match) {
                // 尝试从内存缓存获取
                if (this.storageManager && this.storageManager.memoryCache.has(match[1])) {
                    imgUrl = this.storageManager.memoryCache.get(match[1]);
                }
            }
        }
        
        const hasImage = imgUrl && (imgUrl.startsWith('data:') || imgUrl.startsWith('blob:') || imgUrl.startsWith('http'));
        
        popup.innerHTML = `
            <div class="flex gap-3">
                ${hasImage ? `
                    <div class="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                        <img src="${imgUrl}" class="w-full h-full object-cover" onerror="this.style.display='none'">
                    </div>
                ` : ''}
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-xs font-mono text-gray-500">${entry.code}</span>
                        ${entry.camp ? `<span class="text-[10px] px-2 py-0.5 bg-gray-100 rounded text-gray-600">${entry.camp}</span>` : ''}
                    </div>
                    <h4 class="font-bold text-gray-800 text-lg leading-tight mb-1">${version.title}</h4>
                    <p class="text-xs text-gray-500 line-clamp-2">${version.subtitle || ''}</p>
                </div>
            </div>
        `;
        
        document.body.appendChild(popup);
        
        // 定位弹窗（在元素上方居中）
        const rect = element.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        
        let left = rect.left + (rect.width / 2) - (popupRect.width / 2);
        let top = rect.top - popupRect.height - 10;
        
        // 边界检查
        if (left < 10) left = 10;
        if (left + popupRect.width > window.innerWidth - 10) {
            left = window.innerWidth - popupRect.width - 10;
        }
        if (top < 10) top = rect.bottom + 10; // 如果上方空间不足，显示在下方
        
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        popup.style.bottom = 'auto';
        
        // 显示动画
        requestAnimationFrame(() => {
            popup.classList.add('show');
        });
        
        // 添加背景遮罩（可选，根据需要）
        document.body.classList.add('body-dimmed');
    },

    /**
     * 处理鼠标离开
     */
    handleSynopsisRefLeave: function(element) {
        // 延迟关闭，以便鼠标可以移动到弹窗上
        setTimeout(() => {
            const popup = document.getElementById('synopsis-hover-popup');
            if (popup && !popup.matches(':hover')) {
                this.closeSynopsisTooltip();
            }
        }, 100);
    },

    /**
     * 关闭悬停提示
     */
    closeSynopsisTooltip: function() {
        const popup = document.getElementById('synopsis-hover-popup');
        if (popup) {
            popup.remove();
        }
        document.body.classList.remove('body-dimmed');
    },

    /**
     * 同步剧情梗概与章节
     */
    syncSynopsisWithChapters: function() {
        if (!this.data.synopsis) this.data.synopsis = [];
        
        const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
        const existingSynopsis = {};
        this.data.synopsis.forEach(s => { existingSynopsis[s.chapterId || s.id] = s; });
        
        const newSynopsis = [];
        sortedChapters.forEach(ch => {
            const key = ch.id;
            if (existingSynopsis[key]) {
                // 更新章节信息
                const syn = existingSynopsis[key];
                syn.num = ch.num;
                syn.title = syn.title || ch.title;
                newSynopsis.push(syn);
            } else {
                newSynopsis.push({
                    id: 'syn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                    chapterId: ch.id,
                    num: ch.num,
                    title: ch.title || `第${ch.num}章`,
                    content: '',
                    image: null
                });
            }
        });
        
        this.data.synopsis = newSynopsis;
    },
        // ========== 角色引用与悬停预览功能 ==========
    
    openEntryByCode(code) {
        const cleanCode = code.replace(/\\/g, '');
        const entry = this.data.entries.find(e => e.code === cleanCode);
        if (entry) {
            this.openEntry(entry.id);
        } else {
            this.showToast('未找到该角色: ' + cleanCode, 'warning');
        }
    },

    handleSynopsisRefHover(element) {
        const code = element.getAttribute('data-entry-code');
        if (!code) return;
        
        const entry = this.data.entries.find(e => e.code === code.replace(/\\/g, ''));
        if (!entry) return;
        
        const version = this.getVisibleVersion(entry);
        if (!version) return;
        
        // 移除已存在的弹窗
        this.closeSynopsisTooltip();
        
        const popup = document.createElement('div');
        popup.className = 'synopsis-hover-popup';
        popup.id = 'synopsis-hover-popup';
        
        let imgUrl = version.images?.avatar || version.images?.card || '';
        if (imgUrl && imgUrl.startsWith('{{IMG:')) {
            const match = imgUrl.match(/\{\{IMG:(.+?)\}\}/);
            if (match && this.storageManager && this.storageManager.memoryCache.has(match[1])) {
                imgUrl = this.storageManager.memoryCache.get(match[1]);
            }
        }
        
        const hasImage = imgUrl && (imgUrl.startsWith('data:') || imgUrl.startsWith('blob:') || imgUrl.startsWith('http'));
        
        popup.innerHTML = `
            <div class="flex gap-3">
                ${hasImage ? `
                    <div class="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                        <img src="${imgUrl}" class="w-full h-full object-cover" onerror="this.style.display='none'">
                    </div>
                ` : ''}
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-xs font-mono text-gray-500">${entry.code}</span>
                        ${entry.camp ? `<span class="text-[10px] px-2 py-0.5 bg-gray-100 rounded text-gray-600">${entry.camp}</span>` : ''}
                    </div>
                    <h4 class="font-bold text-gray-800 text-lg leading-tight mb-1">${version.title}</h4>
                    <p class="text-xs text-gray-500 line-clamp-2">${version.subtitle || ''}</p>
                </div>
            </div>
        `;
        
        document.body.appendChild(popup);
        
        // 定位弹窗
        const rect = element.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        
        let left = rect.left + (rect.width / 2) - (popupRect.width / 2);
        let top = rect.top - popupRect.height - 10;
        
        // 边界检查
        if (left < 10) left = 10;
        if (left + popupRect.width > window.innerWidth - 10) {
            left = window.innerWidth - popupRect.width - 10;
        }
        if (top < 10) top = rect.bottom + 10;
        
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        popup.style.bottom = 'auto';
        
        requestAnimationFrame(() => popup.classList.add('show'));
        document.body.classList.add('body-dimmed');
    },

    handleSynopsisRefLeave(element) {
        setTimeout(() => {
            const popup = document.getElementById('synopsis-hover-popup');
            if (popup && !popup.matches(':hover')) {
                this.closeSynopsisTooltip();
            }
        }, 100);
    },

    closeSynopsisTooltip() {
        const popup = document.getElementById('synopsis-hover-popup');
        if (popup) {
            popup.remove();
        }
        document.body.classList.remove('body-dimmed');
    },
});
// 如果 markdownToHtml 未定义，提供兼容实现
if (!app.markdownToHtml) {
    app.markdownToHtml = function(text) {
        if (!text) return '';
        return text
            .replace(/@([^\[]+)\[([^\]]+)\]/g, '<span class="synopsis-entry-ref" data-entry-code="$2" onclick="app.openEntryByCode(\'$2\')"><i class="fa-solid fa-user"></i>$1</span>')
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/\*(.+?)\*/g, '<i>$1</i>')
            .replace(/__(.+?)__/g, '<u>$1</u>')
            .replace(/\n/g, '<br>');
    };
}

if (!app.openEntryByCode) {
    app.openEntryByCode = function(code) {
        const entry = app.data.entries.find(e => e.code === code);
        if (entry) app.openEntry(entry.id);
        else app.showToast('未找到该角色', 'warning');
    };
}
// ========== 确保 shareCodeSystem 存在（防止 Object.assign 失败） ==========
if (!app.shareCodeSystem) {
    app.shareCodeSystem = {
        generateCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 8; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
        },
        
        validateCode(code) {
            return /^[A-Z0-9]{8}$/.test(code);
        },
        
        // 验证分享码是否有效
        async verifyCode(code) {
            const codes = await this.loadShareCodes();
            return codes.hasOwnProperty(code);
        },
        
        // 加载所有分享码
        async loadShareCodes() {
            try {
                const content = await window.WikiGitHubStorage.getFile('share-codes.json');
                if (content) {
                    return JSON.parse(content.content);
                }
            } catch (e) {
                console.warn('无法加载分享码列表:', e);
            }
            return {};
        },
        
        // 保存分享码
        async saveShareCode(code, description = '') {
            try {
                const codes = await this.loadShareCodes();
                codes[code] = {
                    description,
                    createdAt: Date.now(),
                    createdBy: window.app.backendLoggedIn ? 'backend' : 'frontend'
                };
                await window.WikiGitHubStorage.putFile('share-codes.json', JSON.stringify(codes, null, 2), 'Add share code');
                return true;
            } catch (e) {
                console.error('保存分享码失败:', e);
                return false;
            }
        },
        
        // 删除分享码
        async deleteCode(code) {
            try {
                const codes = await this.loadShareCodes();
                delete codes[code];
                await window.WikiGitHubStorage.putFile('share-codes.json', JSON.stringify(codes, null, 2), 'Delete share code');
                return true;
            } catch (e) {
                console.error('删除分享码失败:', e);
                return false;
            }
        }
    };
}

console.log('GitHub Wiki Core demov2.6 加载完成（修复导入与分享码逻辑）');