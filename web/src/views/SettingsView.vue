<template>
  <div class="settings-view" ref="rootEl">
    <div class="header">
      <h2>设置 SETTINGS</h2>
    </div>

    <!-- 面板配置加载失败提示（PANEL-ERROR-VISIBLE-001）：不阻塞整体设置页 -->
    <div v-if="panelLoadError" class="panel-error-banner" role="alert">
      <span>{{ panelLoadError }}</span>
      <button class="btn" @click="loadPanelConfigs">重试面板</button>
    </div>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="loadError" class="empty">
      <p>加载失败: {{ loadError }}</p>
      <button class="btn" @click="loadSettings">重试</button>
    </div>
    <template v-else>
      <AnimatedTabs
        v-if="!loading && !loadError"
        :tabs="sectionTabs"
        v-model="activeSection"
        class="settings-tabs"
      />
      <!-- Compaction -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'compaction'">
          <h3>上下文管理</h3>
          <p class="section-desc">控制 AI 如何管理对话历史和上下文窗口。</p>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">启用上下文压缩</div>
              <div class="setting-desc">当对话过长时自动压缩历史消息。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['compaction.enabled'] }" @click="toggle('compaction.enabled')">
              {{ settings['compaction.enabled'] ? '开启' : '关闭' }}
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">压缩策略</div>
              <div class="setting-desc">选择上下文压缩的方式。</div>
            </div>
            <select class="select" aria-label="压缩策略" :value="settings['compaction.strategy']" @change="set('compaction.strategy', ($event.target as HTMLSelectElement).value)">
              <option value="context-full">上下文满时压缩</option>
              <option value="handoff">交接模式</option>
              <option value="shake">精简模式</option>
              <option value="snapcompact">快速压缩</option>
              <option value="off">关闭</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">压缩阈值</div>
              <div class="setting-desc">上下文使用率达到此百分比时触发压缩。</div>
            </div>
            <div class="setting-control">
              <BalanceSlider
                :min="50" :max="95" :step="5"
                :model-value="(settings['compaction.thresholdPercent'] ?? 80) as number"
                @update:model-value="set('compaction.thresholdPercent', $event)"
                show-value
                class="setting-balance-slider"
              />
            </div>
          </div>

          <!-- GAP-B2-001：上下文提升——溢出时升级到大上下文模型而非压缩。
               需要配置了更大上下文窗口的模型才实际生效（OMP 自动挑选）。 -->
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">上下文提升</div>
              <div class="setting-desc">上下文溢出时优先切换到更大窗口的模型，而不是压缩历史（需存在更大窗口的模型才生效）。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['contextPromotion.enabled'] }" @click="toggle('contextPromotion.enabled')">
              {{ settings['contextPromotion.enabled'] ? '开启' : '关闭' }}
            </button>
          </div>
        </div>
      </GlowingEffect>

      <!-- Retry -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'retry'">
          <h3>容错</h3>
          <p class="section-desc">控制 AI 调用失败时的重试行为。</p>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">自动重试</div>
              <div class="setting-desc">调用失败时自动重试。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['retry.enabled'] }" @click="toggle('retry.enabled')">
              {{ settings['retry.enabled'] ? '开启' : '关闭' }}
            </button>
          </div>

          <div class="setting-row" v-if="settings['retry.enabled']">
            <div class="setting-info">
              <div class="setting-label">最大重试次数</div>
            </div>
            <input type="number" class="input-number" min="1" max="10"
              :value="settings['retry.maxRetries'] ?? 3"
              @change="set('retry.maxRetries', Number(($event.target as HTMLInputElement).value))" />
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">模型降级</div>
              <div class="setting-desc">主模型失败时切换到备用模型。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['retry.modelFallback'] }" @click="toggle('retry.modelFallback')">
              {{ settings['retry.modelFallback'] ? '开启' : '关闭' }}
            </button>
          </div>

          <!-- GAP-B6-001：备用模型链（retry.fallbackChains）——
               JSON 编辑 + 本地校验，保存到 OMP 全局设置（sidecar set_settings 持久化）。 -->
          <div class="setting-row" v-if="settings['retry.modelFallback']">
            <div class="setting-info">
              <div class="setting-label">备用模型链</div>
              <div class="setting-desc">
                主模型失败时按序尝试的备用模型（JSON 对象）。键可为模型角色、
                "provider/model-id" 或通配 "provider/*"；值为有序模型列表。
                示例：<code>{"default": ["openai/gpt-4o-mini"]}</code>
              </div>
            </div>
            <div class="setting-control setting-control--wide">
              <textarea
                class="input-textarea"
                rows="5"
                :value="fallbackChainsText"
                aria-label="备用模型链 JSON"
                placeholder='{"default": ["provider/model"]}'
                @change="saveFallbackChains(($event.target as HTMLTextAreaElement).value)"
              ></textarea>
              <p v-if="fallbackChainsError" class="setting-error" role="alert">{{ fallbackChainsError }}</p>
            </div>
          </div>
        </div>
      </GlowingEffect>

      <!-- Tools -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'tools'">
          <h3>工具</h3>
          <p class="section-desc">控制 AI 使用工具时的行为。</p>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">工具审批模式</div>
              <div class="setting-desc">AI 执行工具前是否需要你确认。</div>
            </div>
            <select class="select" aria-label="工具审批模式" :value="settings['tools.approvalMode']" @change="set('tools.approvalMode', ($event.target as HTMLSelectElement).value)">
              <option value="yolo">自动批准（Yolo）</option>
              <option value="write">写操作需确认</option>
              <option value="always-ask">始终询问</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">MCP 工具发现</div>
              <div class="setting-desc">自动发现并加载 MCP 服务器提供的工具。</div>
            </div>
            <select class="select" aria-label="MCP 工具发现" :value="settings['tools.discoveryMode']" @change="set('tools.discoveryMode', ($event.target as HTMLSelectElement).value)">
              <option value="all">全部加载</option>
              <option value="auto">自动发现</option>
              <option value="off">关闭</option>
            </select>
          </div>

          <!-- GAP-B4-001：Bash 长任务自动后台化（OMP 工具级行为） -->
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Bash 长任务后台化</div>
              <div class="setting-desc">超过阈值的 bash 命令自动转入后台执行，不阻塞对话（完成后交付结果）。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['bash.autoBackground.enabled'] }" @click="toggle('bash.autoBackground.enabled')">
              {{ settings['bash.autoBackground.enabled'] ? '开启' : '关闭' }}
            </button>
          </div>
          <div class="setting-row" v-if="settings['bash.autoBackground.enabled']">
            <div class="setting-info">
              <div class="setting-label">后台化阈值（秒）</div>
              <div class="setting-desc">预计执行超过该时长的命令自动转后台。</div>
            </div>
            <input type="number" class="input-number" min="5" max="300" step="5"
              :value="settings['bash.autoBackground.thresholdMs'] ? Math.round(Number(settings['bash.autoBackground.thresholdMs']) / 1000) : 30"
              @change="set('bash.autoBackground.thresholdMs', Number(($event.target as HTMLInputElement).value) * 1000)" />
          </div>

          <!-- GAP-B5-001：异步任务（job 工具可用性） -->
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">异步任务</div>
              <div class="setting-desc">启用后台作业（job 工具）：Agent 可将长任务作为独立后台作业运行。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['async.enabled'] }" @click="toggle('async.enabled')">
              {{ settings['async.enabled'] ? '开启' : '关闭' }}
            </button>
          </div>
          <div class="setting-row" v-if="settings['async.enabled']">
            <div class="setting-info">
              <div class="setting-label">最大并行作业数</div>
            </div>
            <input type="number" class="input-number" min="1" max="10"
              :value="settings['async.maxJobs'] ?? 3"
              @change="set('async.maxJobs', Number(($event.target as HTMLInputElement).value))" />
          </div>

          <!-- GAP-B7-001：Obsidian 保管库（vault:// URL 支持，非密钥库——
               Maxma 的密钥由凭据信封机制管理） -->
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Obsidian 保管库</div>
              <div class="setting-desc">允许 read 工具通过 vault:// URL 读取/编辑 Obsidian 保管库内容（需本机 Obsidian CLI）。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['vault.enabled'] }" @click="toggle('vault.enabled')">
              {{ settings['vault.enabled'] ? '开启' : '关闭' }}
            </button>
          </div>
        </div>
      </GlowingEffect>

      <!-- Advisor -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'advisor'">
          <h3>顾问</h3>
          <p class="section-desc">启用第二个 AI 模型作为顾问，被动审查每次对话。</p>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">启用顾问</div>
              <div class="setting-desc">配对一个顾问模型来审查 AI 的回复。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['advisor.enabled'] }" @click="toggle('advisor.enabled')">
              {{ settings['advisor.enabled'] ? '开启' : '关闭' }}
            </button>
          </div>
        </div>
      </GlowingEffect>

      <!-- Interaction -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'interaction'">
          <h3>交互</h3>
          <p class="section-desc">控制消息队列和中断行为。</p>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">转向模式</div>
              <div class="setting-desc">连续发送多条消息时的处理方式。</div>
            </div>
            <select class="select" aria-label="引导模式" :value="settings['steeringMode']" @change="set('steeringMode', ($event.target as HTMLSelectElement).value)">
              <option value="all">全部接受</option>
              <option value="one-at-a-time">逐条处理</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">中断模式</div>
              <div class="setting-desc">AI 正在回复时发送新消息的行为。</div>
            </div>
            <select class="select" aria-label="打断模式" :value="settings['interruptMode']" @change="set('interruptMode', ($event.target as HTMLSelectElement).value)">
              <option value="immediate">立即中断</option>
              <option value="wait">等待完成</option>
            </select>
          </div>

          <!-- GAP-A8-001：自动学习开关——OMP autolearn（实验性）。
               对话结束后提炼经验并沉淀到技能/记忆，复用现有模型，无新增付费 API。 -->
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">自动学习</div>
              <div class="setting-desc">对话结束后自动提炼经验与要点（实验性，会消耗少量额外 token）。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['autolearn.enabled'] }" @click="toggle('autolearn.enabled')">
              {{ settings['autolearn.enabled'] ? '开启' : '关闭' }}
            </button>
          </div>

          <!-- GAP-B3-001：会话闲置回顾——轮次完成后闲置一段时间，自动生成
               简短进展总结（OMP recap 配置；触发器由 Maxma 应用层实现）。 -->
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">闲置回顾</div>
              <div class="setting-desc">对话闲置一段时间后自动生成简短进展总结（会消耗少量额外 token）。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['recap.enabled'] !== false }" @click="toggle('recap.enabled')">
              {{ settings['recap.enabled'] !== false ? '开启' : '关闭' }}
            </button>
          </div>
          <div class="setting-row" v-if="settings['recap.enabled'] !== false">
            <div class="setting-info">
              <div class="setting-label">闲置时长</div>
              <div class="setting-desc">闲置多久后触发回顾。</div>
            </div>
            <select class="select" aria-label="回顾闲置时长" :value="String(settings['recap.idleSeconds'] ?? 240)" @change="set('recap.idleSeconds', Number(($event.target as HTMLSelectElement).value))">
              <option value="60">1 分钟</option>
              <option value="120">2 分钟</option>
              <option value="240">4 分钟</option>
              <option value="300">5 分钟</option>
              <option value="600">10 分钟</option>
            </select>
          </div>
        </div>
      </GlowingEffect>

      <!-- Thinking -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'thinking'">
          <h3>推理预算</h3>
          <p class="section-desc">控制 AI 在不同推理级别下的 token 预算。</p>

          <div class="setting-row" v-for="level in ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']" :key="level">
            <div class="setting-info">
              <div class="setting-label">{{ thinkingLevelLabel(level) }}</div>
            </div>
            <input type="number" class="input-number" min="1024" max="131072" step="1024"
              :value="settings[`thinkingBudgets.${level}`] ?? 32768"
              @change="set(`thinkingBudgets.${level}`, Number(($event.target as HTMLInputElement).value))" />
          </div>
        </div>
      </GlowingEffect>

      <!-- Skills -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'skills'">
          <h3>技能包</h3>
          <p class="section-desc">控制 OMP 技能包的启用状态。</p>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">启用技能包</div>
              <div class="setting-desc">加载 .agents/skills/ 和 .claude/skills/ 中的技能。</div>
            </div>
            <button class="toggle-btn" :class="{ on: settings['skills.enabled'] }" @click="toggle('skills.enabled')">
              {{ settings['skills.enabled'] ? '开启' : '关闭' }}
            </button>
          </div>
        </div>
      </GlowingEffect>

      <!-- TTS / 语音 -->
      <!-- GAP-A2-001：语音引擎真实接线——WebView2 speechSynthesis 系统语音，
           零 API 成本。此前整段置灰"即将上线"（UX-FAKE-SETTING-001），
           edge-tts/openai-tts 提供商从未有消费方；现统一为 system 并接通
           消息气泡"朗读"按钮与 auto_read 自动朗读。 -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'tts'">
          <h3>语音</h3>
          <p class="section-desc">配置文本转语音（TTS）的引擎与朗读行为。使用 Windows 系统语音，无需任何付费服务。</p>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">启用 TTS</div>
              <div class="setting-desc">开启后可将 AI 回复朗读出来（消息气泡上的"朗读"按钮）。</div>
            </div>
            <button class="toggle-btn" :class="{ on: tts.enabled }" @click="setTts('enabled', !tts.enabled)">
              {{ tts.enabled ? '开启' : '关闭' }}
            </button>
          </div>

          <template v-if="tts.enabled">
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">语音引擎</div>
                <div class="setting-desc">系统语音（Windows 自带，离线可用）。</div>
              </div>
              <select class="select" aria-label="语音引擎" :value="tts.provider" @change="onTtsProviderChange(($event.target as HTMLSelectElement).value as TtsConfig['provider'])">
                <option value="system">系统语音</option>
                <option value="custom">自定义</option>
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">语音</div>
                <div class="setting-desc">当前系统已安装的语音列表（含中文/英文）。</div>
              </div>
              <select class="select" aria-label="语音" :value="tts.voice" @change="setTts('voice', ($event.target as HTMLSelectElement).value)">
                <option value="">（自动选择中文语音）</option>
                <option v-for="v in systemVoiceOptions" :key="v.value" :value="v.value">{{ v.label }}</option>
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">试听</div>
                <div class="setting-desc">使用当前语音朗读一句示例文本。</div>
              </div>
              <div class="setting-control">
                <button class="btn" type="button" @click="previewTts">播放试听</button>
                <button class="btn" type="button" @click="stopTts">停止</button>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">语速</div>
              </div>
              <div class="setting-control">
                <BalanceSlider
                  :min="0.5" :max="2.0" :step="0.1"
                  :model-value="tts.speed"
                  @update:model-value="setTts('speed', $event)"
                  show-value
                  class="setting-balance-slider"
                />
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">音调</div>
              </div>
              <div class="setting-control">
                <BalanceSlider
                  :min="0.5" :max="2.0" :step="0.1"
                  :model-value="tts.pitch"
                  @update:model-value="setTts('pitch', $event)"
                  show-value
                  class="setting-balance-slider"
                />
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">自动朗读回复</div>
                <div class="setting-desc">AI 回复完成后自动播放语音。</div>
              </div>
              <button class="toggle-btn" :class="{ on: tts.auto_read }" @click="setTts('auto_read', !tts.auto_read)">
                {{ tts.auto_read ? '开启' : '关闭' }}
              </button>
            </div>
          </template>
        </div>
      </GlowingEffect>

      <!-- 系统通知（GAP-A3-001） -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'notify'">
          <h3>系统通知</h3>
          <p class="section-desc">任务完成、等待审批时在系统层弹出通知（窗口在后台时）。</p>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">启用系统通知</div>
              <div class="setting-desc">长任务完成或 Agent 等待你确认时，即使窗口不在前台也能收到提醒。</div>
            </div>
            <button class="toggle-btn" :class="{ on: notifyEnabled }" @click="toggleNotify">
              {{ notifyEnabled ? '开启' : '关闭' }}
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">通知权限</div>
              <div class="setting-desc">Windows 系统级权限，由下方按钮在点击时申请。</div>
            </div>
            <div class="setting-control">
              <span class="permission-badge" :class="notifyPermissionClass">{{ notifyPermissionLabel }}</span>
              <button class="btn" type="button" @click="testNotify">测试通知</button>
            </div>
          </div>
        </div>
      </GlowingEffect>

      <!-- 浏览器工具 -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'browser'">
          <h3>浏览器工具</h3>
          <p class="section-desc">配置 AI 内置浏览器自动化的运行方式。</p>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">启用浏览器工具</div>
              <div class="setting-desc">允许 AI 打开网页、截图与抓取内容。</div>
            </div>
            <button class="toggle-btn" :class="{ on: browser.enabled }" @click="setBrowser('enabled', !browser.enabled)">
              {{ browser.enabled ? '开启' : '关闭' }}
            </button>
          </div>

          <template v-if="browser.enabled">
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Chrome 可执行文件路径</div>
                <div class="setting-desc">留空则使用自动检测的浏览器。</div>
              </div>
              <div class="setting-control">
                <input type="text" class="input-text" :value="browser.chrome_path"
                  placeholder="自动检测"
                  @change="setBrowser('chrome_path', ($event.target as HTMLInputElement).value)" />
                <!-- UX-BUTTON-LABEL-001：按钮叫"检测"实际弹文件选择框，文案与行为
                     不符——改为"选择文件" -->
                <button class="btn" @click="detectChrome">选择文件</button>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">无头模式</div>
                <div class="setting-desc">后台运行浏览器，不显示窗口。</div>
              </div>
              <button class="toggle-btn" :class="{ on: browser.headless }" @click="setBrowser('headless', !browser.headless)">
                {{ browser.headless ? '开启' : '关闭' }}
              </button>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">默认视口</div>
                <div class="setting-desc">浏览器窗口的宽 × 高（像素）。</div>
              </div>
              <div class="setting-control">
                <input type="number" class="input-number" min="1" max="7680"
                  :value="browser.viewport_width"
                  @change="setBrowser('viewport_width', Number(($event.target as HTMLInputElement).value))" />
                <span class="range-value">×</span>
                <input type="number" class="input-number" min="1" max="4320"
                  :value="browser.viewport_height"
                  @change="setBrowser('viewport_height', Number(($event.target as HTMLInputElement).value))" />
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">拦截跟踪 / 分析</div>
                <div class="setting-desc">屏蔽常见的跟踪与统计分析请求。</div>
              </div>
              <button class="toggle-btn" :class="{ on: browser.block_tracking }" @click="setBrowser('block_tracking', !browser.block_tracking)">
                {{ browser.block_tracking ? '开启' : '关闭' }}
              </button>
            </div>

            <div class="setting-row setting-row-block">
              <div class="setting-info">
                <div class="setting-label">允许的域名</div>
                <div class="setting-desc">每行一个域名；留空表示允许全部。</div>
              </div>
              <textarea class="textarea" rows="3" :value="browser.allowed_domains.join('\n')"
                placeholder="example.com&#10;docs.python.org"
                @change="setBrowser('allowed_domains', ($event.target as HTMLTextAreaElement).value.split('\n').map(s => s.trim()).filter(Boolean))" />
            </div>
          </template>
        </div>
      </GlowingEffect>

      <!-- 子代理 -->
      <GlowingEffect :disabled="false" :glow="true" :spread="30" :proximity="60" :blur="2" :movement-duration="1.5" class="section-glow">
        <div class="section" v-show="activeSection === 'subagent'">
          <h3>子代理</h3>
          <p class="section-desc">控制 AI 派生子代理并行处理任务的行为。</p>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">启用子代理</div>
              <div class="setting-desc">允许主 AI 派生子代理处理子任务。</div>
            </div>
            <button class="toggle-btn" :class="{ on: subagent.enabled }" @click="setSubAgent('enabled', !subagent.enabled)">
              {{ subagent.enabled ? '开启' : '关闭' }}
            </button>
          </div>

          <template v-if="subagent.enabled">
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">最大并发数</div>
                <div class="setting-desc">同时运行的子代理上限。</div>
              </div>
              <div class="setting-control">
                <BalanceSlider
                  :min="1" :max="10" :step="1"
                  :model-value="subagent.max_concurrent"
                  @update:model-value="setSubAgent('max_concurrent', $event)"
                  show-value
                  class="setting-balance-slider"
                />
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">自动批准工具调用</div>
                <div class="setting-desc">子代理调用工具时无需逐一确认。</div>
              </div>
              <button class="toggle-btn" :class="{ on: subagent.auto_approve }" @click="setSubAgent('auto_approve', !subagent.auto_approve)">
                {{ subagent.auto_approve ? '开启' : '关闭' }}
              </button>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">子代理模型</div>
                <div class="setting-desc">inherit 表示沿用主对话模型。</div>
              </div>
              <select class="select" :value="subagent.model" @change="setSubAgent('model', ($event.target as HTMLSelectElement).value)">
                <option value="inherit">继承主模型</option>
                <option value="fast">快速模型</option>
                <option value="strong">强力模型</option>
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">超时时间</div>
                <div class="setting-desc">单个子代理的最长运行时间。</div>
              </div>
              <div class="setting-control">
                <BalanceSlider
                  :min="30" :max="600" :step="30"
                  :model-value="subagent.timeout_seconds"
                  @update:model-value="setSubAgent('timeout_seconds', $event)"
                  show-value
                  class="setting-balance-slider"
                />
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">在对话中显示进度</div>
                <div class="setting-desc">实时展示子代理的执行状态。</div>
              </div>
              <button class="toggle-btn" :class="{ on: subagent.show_progress }" @click="setSubAgent('show_progress', !subagent.show_progress)">
                {{ subagent.show_progress ? '开启' : '关闭' }}
              </button>
            </div>
          </template>
        </div>
      </GlowingEffect>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { api } from '@/api'
