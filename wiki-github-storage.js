/**
 * GitHub 存储管理器 v2.6
 * 功能：通过GitHub API读取和修改仓库中的Wiki数据
 * 修复：添加空内容检查，防止 JSON 解析错误
 */

(function() {
    'use strict';

    window.WikiGitHubStorage = {
        config: {
            owner: '',
            repo: '',
            branch: 'main',
            dataPath: 'wiki-data',
            token: ''
        },

        init() {
            const savedConfig = localStorage.getItem('wiki_github_config');
            if (savedConfig) {
                try {
                    this.config = JSON.parse(savedConfig);
                    return true;
                } catch (e) {
                    console.warn('[GitHub] 配置解析失败');
                    return false;
                }
            }
            return false;
        },

        isConfigured() {
            return !!(this.config.owner && this.config.repo && this.config.token);
        },

        saveConfig(owner, repo, token, branch = 'main', dataPath = 'wiki-data') {
            this.config = { owner, repo, token, branch, dataPath };
            localStorage.setItem('wiki_github_config', JSON.stringify(this.config));
        },

        clearConfig() {
            this.config = { owner: '', repo: '', branch: 'main', dataPath: 'wiki-data', token: '' };
            localStorage.removeItem('wiki_github_config');
        },

        getBaseUrl() {
            return `https://api.github.com/repos/${this.config.owner}/${this.config.repo}`;
        },

        getHeaders() {
            return {
                'Authorization': `token ${this.config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            };
        },

        async getFile(path) {
            try {
                const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}?ref=${this.config.branch}`, {
                    method: 'GET',
                    headers: this.getHeaders()
                });

                if (!response.ok) {
                    if (response.status === 404) {
                        console.log(`[GitHub] 文件 ${path} 不存在（404）`);
                        return null;
                    }
                    throw new Error(`GitHub API错误: ${response.status}`);
                }

                const data = await response.json();
                
                // 【修复】更精确的空内容检测
                if (!data.content) {
                    console.warn(`[GitHub] 文件 ${path} 无 content 字段`);
                    return null;
                }
                
                if (data.content.trim() === '') {
                    console.warn(`[GitHub] 文件 ${path} content 为空字符串`);
                    return null;
                }
                
                try {
                    const content = atob(data.content.replace(/\s/g, ''));
                    console.log(`[GitHub] 成功读取 ${path}，内容长度: ${content.length}`);
                    return { content, sha: data.sha };
                } catch (decodeError) {
                    console.error(`[GitHub] Base64 解码 ${path} 失败:`, decodeError);
                    return null;
                }
            } catch (error) {
                console.error('[GitHub] 获取文件失败:', error);
                throw error;
            }
        },

        async putFile(path, content, message = 'Update via Wiki', isBinary = false, retryCount = 3) {
            try {
                let sha = null;
                try {
                    const existing = await this.getFile(path);
                    if (existing) sha = existing.sha;
                } catch (e) {
                    // 文件可能不存在，这是正常的
                }

                let encodedContent;
                if (isBinary) {
                    // 对于已经是 base64 的内容（如图片），直接发送，不再二次编码
                    // 移除可能的换行符（GitHub API 不接受带换行符的 base64）
                    encodedContent = content.replace(/\s/g, '');
                } else {
                    // 对于文本内容（如 JSON），使用标准编码
                    // 注意：先 utf-8 编码再 base64，避免中文乱码
                    const utf8Bytes = new TextEncoder().encode(content);
                    const binaryString = Array.from(utf8Bytes, byte => String.fromCharCode(byte)).join('');
                    encodedContent = btoa(binaryString);
                }

                const body = {
                    message: message,
                    content: encodedContent,
                    branch: this.config.branch
                };
                
                if (sha) body.sha = sha;

                console.log(`[GitHub] 正在保存 ${path}，大小: ${(encodedContent.length / 1024).toFixed(2)}KB，SHA: ${sha || '新建'}`);

                const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`, {
                    method: 'PUT',
                    headers: this.getHeaders(),
                    body: JSON.stringify(body)
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    console.error(`[GitHub] API 错误详情:`, errorData);
                    
                    if (response.status === 409 && retryCount > 0) {
                        console.warn(`[GitHub] 409 冲突，获取最新 SHA 后重试...`);
                        // 重新获取最新 SHA
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        const latest = await this.getFile(path).catch(() => null);
                        if (latest && latest.sha !== sha) {
                            console.log(`[GitHub] 获取到新 SHA: ${latest.sha}`);
                            // 递归重试，但不再次获取 SHA，避免无限循环
                            return this.putFile(path, content, message, isBinary, retryCount - 1);
                        }
                        throw new Error(`GitHub API错误: 409 - 内容冲突，请刷新后重试`);
                    }
                    
                    if (response.status === 422) {
                        const size = (encodedContent.length / 1024 / 1024).toFixed(2);
                        throw new Error(`GitHub API错误: 422 - 内容格式错误或过大(${size}MB)。单文件限制100MB。`);
                    }
                    
                    throw new Error(`GitHub API错误: ${response.status} ${errorData.message || ''}`);
                }
                
                const result = await response.json();
                console.log(`[GitHub] ✅ 成功保存 ${path}，新 SHA: ${result.content?.sha?.substring(0, 8)}`);
                return result;
            } catch (error) {
                console.error(`[GitHub] 保存文件 ${path} 失败:`, error.message);
                throw error;
            }
        },


        async deleteFile(path, message = 'Delete via Wiki') {
            try {
                const existing = await this.getFile(path);
                if (!existing) return true;

                const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`, {
                    method: 'DELETE',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        message: message,
                        sha: existing.sha,
                        branch: this.config.branch
                    })
                });
                if (!response.ok) throw new Error(`GitHub API错误: ${response.status}`);
                return true;
            } catch (error) {
                console.error('[GitHub] 删除文件失败:', error);
                throw error;
            }
        },

        async getDirectory(path = '') {
            try {
                const fullPath = path ? `${this.config.dataPath}/${path}` : this.config.dataPath;
                const response = await fetch(`${this.getBaseUrl()}/contents/${fullPath}?ref=${this.config.branch}`, {
                    method: 'GET',
                    headers: this.getHeaders()
                });
                if (!response.ok) {
                    if (response.status === 404) return [];
                    throw new Error(`GitHub API错误: ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                console.error('[GitHub] 获取目录失败:', error);
                throw error;
            }
        },

        // 【关键修复】添加空内容检查和健壮的错误处理
        async loadWikiData(filename = null) {
            try {
                if (filename) {
                    const file = await this.getFile(filename);
                    // 【修复】检查文件和内容是否存在且不为空
                    if (file && file.content && typeof file.content === 'string' && file.content.trim() !== '') {
                        try {
                            return JSON.parse(file.content);
                        } catch (parseError) {
                            console.warn(`[GitHub] 解析 ${filename} 失败:`, parseError.message);
                            // 【新增】如果解析失败，尝试删除损坏的文件或备份
                            return null;
                        }
                    }
                    return null;
                }

                const filenames = ['data.json', 'wiki-manifest.json'];
                for (const name of filenames) {
                    try {
                        const file = await this.getFile(name);
                        // 【修复】检查文件和内容是否存在且不为空
                        if (file && file.content && typeof file.content === 'string' && file.content.trim() !== '') {
                            try {
                                const parsed = JSON.parse(file.content);
                                // 【关键修复】如果读取的是 wiki-manifest.json 且没有 entries，则跳过（这是映射文件不是数据文件）
                                if (name === 'wiki-manifest.json' && !parsed.entries && !parsed.data && parsed.mappings) {
                                    console.log('[GitHub] 跳过 manifest 文件，继续寻找 data.json');
                                    continue;
                                }
                                console.log('[GitHub] 成功加载数据文件:', name);
                                return parsed;
                            } catch (parseError) {
                                console.warn(`[GitHub] 解析 ${name} 失败:`, parseError.message);
                                continue;
                            }
                        }
                    } catch (e) {
                        console.warn(`[GitHub] 加载 ${name} 失败:`, e.message);
                        continue;
                    }
                }
                return null;
            } catch (error) {
                console.error('[GitHub] 加载Wiki数据失败:', error);
                return null;
            }
        },

        async saveWikiData(data) {
            const content = JSON.stringify(data, null, 2);
            return await this.putFile('data.json', content, 'Update Wiki data');
        },

        async saveImage(filename, dataUrl) {
            try {
                // 提取 base64 部分
                let base64 = dataUrl;
                if (dataUrl.includes(',')) {
                    base64 = dataUrl.split(',')[1];
                }
                
                // 移除 dataUrl 前缀可能残留的空白
                base64 = base64.trim();
                
                // 使用 isBinary=true 模式，避免二次 base64 编码
                await this.putFile(`images/${filename}`, base64, `Add image: ${filename}`, true);
                return true;
            } catch (error) {
                console.error('[GitHub] 保存图片失败:', filename, error.message);
                throw error;
            }
        },

        async loadImage(filename) {
            try {
                // 【新增】处理 {{IMG:filename}} 格式
                if (filename.startsWith('{{IMG:') && filename.endsWith('}}')) {
                    filename = filename.slice(6, -2);
                }
                
                // 检查文件是否存在于GitHub
                const file = await this.getFile(`images/${filename}`);
                if (file) {
                    // 返回 GitHub raw 内容 URL
                    return `https://raw.githubusercontent.com/${this.config.owner}/${this.config.repo}/${this.config.branch}/${this.config.dataPath}/images/${filename}`;
                }
                return null;
            } catch (error) {
                console.error('[GitHub] 加载图片失败:', error);
                return null;
            }
        },

        async getImageList() {
            try {
                const items = await this.getDirectory('images');
                return items.filter(item => item.type === 'file').map(item => item.name);
            } catch (error) {
                console.error('[GitHub] 获取图片列表失败:', error);
                return [];
            }
        },

        async testConnection() {
            try {
                const response = await fetch(`${this.getBaseUrl()}`, {
                    method: 'GET',
                    headers: this.getHeaders()
                });
                if (!response.ok) {
                    if (response.status === 401) return { success: false, error: 'Token无效或已过期' };
                    if (response.status === 404) return { success: false, error: '仓库不存在' };
                    return { success: false, error: `HTTP ${response.status}` };
                }
                const data = await response.json();
                return { success: true, repo: data.name, owner: data.owner.login, private: data.private };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    console.log('GitHub Storage Manager v2.6 加载完成（已修复JSON解析错误）');
})();