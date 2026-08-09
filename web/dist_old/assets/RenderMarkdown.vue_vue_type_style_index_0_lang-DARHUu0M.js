const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./katex-DLVrwanO.css"])))=>i.map(i=>d[i]);
import{I as C,c as z,a as R,_ as $}from"./favicon-BY5S5h1X.js";import{M as I,t as P,a as j,k as B}from"./markdown-vendor-BaWzuhFV.js";import{d as N,L as F,o as V,b as W,x as f,e as h,f as E,A as M,l as H,g as D,p as U,r as b,c as g,F as q,z as G,k as X}from"./vue-vendor-Di1ub1-d.js";import{u as Y}from"./useMediaViewer-pIngAAnf.js";const y=new I({html:!0,breaks:!0,linkify:!0}),K=new Set(["script","style","iframe","frame","object","embed","applet","meta","link","base","form","input","textarea","select","option","noscript","template"]),J=new Set(["div","span","p","br","hr","h1","h2","h3","h4","h5","h6","a","b","strong","i","em","u","s","strike","del","ins","ul","ol","li","dl","dt","dd","blockquote","q","cite","pre","code","table","thead","tbody","tfoot","tr","th","td","caption","colgroup","col","img","figure","figcaption","details","summary","mark","small","sub","sup","time","section","article","aside","header","footer","main","nav"]),Q=new Set(["href","src","srcset","action","formaction","cite","poster","data"]),Z=new Set(["http:","https:","mailto:","tel:","data:","ftp:","ftps:"]),ee=/^data:image\/(png|jpeg|jpg|gif|webp|bmp|avif);/i;function te(o){const t=o.trim().toLowerCase();if(/^(javascript|vbscript)/i.test(t))return!0;if(/^data:/i.test(t))return!ee.test(t);const r=t.match(/^([a-z][a-z0-9+.-]*:)/i);return!!(r&&!Z.has(r[1].toLowerCase()))}function re(o,t){const r=o.toLowerCase();return r.startsWith("on")||r==="style"||r==="contenteditable"||r==="draggable"||r==="form"||r==="formaction"||r==="manifest"||Q.has(r)&&te(t)?null:t}function S(o){if(o.nodeType===Node.TEXT_NODE)return o.cloneNode(!1);if(o.nodeType===Node.COMMENT_NODE||o.nodeType!==Node.ELEMENT_NODE)return null;const t=o,r=t.tagName.toLowerCase();if(K.has(r))return null;if(!J.has(r)){const e=document.createDocumentFragment();return t.childNodes.forEach(a=>{const i=S(a);i&&e.appendChild(i)}),e}const c=document.createElement(r);for(let e=0;e<t.attributes.length;e++){const a=t.attributes[e];if(!a)continue;const i=re(a.name,a.value);i!==null&&c.setAttribute(a.name,i)}return t.childNodes.forEach(e=>{const a=S(e);a&&c.appendChild(a)}),c}function T(o){if(!o)return"";const r=new DOMParser().parseFromString(o,"text/html"),c=document.createDocumentFragment();Array.from(r.body.childNodes).forEach(a=>{const i=S(a);i&&c.appendChild(i)});const e=document.createElement("div");return e.appendChild(c),e.innerHTML}y.use(P,{enabled:!0});y.use(j,{engine:B,delimiters:["dollars","parentheses","brackets"],allow_escape:!0,katexOptions:{throwOnError:!1}});const L=y.renderer.rules.fence;y.renderer.rules.fence=function(o,t,r,c,e){const a=o[t];return(a.info?a.info.trim():"").split(/\s+/)[0].toLowerCase()==="html"?T(a.content):L?L(o,t,r,c,e):e.renderToken(o,t,r)};const oe=200,ne=new Map,ae=new Map;function A(o,t=!0){const r=t?ne:ae;if(r.has(o)){const a=r.get(o);return r.delete(o),r.set(o,a),a}const c=y.render(o),e=t?T(c):c;if(r.size>=oe){const a=r.keys().next().value;a!==void 0&&r.delete(a)}return r.set(o,e),e}function se(o,t={}){return o?A(o,t.sanitize!==!1):""}function ie(o){return o?A(o,!1):""}function ce(o){if(!o)return!1;let t=!1,r="";const c=o.split(`
`);for(const e of c){const a=e.trimStart();if(a.startsWith("```")){t?r="":r=a.slice(3).trim().split(/\s+/)[0].toLowerCase(),t=!t;continue}if(!(t&&r!=="html")&&(/<script[\s>/]/i.test(e)||/<\/script>/i.test(e)||/<style[\s>/]/i.test(e)||/<\/style>/i.test(e)||/<link[\s>]/i.test(e)&&/rel\s*=\s*["']stylesheet["']/i.test(e)||/\son\w+\s*=\s*["']/i.test(e)||/href\s*=\s*["']\s*javascript:/i.test(e)||/<iframe[\s>/]/i.test(e)||/<meta[^>]*http-equiv\s*=\s*["']?\s*refresh/i.test(e)||/(?:location\.href|window\.location|document\.location)\s*=/.test(e)))return!0}return!1}const le={key:0,class:"sandbox-loading"},de={key:1,class:"sandbox-error-bar"},ue={class:"sandbox-error-text"},me=["srcdoc"],fe=N({__name:"HtmlSandbox",props:{html:{}},setup(o){const t=z("HtmlSandbox"),r=o,c=b(null),e=b(null),a=b(200),i=b(!1);F(()=>{const n=e.value;n&&n.style.setProperty("height",`${a.value}px`)},{flush:"post"});const p=b([]);function w(){const n=getComputedStyle(document.documentElement);return["--bg-primary","--bg-secondary","--bg-card","--text-primary","--text-secondary","--text-tertiary","--accent","--accent-dark","--border","--user-bubble","--status-ok","--status-error","--status-warn","--shadow","--shadow-xs","--shadow-sm","--shadow-md","--shadow-lg","--shadow-xl","--radius"].map(d=>`${d}: ${n.getPropertyValue(d).trim()};`)}function k(n){p.value.push(n);const s=`[Sandbox ${n.type}]`;console.group(`%c${s} ${n.message}`,"color:var(--status-error);font-weight:bold"),t.error("  消息:",n.message),n.stack&&t.error("  堆栈:",n.stack),n.source&&t.error("  来源:",n.source,`(${n.line}:${n.col})`),t.error("  时间:",n.time),t.error("  内容预览 (前 200 字符):",r.html.slice(0,200)),console.groupEnd()}const _=g(()=>`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    ${w().join(`
    `)}
  }
  *,
  *::before,
  *::after {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  html {
    height: 100%;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
      'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
    font-size: 16px;
    line-height: 1.6;
    color: var(--text-primary, #1f2937);
    background: transparent;
    padding: 0;
    min-height: 40px;
    word-break: break-word;
    overflow-x: hidden;
  }

  /* ── Markdown 样式 ── */
  h1, h2, h3, h4, h5, h6 {
    margin: 16px 0 8px;
    font-weight: 600;
    line-height: 1.3;
  }
  h1 { font-size: 1.5em; }
  h2 { font-size: 1.3em; }
  h3 { font-size: 1.15em; }
  h4 { font-size: 1em; }
  h5 { font-size: 0.9em; }
  h6 { font-size: 0.85em; color: var(--text-secondary); }

  p { margin: 8px 0; }
  ul, ol { padding-left: 20px; margin: 8px 0; }
  li { margin: 4px 0; }

  code {
    background: var(--bg-primary);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: 'SF Mono', 'Consolas', monospace;
  }
  pre {
    background: var(--bg-primary);
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 8px 0;
  }
  pre code {
    background: none;
    padding: 0;
    border-radius: 0;
    font-size: 13px;
  }

  blockquote {
    border-left: 3px solid var(--accent);
    padding: 4px 12px;
    margin: 8px 0;
    color: var(--text-secondary);
  }

  table {
    border-collapse: collapse;
    margin: 8px 0;
    width: 100%;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 6px 12px;
    text-align: left;
  }
  th {
    background: var(--bg-secondary);
    font-weight: 600;
  }

  a {
    color: var(--accent);
    text-decoration: underline;
  }
  a:hover { opacity: 0.8; }

  strong { font-weight: 600; }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 16px 0;
  }

  img {
    max-width: 100%;
    border-radius: 8px;
    height: auto;
  }

  input[type="checkbox"] {
    margin-right: 6px;
    accent-color: var(--accent);
  }

  /* 响应式媒体 */
  video, canvas, svg {
    max-width: 100%;
    height: auto;
  }

  .markdown-body > *:first-child { margin-top: 0; }
  .markdown-body > *:last-child  { margin-bottom: 0; }
</style>
<script>
(function () {
  'use strict';
  /* ── 导航护栏：拦截 AI 输出对 iframe 的脚本式外部导航。
     sandbox 已阻止顶层导航，但 iframe 内 location.href=/assign()/replace()
     会导航 iframe 自身到外部地址（用户看到"页面被替换"）。
     此脚本在 head 阶段（早于 AI 内容）执行，拦截 http(s) 外部地址；
     用户点击链接（默认导航）不受影响，localhost 放行。 */
  function isExternalHttp(url) {
    var s = String(url).trim().replace(/^['"]+|['"]+$/g, '').toLowerCase();
    if (!/^https?:/i.test(s)) return false;
    if (/^https?://(?:localhost|127.0.0.1|0.0.0.0)(?::d+)?([/#?]|$)/i.test(s)) return false;
    return true;
  }
  function blockNav(url) {
    try {
      parent.postMessage({ type: 'sandbox-error', payload: { category: 'nav-blocked', message: '已阻止 AI 输出的外部跳转: ' + String(url).slice(0, 200), detail: '' } }, '*');
    } catch (e) {}
  }
  var locProto = window.Location && Location.prototype;
  if (!locProto) return;
  var hrefDesc = Object.getOwnPropertyDescriptor(locProto, 'href');
  if (hrefDesc && typeof hrefDesc.set === 'function') {
    Object.defineProperty(locProto, 'href', {
      get: hrefDesc.get,
      set: function (v) {
        if (isExternalHttp(v)) { blockNav(v); return; }
        return hrefDesc.set.call(this, v);
      },
      configurable: true
    });
  }
  ['assign', 'replace'].forEach(function (m) {
    if (typeof locProto[m] !== 'function') return;
    var orig = locProto[m];
    locProto[m] = function (url) {
      if (isExternalHttp(url)) { blockNav(url); return; }
      return orig.call(this, url);
    };
  });
})();
<\/script>
</head>
<body>
<div class="markdown-body">
${r.html}
</div>
<script>
(function() {
  'use strict';

  /* ── 全局错误拦截器 ── */
  var _origOnError = window.onerror;
  window.onerror = function(msg, source, line, col, err) {
    parent.postMessage({
      type: 'sandbox-error',
      payload: {
        category: 'runtime',
        message: msg,
        source: source,
        line: line,
        col: col,
        stack: err && err.stack ? err.stack : null,
      }
    }, '*');
    if (typeof _origOnError === 'function') {
      return _origOnError(msg, source, line, col, err);
    }
    return false;
  };

  window.addEventListener('error', function(e) {
    // 不重复上报 window.onerror 已捕获的错误
    if (e.error && e.error.stack) {
      parent.postMessage({
        type: 'sandbox-error',
        payload: {
          category: 'error-event',
          message: e.message || String(e.error),
          source: e.filename,
          line: e.lineno,
          col: e.colno,
          stack: e.error && e.error.stack ? e.error.stack : null,
        }
      }, '*');
    }
    e.preventDefault();
  });

  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason || {};
    parent.postMessage({
      type: 'sandbox-error',
      payload: {
        category: 'unhandled-rejection',
        message: typeof reason === 'string' ? reason : (reason.message || String(reason)),
        stack: reason && reason.stack ? reason.stack : null,
      }
    }, '*');
    e.preventDefault();
  });

  /* ── 拦截 document.write（LLM 输出后调用会清空文档） ── */
  var _origWrite = document.write.bind(document);
  var _origWriteln = document.writeln.bind(document);
  document.write = function() {
    var args = Array.prototype.slice.call(arguments);
    var text = args.join('');
    parent.postMessage({
      type: 'sandbox-error',
      payload: {
        category: 'document-write',
        message: 'document.write() 在文档加载完成后被调用（会清空页面内容）',
        detail: text.slice(0, 200),
      }
    }, '*');
    // 仍执行原 write 以防页面完全崩溃，但用户会在控制台看到警告
    return _origWrite.apply(document, args);
  };
  document.writeln = function() {
    var args = Array.prototype.slice.call(arguments);
    parent.postMessage({
      type: 'sandbox-error',
      payload: {
        category: 'document-write',
        message: 'document.writeln() 在文档加载完成后被调用（会清空页面内容）',
      }
    }, '*');
    return _origWriteln.apply(document, args);
  };

  /* ── 高度上报 ── */
  function reportHeight() {
    var h = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
    if (h < 40) h = 40;
    parent.postMessage({ type: 'sandbox-resize', height: h }, '*');
  }
  if (document.readyState === 'complete') {
    reportHeight();
  } else {
    window.addEventListener('load', reportHeight);
  }
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(reportHeight);
    ro.observe(document.body);
    ro.observe(document.documentElement);
  }
  var delays = [100, 300, 800, 2000];
  delays.forEach(function(d) { setTimeout(reportHeight, d); });
})();
<\/script>
</body>
</html>`);function l(n){var s,d,x,v;if(n.source===((s=e.value)==null?void 0:s.contentWindow)){if(((d=n.data)==null?void 0:d.type)==="sandbox-resize"&&typeof n.data.height=="number"){a.value=n.data.height;return}if(((x=n.data)==null?void 0:x.type)==="sandbox-error"&&((v=n.data)!=null&&v.payload)){const u=n.data.payload,O=new Date().toLocaleTimeString();k({type:u.category||"unknown",message:u.message||"(无消息)",stack:u.stack,source:u.source,line:u.line,col:u.col,time:O})}}}function m(){i.value=!0}return V(()=>{window.addEventListener("message",l)}),W(()=>{window.removeEventListener("message",l)}),(n,s)=>(f(),h("div",{class:"html-sandbox-container",ref_key:"container",ref:c},[i.value?M("",!0):(f(),h("div",le,[...s[0]||(s[0]=[E("span",{class:"sandbox-spinner"},null,-1)])])),p.value.length>0?(f(),h("div",de,[H(C,{class:"sandbox-error-icon",name:"warning",size:14}),E("span",ue,"沙箱内 "+D(p.value.length)+" 个错误 — 见控制台",1)])):M("",!0),E("iframe",{ref_key:"iframeRef",ref:e,srcdoc:_.value,sandbox:"allow-scripts allow-modals",class:U(["html-sandbox-iframe",{"is-loaded":i.value,"is-loading":!i.value}]),title:"sandboxed-content",onLoad:m},null,42,me)],512))}}),pe=R(fe,[["__scopeId","data-v-63161d77"]]),ge=["innerHTML"],he={key:2,class:"md-render-error"},ve=N({__name:"RenderMarkdown",props:{content:{},forceSandbox:{type:Boolean,default:!1},streaming:{type:Boolean,default:!1}},setup(o){const t=z("RenderMarkdown");$(()=>Promise.resolve({}),__vite__mapDeps([0]),import.meta.url).catch(l=>{t.warn("[RenderMarkdown] KaTeX CSS 加载失败，数学公式可能显示异常:",l)});const{open:r}=Y();function c(l){const m=l.target;if(m.tagName==="IMG"){l.preventDefault();const n=m,s=n.closest(".markdown-body"),d=s?Array.from(s.querySelectorAll("img")):[n],x=d.map(u=>({src:u.src,alt:u.alt})),v=d.indexOf(n);r(x,v)}}const e=o;let a=0;const i=g(()=>{let l=null,m="",n="";try{m=se(e.content)}catch(s){a++;const d=s instanceof Error?s.message:String(s);t.error(`[RenderMarkdown] marked.parse 错误 (第 ${a} 次):`,d),t.error("  内容预览:",e.content.slice(0,200)),l=d}try{n=ie(e.content)}catch(s){const d=s instanceof Error?s.message:String(s);t.error("[RenderMarkdown] raw render 错误:",d),l||(l=d)}return{html:m,sandbox:n,error:l}}),p=g(()=>i.value.html),w=g(()=>i.value.error),k=g(()=>i.value.sandbox),_=g(()=>{if(e.streaming||!e.content)return!1;if(e.forceSandbox)return!0;try{return ce(e.content)}catch(l){return t.error("[RenderMarkdown] contentNeedsIsolation 检测异常:",l),!0}});return(l,m)=>(f(),h(q,null,[_.value?(f(),G(pe,{key:0,html:k.value},null,8,["html"])):(f(),h("div",{key:1,class:"markdown-body",innerHTML:p.value,onClick:c},null,8,ge)),w.value?(f(),h("p",he,[H(C,{name:"warning",size:14}),X(" Markdown 渲染错误: "+D(w.value),1)])):M("",!0)],64))}});export{ve as _};
