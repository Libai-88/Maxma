const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./favicon-BY5S5h1X.js","./vue-vendor-Di1ub1-d.js","./favicon-3yqn6297.css"])))=>i.map(i=>d[i]);
import{_ as X,I as Y,a as K}from"./favicon-BY5S5h1X.js";import{u as Q,g as I,e as V,i as Z,b as ee}from"./main-CqTVDvNO.js";import{T as te}from"./codemirror-B74nGrP-.js";import{u as oe}from"./useMarkdownPersist-Bgn6KFCs.js";import{d as L,o as A,e as c,f as e,k as l,g as p,u as s,p as se,A as _,l as R,E as ne,F as ae,j as le,X as ie,r as N,w as B,x as d,z as re,B as de}from"./vue-vendor-Di1ub1-d.js";import{u as ce}from"./useViewEntrance-uxxfIEDJ.js";import"./core-DhEqZVGG.js";const ue={class:"header"},me={class:"subtitle"},pe=["disabled"],ye={key:0,class:"save-error"},fe={key:1,class:"save-hint"},ge={key:0,class:"md-guide"},he={class:"md-guide-summary"},ve={class:"md-guide-body"},_e={key:0,class:"md-guide-templates"},Ce={class:"md-guide-template-list"},be=["onClick"],ke={key:1,class:"loading"},Se={key:2,class:"load-error"},Ee={key:3,class:"editor-wrapper"},we=L({__name:"MarkdownEditor",props:{type:{},title:{},subtitle:{},placeholder:{},templates:{}},setup(u){const y=u;async function C(n){await Z({title:"应用模板",message:"应用此模板将覆盖当前编辑器内容，确定吗？（未保存的内容会丢失）",confirmText:"应用",danger:!0})&&(i.value=n)}const{content:i,savedContent:f,loading:$,saving:b,saveState:M,saveError:x,loadError:D,extensions:U,saveStateText:q,loadContent:P,saveContent:O,onBlur:z,retryLoad:F}=oe({type:y.type});function W(n){var g;const o=n.view,a=E.value==="night"||E.value==="midnight";T(o,a);const r=B(E,h=>{T(o,h==="night"||h==="midnight")}),t=o.destroy.bind(o);o.destroy=()=>{r(),t()};const m=JSON.stringify({kind:"editor-ready",type:y.type,contentLen:((g=i.value)==null?void 0:g.length)??0,inlineFont:o.contentDOM.style.fontFamily.slice(0,50),inlineColor:o.contentDOM.style.color});try{k(m)}catch{}}function T(n,o){n.contentDOM.style.fontFamily='"Microsoft YaHei", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',n.contentDOM.style.color=o?"#E6EDF3":"#1C1C1C",n.contentDOM.style.fontSize="15px",n.contentDOM.style.lineHeight="1.6"}async function k(n){const{api:o}=await X(async()=>{const{api:a}=await import("./favicon-BY5S5h1X.js").then(r=>r.y);return{api:a}},__vite__mapDeps([0,1,2]),import.meta.url);o.request("/diagnostics/frontend",{method:"POST",body:JSON.stringify({kind:"markdown-editor",msg:n,url:`${location.pathname}${location.hash}`})}).catch(()=>{})}const S=N(null),{activeTheme:E}=ee();return Q((n,o)=>{B($,o(a=>{if(a)return;const r=S.value;if(!r)return;const t=r.querySelector(".header");t&&I.from(t,{opacity:0,y:-8,duration:.3,ease:V.out});const m=r.querySelector(".editor-wrapper");m&&I.from(m,{opacity:0,y:8,duration:.3,ease:V.out})}),{immediate:!0,flush:"post"})}),A(P),A(()=>{setTimeout(()=>{var n,o;try{const a=S.value;if(!a)return;const r=a.querySelector(".editor-wrapper"),t=a.querySelector(".cm-content"),m=w=>w?`${w.offsetWidth}x${w.offsetHeight}`:"none",g=(t==null?void 0:t.childElementCount)??0,h=((n=t==null?void 0:t.firstElementChild)==null?void 0:n.tagName)??"none",H=((o=t==null?void 0:t.textContent)==null?void 0:o.length)??0,v=t==null?void 0:t.firstElementChild,j=v?getComputedStyle(v).display:"none",G=v?getComputedStyle(v).opacity:"none",J=[`wrapper=${m(r)}`,`content=${m(t)}`,`children=${g}`,`firstChild=${h}`,`firstDisplay=${j}`,`firstOpacity=${G}`,`textLen=${H}`].join(" | ");k(`DOM: ${J}`)}catch(a){k(`DOM-diagnose-fail: ${String(a)}`)}},1500)}),(n,o)=>{var a,r;return d(),c("div",{ref_key:"rootRef",ref:S,class:"md-editor-view",style:{color:"#1C1C1C",background:"var(--bg-card, #FFFEFA)",fontFamily:"inherit"}},[e("div",ue,[e("h2",null,[l(p(u.title)+" ",1),e("span",me,p(u.subtitle),1)]),e("button",{class:"save-button",disabled:s(b)||s(i)===s(f),onClick:o[0]||(o[0]=(...t)=>s(O)&&s(O)(...t))},p(s(b)?"保存中...":"保存"),9,pe),e("span",{class:se(["save-indicator",s(M)])},p(s(q)),3),s(x)?(d(),c("span",ye,"保存失败："+p(s(x)),1)):_("",!0),!s(M)&&s(i)&&s(i)!==s(f)?(d(),c("span",fe,"点击编辑区域外来保存")):_("",!0)]),n.$slots.guide||(a=u.templates)!=null&&a.length?(d(),c("details",ge,[e("summary",he,[R(Y,{class:"md-guide-icon",name:"file-page",size:14}),o[3]||(o[3]=l("写作指引与模板",-1))]),e("div",ve,[ne(n.$slots,"guide",{},void 0,!0),(r=u.templates)!=null&&r.length?(d(),c("div",_e,[o[4]||(o[4]=e("div",{class:"md-guide-templates-title"},"点击使用模板（将覆盖当前内容）：",-1)),e("div",Ce,[(d(!0),c(ae,null,le(u.templates,t=>(d(),c("button",{key:t.label,type:"button",class:"md-template-btn",onClick:m=>C(t.content)},p(t.label),9,be))),128))])])):_("",!0)])])):_("",!0),s($)?(d(),c("div",ke,"加载中...")):s(D)?(d(),c("div",Se,[e("p",null,"加载失败："+p(s(D)),1),e("button",{class:"retry-button",onClick:o[1]||(o[1]=(...t)=>s(F)&&s(F)(...t))},"重试")])):(d(),c("div",Ee,[R(s(te),{modelValue:s(i),"onUpdate:modelValue":o[2]||(o[2]=t=>ie(i)?i.value=t:null),extensions:s(U),disabled:s(b),placeholder:u.placeholder,autofocus:!1,"indent-with-tab":!0,"tab-size":2,onReady:W,onBlur:s(z)},null,8,["modelValue","extensions","disabled","placeholder","onBlur"])]))],512)}}}),$e=K(we,[["__scopeId","data-v-b730aa42"]]),Ve=L({__name:"UserView",setup(u){const y=N(null);ce(()=>{var i;return((i=y.value)==null?void 0:i.$el)??null},{header:".header"});const C=[{label:"📝 通用用户档案",content:`# 关于我

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
`},{label:"💻 开发者档案",content:`# 关于我

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
`}];return(i,f)=>(d(),re($e,{ref_key:"rootEl",ref:y,type:"user",title:"用户",subtitle:"USER",placeholder:"编辑用户描述...",templates:C},{guide:de(()=>[...f[0]||(f[0]=[e("p",null,[e("strong",null,"USER.md"),l(" 是你的「用户档案」，AI 在每次对话时会自动读取这里的内容，用来理解你是谁、喜欢什么、关心什么。 ")],-1),e("p",null,[l(" 与 "),e("strong",null,"SOUL.md"),l("（定义 AI 的角色）不同，"),e("strong",null,"USER.md"),l(" 定义的是 "),e("em",null,"你"),l("—— 写得越具体，AI 越能给你贴心的回答。 ")],-1),e("p",null,"建议写：",-1),e("ul",null,[e("li",null,[e("strong",null,"称呼 / 身份"),l("：怎么称呼你？你的职业或学生身份？")]),e("li",null,[e("strong",null,"偏好"),l("：喜欢简洁还是详细？中文还是英文？代码注释风格？")]),e("li",null,[e("strong",null,"兴趣 / 项目"),l("：你正在做什么、关心哪些话题（AI 会基于此推荐相关内容）")]),e("li",null,[e("strong",null,"禁忌"),l("：不想 AI 做什么（如「不要给我鸡汤」「不要假设我用 Mac」）")])],-1),e("p",null,[l("格式为 "),e("code",null,"Markdown"),l("，写多少都可以，留空也可以——AI 会基于对话逐步学习你。")],-1)])]),_:1},512))}});export{Ve as default};
