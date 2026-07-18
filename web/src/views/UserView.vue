<template>
  <MarkdownEditor
    type="user"
    title="用户"
    subtitle="USER"
    placeholder="编辑用户描述..."
    :templates="userTemplates"
  >
    <template #guide>
      <p>
        <strong>USER.md</strong> 是你的「用户档案」，AI 在每次对话时会自动读取这里的内容，用来理解你是谁、喜欢什么、关心什么。
      </p>
      <p>
        与 <strong>SOUL.md</strong>（定义 AI 的角色）不同，<strong>USER.md</strong> 定义的是 <em>你</em>——
        写得越具体，AI 越能给你贴心的回答。
      </p>
      <p>建议写：</p>
      <ul>
        <li><strong>称呼 / 身份</strong>：怎么称呼你？你的职业或学生身份？</li>
        <li><strong>偏好</strong>：喜欢简洁还是详细？中文还是英文？代码注释风格？</li>
        <li><strong>兴趣 / 项目</strong>：你正在做什么、关心哪些话题（AI 会基于此推荐相关内容）</li>
        <li><strong>禁忌</strong>：不想 AI 做什么（如「不要给我鸡汤」「不要假设我用 Mac」）</li>
      </ul>
      <p>格式为 <code>Markdown</code>，写多少都可以，留空也可以——AI 会基于对话逐步学习你。</p>
    </template>
  </MarkdownEditor>
</template>

<script setup lang="ts">
import MarkdownEditor from '@/components/MarkdownEditor.vue'

const userTemplates = [
  {
    label: '📝 通用用户档案',
    content: `# 关于我

- 称呼：你的称呼
- 身份：学生 / 上班族 / 开发者 / 自由职业者

## 偏好
- 回答风格：直接简洁 / 详细讲解 / 启发引导
- 语言：中文为主，关键术语可用英文
- 代码风格：注释完整、变量名清晰

## 我正在做的事
- （简述你的工作 / 学习 / 兴趣方向）

## 不要做
- 不要给我鸡汤
- 不要假设我用某个操作系统
`,
  },
  {
    label: '💻 开发者档案',
    content: `# 关于我

- 称呼：你的称呼
- 身份：后端开发者，主用 Python / Go
- 工作环境：Windows + VS Code

## 偏好
- 回答要可直接运行的代码，不要省略 import
- 优先使用标准库，避免引入新依赖
- 给出代码前后简单解释思路

## 当前关注
- 分布式系统 / 数据库 / 性能优化

## 不要做
- 不要给我讲课式的长篇大论
- 不要假设我用 macOS
`,
  },
]
</script>
