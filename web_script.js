// ==UserScript==
// @name         goodJobs
// @namespace    http://tampermonkey.net/
// @version      2026-09-25
// @description  goodJobs篡改猴插件
// @match        https://www.zhipin.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=zhipin.com
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==

(function () {
    'use strict';

    // 配置项
    const OPTIONS = {
        resumeIndex: 0, // 第几份简历，从 0 开始递增
        serverHost: 'http://127.0.0.1:8000', // 本地服务的主机地址
        thread: 50, // 分数阈值，低于这个就不发消息了
        timestampTimeout: 3000, // 时间戳过期时间，单位毫秒，根据当前网络设定，建议不要太大。
        onlyGreet: false, // 是否只打招呼，默认为false，即打招呼和代聊天
        manualFilterWaitMs: 10000, // 每轮搜索后留给用户手动筛选的时间
        roundRestartDelayMs: 2000, // 本轮结束后，启动下一轮前的缓冲时间
        maxEmptyRounds: 3, // 连续多少轮没有拿到新岗位后停止，避免空转
        detailTimeout: 20000, // 获取职位详情超时时间
        greetTimeout: 30000, // 打招呼页加载并回传结果的最长等待时间
        openChatViewAfterGreet: true, // Boss沟通接口成功后打开只读聊天窗口
        preloadScrollPixels: 180, // 岗位预加载：每轮下滑像素
        preloadScrollWaitMs: 450, // 岗位预加载：每轮等待毫秒数
        preloadStableRoundsLimit: 24, // 岗位预加载：连续多少轮无增长后结束
        preloadMaxRounds: 300, // 岗位预加载：最多滑动多少轮
        maxJobsPerRound: 20, // 每轮最多实际评分多少个岗位，0 表示不限制
        maxJobsPerRun: 0, // 本次启动最多检查多少个岗位，0 表示不限制
        jobHistoryExpireDays: 7, // 已检查岗位在多少天内跳过，0 表示关闭跨次去重
        jobHistoryResetToken: '', // 修改为一个新值时，仅自动清空一次岗位历史
        companyBlockKeywords: [], // 公司名称黑名单，命中后不评分、不打招呼
        preloadActivateCardEvery: 0, // 预加载时每隔多少轮尝试轻点一次左侧岗位卡片，0 表示关闭
        preloadActivateCardWaitMs: 250, // 轻点岗位卡片后的额外等待时间
    };

    // 元素选择器
    const SELECTORS = {
        ZHIPIN: {
            SEARCH: {
                SEARCHINPUT: 'input', // 搜索框
                SEARCHBTN: '.search-btn', // 搜索按钮
                JOBLISTCTN: '.job-list-container', // 职位列表容器
                JOBLIST: '.rec-job-list', // 职位列表
                JOBCARD: '.job-card-box', // 左侧岗位卡片
                JOBHREFS: '.job-card-box .job-name', // 职位链接
                COMPANY: '.company-name, .company-info a[href*="/gongsi/"], .company-info a[href*="/company/"]', // 仅取明确的公司字段或公司链接
            },
            DETAIL: {
                STARTCHAT: '.btn-startchat', // 开始聊天按钮
                NAMEBOX: '.name', // 职位名称盒子
                JOBNAME: 'h1', // 职位名称
                SALARY: '.salary', // 职位薪资
                DETAIL: '.job-sec-text', // 职位详情
                COMPANY: '.job-detail-company .company-name, .job-detail-company a[href*="/gongsi/"], .job-detail-company a[href*="/company/"], .sider-company .company-name, .sider-company a[href*="/gongsi/"], .sider-company a[href*="/company/"], .job-boss-info .company-name, .job-boss-info .boss-company-name, .job-boss-info .boss-info-company, .job-boss-info a[href*="/gongsi/"], .job-boss-info a[href*="/company/"]', // 仅取明确的公司字段或公司链接
                CHATURL: 'redirect-url', // 聊天链接
            },
            CHAT: {
                // 聊天
                CHATINPUT: '#chat-input', // 聊天输入框
                MSGSEND: '.btn-send', // 消息发送按钮
                // 聊天记录
                HISTORYCTN: '.chat-message', // 聊天记录容器
                USEFULMSG: '.item-friend,.item-myself', // 有效的文字聊天记录项
                MSGCONTENT: '.message-content .text', // 聊天记录内容
                // 职位
                JOBEL: '*[ka=geek_chat_job_detail]', // 职位元素
                JOBCITY: '.city', // 职位城市
                // 简历
                RESUMESEND: '.toolbar-btn.tooltip.tooltip-top', // 简历发送按钮
                RESUMEMODAL: '.panel-resume', // 简历发送弹窗，有的时候简历按钮点击会出来一个小弹窗
                RESUMEMODALCONFIRM: '.btn-sure-v2', // 简历发送弹窗确认按钮
                RESUMELIST: '.resume-list', // 简历列表
                RESUMELISTITEM: 'li', // 简历列表项
                RESUMESENDCONFIRM: '.btn-confirm', // 简历发送确认按钮
                // 联系人
                CONTACTLISTEMPTY: '.no-data', // 联系人列表为空
                CONTACTLIST: '.user-list-content', // 联系人列表
                CONTACTLISTITEM: 'li', // 联系人列表项
                NEWMSGNOTICE: '.notice-badge', // 新消息通知图标
                USERNAME: '.name-text', // 联系人名称
            }
        },
    };

    const cleanCompanyName = (value) => String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/^(公司名称|所属公司)[：:]?\s*/, '')
        .trim();

    const invalidCompanyNames = new Set([
        '公司', '公司信息', '企业', '企业信息', '工商信息',
        '查看公司', '查看全部职位', '所属公司',
    ]);

    const isUsableCompanyName = (value) => {
        const normalized = cleanCompanyName(value).toLowerCase();
        return normalized.length >= 2 && !invalidCompanyNames.has(normalized);
    };

    const extractBossCardCompany = (card) => {
        if (!card) return '';
        for (const element of card.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.COMPANY)) {
            const name = cleanCompanyName(element.innerText || element.textContent);
            if (isUsableCompanyName(name)) return name;
        }
        return '';
    };

    const extractRecruiterCompany = (recruiter) => {
        const roleLine = String(recruiter?.querySelector('.boss-info-attr')?.innerText || '').trim();
        const parts = roleLine.match(/^(.+?)\s*[·•]\s*(.+)$/);
        if (!parts) return '';
        const company = cleanCompanyName(parts[1]);
        const role = parts[2].trim();
        const recruiterName = String(recruiter.innerText || '').split('\n')[0].trim();
        if (!isUsableCompanyName(company) || company === recruiterName || company.length > 80) return '';
        if (!/猎头|代招|招聘|人事|HR|工程师|算法|技术|创始人|合伙人|CEO|CTO|经理|主管|负责人|总监|运营|产品|销售/i.test(role)) return '';
        return company;
    };

    // 搜索路径
    const SEARCHPATH = {
        zhipin: '/web/geek/job',
    };

    // 白名单
    const WHITELIST = {
        zhipin: {
            deatil: '/job_detail',
            chat: '/web/geek/chat'
        },
    };

    // 工具
    const tools = {
        inWhiteList: function (pathObj) {
            return Object.values(pathObj).some((path) => location.pathname.startsWith(path));
        },
        endlessFind: function (selector) {
            return new Promise((resolve, reject) => {
                // 初始立即检查元素是否存在
                let element;
                try {
                    element = document.querySelector(selector);
                } catch (e) {
                    reject(e); // 处理无效选择器
                    return;
                }
                if (element) {
                    resolve(element);
                    return;
                }

                // 设置超时
                const timeoutId = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error('未找到目标元素'));
                }, 10000);

                // 定义MutationObserver回调
                const observer = new MutationObserver((_, obs) => {
                    try {
                        const el = document.querySelector(selector);
                        if (el) {
                            obs.disconnect();
                            clearTimeout(timeoutId);
                            resolve(el);
                        }
                    } catch (e) {
                        obs.disconnect();
                        clearTimeout(timeoutId);
                        reject(e);
                    }
                });

                // 开始观察整个文档的DOM变化
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true
                });
            });
        },
        inputText: function (el, text) {
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        asyncSleep(ms) {
            return new Promise((resolve) => {
                // 创建一个 Blob 对象，包含 Web Worker 的代码
                const workerCode = `self.addEventListener('message', function(e) {
                    const delay = e.data;
                    setTimeout(function() {
                        self.postMessage('done');
                    }, delay);
                });`;

                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);

                const worker = new Worker(workerUrl);
                worker.onmessage = function () {
                    resolve();
                    worker.terminate(); // 使用后终止worker
                    URL.revokeObjectURL(workerUrl); // 释放对象URL
                };
                worker.postMessage(ms);
            });
        },
        getTimestamp(key) {
            return Number(localStorage.getItem(key));
        },
        openTabNSetTimestamp(href, key, self = false) {
            localStorage.setItem(key, new Date().getTime());
            window.open(href, self ? '_self' : key);
        },
    };

    /**
     * 横幅
     * @param {string} text 显示的文本
     */
    function banner(text) {
        const el = document.createElement('div');
        el.style.cssText = `
                position: fixed;
                top: 60px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 9999;
                background-color: rgba(0,0,0,.5);
                padding: 4px 20px;
                text-align: center;
                border-radius: 8px;
                color: #fff;
        `;
        el.innerText = text;
        document.body.appendChild(el);
        setTimeout(function () {
            el.remove();
        }, 3000);
    }

    /**
     * 转换时间
     * @param {number} seconds 秒数
     * @returns {string} 转换后的时间字符串
     */
    function convertTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        return `${hours.toString().padStart(2, 0)
            } : ${minutes.toString().padStart(2, 0)
            } : ${secs.toFixed(0).padStart(2, 0)
            }`;
    }


    class WebBroadcastError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
            this.name = 'WebBroadcastError';
        }
    }

    class WebBroadcast {
        static ID_COUNTER = 0; // 自增序列，避免时间戳冲突

        /**
         * @param {string} name 频道名称
         * @param {string} target 当前页面标识
         * @param {object} [options] 配置项
         * @param {number} [options.retry=3] 发送失败重试次数
         * @param {number} [options.retryInterval=1000] 重试间隔(毫秒)
         */
        constructor(name, target, options = {}) {
            this.name = name;
            this.target = target;
            this.retry = options.retry ?? 3;
            this.retryInterval = options.retryInterval ?? 1000;
            this.evts = {};
            this.pendingResponses = {};
            this.pendingReceives = {};

            // 初始化通信通道
            this.initChannel();
        }

        /* -------------------- 核心通信逻辑 -------------------- */
        initChannel() {
            // 优先使用 BroadcastChannel
            if (typeof BroadcastChannel !== 'undefined') {
                this.setupBroadcastChannel();
            } else {
                this.setupStorageFallback();
            }
            window.addEventListener('beforeunload', () => this.destroy());
        }

        setupBroadcastChannel() {
            this.channelType = 'broadcast';
            this.channel = new BroadcastChannel(this.name);
            this.channel.addEventListener('message', this.handleMessage.bind(this));
            this.channel.addEventListener('messageerror', (e) => {
                this.emitError('MESSAGE_ERROR', '消息解析失败', e);
            });
        }

        setupStorageFallback() {
            this.channelType = 'storage';
            this.storageKey = `web_broadcast_${this.name}`;

            // 监听 storage 事件
            window.addEventListener('storage', (e) => {
                if (e.key === this.storageKey && e.newValue) {
                    const message = JSON.parse(e.newValue);
                    this.handleMessage({ data: message });
                }
            });
        }

        handleMessage(e) {
            const resp = e.data;
            if (![this.target, 'all'].includes(resp.to)) return;

            // 处理事件监听
            if (this.evts[resp.type]) {
                Promise.resolve().then(() => this.evts[resp.type](resp.from, resp.data));
            }

            // 处理 receive 等待
            const receiveKey = `${resp.from}-${resp.type}`;
            if (this.pendingReceives[receiveKey]) {
                const pending = this.pendingReceives[receiveKey];
                pending.resolve(resp.data);
                clearTimeout(pending.timer);
                delete this.pendingReceives[receiveKey];
            }

            // 处理 sendAndReceive 响应
            if (this.pendingResponses[resp.data?.requestId]) {
                const pending = this.pendingResponses[resp.data.requestId];
                pending.resolve(resp.data);
                clearTimeout(pending.timer);
                delete this.pendingResponses[resp.data.requestId];
            }
        }

        /* -------------------- 消息收发方法 -------------------- */
        send(to, type, data = null, attempt = 0) {
            const message = { from: this.target, to, type, data };

            return new Promise((resolve, reject) => {
                try {
                    if (this.channelType === 'broadcast') {
                        this.channel.postMessage(message);
                    } else {
                        // storage 方案需要先写入再删除，触发事件
                        localStorage.setItem(this.storageKey, JSON.stringify(message));
                        localStorage.removeItem(this.storageKey);
                    }
                    resolve();
                } catch (err) {
                    if (attempt < this.retry) {
                        setTimeout(() => this.send(to, type, data, attempt + 1), this.retryInterval);
                    } else {
                        this.emitError('SEND_FAILED', `消息发送失败: ${type}`, err);
                        reject(`消息发送失败: ${type}, ${err.message}`);
                    }
                }
            });
        }

        receive(from, type, timeout = 30000) {
            const key = `${from}-${type}`;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `接收超时: ${type}`));
                    delete this.pendingReceives[key];
                }, timeout);

                this.pendingReceives[key] = { resolve, reject, timer };
            });
        }

        sendAndReceive(to, type, data = null, timeout = 30000) {
            const requestId = this.generateRequestId();
            const responseType = `${type}_response`;

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `请求超时: ${type}`));
                    delete this.pendingResponses[requestId];
                }, timeout);


                this.pendingResponses[requestId] = { resolve, reject, timer };
                // 发送时携带 responseType
                this.send(to, type, { ...data, requestId, responseType });
            });
        }

        reply(originalFrom, originalType, data, requestId, responseType) {
            const finalResponseType = responseType || `${originalType}_response`;
            return this.send(originalFrom, finalResponseType, { ...data, requestId });
        }

        /* -------------------- 工具方法 -------------------- */
        generateRequestId() {
            const time = Date.now().toString(36);
            const random = Math.random().toString(36).slice(2, 6);
            WebBroadcast.ID_COUNTER = (WebBroadcast.ID_COUNTER + 1) % 0xfff;
            return `${time}-${random}-${WebBroadcast.ID_COUNTER.toString(36).padStart(2, '0')}`;
        }

        emitError(code, message, error) {
            const err = new WebBroadcastError(code, `${message}: ${error?.message || error}`);
            console.error(err);
            if (this.evts['error']) {
                this.evts['error'](code, err.message);
            }
        }

        on(evt, fn) {
            if (typeof fn !== 'function') throw new Error('回调必须是函数');
            this.evts[evt] = fn;
        }

        off(evt) {
            delete this.evts[evt];
        }

        destroy() {
            if (this.channel) {
                this.channel.close();
            }
            window.removeEventListener('storage', this.handleMessage);
            this.pendingResponses = {};
            this.pendingReceives = {};
        }
    }

    // api请求
    class Api {
        constructor() { }

        /**
         * 封装请求
         * @param {string} path 请求路径
         * @param {string} method 请求方法
         * @param {any} data 请求数据
         * @returns {Promise<any>} 请求结果
         */
        __http(path, method = 'GET', data = null) {
            const start = performance.now();
            return new Promise(async (resolve, reject) => {
                GM.xmlHttpRequest({
                    method: method,
                    url: OPTIONS.serverHost + path,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    data: data,
                    timeout: 1000 * 60 * 10,
                })
                    .then(resp => {
                        if (resp.status != 200) {
                            banner(`请求失败: ${resp.status}`);
                            reject(resp.status);
                            return;
                        }
                        resolve(JSON.parse(resp.response));
                    })
                    .catch((err) => {
                        banner('请求出错');
                        reject(`请求出错: ${JSON.stringify(err)}`);
                    });
            });
        }

        /**
         * 获取自我介绍
         */
        getIntroduce() {
            return new Promise((resolve, reject) => this.__http('/get-introduce').then(res => {
                resolve(res.introduce);
            }).catch(reject));
        }

        /**
         * 获取标签
         */
        getTags() {
            return new Promise((resolve, reject) => this.__http('/tags').then(res => {
                resolve(res.tags);
            }).catch(reject));
        }

        /**
         * 获取前端运行配置
         */
        getClientConfig() {
            return new Promise((resolve, reject) => this.__http('/client-config').then(resolve).catch(reject));
        }

        /**
         * 获取职位匹配度
         * @param {string} title 职位标题
         * @param {string} salary 薪资范围
         * @param {string} detail 职位描述
         * @param {string} company 公司名称
         */
        getJobScore(title, salary, detail, company = '') {
            const data = { platform: 'boss', title, company, salary, detail };
            return new Promise((resolve, reject) => {
                this.__http('/get-job-score', 'POST', JSON.stringify(data)).then(resolve).catch(reject);
            });
        }

        /**
         * 回复消息
         * @param {string} msgs 消息记录
         */
        reply(msgs) {
            return new Promise((resolve, reject) => {
                this.__http('/reply', 'POST', JSON.stringify(msgs)).then(res => {
                    resolve(res);
                }).catch(reject);
            });
        }

        /**
         * 判断是否需要简历
         * @param {string} msgs 消息记录
         */
        isNeedResume(msgs) {
            return new Promise((resolve, reject) => {
                this.__http('/is-need-resume', 'POST', JSON.stringify(msgs)).then(res => {
                    resolve(res.need);
                }).catch(reject);
            });
        }

        /**
         * 判断是否需要作品集
         * @param {string} msgs 消息记录
         */
        isNeedWorks(msgs) {
            return new Promise((resolve, reject) => {
                this.__http('/is-need-works', 'POST', JSON.stringify(msgs)).then(res => {
                    resolve(res.need);
                }).catch(reject);
            });
        }

        /**
         * 记录动作日志
         * @param {object} payload 动作信息
         */
        logAction(payload) {
            return new Promise((resolve, reject) => {
                this.__http('/log-action', 'POST', JSON.stringify(payload)).then(resolve).catch(reject);
            });
        }
    }

    // 日志记录
    class Logger {
        constructor(startFn, pauseFn) {
            // 校验函数
            if (startFn && !Function.prototype.isPrototypeOf(startFn)) {
                throw new Error('参数错误，startFn应为函数');
            }
            if (pauseFn && !Function.prototype.isPrototypeOf(pauseFn)) {
                throw new Error('参数错误，pauseFn应为函数');
            }
            // 创建元素
            const ctn = document.createElement('div');
            const btnBox = document.createElement('div');
            const clearBtn = document.createElement('div');
            const runBtn = document.createElement('div');
            const foldBtn = document.createElement('div');
            const msgList = document.createElement('div');
            ctn.style.cssText = `
                position: fixed;
                bottom: 16px;
                left: 16px;
                width: 380px;
                background-color: rgba(0, 0, 0, 0.5);
                color: #fff;
                z-index: 9999;
                font-size: 14px;
                border-radius: 10px;
            `;
            btnBox.style.cssText = `
                width: 380px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: flex-end;
            `;
            clearBtn.style.cssText = runBtn.style.cssText = foldBtn.style.cssText = `
                width: 60px;
                height: 32px;
                line-height: 32px;
                text-align: center;
                cursor: pointer;
            `;
            msgList.style.cssText = `
                width: 380px;
                height: 240px;
                padding: 2px 12px 8px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 4px;
            `;
            clearBtn.innerText = "清空";
            runBtn.innerText = "开始";
            foldBtn.innerText = "收起";
            document.body.appendChild(ctn);
            ctn.appendChild(btnBox);
            btnBox.appendChild(clearBtn);
            btnBox.appendChild(runBtn);
            btnBox.appendChild(foldBtn);
            ctn.appendChild(msgList);
            this.ctn = ctn;
            this.list = msgList;
            this.runBtn = runBtn;
            this.clearBtn = clearBtn;
            this.__startFn = startFn || (() => void 0);
            this.__pauseFn = pauseFn || (() => void 0);
            this.__pause = true;
            clearBtn.addEventListener('click', () => this.clear());
            runBtn.addEventListener('click', () => {
                this.__pause = !this.__pause;
                if (this.__pause) {
                    runBtn.innerText = "继续";
                    this.__pauseFn();
                } else {
                    runBtn.innerText = "暂停";
                    this.__startFn();
                }
            });
            foldBtn.addEventListener('click', () => {
                if (foldBtn.innerText === "展开") {
                    msgList.style.height = "240px";
                    foldBtn.innerText = "收起";
                } else {
                    msgList.style.height = "32px";
                    this.list.scrollTop = this.list.scrollHeight;
                    foldBtn.innerText = "展开";
                }
            });
        }

        add(message) {
            const item = document.createElement('div');
            item.textContent = message;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        divider() {
            const item = document.createElement('div');
            item.style.cssText = `
                width: 100%;
                border-top: 1px dashed rgba(255, 255, 255, 0.6);
            `;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        clear() {
            while (this.list.firstChild) {
                this.list.removeChild(this.list.firstChild);
            }
        }

        remove() {
            this.ctn.remove();
        }
    }

    // boss 直聘
    class Zhipin {
        constructor() {
            // 窗口标签
            this.targets = {
                search: "__zhipin_search",
                detail: "__zhipin_detail",
                chat: "__zhipin_chat",
                chatGreet: "__zhipin_chat_greet",
                chatView: "__zhipin_chat_view",
            };
            // 广播类型
            this.bcTypes = {
                // 全局
                STATUS: "status",
                RUN: 'run',
                DIVIDER: 'divider',
                INTRODUCE: 'introduce',
                HEART_BEAT: 'heart-beat',
                // 聊天页和职位详情页
                GET_JOB_INFO: 'get-job-info',
                SAY_HI: 'say-hi',
            };
            // 白名单
            this.whiteList = WHITELIST.zhipin;
            // 记录状态
            this.pause = false;
            this.tags = [];
            this.introduce = ''
        }

        // 注册广播
        __broadcast(target) {
            this.broadcast = new WebBroadcast('__zhipin_broadcast', target);
        }

        // 搜索页
        async __search(tagIdx) {
            // api
            const api = new Api();
            // 记录开始时间
            const start = new Date().getTime();
            let count = 0;
            let page = 0;
            // 记录职位链接
            let jobHrefs = [];
            let elsLen = 0;
            // 缓存
            let started = false;
            let pendingRoundRestart = false;
            let roundTransitioning = false;
            let currentRound = 0;
            let emptyRounds = 0;
            let roundQueuedCount = 0;
            let currentKeyword = '';
            let currentTagIdx = -1;
            const processedJobHrefs = new Set();
            const jobHistoryStorageKey = 'goodJobs.jobHistory.v1';
            const jobHistoryResetStorageKey = 'goodJobs.jobHistoryResetToken.v1';
            let jobHistory = null;
            window.addEventListener('storage', (event) => {
                if (event.key === jobHistoryStorageKey) jobHistory = null;
            });

            const getJobHistoryKey = (href) => {
                try {
                    const url = new URL(href, window.location.origin);
                    const jobId = url.searchParams.get('jobId');
                    if (jobId) return `jobId:${jobId}`;
                    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
                } catch (e) {
                    return String(href || '').split('?')[0];
                }
            };

            const saveJobHistory = () => {
                try {
                    localStorage.setItem(jobHistoryStorageKey, JSON.stringify(jobHistory || {}));
                } catch (e) {
                    console.log('保存岗位历史失败', e);
                }
            };

            const loadJobHistory = () => {
                if (jobHistory !== null) return jobHistory;
                let stored = {};
                try {
                    stored = JSON.parse(localStorage.getItem(jobHistoryStorageKey) || '{}');
                } catch (e) {
                    stored = {};
                }
                const expireDays = Number(OPTIONS.jobHistoryExpireDays) || 0;
                const cutoff = Date.now() - expireDays * 24 * 60 * 60 * 1000;
                jobHistory = {};
                if (expireDays > 0 && stored && typeof stored === 'object') {
                    Object.entries(stored).forEach(([key, checkedAt]) => {
                        if (Number(checkedAt) >= cutoff) jobHistory[key] = Number(checkedAt);
                    });
                }
                saveJobHistory();
                return jobHistory;
            };

            const wasRecentlyChecked = (href) => {
                if ((Number(OPTIONS.jobHistoryExpireDays) || 0) <= 0) return false;
                return Object.prototype.hasOwnProperty.call(loadJobHistory(), getJobHistoryKey(href));
            };

            const rememberCheckedJob = (href) => {
                if ((Number(OPTIONS.jobHistoryExpireDays) || 0) <= 0) return;
                // 重新合并一次存储，避免多个Boss页面互相覆盖岗位历史。
                jobHistory = null;
                loadJobHistory()[getJobHistoryKey(href)] = Date.now();
                saveJobHistory();
            };

            const wasProcessedInCurrentRun = (href) => processedJobHrefs.has(getJobHistoryKey(href));

            const applyJobHistoryResetToken = () => {
                const resetToken = String(OPTIONS.jobHistoryResetToken || '').trim();
                if (!resetToken) return false;
                if (localStorage.getItem(jobHistoryResetStorageKey) === resetToken) return false;
                localStorage.removeItem(jobHistoryStorageKey);
                localStorage.setItem(jobHistoryResetStorageKey, resetToken);
                jobHistory = null;
                return true;
            };

            // 日志启动暂停事件
            const logger = new Logger(() => {
                this.pause = false;
                if (!started) return main();
                if (pendingRoundRestart) {
                    pendingRoundRestart = false;
                    return startRound();
                }
                loop();
            }, () => {
                this.pause = true;
            });

            // 开始广播
            const startBroadcast = () => {
                this.__broadcast(this.targets.search);
                // 接收聊天页的消息提醒
                this.broadcast.on(this.bcTypes.STATUS, (from, data) => {
                    if (from === this.targets.chat) {
                        logger.add(data);
                    }
                });
                // 发送自我介绍
                this.broadcast.on(this.bcTypes.INTRODUCE, (from, data) => {
                    this.broadcast.reply(
                        from,
                        this.bcTypes.INTRODUCE,
                        { introduce: this.introduce },
                        data.requestId,
                        data.responseType
                    );
                });
                // 分割线
                this.broadcast.on(this.bcTypes.DIVIDER, () => {
                    logger.divider();
                });
                // 监听聊天页
                chatListener();
                // 心跳监听
                heartBeatListener();
            };

            // 执行搜索
            const search = async (kw) => {
                try {
                    const input = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.SEARCHINPUT);
                    const btn = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.SEARCHBTN);
                    tools.inputText(input, kw);
                    btn.click();
                } catch (e) {
                    logger.add('搜索出错');
                    throw new Error('搜索出错');
                }
            };

            // 获取职位链接
            const jobCompanyByHref = new Map();
            const rememberCompanyFromCard = (jobLink) => {
                if (!jobLink || !jobLink.href) return;
                const card = jobLink.closest(SELECTORS.ZHIPIN.SEARCH.JOBCARD);
                const company = extractBossCardCompany(card);
                if (company) jobCompanyByHref.set(getJobHistoryKey(jobLink.href), company);
            };
            const getJobHrefs = async () => {
                try {
                    const jobUl = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    const aList = jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS);
                    aList.forEach(rememberCompanyFromCard);
                    const hrefs = Array.from(aList)
                        .map(a => a.href)
                        .slice(elsLen)
                        .filter(href => !wasProcessedInCurrentRun(href) && !wasRecentlyChecked(href));
                    return [hrefs, aList];
                } catch (e) {
                    logger.add('获取职位链接出错');
                    throw new Error('获取职位链接出错');
                }
            };

            const resetRoundState = () => {
                jobHrefs = [];
                elsLen = 0;
                page = 0;
                roundQueuedCount = 0;
                clearPendingGreet();
            };

            const activatePreloadCard = async (round) => {
                if (!OPTIONS.preloadActivateCardEvery || round % OPTIONS.preloadActivateCardEvery !== 0) return;
                try {
                    const jobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    if (!jobUl) return;
                    const cards = Array.from(jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBCARD));
                    if (!cards.length) return;
                    const visibleCards = cards.filter(card => {
                        const rect = card.getBoundingClientRect();
                        return rect.top < window.innerHeight - 120 && rect.bottom > 120;
                    });
                    const targetCard = visibleCards[visibleCards.length - 1] || cards[cards.length - 1];
                    if (!targetCard) return;
                    targetCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    await tools.asyncSleep(120);
                    targetCard.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    targetCard.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    targetCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    logger.add(`预加载第 ${round} 轮：已轻点左侧岗位卡片`);
                    await tools.asyncSleep(OPTIONS.preloadActivateCardWaitMs);
                } catch (e) {
                    logger.add('预加载时轻点岗位卡片失败，已继续纯滚动');
                }
            };

            // 下一页
            const nextPage = async () => {
                if (OPTIONS.maxJobsPerRun > 0 && count >= OPTIONS.maxJobsPerRun) {
                    logger.add(`本次测试已达到 ${OPTIONS.maxJobsPerRun} 个岗位的总上限`);
                    return false;
                }
                if (OPTIONS.maxJobsPerRound > 0 && roundQueuedCount >= OPTIONS.maxJobsPerRound) {
                    logger.add(`本轮已达到 ${OPTIONS.maxJobsPerRound} 个岗位的测试上限`);
                    return false;
                }
                while (true) {
                    let hrefs, els;
                    [hrefs, els] = await getJobHrefs();
                    if (els.length === elsLen) {
                        logger.add('没有更多职位了');
                        return false;
                    }
                    elsLen = els.length;
                    els[elsLen - 1].scrollIntoView();
                    page++;
                    logger.add(`开始浏览第 ${page} 页`);
                    if (hrefs.length) {
                        const remainingRoundSlots = OPTIONS.maxJobsPerRound > 0
                            ? Math.max(0, OPTIONS.maxJobsPerRound - roundQueuedCount)
                            : hrefs.length;
                        const remainingRunSlots = OPTIONS.maxJobsPerRun > 0
                            ? Math.max(0, OPTIONS.maxJobsPerRun - count)
                            : hrefs.length;
                        const queuedHrefs = hrefs.slice(0, Math.min(remainingRoundSlots, remainingRunSlots));
                        jobHrefs.push(...queuedHrefs);
                        roundQueuedCount += queuedHrefs.length;
                        logger.add(`本页新增 ${queuedHrefs.length} 个未处理岗位`);
                        return true;
                    }
                    logger.add('本页新增岗位都已处理过，继续向下查找');
                    await tools.asyncSleep(OPTIONS.preloadScrollWaitMs);
                }
            };

            document.nextPage = nextPage
            document.clearGoodJobsHistory = () => {
                localStorage.removeItem(jobHistoryStorageKey);
                jobHistory = {};
                logger.add('已清空跨次岗位历史；刷新页面后可重新检查这些岗位');
                return true;
            };

            let pendingGreetTimer = null;
            let pendingGreetTitle = '';
            let pendingGreetDecision = null;
            let pendingGreetHref = '';

            const clearPendingGreet = () => {
                if (pendingGreetTimer) {
                    clearTimeout(pendingGreetTimer);
                    pendingGreetTimer = null;
                }
                pendingGreetTitle = '';
                pendingGreetDecision = null;
                pendingGreetHref = '';
            };

            const armPendingGreet = (title, decision = null, href = '') => {
                clearPendingGreet();
                pendingGreetTitle = title;
                pendingGreetDecision = decision;
                pendingGreetHref = href;
                pendingGreetTimer = setTimeout(async () => {
                    const timeoutTitle = pendingGreetTitle;
                    const timeoutDecision = pendingGreetDecision;
                    logger.add(`职位 [${timeoutTitle}] 打招呼超时，未写入岗位历史，可在下次运行时重试`);
                    await logAction({
                        action: 'greet_timeout',
                        scene: 'search',
                        title: timeoutTitle,
                        score: timeoutDecision?.score ?? null,
                        resumeIndex: timeoutDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                    });
                    clearPendingGreet();
                    loop();
                }, OPTIONS.greetTimeout);
            };

            const handleRoundExhausted = async () => {
                if (roundTransitioning) return;
                roundTransitioning = true;
                try {
                    if (OPTIONS.maxJobsPerRun > 0 && count >= OPTIONS.maxJobsPerRun) {
                        this.pause = true;
                        logger.add(`本次测试完成：已检查 ${count} 个岗位，程序自动暂停`);
                        return;
                    }
                    if (roundQueuedCount === 0) {
                        emptyRounds += 1;
                        logger.add(`第 ${currentRound} 轮没有拿到新岗位（连续空轮 ${emptyRounds}/${OPTIONS.maxEmptyRounds}）`);
                    } else {
                        emptyRounds = 0;
                        logger.add(`第 ${currentRound} 轮已处理完当前加载岗位，准备进入下一轮`);
                    }
                    if (emptyRounds >= OPTIONS.maxEmptyRounds) {
                        logger.add(`连续 ${OPTIONS.maxEmptyRounds} 轮没有新岗位，自动切换到下一个关键词继续挂机`);
                        emptyRounds = 0;
                        return startRound();
                    }
                    await tools.asyncSleep(OPTIONS.roundRestartDelayMs);
                    if (this.pause) {
                        pendingRoundRestart = true;
                        logger.add('当前已暂停，下一轮等待继续');
                        return;
                    }
                    await startRound();
                } finally {
                    roundTransitioning = false;
                }
            };

            const logAction = async (payload) => {
                try {
                    await api.logAction(payload);
                } catch (e) {
                    console.log('logAction failed', e);
                }
            };

            const normalizeCompanyName = (value) => String(value || '')
                .toLowerCase()
                .replace(/[\s·•（）()\[\]【】]/g, '');

            const invalidCompanyNames = new Set([
                '公司', '公司信息', '企业', '企业信息', '工商信息',
                '查看公司', '查看全部职位', '所属公司',
            ]);

            const isUsableCompanyName = (value) => {
                const normalized = normalizeCompanyName(value);
                return normalized.length >= 2 && !invalidCompanyNames.has(normalized);
            };

            const getBlockedCompanyKeyword = (company) => {
                const normalizedCompany = normalizeCompanyName(company);
                if (!normalizedCompany || !Array.isArray(OPTIONS.companyBlockKeywords)) return '';
                return OPTIONS.companyBlockKeywords.find((keyword) => {
                    const normalizedKeyword = normalizeCompanyName(keyword);
                    return normalizedKeyword && normalizedCompany.includes(normalizedKeyword);
                }) || '';
            };

            // 获取职位信息
            const getJobInfo = async (href) => {
                // 必须先注册接收，再打开详情页；否则详情页加载较快时，
                // 回传消息会早于 receive 注册并永久丢失。
                const pendingInfo = this.broadcast.receive(
                    this.targets.detail,
                    this.bcTypes.GET_JOB_INFO,
                    OPTIONS.detailTimeout
                );
                tools.openTabNSetTimestamp(href, this.targets.detail);
                const info = await pendingInfo.catch(() => ({
                    skip: true,
                    skipReason: `获取职位详情超时（>${(OPTIONS.detailTimeout / 1000).toFixed(0)}s）`,
                }));
                if (!info.agencyRole && !isUsableCompanyName(info.company)) {
                    const cardCompany = jobCompanyByHref.get(getJobHistoryKey(href)) || '';
                    info.company = isUsableCompanyName(cardCompany) ? cardCompany : '';
                }
                return info;
            };

            // 添加到聊天列表
            const addToChatList = async (url) => {
                return new Promise((resolve, reject) => {
                    fetch(url)
                        .then(async resp => {
                            if (!(resp.ok && resp.status === 200)) {
                                const bodyText = await resp.text().catch(() => '');
                                logger.add(`boss直聘网络连接出错: status=${resp.status}`);
                                return reject(new Error(`http_${resp.status}:${bodyText.slice(0, 300)}`));
                            }
                            return resp.json();
                        }).then(resp => {
                            if (resp.code === 0) return resolve(resp);
                            const msg = resp?.zpData?.bizData?.chatRemindDialog?.title || resp?.message || '未知错误';
                            logger.add(`打招呼失败: ${msg}`);
                            reject(new Error(`biz_fail:${msg}`));
                        }).catch(err => {
                            reject(err instanceof Error ? err : new Error(String(err)));
                        });
                });
            };

            // 打招呼监听
            const greetListener = () => {
                this.broadcast.on(this.bcTypes.SAY_HI, async (from, data) => {
                    if (from !== this.targets.chatGreet) return;
                    // 要自我介绍
                    if (data.requestId) {
                        this.broadcast.reply(
                            from,
                            this.bcTypes.SAY_HI,
                            {
                                introduce: pendingGreetDecision?.introduce || this.introduce,
                                resumeIndex: pendingGreetDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                            },
                            data.requestId,
                            data.responseType
                        );
                        return;
                    }
                    // 告知结果
                    const finalDecision = pendingGreetDecision;
                    const finalTitle = pendingGreetTitle;
                    const finalHref = pendingGreetHref;
                    clearPendingGreet();
                    if (data.success) {
                        rememberCheckedJob(finalHref);
                        logger.add(`打招呼成功`);
                        await logAction({
                            action: 'greet_sent',
                            scene: 'search',
                            title: finalTitle,
                            resumeIndex: finalDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                        });
                    }
                    // 出错了
                    else {
                        logger.add(`打招呼失败`);
                        await logAction({
                            action: 'greet_failed',
                            scene: 'search',
                            title: finalTitle,
                            resumeIndex: finalDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                        });
                    }
                    loop();
                });
            };

            // 聊天页监听
            const chatListener = () => {
                this.broadcast.on(this.bcTypes.RUN, async (from, data) => {
                    if (from !== this.targets.chat) return;
                    if (data) {
                        logger.divider();
                        const hasNext = await nextPage();
                        if (!hasNext) return handleRoundExhausted();
                        loop();
                    } else {
                        logger.add(`消息处理出错，重试中...`);
                        tools.openTabNSetTimestamp(this.whiteList.chat, this.targets.chat);
                    }
                });
            };

            // 心跳监听
            const heartBeatListener = () => {
                this.broadcast.on(this.bcTypes.HEART_BEAT, async (from, data) => {
                    this.broadcast.reply(
                        from,
                        this.bcTypes.HEART_BEAT,
                        { success: true },
                        data.requestId,
                        data.responseType
                    );
                });
            }

            // 循环
            const loop = async () => {
                try {
                    // 如果暂停，则跳过
                    if (this.pause) {
                        logger.add('暂停中...');
                        return;
                    }
                    logger.divider();
                    // 判断职位链接是否为空
                    if (jobHrefs.length === 0) {
                        // 判断是否需要代聊天
                        if (OPTIONS.onlyGreet) {
                            const hasNext = await nextPage();
                            if (!hasNext) return handleRoundExhausted();
                            return loop();
                        }
                        logger.add('开始处理聊天消息');
                        tools.openTabNSetTimestamp(this.whiteList.chat, this.targets.chat);
                        return;
                    }
                    // 抽取第一个
                    const href = jobHrefs.shift();
                    // 队列建立后页面链接参数仍可能变化，因此在真正计数前再次判重。
                    if (wasProcessedInCurrentRun(href) || wasRecentlyChecked(href)) {
                        return loop();
                    }
                    const diff = (new Date().getTime() - start) / 1000;
                    // 获取详情
                    logger.add(`| 浏览: ${++count} | 剩余: ${jobHrefs.length} | 平均: ${(diff / count).toFixed(0)}s | 耗时: ${convertTime(diff)} |`);
                    logger.add(`正在获取职位详情`);
                    const jobInfo = await getJobInfo(href);
                    if (jobInfo.skip) {
                        // 已明确识别的猎头岗位也要去重，避免下一轮反复打开并占用检查名额。
                        if (jobInfo.agencyRole) {
                            processedJobHrefs.add(getJobHistoryKey(href));
                            rememberCheckedJob(href);
                        }
                        if (jobInfo.recruiterCompany) {
                            logger.add(`招聘者所属机构：[${jobInfo.recruiterCompany}]`);
                        }
                        logger.add(`职位跳过: ${jobInfo.skipReason}`);
                        await logAction({
                            action: 'job_skip',
                            scene: 'search',
                            company: jobInfo.company || null,
                            recruiterCompany: jobInfo.recruiterCompany || null,
                            title: jobInfo.title || null,
                            salary: jobInfo.salary || null,
                            detail: jobInfo.detail || null,
                            reason: jobInfo.skipReason,
                        });
                        return loop();
                    }
                    processedJobHrefs.add(getJobHistoryKey(href));
                    if (isUsableCompanyName(jobInfo.company)) {
                        logger.add(`已识别公司：[${jobInfo.company}]`);
                    } else {
                        logger.add(`岗位 [${jobInfo.title}] 未识别到公司名称`);
                    }
                    const companyBlacklistEnabled = Array.isArray(OPTIONS.companyBlockKeywords)
                        && OPTIONS.companyBlockKeywords.length > 0;
                    if (companyBlacklistEnabled && !isUsableCompanyName(jobInfo.company)) {
                        logger.add(`岗位 [${jobInfo.title}] 未能识别公司名称，为确保公司黑名单有效，本次不评分、不打招呼`);
                        await logAction({
                            action: 'job_company_unknown',
                            scene: 'search',
                            company: null,
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                        });
                        return loop();
                    }
                    const blockedCompanyKeyword = getBlockedCompanyKeyword(jobInfo.company);
                    if (blockedCompanyKeyword) {
                        rememberCheckedJob(href);
                        logger.add(`公司 [${jobInfo.company}] 已在屏蔽名单中，跳过岗位 [${jobInfo.title}]`);
                        await logAction({
                            action: 'job_company_blocked',
                            scene: 'search',
                            company: jobInfo.company,
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                            matchedKeyword: blockedCompanyKeyword,
                        });
                        return loop();
                    }
                    // 如果聊过，下一个
                    if (jobInfo.talked) {
                        rememberCheckedJob(href);
                        logger.add(`职位 [${jobInfo.title}] 已经聊过，下一个`);
                        await logAction({
                            action: 'job_already_talked',
                            scene: 'search',
                            company: jobInfo.company,
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                        });
                        return loop();
                    }
                    // 否则发送消息计算匹配度
                    logger.add(`开始计算职位 [${jobInfo.title}] 的匹配度`);
                    const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail, jobInfo.company);
                    logger.add(`匹配度: ${decision.score} | 简历索引: ${decision.resumeIndex}`);
                    await logAction({
                        action: 'job_decision_consumed',
                        scene: 'search',
                        decisionId: decision.decisionId,
                        company: jobInfo.company,
                        title: jobInfo.title,
                        salary: jobInfo.salary,
                        score: decision.score,
                        resumeIndex: decision.resumeIndex,
                    });
                    // “只筛选”和“审核后发送”模式只记录推荐结果，不自动触发平台沟通。
                    if (decision.score >= OPTIONS.thread && decision.autoSend === false) {
                        rememberCheckedJob(href);
                        const screenOnly = decision.decisionMode === 'screen_only';
                        logger.add(screenOnly
                            ? `职位 [${jobInfo.title}] 达到推荐线，已记录结果，不自动发送`
                            : `职位 [${jobInfo.title}] 达到推荐线，已进入人工审核，不自动发送`);
                        await logAction({
                            action: screenOnly ? 'job_screened_only' : 'job_requires_review',
                            scene: 'search',
                            decisionId: decision.decisionId,
                            company: jobInfo.company,
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                            score: decision.score,
                            threshold: OPTIONS.thread,
                            decisionMode: decision.decisionMode,
                            agentUsed: decision.agentUsed,
                            agentDecision: decision.agentDecision,
                            reason: decision.reason,
                        });
                        return loop();
                    }
                    // 如果分数达到阈值，打个招呼
                    if (decision.score >= OPTIONS.thread) {
                        logger.add(`正在给职位 [${jobInfo.title}] 发送打招呼消息`);
                        await logAction({
                            action: 'greet_queued',
                            scene: 'search',
                            decisionId: decision.decisionId,
                            company: jobInfo.company,
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                            resumeIndex: decision.resumeIndex,
                            score: decision.score,
                        });
                        const sendThroughBossApi = async () => {
                            // 获得跨标签页锁后重新读取历史，避免两个搜索页同时发送。
                            jobHistory = null;
                            if (wasRecentlyChecked(href)) {
                                await logAction({
                                    action: 'greet_duplicate_blocked',
                                    scene: 'search',
                                    decisionId: decision.decisionId,
                                    company: jobInfo.company,
                                    title: jobInfo.title,
                                    score: decision.score,
                                });
                                return 'duplicate';
                            }
                            try {
                                await addToChatList(jobInfo.addUrl);
                                rememberCheckedJob(href);
                                logger.add(`职位 [${jobInfo.title}] Boss沟通接口成功，平台招呼语已触发`);
                                await logAction({
                                    action: 'greet_api_succeeded',
                                    scene: 'search',
                                    decisionId: decision.decisionId,
                                    company: jobInfo.company,
                                    title: jobInfo.title,
                                    salary: jobInfo.salary,
                                    score: decision.score,
                                    resumeIndex: decision.resumeIndex,
                                });
                                if (OPTIONS.openChatViewAfterGreet) {
                                    const chatViewWindow = window.open(jobInfo.chatUrl, this.targets.chatView);
                                    if (chatViewWindow) {
                                        logger.add(`已在只读窗口打开职位 [${jobInfo.title}] 的聊天页`);
                                        await logAction({
                                            action: 'chat_view_opened',
                                            scene: 'search',
                                            title: jobInfo.title,
                                            chatUrl: jobInfo.chatUrl,
                                        });
                                    } else {
                                        logger.add('聊天查看窗口被Chrome拦截；招呼接口已成功，不影响发送结果');
                                        await logAction({
                                            action: 'chat_view_blocked',
                                            scene: 'search',
                                            title: jobInfo.title,
                                            chatUrl: jobInfo.chatUrl,
                                        });
                                    }
                                }
                                return 'success';
                            } catch (err) {
                                logger.add(`职位 [${jobInfo.title}] Boss沟通接口失败，未写入岗位历史`);
                                await logAction({
                                    action: 'greet_api_failed',
                                    scene: 'search',
                                    decisionId: decision.decisionId,
                                    company: jobInfo.company,
                                    title: jobInfo.title,
                                    salary: jobInfo.salary,
                                    score: decision.score,
                                    resumeIndex: decision.resumeIndex,
                                    addUrl: jobInfo.addUrl,
                                    reason: String(err),
                                });
                                return 'failed';
                            }
                        };

                        const lockName = `goodJobs:greet:${getJobHistoryKey(href)}`;
                        let greetResult;
                        if (navigator.locks && typeof navigator.locks.request === 'function') {
                            greetResult = await navigator.locks.request(
                                lockName,
                                { ifAvailable: true },
                                lock => lock ? sendThroughBossApi() : 'locked'
                            );
                        } else {
                            greetResult = await sendThroughBossApi();
                        }
                        if (greetResult === 'locked') {
                            logger.add(`职位 [${jobInfo.title}] 正由另一个Boss页面处理，已跳过重复发送`);
                            await logAction({
                                action: 'greet_duplicate_blocked',
                                scene: 'search',
                                decisionId: decision.decisionId,
                                company: jobInfo.company,
                                title: jobInfo.title,
                                score: decision.score,
                            });
                        }
                        return loop();
                    }
                    // 否则下一轮
                    else {
                        rememberCheckedJob(href);
                        await logAction({
                            action: 'job_below_threshold',
                            scene: 'search',
                            decisionId: decision.decisionId,
                            company: jobInfo.company,
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                            score: decision.score,
                            threshold: OPTIONS.thread,
                            resumeIndex: decision.resumeIndex,
                        });
                        loop();
                    }
                } catch (e) {
                    console.log(e);
                    logger.add(`循环时出错: ${e}`);
                    loop();
                }
            };

            const preloadJobs = async () => {
                logger.add('开始慢速预加载岗位列表');
                const preloadedHrefs = new Set();
                let stableRounds = 0;

                const collectLoadedHrefs = (jobUl) => {
                    if (!jobUl) return;
                    jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).forEach((a) => {
                        rememberCompanyFromCard(a);
                        if (a.href && !wasProcessedInCurrentRun(a.href) && !wasRecentlyChecked(a.href)) {
                            preloadedHrefs.add(a.href);
                        }
                    });
                };

                for (let round = 1; round <= OPTIONS.preloadMaxRounds; round++) {
                    if (this.pause) {
                        logger.add('预加载已暂停');
                        break;
                    }
                    const jobUl = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.JOBLIST).catch(() => null);
                    const currentCount = jobUl ? jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : 0;
                    const beforeUniqueCount = preloadedHrefs.size;
                    collectLoadedHrefs(jobUl);
                    window.scrollBy({ top: OPTIONS.preloadScrollPixels, left: 0, behavior: 'smooth' });
                    await tools.asyncSleep(OPTIONS.preloadScrollWaitMs);
                    await activatePreloadCard(round);
                    const afterJobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    const afterCount = afterJobUl ? afterJobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : currentCount;
                    collectLoadedHrefs(afterJobUl);
                    const addedCount = preloadedHrefs.size - beforeUniqueCount;
                    logger.add(`预加载第 ${round} 轮：页面岗位 ${currentCount} -> ${afterCount}，累计唯一岗位 ${preloadedHrefs.size}`);
                    if (addedCount > 0) {
                        stableRounds = 0;
                    } else {
                        stableRounds += 1;
                    }
                    if (stableRounds >= OPTIONS.preloadStableRoundsLimit) {
                        logger.add(`预加载结束：连续 ${stableRounds} 轮没有发现新的唯一岗位`);
                        break;
                    }
                }
                const newHrefs = Array.from(preloadedHrefs)
                    .filter(href => !wasProcessedInCurrentRun(href) && !wasRecentlyChecked(href));
                const remainingRunSlots = OPTIONS.maxJobsPerRun > 0
                    ? Math.max(0, OPTIONS.maxJobsPerRun - count)
                    : newHrefs.length;
                const roundLimit = OPTIONS.maxJobsPerRound > 0
                    ? OPTIONS.maxJobsPerRound
                    : newHrefs.length;
                const queuedHrefs = newHrefs.slice(0, Math.min(roundLimit, remainingRunSlots));
                jobHrefs.push(...queuedHrefs);
                roundQueuedCount += queuedHrefs.length;
                logger.add(`预加载完成，发现 ${newHrefs.length} 个唯一岗位，本轮选取 ${queuedHrefs.length} 个进行评分`);
            };

            const pickNextKeyword = () => {
                if (!this.tags || !this.tags.length) {
                    throw new Error('未获取到岗位关键词列表');
                }
                currentTagIdx = (currentTagIdx + 1) % this.tags.length;
                currentKeyword = this.tags[currentTagIdx];
                return currentKeyword;
            };

            const startRound = async () => {
                resetRoundState();
                currentRound += 1;
                const keyword = pickNextKeyword();
                logger.divider();
                logger.add(`开始第 ${currentRound} 轮`);
                logger.add(`本轮搜索关键词：${keyword}`);
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                await tools.asyncSleep(600);
                await search(keyword);
                logger.add(`第 ${currentRound} 轮已完成搜索（关键词：${keyword}），请在 ${(OPTIONS.manualFilterWaitMs / 1000).toFixed(0)} 秒内手动选择地区、薪资等筛选条件`);
                await tools.asyncSleep(OPTIONS.manualFilterWaitMs);
                await preloadJobs();
                logger.add(`第 ${currentRound} 轮开始按当前筛选条件扫描岗位（关键词：${keyword}）`);
                loop();
            };

            // 主函数
            const main = async () => {
                started = true;
                logger.add('--程序启动--');
                // 开始广播
                startBroadcast();
                // 获取统一配置
                const clientConfig = await api.getClientConfig().catch((e) => {
                    logger.add('获取统一配置失败，将回退旧接口');
                    return null;
                });
                if (clientConfig && clientConfig.frontend) {
                    Object.assign(OPTIONS, clientConfig.frontend);
                    logger.add('获取前端配置成功');
                }
                const historyWasReset = applyJobHistoryResetToken();
                const historyCount = Object.keys(loadJobHistory()).length;
                if (historyWasReset) {
                    logger.add('已按配置自动清空一次岗位历史');
                }
                if ((Number(OPTIONS.jobHistoryExpireDays) || 0) > 0) {
                    logger.add(`已启用 ${OPTIONS.jobHistoryExpireDays} 天岗位去重，当前记录 ${historyCount} 个岗位`);
                }
                if (Array.isArray(OPTIONS.companyBlockKeywords) && OPTIONS.companyBlockKeywords.length) {
                    logger.add(`已启用公司屏蔽名单，共 ${OPTIONS.companyBlockKeywords.length} 个名称或简称`);
                }
                if (clientConfig && Array.isArray(clientConfig.tags) && clientConfig.tags.length) {
                    this.tags = clientConfig.tags;
                    logger.add('获取标签成功: ' + this.tags.join('、'));
                } else {
                    this.tags = await api.getTags();
                    logger.add('获取标签成功(旧接口): ' + this.tags.join('、'));
                }
                if (typeof tagIdx === 'number' && this.tags.length) {
                    currentTagIdx = ((tagIdx % this.tags.length) + this.tags.length) % this.tags.length - 1;
                }
                if (clientConfig && typeof clientConfig.introduce === 'string' && clientConfig.introduce) {
                    this.introduce = clientConfig.introduce;
                    logger.add('获取自我介绍成功');
                } else {
                    this.introduce = await api.getIntroduce();
                    logger.add('获取自我介绍成功(旧接口)');
                }
                await startRound();
            };

            // 初始化
            const init = () => {
                // 如果时间戳小于阈值，直接运行
                if (start - tools.getTimestamp(this.targets.search) < OPTIONS.timestampTimeout) {
                    logger.runBtn.click();
                }
            };

            init();
        }

        // 详情页
        __detail() {
            // 注册广播
            const startBroadcast = () => {
                this.__broadcast(this.targets.detail);
            };
            startBroadcast();

            const getCompanyFromStructuredData = () => {
                const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (const script of scripts) {
                    try {
                        const parsed = JSON.parse(script.textContent);
                        const items = Array.isArray(parsed)
                            ? parsed
                            : (Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]);
                        for (const item of items) {
                            const name = cleanCompanyName(item?.hiringOrganization?.name);
                            if (isUsableCompanyName(name)) return name;
                        }
                    } catch (e) {
                        // 页面可能包含非标准 JSON-LD，继续使用 DOM 兜底。
                    }
                }
                return '';
            };

            const getCompanyName = () => {
                const companyEls = document.querySelectorAll(SELECTORS.ZHIPIN.DETAIL.COMPANY);
                for (const companyEl of companyEls) {
                    const directName = cleanCompanyName(companyEl?.innerText || companyEl?.textContent);
                    if (isUsableCompanyName(directName)) return directName;
                }

                const structuredName = getCompanyFromStructuredData();
                if (isUsableCompanyName(structuredName)) return structuredName;

                return '';
            };

            // 获取职位信息
            const getJobInfo = () => {
                const chatBtn = document.querySelector(SELECTORS.ZHIPIN.DETAIL.STARTCHAT);
                const nameBox = document.querySelector(SELECTORS.ZHIPIN.DETAIL.NAMEBOX);
                const title = nameBox.querySelector(SELECTORS.ZHIPIN.DETAIL.JOBNAME).innerText;
                const salary = nameBox.querySelector(SELECTORS.ZHIPIN.DETAIL.SALARY).innerText;
                const detail = document.querySelector(SELECTORS.ZHIPIN.DETAIL.DETAIL).innerText;
                const recruiter = document.querySelector('.job-boss-info');
                const recruiterCompany = extractRecruiterCompany(recruiter);
                const recruiterText = recruiter?.innerText || '';
                const agencyRole = recruiterText.match(/猎头顾问|猎头经理|猎头招聘|猎头服务|代理招聘|代招/);
                const company = agencyRole ? '' : (getCompanyName() || recruiterCompany);
                const actionText = chatBtn ? chatBtn.innerText.trim() : '';
                const chatUrl = chatBtn && chatBtn.getAttribute(SELECTORS.ZHIPIN.DETAIL.CHATURL);
                const addUrl = chatBtn && chatBtn.dataset.url;
                let skip = false;
                let skipReason = '';

                if (agencyRole) {
                    skip = true;
                    skipReason = `招聘者信息标注为${agencyRole[0]}`;
                } else if (!chatBtn) {
                    skip = true;
                    skipReason = '未找到立即沟通按钮';
                } else if (actionText.indexOf('立即沟通') === -1) {
                    skip = true;
                    skipReason = `按钮为 [${actionText || '未知'}]，疑似网申岗位`;
                } else if (!chatUrl || !addUrl) {
                    skip = true;
                    skipReason = '缺少聊天链接，疑似异常岗位';
                }

                return {
                    title,
                    company,
                    recruiterCompany,
                    agencyRole: agencyRole?.[0] || '',
                    salary,
                    detail,
                    actionText,
                    chatUrl,
                    addUrl,
                    skip,
                    skipReason,
                    talked: chatBtn && chatBtn.dataset.isfriend === 'true',
                };
            };
            const jobInfo = getJobInfo();

            // 来自搜索页
            const fromSearchPage = () => {
                // 把职位信息发送给搜索页
                this.broadcast.send(this.targets.search, this.bcTypes.GET_JOB_INFO, jobInfo);
            };

            // 来自聊天页
            const fromChatPage = () => {
                // 把职位信息发送给聊天页
                this.broadcast.send(
                    this.targets.chat,
                    this.bcTypes.GET_JOB_INFO,
                    jobInfo
                ).then(() => {
                    window.close();
                });
            };

            // 主函数
            const main = () => {
                // 判断来源
                const now = new Date().getTime();
                // Boss 详情页偶尔需要数秒才能完成加载。来源识别不能只使用
                // 搜索页自动启动所需的 3 秒窗口，否则慢页面不会回传岗位详情。
                const detailSourceTimeout = Math.max(OPTIONS.timestampTimeout, OPTIONS.detailTimeout, 20000);
                const isFromSearch = now - tools.getTimestamp(this.targets.detail) < detailSourceTimeout && window.name === this.targets.detail;
                const isFromChat = now - tools.getTimestamp(this.targets.chat) < detailSourceTimeout;

                if (isFromSearch) {
                    fromSearchPage();
                } else if (isFromChat) {
                    fromChatPage();
                }
            };
            main();
        }

        // 聊天页
        async __chat() {
            // 注册广播
            const startBroadcast = (target = this.targets.chat) => {
                this.__broadcast(target);
            };

            // 发送消息
            const sendMsg = (text) => {
                return new Promise(async (resolve, reject) => {
                    try {
                        const ipt = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.CHATINPUT);
                        ipt.innerText = text;
                        await tools.asyncSleep(600);
                        const btn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.MSGSEND);
                        btn.click();
                        resolve();
                    } catch (e) {
                        reject();
                    }
                })
            };

            // 打招呼
            const sayHi = async () => {
                startBroadcast(this.targets.chatGreet);

                // 心跳 
                let count = 0;
                const loop = () => {
                    this.broadcast.sendAndReceive(
                        this.targets.search,
                        this.bcTypes.HEART_BEAT,
                        { count: ++count }
                    ).then((res) => {
                        if (res.success) {
                            setTimeout(loop, 1000);
                        } else {
                            throw new Error('心跳失联');
                        }
                    });
                };
                loop();

                try {
                    const greetDecision = await this.broadcast.sendAndReceive(this.targets.search, this.bcTypes.SAY_HI);
                    const introduce = greetDecision.introduce;
                    await sendMsg(introduce);
                    await logAction({
                        action: 'greet_message_sent',
                        scene: 'chat_greet',
                        resumeIndex: greetDecision.resumeIndex ?? OPTIONS.resumeIndex,
                    });
                    this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, { success: true }).then(() => {
                        this.broadcast.destroy();
                    });
                } catch (e) {
                    await logAction({
                        action: 'greet_message_failed',
                        scene: 'chat_greet',
                        reason: String(e),
                    });
                    this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, { success: false }).then(() => {
                        this.broadcast.destroy();
                    });
                }
            };

            // 获取聊天记录信息
            const getChatInfo = async () => {
                const ctn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.HISTORYCTN);

                const getMsgs = async () => {
                    const lis = Array.from(ctn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.USEFULMSG));
                    // 提取历史记录
                    const msgs = [];
                    lis.forEach(li => {
                        const role = li.classList.contains('item-friend') ? 'user' : 'assistant';
                        const msgBox = li.querySelector(SELECTORS.ZHIPIN.CHAT.MSGCONTENT);
                        if (!msgBox) return;
                        msgs.push({
                            role,
                            content: msgBox.innerText,
                        });
                    });
                    // 提取简历，作品集状态
                    let needResume = 0;
                    let needWorks = 0;
                    let resumeSended = false;
                    let worksSended = false;
                    let confirmAddr = false;
                    // 判断聊天字眼中是否有相关信息
                    msgs.reverse();
                    let recent = '';
                    for (const msg of msgs) {
                        if (msg.role !== 'user') {
                            break;
                        }
                        recent += msg.content;
                    }
                    msgs.reverse();
                    if (recent.indexOf('简历') !== -1) {
                        needResume = 1;
                    }
                    if (recent.indexOf('作品') !== -1) {
                        needWorks = 1;
                    }
                    // 判断是否有过明确弹窗
                    const rlis = lis.reverse();
                    for (const li of rlis) {
                        if (li.classList.contains('item-myself')) {
                            break;
                        }
                        const bossGreen = li.querySelector('.boss-green');
                        const dialog = li.querySelector('.item-dialog');
                        if (bossGreen) {
                            const t = bossGreen.innerText;
                            if (t.indexOf('我想要一份您的附件简历，您是否同意\n拒绝\n同意') !== -1) {
                                needResume = 2;
                            }
                        } else if (dialog) {
                            const t = dialog.querySelector('.msg-dialog-title').innerText;
                            if (t.indexOf('您是否接受此工作地点?') !== -1) {
                                confirmAddr = true;
                            }
                        }
                    }
                    // 判断是否发过简历
                    const bossGreen = ctn.querySelectorAll('.boss-green');
                    if (bossGreen.length) {
                        bossGreen.forEach(el => {
                            const t = el.innerText;
                            if (t.indexOf('点击预览附件简历') !== -1) {
                                resumeSended = true;
                            }
                        });
                    }
                    return {
                        msgs,
                        needResume,
                        needWorks,
                        resumeSended,
                        worksSended,
                        confirmAddr,
                        talked: !msgs.every(d => d.role === 'user'),
                        jobEl: (await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.JOBEL)).querySelector(SELECTORS.ZHIPIN.CHAT.JOBCITY)
                    };
                };

                const scroll2Top = async () => {
                    if (ctn.scrollTop === 0) return;
                    ctn.scrollTop = 0;
                    await tools.asyncSleep(300);
                    await scroll2Top();
                };

                // 滚动到顶部
                await tools.asyncSleep(300);
                await scroll2Top();
                // 获取聊天记录
                return await getMsgs();
            };

            // 发送简历
            const sendResume = async (resumeIndex = OPTIONS.resumeIndex) => {
                const sendBtn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMESEND);
                sendBtn.click();

                // 可能是弹一个小窗
                const smallDialog = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMEMODAL).catch(() => null);
                if (smallDialog) {
                    smallDialog.querySelector(SELECTORS.ZHIPIN.CHAT.RESUMEMODALCONFIRM).click();
                    await sendMsg('已发送，请查收');
                    return {
                        mode: 'small_dialog',
                        selectedResumeIndex: resumeIndex,
                    };
                }

                // 弹出大窗让选择
                const resumeCtn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMELIST);
                const confirm = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMESENDCONFIRM);
                const resumes = resumeCtn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.RESUMELISTITEM);
                const fallbackIndex = resumes[resumeIndex] ? resumeIndex : (resumes[OPTIONS.resumeIndex] ? OPTIONS.resumeIndex : 0);
                const resume = resumes[fallbackIndex];
                await tools.asyncSleep(300);
                resume.click();
                await tools.asyncSleep(300);
                confirm.click();
                await sendMsg('已发送，请查收');
                return {
                    mode: 'resume_list',
                    selectedResumeIndex: fallbackIndex,
                };
            };

            // 发送作品集
            const sendWorks = async () => {
                logger.add('sendWks');
            };

            let logger = null;
            // 给搜索页同步状态
            const status = (text) => {
                logger && logger.add(text);
                this.broadcast && this.broadcast.send(
                    this.targets.search,
                    this.bcTypes.STATUS,
                    text
                );
            };
            // 分割线
            const divider = () => {
                logger && logger.divider();
                this.broadcast && this.broadcast.send(this.targets.search, this.bcTypes.DIVIDER);
            };

            // 聊天
            const chat = async () => {
                // api
                const api = new Api();
                const logAction = async (payload) => {
                    try {
                        await api.logAction(payload);
                    } catch (e) {
                        console.log('logAction failed', e);
                    }
                };
                // 开始广播
                startBroadcast(this.targets.chat);
                // 获取默认自我介绍（兜底）
                const defaultIntroduce = (await this.broadcast.sendAndReceive(
                    this.targets.search,
                    this.bcTypes.INTRODUCE,
                )).introduce;
                // 心跳
                let count = 0;
                const loop = async () => {
                    await this.broadcast.sendAndReceive(
                        this.targets.search,
                        this.bcTypes.HEART_BEAT,
                        { count: ++count }
                    ).then((res) => {
                        if (res.success) {
                            setTimeout(loop, 1000);
                        } else {
                            throw new Error('心跳失联');
                        }
                    });
                };
                loop();

                // 一轮
                let round = 0;
                let lastTop = 0;
                const once = async () => {
                    // 获取联系人列表
                    let empty = false;
                    const ctn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.CONTACTLIST).catch(e => {
                        if (document.querySelector(SELECTORS.ZHIPIN.CHAT.CONTACTLISTEMPTY)) {
                            status('当前暂无消息');
                            empty = true;
                        }
                    });
                    if (empty) return;
                    const lis = ctn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.CONTACTLISTITEM);
                    // 遍历新消息
                    for (const ls of lis) {
                        try {
                            // 无新消息
                            if (!ls.querySelector(SELECTORS.ZHIPIN.CHAT.NEWMSGNOTICE)) continue;
                            // 获取联系人信息
                            const name = ls.querySelector(SELECTORS.ZHIPIN.CHAT.USERNAME);
                            const company = name.nextElementSibling.innerText;
                            divider();
                            status(`[${company} - ${name.innerText}] 发来一条新消息`);
                            // 进入聊天界面
                            name.click();
                            // 获取聊天记录信息
                            const chatInfo = await getChatInfo();
                            // 如果最新的是我的回复
                            const lastMsg = chatInfo.msgs.slice(-1)[0];
                            if (lastMsg && lastMsg.role === 'assistant') continue;
                            // 如果以前没聊过
                            if (!chatInfo.talked) {
                                const pendingJobInfo = this.broadcast.receive(
                                    this.targets.detail,
                                    this.bcTypes.GET_JOB_INFO,
                                    OPTIONS.detailTimeout
                                );
                                localStorage.setItem(this.targets.chat, new Date().getTime());
                                chatInfo.jobEl.click();
                                status(`正在获取职位详情`);
                                const jobInfo = await pendingJobInfo;
                                // 获取职位匹配度
                                status(`开始计算职位 [${jobInfo.title}] 的匹配度`);
                                const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail, jobInfo.company);
                                status(`匹配度: ${decision.score} | 简历索引: ${decision.resumeIndex}`);
                                await logAction({
                                    action: 'job_decision_consumed',
                                    scene: 'chat',
                                    title: jobInfo.title,
                                    salary: jobInfo.salary,
                                    score: decision.score,
                                    resumeIndex: decision.resumeIndex,
                                });
                                // 如果分数达到阈值并且未聊过天，打个招呼
                                if (decision.score >= OPTIONS.thread && !chatInfo.msgs.length) {
                                    status(`正在给职位 [${jobInfo.title}] 发送打招呼消息`);
                                    try {
                                        await sendMsg(decision.introduce || defaultIntroduce);
                                        await logAction({
                                            action: 'chat_greet_sent',
                                            scene: 'chat',
                                            title: jobInfo.title,
                                            resumeIndex: decision.resumeIndex,
                                        });
                                        status(`打招呼成功`);
                                    } catch (e) {
                                        await logAction({
                                            action: 'chat_greet_failed',
                                            scene: 'chat',
                                            title: jobInfo.title,
                                            resumeIndex: decision.resumeIndex,
                                            reason: String(e),
                                        });
                                        status(`打招呼失败: ${e}`);
                                    }
                                    continue;
                                }
                                // 未达到阈值，直接下一个
                                else if (decision.score < OPTIONS.thread) {
                                    await logAction({
                                        action: 'chat_rejected_below_threshold',
                                        scene: 'chat',
                                        title: jobInfo.title,
                                        score: decision.score,
                                        threshold: OPTIONS.thread,
                                        resumeIndex: decision.resumeIndex,
                                    });
                                    await sendMsg('不好意思，不太合适哈，祝早日找到合适的人选。')
                                    continue;
                                }
                            }
                            let isChat = true;
                            // 只要对方发来新消息且还没发过简历，就直接发送简历，不再调用大模型聊天
                            if (!chatInfo.resumeSended) {
                                isChat = false;
                                const pendingJobInfo = this.broadcast.receive(
                                    this.targets.detail,
                                    this.bcTypes.GET_JOB_INFO,
                                    OPTIONS.detailTimeout
                                );
                                localStorage.setItem(this.targets.chat, new Date().getTime());
                                chatInfo.jobEl.click();
                                status(`正在获取职位详情（用于确定简历）`);
                                const jobInfo = await pendingJobInfo;
                                const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail, jobInfo.company);
                                status(`检测到新消息，直接发送简历（简历索引 ${decision.resumeIndex}）`);
                                const resumeResult = await sendResume(decision.resumeIndex);
                                await logAction({
                                    action: 'resume_sent',
                                    scene: 'chat',
                                    title: jobInfo.title,
                                    salary: jobInfo.salary,
                                    requestedResumeIndex: decision.resumeIndex,
                                    selectedResumeIndex: resumeResult?.selectedResumeIndex ?? decision.resumeIndex,
                                    sendMode: resumeResult?.mode || 'unknown',
                                });
                                status('发送成功');
                            }
                            // 是否需要作品集（当前关闭自动发送，仅保留原入口）
                            if (chatInfo.needWorks && !chatInfo.worksSended) {
                                isChat = false;
                                status('检测到作品集相关消息，当前未开启自动发送作品集');
                            }
                            // 聊天
                            if (isChat) {
                                status('已发过简历，跳过自动聊天');
                            }
                        } catch (e) {
                            status('回复某条消息出错');
                        }
                    }
                    // 向下滚动
                    ctn.scrollTop = 1014 * ++round;
                    await tools.asyncSleep(300);
                    if (ctn.scrollTop !== lastTop) {
                        lastTop = ctn.scrollTop;
                        await once();
                    }
                };
                // 完成一轮
                await once();
            };

            // 主函数
            const main = async () => {
                // 判断来源
                const now = new Date().getTime();
                // 聊天页在网络繁忙时常常超过 3 秒才完成加载，来源识别窗口
                // 必须覆盖完整的打招呼等待时间，否则页面打开后不会执行 sayHi。
                const greetSourceTimeout = Math.max(OPTIONS.timestampTimeout, OPTIONS.greetTimeout, 30000);
                const isGreet = now - tools.getTimestamp(this.targets.chatGreet) < greetSourceTimeout && window.name === this.targets.chatGreet;
                const isChat = now - tools.getTimestamp(this.targets.chat) < OPTIONS.timestampTimeout && window.name === this.targets.chat;

                if (isGreet) {
                    sayHi();
                }
                else if (isChat) {
                    // 日志
                    logger = new Logger();
                    logger.runBtn.remove();
                    logger.clearBtn.remove();
                    // 等待加载
                    await tools.asyncSleep(3000);
                    chat()
                        .then(async () => {
                            status('消息处理完毕');
                            await this.broadcast.send(this.targets.search, this.bcTypes.RUN, true);
                        })
                        .catch(async () => {
                            status('聊天程序运行出错');
                            await this.broadcast.send(this.targets.search, this.bcTypes.RUN, false);
                        }).finally(() => {
                            this.broadcast.destroy();
                        });
                }
            };
            main();
        }

        // 运行
        run(tagIdx = 0) {
            const path = location.pathname;
            // 在搜索页
            if (path.startsWith(SEARCHPATH.zhipin)) {
                this.__search(tagIdx);
            }
            // 在详情页
            else if (path.startsWith(this.whiteList.deatil)) {
                this.__detail();
            }
            // 在聊天页
            else if (path.startsWith(this.whiteList.chat)) {
                this.__chat();
            }
            // 否则跳转搜索页
            else {
                new Logger(() => {
                    tools.openTabNSetTimestamp(SEARCHPATH.zhipin, this.targets.search, true);
                });
            }
        }
    }

    const goodjobs = new Zhipin().run();
})();
