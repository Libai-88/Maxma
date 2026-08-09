import{d as j,x as r,e as i,f as e,u as t,g as l,r as m,o as K,l as O,k as Q,m as h,n as N,F as E,j as D,A as S,p as Z,q as ee,X as ae,H as te,v as R}from"./vue-vendor-Di1ub1-d.js";import{T as se}from"./codemirror-B74nGrP-.js";import{a as z,e as I,c as oe}from"./favicon-BY5S5h1X.js";import{u as le}from"./persona-BvrcrQcW.js";import{u as ne}from"./useTilt-BNlv-4-a.js";import{u as re}from"./useMarkdownPersist-Bgn6KFCs.js";import{a as k,i as ie}from"./main-CqTVDvNO.js";import{u as de}from"./useViewEntrance-uxxfIEDJ.js";import"./core-DhEqZVGG.js";const ue=""+new URL("logo-companion-opt-MJWxDk48.jpg",import.meta.url).href,ce={class:"card-body"},ve={class:"persona-avatar"},me=["src"],pe={class:"persona-name"},fe={class:"persona-desc"},ge={class:"persona-details"},be={class:"detail-row"},_e={class:"value"},we={class:"detail-row"},ye={class:"value"},he={class:"detail-row"},Se={class:"value"},ke=j({__name:"PersonaCard",setup(P){const u=le(),p=m(null);return ne(()=>p.value),(L,d)=>(r(),i("div",{ref_key:"rootEl",ref:p,class:"persona-card"},[d[3]||(d[3]=e("div",{class:"card-header"},"当前人格",-1)),e("div",ce,[e("div",ve,[e("img",{class:"persona-avatar-img",src:t(ue),alt:"Maxma 人格头像"},null,8,me),e("span",pe,l(t(u).profile.name),1)]),e("p",fe,'"'+l(t(u).profile.description)+'"',1),e("div",ge,[e("div",be,[d[0]||(d[0]=e("span",{class:"label"},"称呼你",-1)),e("span",_e,l(t(u).profile.nickname),1)]),e("div",we,[d[1]||(d[1]=e("span",{class:"label"},"常驻地",-1)),e("span",ye,l(t(u).profile.scene||"小书房"),1)]),e("div",he,[d[2]||(d[2]=e("span",{class:"label"},"风格",-1)),e("span",Se,l(t(u).profile.style),1)])])])],512))}}),Ce=z(ke,[["__scopeId","data-v-bb6f59a8"]]),xe={class:"header"},Ve={class:"subtitle"},$e=["disabled"],Ee={key:0,class:"persona-selector"},Ie=["disabled"],Pe=["value"],Le={key:1,class:"save-error"},Me={key:2,class:"save-hint"},Ue={key:0,class:"loading"},Ae={key:1,class:"load-error"},Te={class:"md-guide"},Fe={class:"md-guide-body"},Be={class:"md-guide-templates"},Oe={class:"md-guide-template-list"},Ne=["onClick"],De={class:"editor-wrapper"},Re={class:"create-dialog"},je={class:"create-field"},ze={class:"create-field"},qe={class:"create-field"},He={class:"create-actions"},Je=["disabled"],We="soul",Xe=j({__name:"SoulView",props:{title:{},subtitle:{},placeholder:{}},setup(P){const u=oe("SoulView"),p=P,L=p.title||"人设",d=p.subtitle||"SOUL",q=p.placeholder||"编辑人设内容...",w=m([]),y=m(!1),c=m("SOUL.md"),{content:v,savedContent:C,loading:b,saving:x,saveState:M,saveError:U,loadError:V,extensions:H,saveStateText:J,loadContent:A,saveContent:$,onBlur:W,retryLoad:T}=re({type:We,getVariant:()=>c.value!=="SOUL.md"?c.value:void 0}),f=m(null);de(()=>f.value,{header:".header",ready:()=>!b.value}),k(()=>f.value,".save-button",{hoverScale:1.06,magnetic:10,watchSources:[b]}),k(()=>f.value,".btn-create-persona",{hoverScale:1.2,magnetic:8,watchSources:[y]}),k(()=>f.value,".md-template-btn",{hoverScale:1.08,bounceIcon:!0,watchSources:[b]});const g=m(!1),_=m(!1),n=m({name:"",description:"",memory:"shared"});k(()=>f.value,".create-btn",{hoverScale:1.08,bounceIcon:!0,watchSources:[g]});const X=[{label:"🐱 温柔桌面伙伴",content:`# 身份

我是 Maxma，一只温柔、有点小聪明的桌面伙伴。我的目标是帮用户把事情想清楚、做明白，而不是炫技或卖弄。

## 风格
- 语气温柔、克制，像朋友间讨论问题
- 简洁优先；除非用户要求展开，否则回答不超过 300 字
- 不用感叹号、不卖萌、不吹捧自己

## 能力
- 帮用户梳理思路、起草文档、写代码、查信息
- 不确定时坦诚说「我不确定」，并建议用户怎么验证

## 禁忌
- 不要说教、不要鸡汤
- 不要假设用户的操作系统或工具链
- 不要自夸「我是一个强大的 AI」
`},{label:"💼 专业工作助手",content:`# 身份

我是 Maxma，一名冷静、靠谱的工作助手。我擅长把模糊的需求拆解成可执行的步骤，给出直接可用的产出。

## 风格
- 专业、简洁，避免口语化
- 代码要可直接运行，包含必要 import 和边界处理
- 文档要分点列出，先结论后细节

## 能力
- 写文档、起草邮件、整理会议纪要、写代码、做数据分析
- 优先使用标准库 / 主流工具，不引入无谓依赖

## 禁忌
- 不要给「看起来厉害但跑不动」的代码
- 不要给鸡汤式建议
- 不要假设用户用 macOS
`},{label:"🎨 创意灵感搭子",content:`# 身份

我是 Maxma，一个爱发散、爱联结的创意搭子。我擅长从看似无关的事物中找到联系，给用户新鲜的视角。

## 风格
- 活泼但不浮夸，敢于给具体方案而不是空话
- 多给几个方向，每个方向简短说明
- 鼓励用户先发散再收敛

## 能力
- 起名字、写文案、做方案、设计活动、出点子
- 用类比、隐喻、跨领域借鉴打开思路

## 禁忌
- 不要给「多读书多看报」式空泛建议
- 不要每个回答都给"3 个建议"
`}];async function Y(o){await ie({title:"应用模板",message:"应用此模板将覆盖当前编辑器内容，确定吗？（未保存的内容会丢失）",confirmText:"应用",danger:!0})&&(v.value=o)}async function G(){if(!(!n.value.name.trim()||_.value)){_.value=!0;try{const o=await I.createPersona({name:n.value.name.trim(),description:n.value.description.trim(),memory:n.value.memory});g.value=!1,n.value={name:"",description:"",memory:"shared"},await F(),c.value=o.file,await B()}catch(o){u.error("[SoulView] createPersona FAIL",o),window.dispatchEvent(new CustomEvent("maxma:error",{detail:{message:"创建失败: "+(o instanceof Error?o.message:String(o))}}))}finally{_.value=!1}}}async function F(){try{const o=await I.listPersonas();w.value=o.personas,c.value=o.active_file,y.value=!0}catch(o){u.error("[SoulView] loadPersonas FAIL",o),w.value=[],y.value=!0}}async function B(){v.value!==C.value&&await $();try{await I.switchPersona(c.value),w.value.forEach(o=>{o.active=o.file===c.value})}catch(o){u.error("[SoulView] switchPersona FAIL",o),V.value="切换人格失败: "+(o instanceof Error?o.message:String(o));return}await A()}return K(async()=>{await F(),await A()}),(o,a)=>(r(),i("div",{class:"md-editor-view",ref_key:"rootEl",ref:f},[O(Ce,{class:"persona-card-spacing"}),e("div",xe,[e("h2",null,[Q(l(t(L))+" ",1),e("span",Ve,l(t(d)),1)]),e("button",{class:"save-button",disabled:t(x)||t(v)===t(C),onClick:a[0]||(a[0]=(...s)=>t($)&&t($)(...s))},l(t(x)?"保存中...":"保存"),9,$e),y.value?(r(),i("div",Ee,[h(e("select",{"onUpdate:modelValue":a[1]||(a[1]=s=>c.value=s),onChange:B,disabled:t(b)},[(r(!0),i(E,null,D(w.value,s=>(r(),i("option",{key:s.id,value:s.file},l(s.name)+l(s.active?" (当前)":""),9,Pe))),128))],40,Ie),[[N,c.value]]),e("button",{class:"btn-create-persona",onClick:a[2]||(a[2]=s=>g.value=!0),title:"创建新人格"},"+")])):S("",!0),e("span",{class:Z(["save-indicator",t(M)])},l(t(J)),3),t(U)?(r(),i("span",Le,"保存失败："+l(t(U)),1)):S("",!0),!t(M)&&t(v)&&t(v)!==t(C)?(r(),i("span",Me,"点击编辑区域外来保存")):S("",!0)]),t(b)?(r(),i("div",Ue,"加载中...")):t(V)?(r(),i("div",Ae,[e("p",null,"加载失败："+l(t(V)),1),e("button",{onClick:a[3]||(a[3]=(...s)=>t(T)&&t(T)(...s))},"重试")])):(r(),i(E,{key:2},[e("details",Te,[a[12]||(a[12]=e("summary",{class:"md-guide-summary"},"📝 写作指引与模板",-1)),e("div",Fe,[a[11]||(a[11]=ee("<p data-v-2255e9e4><strong data-v-2255e9e4>SOUL.md</strong> 是当前人格的「角色设定文件」，定义 AI 在对话中扮演谁、用什么语气、有什么能力边界。 AI 每次对话时会自动读取，写得越具体，AI 表现越稳定。 </p><p data-v-2255e9e4> 与 <strong data-v-2255e9e4>USER.md</strong>（定义用户）不同，<strong data-v-2255e9e4>SOUL.md</strong> 定义的是 <em data-v-2255e9e4>AI 自己</em>。 </p><p data-v-2255e9e4>建议写：</p><ul data-v-2255e9e4><li data-v-2255e9e4><strong data-v-2255e9e4>身份</strong>：AI 是谁？（如「我是 Maxma，一只温柔的桌面伙伴」）</li><li data-v-2255e9e4><strong data-v-2255e9e4>风格</strong>：语气、措辞偏好、回答长度倾向</li><li data-v-2255e9e4><strong data-v-2255e9e4>能力边界</strong>：擅长什么、不擅长什么、什么场景应拒绝</li><li data-v-2255e9e4><strong data-v-2255e9e4>禁忌</strong>：不要做什么（如「不要自夸」「不要说教」）</li></ul><p data-v-2255e9e4>格式为 <code data-v-2255e9e4>Markdown</code>，可以切换不同人格分别配置；点击下方模板可一键填入。</p>",5)),e("div",Be,[a[10]||(a[10]=e("div",{class:"md-guide-templates-title"},"点击使用模板（将覆盖当前内容）：",-1)),e("div",Oe,[(r(),i(E,null,D(X,s=>e("button",{key:s.label,type:"button",class:"md-template-btn",onClick:Ye=>Y(s.content)},l(s.label),9,Ne)),64))])])])]),e("div",De,[O(t(se),{modelValue:t(v),"onUpdate:modelValue":a[4]||(a[4]=s=>ae(v)?v.value=s:null),extensions:t(H),disabled:t(x),placeholder:t(q),autofocus:!1,"indent-with-tab":!0,"tab-size":2,onBlur:t(W)},null,8,["modelValue","extensions","disabled","placeholder","onBlur"])])],64)),g.value?(r(),i("div",{key:3,class:"create-overlay",onClick:a[9]||(a[9]=te(s=>g.value=!1,["self"]))},[e("div",Re,[a[17]||(a[17]=e("h3",null,"创建新人格",-1)),e("div",je,[a[13]||(a[13]=e("label",null,"名称",-1)),h(e("input",{"onUpdate:modelValue":a[5]||(a[5]=s=>n.value.name=s),class:"create-input",placeholder:"例如: 小助手"},null,512),[[R,n.value.name]])]),e("div",ze,[a[14]||(a[14]=e("label",null,"描述",-1)),h(e("input",{"onUpdate:modelValue":a[6]||(a[6]=s=>n.value.description=s),class:"create-input",placeholder:"一句话描述这个人格"},null,512),[[R,n.value.description]])]),e("div",qe,[a[16]||(a[16]=e("label",null,"记忆模式",-1)),h(e("select",{"onUpdate:modelValue":a[7]||(a[7]=s=>n.value.memory=s),class:"create-input"},[...a[15]||(a[15]=[e("option",{value:"shared"},"共享记忆（所有格共用）",-1),e("option",{value:"persona"},"独立记忆（专属记忆分区）",-1)])],512),[[N,n.value.memory]])]),e("div",He,[e("button",{class:"create-btn cancel",onClick:a[8]||(a[8]=s=>g.value=!1)},"取消"),e("button",{class:"create-btn save",disabled:!n.value.name.trim()||_.value,onClick:G},l(_.value?"创建中...":"创建"),9,Je)])])])):S("",!0)],512))}}),la=z(Xe,[["__scopeId","data-v-2255e9e4"]]);export{la as default};