import type { TtsConfig, BrowserToolsConfig, SubAgentConfig } from '@/api'
import { isNotifyEnabled, setNotifyEnabled, isNotificationSupported, getNotificationPermission, requestNotifyPermission, showSystemNotification } from '@/lib/notify'
import { invalidateTtsConfigCache, listSystemVoices, speakText, stopSpeaking, isSpeechSupported } from '@/composables/useTts'
import { createLogger } from '@/utils/logger'
import { showError, showSuccess } from '@/lib/toast'
import { useViewEntrance } from '@/composables/useViewEntrance'
import { useButtonFx } from '@/composables/useButtonFx'
import GlowingEffect from '@/components/inspira/GlowingEffect.vue'
import AnimatedTabs from '@/components/inspira/AnimatedTabs.vue'
import BalanceSlider from '@/components/inspira/BalanceSlider.vue'

const log = createLogger('SettingsView')

const loading = ref(true)
const loadError = ref('')
const settings = ref<Record<string, unknown>>({})

const rootEl = ref<HTMLElement | null>(null)
useViewEntrance(() => rootEl.value, { header: '.header', blocks: '.section', ready: () => !loading.value })

// 功能按钮交互动效：toggle 开关弹性缩放；重试/检测按钮磁吸
useButtonFx(() => rootEl.value, '.toggle-btn', { hoverScale: 1.08, bounceIcon: true, watchSources: [loading] })
useButtonFx(() => rootEl.value, '.btn', { hoverScale: 1.08, bounceIcon: true, magnetic: 8, watchSources: [loading] })

