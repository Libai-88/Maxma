# Project — MaxmaHere 前端视觉改造落地竞赛

## 项目路径
`D:\Maxma\MaxmaHere`

## 竞赛主题
前端视觉改造 **完全实现**。上一轮两队分别提出了设计方案，本轮要求：**把方案完整实现到代码中**，让用户能重新启动前端看到真实的视觉效果。

## 现有设计方案（上一轮产出）
- **红队 "The Study"**: 设计方案见 `.superma/20260719-032441-maxmahere-ui-design/rounds/round-1/red/review.md`，已创建 `web/src/themes/study.css` 主题
- **蓝队 "Warm Precision"**: 设计方案见 `.superma/20260719-032441-maxmahere-ui-design/rounds/round-1/blue/review.md`，已创建 `web/src/themes/warm-precision.css` 主题并设为默认

## 要求
1. **不限于主题文件** — 需修改实际的 Vue 组件、CSS 文件、设计令牌，让每个 UI 元素都体现设计理念
2. **可运行验证** — 修改后 `npm run build` 必须通过，浏览器能看到真实的视觉效果
3. **完整覆盖** — 至少覆盖：聊天视图、侧边栏导航、设置面板、Provider 管理页、消息气泡
4. **完成度 > 创意** — 一个 80% 实现的好设计方案 > 一个 100% 设计但 30% 实现的方案

## 技术约束
- Vue 3 + Vite 5 + TypeScript
- CSS 设计令牌在 `web/src/assets/styles/tokens.css`
- 主题文件在 `web/src/themes/`
- 组件在 `web/src/components/`
- 视图在 `web/src/views/`
- 全局样式在 `web/src/assets/styles/`

## 评分标准
- **视觉质量** (30%): 最终视觉效果是否美观、协调
- **完成度** (40%): 实现了多少设计意图（不仅是主题色，还有组件级修改）
- **一致性** (15%): 所有界面元素是否遵循同一设计语言
- **构建通过** (15%): `npm run build` 通过，无运行时错误

## 已就绪
- 后端 dev 服务器已在 `http://localhost:8000` 运行
- 修改后启动 `cd web && npm run dev` 即可预览
