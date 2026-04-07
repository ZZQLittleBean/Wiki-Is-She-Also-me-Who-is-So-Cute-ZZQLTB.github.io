/**
 * GitHub 存储管理器
 * 功能：通过GitHub API读取和修改仓库中的Wiki数据
 */

if (typeof app === 'undefined') {
    console.error('wiki-github-storage.js: app 对象未定义');
    throw new Error('Missing dependency: wiki-core.js');
}

// ========== GitHub 存储管理器 ==========
app.githubStorage = {
    // 配置
    config: {
        owner: '',
        repo: '',
        branch: 'main',
        dataPath: 'wiki-data',
        token: ''
    },
    
    // 内存缓存
    memoryCache: new Map(),
    
    // 初始化
    init() {
        // 从localStorage读取配置
        const savedConfig = localStorage.getItem('wiki_github_config');
        if (savedConfig) {
            try {
                this.config = JSON.parse(savedConfig);
            } catch (e) {
                console.warn('[GitHub] 配置解析失败');
            }
        }
        return this.isConfigured();
    },
    
    // 检查是否已配置
    isConfigured() {
        return !!(this.config.owner && this.config.repo && this.config.token);
    },
    
    // 保存配置
    saveConfig(owner, repo, token, branch = 'main', dataPath = 'wiki-data') {
        this.config = { owner, repo, token, branch, dataPath };
        localStorage.setItem('wiki_github_config', JSON.stringify(this.config));
    },
    
    // 清除配置
    clearConfig() {
        this.config = { owner: '', repo: '', branch: 'main', dataPath: 'wiki-data', token: '' };
        localStorage.removeItem('wiki_github_config');
    },
    
    // 获取GitHub API基础URL
    getBaseUrl() {
        return `https://api.github.com/repos/${this.config.owner}/${this.config.repo}`;
    },
    
    // 获取请求头
    getHeaders() {
        return {
            'Authorization': `token ${this.config.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };
    },
    
    // 获取文件内容
    async getFile(path) {
        try {
            const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}?ref=${this.config.branch}`, {
                method: 'GET',
                headers: this.getHeaders()
            });
            
            if (!response.ok) {
                if (response.status === 404) {
                    return null; // 文件不存在
                }
                throw new Error(`GitHub API错误: ${response.status}`);
            }
            
            const data = await response.json();
            // GitHub返回的content是base64编码的
            const content = atob(data.content.replace(/\s/g, ''));
            return {
                content: content,
                sha: data.sha
            };
        } catch (error) {
            console.error('[GitHub] 获取文件失败:', error);
            throw error;
        }
    },
    
    // 创建或更新文件
    async putFile(path, content, message = 'Update via Wiki') {
        try {
            // 首先尝试获取现有文件的sha
            let sha = null;
            try {
                const existing = await this.getFile(path);
                if (existing) {
                    sha = existing.sha;
                }
            } catch (e) {
                // 文件不存在，继续创建
            }
            
            const body = {
                message: message,
                content: btoa(unescape(encodeURIComponent(content))),
                branch: this.config.branch
            };
            
            if (sha) {
                body.sha = sha;
            }
            
            const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(body)
            });
            
            if (!response.ok) {
                throw new Error(`GitHub API错误: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('[GitHub] 保存文件失败:', error);
            throw error;
        }
    },
    
    // 删除文件
    async deleteFile(path, message = 'Delete via Wiki') {
        try {
            const existing = await this.getFile(path);
            if (!existing) {
                return true; // 文件不存在，视为成功
            }
            
            const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`, {
                method: 'DELETE',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    message: message,
                    sha: existing.sha,
                    branch: this.config.branch
                })
            });
            
            if (!response.ok) {
                throw new Error(`GitHub API错误: ${response.status}`);
            }
            
            return true;
        } catch (error) {
            console.error('[GitHub] 删除文件失败:', error);
            throw error;
        }
    },
    
    // 获取目录内容
    async getDirectory(path = '') {
        try {
            const fullPath = path ? `${this.config.dataPath}/${path}` : this.config.dataPath;
            const response = await fetch(`${this.getBaseUrl()}/contents/${fullPath}?ref=${this.config.branch}`, {
                method: 'GET',
                headers: this.getHeaders()
            });
            
            if (!response.ok) {
                if (response.status === 404) {
                    return []; // 目录不存在
                }
                throw new Error(`GitHub API错误: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('[GitHub] 获取目录失败:', error);
            throw error;
        }
    },
    
    // ========== Wiki数据操作 ==========
    
    // 加载Wiki数据
    async loadWikiData() {
        try {
            const file = await this.getFile('data.json');
            if (file) {
                return JSON.parse(file.content);
            }
            return null;
        } catch (error) {
            console.error('[GitHub] 加载Wiki数据失败:', error);
            return null;
        }
    },
    
    // 保存Wiki数据
    async saveWikiData(data) {
        const content = JSON.stringify(data, null, 2);
        return await this.putFile('data.json', content, 'Update Wiki data');
    },
    
    // 保存图片
    async saveImage(filename, dataUrl) {
        try {
            // 将dataURL转换为base64
            const base64 = dataUrl.split(',')[1];
            await this.putFile(`images/${filename}`, base64, `Add image: ${filename}`);
            return true;
        } catch (error) {
            console.error('[GitHub] 保存图片失败:', error);
            throw error;
        }
    },
    
    // 加载图片
    async loadImage(filename) {
        try {
            const file = await this.getFile(`images/${filename}`);
            if (file) {
                // 从GitHub raw URL获取图片
                return `https://raw.githubusercontent.com/${this.config.owner}/${this.config.repo}/${this.config.branch}/${this.config.dataPath}/images/${filename}`;
            }
            return null;
        } catch (error) {
            console.error('[GitHub] 加载图片失败:', error);
            return null;
        }
    },
    
    // 获取所有图片列表
    async getImageList() {
        try {
            const items = await this.getDirectory('images');
            return items.filter(item => item.type === 'file').map(item => item.name);
        } catch (error) {
            console.error('[GitHub] 获取图片列表失败:', error);
            return [];
        }
    },
    
    // 测试连接
    async testConnection() {
        try {
            const response = await fetch(`${this.getBaseUrl()}`, {
                method: 'GET',
                headers: this.getHeaders()
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    return { success: false, error: 'Token无效或已过期' };
                }
                if (response.status === 404) {
                    return { success: false, error: '仓库不存在' };
                }
                return { success: false, error: `HTTP ${response.status}` };
            }
            
            const data = await response.json();
            return { 
                success: true, 
                repo: data.name,
                owner: data.owner.login,
                private: data.private
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};

// ========== 存档分享码系统 ==========
app.shareCodeSystem = {
    // 生成分享码
    generateCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    },
    
    // 验证分享码格式
    validateCode(code) {
        return /^[A-HJ-NP-Z2-9]{8}$/.test(code);
    },
    
    // 保存分享码到GitHub
    async saveShareCode(code, description = '') {
        try {
            const shareCodes = await this.loadShareCodes();
            shareCodes[code] = {
                createdAt: Date.now(),
                description: description,
                active: true
            };
            
            await app.githubStorage.putFile('share-codes.json', 
                JSON.stringify(shareCodes, null, 2), 
                'Update share codes'
            );
            return true;
        } catch (error) {
            console.error('[ShareCode] 保存分享码失败:', error);
            return false;
        }
    },
    
    // 加载所有分享码
    async loadShareCodes() {
        try {
            const file = await app.githubStorage.getFile('share-codes.json');
            if (file) {
                return JSON.parse(file.content);
            }
        } catch (e) {}
        return {};
    },
    
    // 验证分享码是否有效
    async verifyCode(code) {
        if (!this.validateCode(code)) {
            return false;
        }
        
        try {
            const shareCodes = await this.loadShareCodes();
            return shareCodes[code] && shareCodes[code].active === true;
        } catch (error) {
            return false;
        }
    },
    
    // 删除分享码
    async deleteCode(code) {
        try {
            const shareCodes = await this.loadShareCodes();
            delete shareCodes[code];
            
            await app.githubStorage.putFile('share-codes.json', 
                JSON.stringify(shareCodes, null, 2), 
                'Delete share code'
            );
            return true;
        } catch (error) {
            return false;
        }
    }
};

console.log('GitHub Storage Manager 加载完成');