// ── Panel configs（独立于 OMP Settings，存储在后端 panel_configs.json） ──

const tts = ref<TtsConfig>({
  enabled: false, provider: 'system', voice: '', speed: 1.0, pitch: 1.0, auto_read: false,
})
const browser = ref<BrowserToolsConfig>({
  enabled: false, chrome_path: '', headless: true,
  viewport_width: 1280, viewport_height: 800, block_tracking: true, allowed_domains: [],
})
const subagent = ref<SubAgentConfig>({
  enabled: false, max_concurrent: 3, auto_approve: false,
  model: 'inherit', timeout_seconds: 120, show_progress: true,
})

const sectionTabs = [
  { label: '上下文管理', value: 'compaction' },
  { label: '容错', value: 'retry' },
  { label: '工具', value: 'tools' },
  { label: '顾问', value: 'advisor' },
  { label: '交互', value: 'interaction' },
  { label: '推理预算', value: 'thinking' },
  { label: '技能包', value: 'skills' },
  { label: '语音', value: 'tts' },
  { label: '通知', value: 'notify' },
  { label: '浏览器', value: 'browser' },
  { label: '子代理', value: 'subagent' },
]
const activeSection = ref('compaction')

// GAP-A2-001：语音列表来自系统（speechSynthesis.getVoices()），
// 中文优先展示；voice 存语音名称（与朗读时匹配逻辑一致）。
const systemVoiceOptions = computed(() => {
  const voices = listSystemVoices()
  const sorted = [...voices].sort((a, b) => {
    const aZh = a.lang?.toLowerCase().startsWith('zh') ? 0 : 1
    const bZh = b.lang?.toLowerCase().startsWith('zh') ? 0 : 1
    return aZh - bZh || a.name.localeCompare(b.name)
  })
  return sorted.map((v) => ({ value: v.name, label: `${v.name}（${v.lang}）` }))
})

