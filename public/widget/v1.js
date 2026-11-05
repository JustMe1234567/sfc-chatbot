"use strict";(()=>{var m="sfc-chatbot-widget-v1",x=`
.sfcw-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:56px;height:56px;border:0;border-radius:14px;background:#fff;color:#1d4e89;padding:8px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:inline-flex;align-items:center;justify-content:center}
.sfcw-launcher:hover{background:#f5f7fa}
.sfcw-launcher:active{transform:translateY(1px)}
.sfcw-launcher:focus-visible{outline:2px solid #e3a739;outline-offset:2px}
/* The display above would override the hidden attribute's UA style. */
.sfcw-launcher[hidden]{display:none}
/* The launcher's white surface is the plate that keeps the blue crest legible
   on arbitrary host-page backgrounds (ticket 40). */
.sfcw-launcher img{width:40px;height:40px;display:block;object-fit:contain}
.sfcw-launcher-close{width:28px;height:28px;display:none;align-items:center;justify-content:center;font:400 28px/1 system-ui,sans-serif}
.sfcw-launcher[aria-expanded="true"] img{display:none}
.sfcw-launcher[data-closing="true"] img{display:none}
.sfcw-launcher[aria-expanded="true"] .sfcw-launcher-close{display:flex}
.sfcw-launcher[data-closing="true"] .sfcw-launcher-close{display:flex}
.sfcw-frame{position:fixed;right:16px;bottom:76px;z-index:2147483000;display:block;border:0;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);background:#fff;width:min(360px,calc(100vw - 32px));height:min(560px,calc(100vh - 100px));opacity:0;transform:translateY(10px) scale(.98);transition:opacity 180ms cubic-bezier(.2,.8,.2,1),transform 180ms cubic-bezier(.2,.8,.2,1)}
.sfcw-frame.sfcw-frame-in{opacity:1;transform:none}
.sfcw-frame[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.sfcw-frame{transition-duration:0ms}.sfcw-launcher:active{transform:none}}
@media (max-width:480px){.sfcw-frame{right:8px;left:8px;bottom:72px;width:calc(100vw - 16px);height:calc(100vh - 88px)}}
`;function w(){var u;if(document.querySelector(`.${m}`))return;let a=document.currentScript;a&&(a.dataset.sfcChatbot="1");let o=new URL((u=a==null?void 0:a.src)!=null?u:document.baseURI,document.baseURI).origin,l=document.createElement("style");l.textContent=x,document.head.appendChild(l);let e=document.createElement("button");e.type="button",e.className=`sfcw-launcher ${m}`;let d=document.createElement("img");d.src=`${o}/brand/cropped-SFC-Final-Logo-Single.png`,d.alt="";let r=document.createElement("span");r.className="sfcw-launcher-close",r.textContent="\xD7",r.setAttribute("aria-hidden","true"),e.appendChild(d),e.appendChild(r),e.setAttribute("aria-label","Chat with Springfield College"),e.setAttribute("aria-expanded","false"),document.body.appendChild(e);let t=document.createElement("iframe");t.className="sfcw-frame",t.src=`${o}/widget/frame`,t.title="Chat with Springfield College",t.hidden=!0,document.body.appendChild(t);let i,s=!1;function c(){var n;(n=t.contentWindow)==null||n.postMessage({type:"sfcw:state",open:s,visible:document.visibilityState==="visible"},o)}t.addEventListener("load",c),document.addEventListener("visibilitychange",c);function b(){var n;s=!0,delete e.dataset.closing,i!==void 0&&(window.clearTimeout(i),i=void 0),t.hidden=!1,window.requestAnimationFrame(()=>{window.requestAnimationFrame(()=>{s&&t.classList.add("sfcw-frame-in")})}),e.setAttribute("aria-label","Close chat"),e.setAttribute("aria-expanded","true"),c(),(n=t.contentWindow)==null||n.focus()}function f(){s=!1,t.classList.remove("sfcw-frame-in"),e.dataset.closing="true",e.setAttribute("aria-label","Chat with Springfield College"),e.setAttribute("aria-expanded","false"),c(),e.focus(),i!==void 0&&window.clearTimeout(i),i=window.setTimeout(()=>{t.hidden=!0,delete e.dataset.closing,i=void 0},200)}e.addEventListener("click",()=>{s?f():b()}),window.addEventListener("message",n=>{var p,h;n.origin!==o||n.source!==t.contentWindow||(((p=n.data)==null?void 0:p.type)==="sfcw:ready"?c():((h=n.data)==null?void 0:h.type)==="sfcw:close"&&f())})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",w,{once:!0}):w();})();