const CORE_PATHS = [
  'compaction.enabled', 'compaction.strategy', 'compaction.thresholdPercent',
  'compaction.midTurnEnabled', 'compaction.idleEnabled',
  'contextPromotion.enabled',
  'retry.enabled', 'retry.maxRetries', 'retry.modelFallback', 'retry.fallbackChains',
  'tools.approvalMode', 'tools.discoveryMode',
  'advisor.enabled',
  'steeringMode', 'followUpMode', 'interruptMode',
  'thinkingBudgets.minimal', 'thinkingBudgets.low', 'thinkingBudgets.medium',
  'thinkingBudgets.high', 'thinkingBudgets.xhigh', 'thinkingBudgets.max',
  'skills.enabled',
  'autolearn.enabled',
  'recap.enabled', 'recap.idleSeconds',
  'bash.autoBackground.enabled', 'bash.autoBackground.thresholdMs',
  'async.enabled', 'async.maxJobs',
  'vault.enabled',
]

// GAP-B6-001：备用模型链 JSON 编辑器状态
const fallbackChainsText = ref('')
const fallbackChainsError = ref('')

watch(() => settings.value['retry.fallbackChains'], (v) => {
  if (v === undefined || v === null) {
    fallbackChainsText.value = ''
  } else {
    fallbackChainsText.value = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  }
}, { immediate: true })

async function saveFallbackChains(raw: string) {
  fallbackChainsError.value = ''
  const text = raw.trim()
  if (!text) {
    await set('retry.fallbackChains', {})
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    fallbackChainsError.value = 'JSON 格式错误，请检查括号与引号'
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fallbackChainsError.value = '必须是 JSON 对象（键 → 字符串数组）'
    return
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!Array.isArray(value) || !value.every((s) => typeof s === 'string' && s.trim())) {
      fallbackChainsError.value = `键 "${key}" 的值必须是非空字符串数组`
      return
    }
  }
  await set('retry.fallbackChains', parsed)
  fallbackChainsText.value = JSON.stringify(parsed, null, 2)
}

function thinkingLevelLabel(level: string): string {
  const labels: Record<string, string> = {
    minimal: '最小', low: '低', medium: '中',
    high: '高', xhigh: '极高', max: '最大',
  }
  return `${labels[level] ?? level}（${level}）`
}

async function loadSettings() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await api.getSettings(CORE_PATHS)
    settings.value = data
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

const panelLoadError = ref('')

async function loadPanelConfigs() {
  // 修复 PANEL-ERROR-VISIBLE-001：加载失败时记录错误并显示重试入口——
  // 此前静默显示默认值（如"已停用"实际已启用），用户按错误默认值操作
  // 可能覆盖真实配置
  panelLoadError.value = ''
  let failed = 0
  try { tts.value = { ...tts.value, ...(await api.getTtsConfig()) } }
  catch (e) { failed++; log.warn('Failed to load TTS config:', e) }
  try { browser.value = { ...browser.value, ...(await api.getBrowserToolsConfig()) } }
  catch (e) { failed++; log.warn('Failed to load browser tools config:', e) }
  try { subagent.value = { ...subagent.value, ...(await api.getSubAgentConfig()) } }
  catch (e) { failed++; log.warn('Failed to load sub-agent config:', e) }
  if (failed > 0) {
    panelLoadError.value = `有 ${failed} 个面板配置加载失败，当前显示的可能不是实际配置`
  }
}

// ── 去重：避免同一个 setting path 短时间内重复请求后端 ──
const _inflightSettings = new Map<string, Promise<unknown>>()

async function set(path: string, value: unknown) {
  // 同一个 path 的请求尚未完成时，合并请求（以最后一次 value 为准）
  const existing = _inflightSettings.get(path)
  const prev = settings.value[path]
  settings.value[path] = value

  let promise: Promise<unknown> | undefined
  try {
    if (existing) {
      // 现有请求完成后，再发本次请求（用最新 value）
      await existing.catch(() => {})
    }
    promise = api.setSetting(path, value)
    _inflightSettings.set(path, promise)
    await promise
  } catch (e) {
    log.error(`Failed to set ${path}:`, e)
    settings.value[path] = prev
    // UX-SETTINGS-FEEDBACK-001：保存失败必须可见——此前静默回滚控件值，
    // 用户拨动开关后看到它悄悄弹回，完全不知道发生了什么
    showError(`设置保存失败 (${path}): ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    // 清除本 path 的在途标记，确保下一次同类请求能正常发起
    if (promise && _inflightSettings.get(path) === promise) {
      _inflightSettings.delete(path)
    }
  }
}

async function toggle(path: string) {
  await set(path, !settings.value[path])
}

// 通用的面板配置写入：乐观更新 + 失败回滚
async function setTts<K extends keyof TtsConfig>(key: K, value: TtsConfig[K]) {
  const prev = tts.value[key]
  tts.value[key] = value
  try {
    tts.value = { ...tts.value, ...(await api.updateTtsConfig({ [key]: value })) }
    invalidateTtsConfigCache()  // GAP-A2-001：朗读端 60s TTL 缓存立即失效
  } catch (e) {
    log.error(`Failed to set tts.${String(key)}:`, e)
    tts.value[key] = prev
    showError(`语音设置保存失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function onTtsProviderChange(provider: TtsConfig['provider']) {
  // 切换引擎后旧音色通常无效，一并清空交由后端补默认值
  const prevProvider = tts.value.provider
  const prevVoice = tts.value.voice
  tts.value.provider = provider
  tts.value.voice = ''
  try {
    tts.value = { ...tts.value, ...(await api.updateTtsConfig({ provider, voice: '' })) }
    invalidateTtsConfigCache()
  } catch (e) {
    log.error('Failed to change TTS provider:', e)
    tts.value.provider = prevProvider
    tts.value.voice = prevVoice
    showError(`语音引擎切换失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// GAP-A2-001：试听/停止（用户手势内直接调用，读当前面板配置生效）
function previewTts() {
  if (!isSpeechSupported()) {
    showError('当前环境不支持语音合成')
    return
  }
  const ok = speakText('你好，这是 Maxma 的语音试听。Hello, this is a Maxma voice preview.')
  if (!ok) {
    showError('语音合成不可用，请检查系统语音设置')
    return
  }
  showSuccess('正在播放试听…')
}

function stopTts() {
  stopSpeaking()
}

// ── 系统通知（GAP-A3-001）：纯客户端能力（Notification API），
//    开关存 localStorage，不新增任何后端/API 依赖 ──
const notifyEnabled = ref(isNotifyEnabled())

function toggleNotify() {
  notifyEnabled.value = !notifyEnabled.value
  setNotifyEnabled(notifyEnabled.value)
  showSuccess(notifyEnabled.value ? '已开启系统通知' : '已关闭系统通知')
}

const notifyPermissionLabel = computed(() => {
  const p = getNotificationPermission()
  if (p === 'unsupported') return '不支持'
  if (p === 'granted') return '已授权'
  if (p === 'denied') return '已拒绝（请在系统设置中允许）'
  return '未请求'
})
const notifyPermissionClass = computed(() => {
  const p = getNotificationPermission()
  if (p === 'granted') return 'permission-granted'
  if (p === 'denied') return 'permission-denied'
  return 'permission-default'
})

async function testNotify() {
  if (!isNotificationSupported()) {
    showError('当前环境不支持系统通知')
    return
  }
  if (getNotificationPermission() !== 'granted') {
    const granted = await requestNotifyPermission()
    if (!granted) {
      showError('通知权限未授予，请在 Windows 系统设置中允许通知')
      return
    }
  }
  const shown = showSystemNotification('Maxma — 测试通知', '系统通知已就绪 ✅', true)
  if (!shown) {
    showError('通知未弹出：请检查开关或系统通知设置')
    return
  }
  showSuccess('已发送测试通知')
}

async function setBrowser<K extends keyof BrowserToolsConfig>(key: K, value: BrowserToolsConfig[K]) {
  const prev = browser.value[key]
  browser.value[key] = value
  try {
    browser.value = { ...browser.value, ...(await api.updateBrowserToolsConfig({ [key]: value })) }
  } catch (e) {
    log.error(`Failed to set browser.${String(key)}:`, e)
    browser.value[key] = prev
    showError(`浏览器工具设置保存失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function setSubAgent<K extends keyof SubAgentConfig>(key: K, value: SubAgentConfig[K]) {
  const prev = subagent.value[key]
  subagent.value[key] = value
  try {
    subagent.value = { ...subagent.value, ...(await api.updateSubAgentConfig({ [key]: value })) }
  } catch (e) {
    log.error(`Failed to set subagent.${String(key)}:`, e)
    subagent.value[key] = prev
    showError(`子代理设置保存失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function detectChrome() {
  try {
    const res = await api.selectFile('file')
    if (res.path) {
      await setBrowser('chrome_path', res.path)
    }
  } catch (e) {
    log.warn('Chrome detect failed:', e)
  }
}

onMounted(async () => {
  await Promise.all([loadSettings(), loadPanelConfigs()])
})
</script>

<style scoped>


/* 面板配置加载失败提示（PANEL-ERROR-VISIBLE-001） */
.panel-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--status-warn) 12%, var(--bg-card));
  border: 1px solid color-mix(in srgb, var(--status-warn) 35%, var(--border));
  border-radius: var(--radius);
  font-size: 13px;
  color: var(--text-primary);}
.settings-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px;
}

.header {
  margin-bottom: 24px;
}

.header h2 {
  font-size: var(--fs-display-lg);
  font-weight: 600;
  font-family: var(--font-display);
  letter-spacing: -0.01em;
  margin: 0;
}

.section {
  margin-bottom: 28px;
}

/* UX-FAKE-SETTING-001：未接入运行时的配置段整体置灰 + "即将上线"徽标 */
.section-upcoming {
  opacity: 0.55;
  filter: saturate(0.6);
  pointer-events: none;
  user-select: none;
}
.upcoming-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.68em;
  font-weight: 500;
  vertical-align: middle;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border);
}

.section h3 {
  font-size: 1em;
  font-weight: 600;
  margin: 0 0 4px;
}

.section-desc {
  font-size: 0.82em;
  color: var(--text-tertiary);
  margin: 0 0 12px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-label {
  font-size: 0.9em;
  font-weight: 500;
}

.setting-desc {
  font-size: 0.75em;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.8em;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.toggle-btn.on {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.8em;
  cursor: pointer;
}

.input-number {
  width: 80px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.8em;
  text-align: right;
}

.input-text {
  width: 180px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.8em;
}

.textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.8em;
  font-family: inherit;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.setting-row-block {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.range-value {
  font-size: 0.8em;
  color: var(--text-secondary);
  min-width: 36px;
  text-align: right;
}

input[type="range"] {
  width: 120px;
}

.loading, .empty {
  text-align: center;
  padding: 40px;
  color: var(--text-tertiary);
}

.btn {
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  cursor: pointer;
  font-size: 0.85em;
  margin-top: 8px;
}

.permission-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 0.8em;
  margin-right: 8px;
  border: 1px solid var(--border);
}

.permission-granted {
  color: var(--status-ok, #4caf50);
  border-color: var(--status-ok, #4caf50);
}

.permission-denied {
  color: var(--status-error, #e05252);
  border-color: var(--status-error, #e05252);
}

.permission-default {
  color: var(--text-secondary);
}

.setting-control--wide {
  flex: 1 1 100%;
  min-width: 0;
}

.input-textarea {
  width: 100%;
  min-height: 110px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.8em;
  line-height: 1.5;
  resize: vertical;
}

.setting-error {
  margin-top: 6px;
  font-size: 0.8em;
  color: var(--status-error, #e05252);
}
</style>