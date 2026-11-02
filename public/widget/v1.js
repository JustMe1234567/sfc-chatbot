"use strict";(()=>{var p="sfc-chatbot-widget-v1",w=`
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
`;function h(){var f;if(document.querySelector(`.${p}`))return;let a=document.currentScript;a&&(a.dataset.sfcChatbot="1");let r=new URL((f=a==null?void 0:a.src)!=null?f:document.baseURI,document.baseURI).origin,d=document.createElement("style");d.textContent=w,document.head.appendChild(d);let e=document.createElement("button");e.type="button",e.className=`sfcw-launcher ${p}`;let o=document.createElement("img");o.src=`${r}/brand/cropped-SFC-Final-Logo-Single.png`,o.alt="";let s=document.createElement("span");s.className="sfcw-launcher-close",s.textContent="\xD7",s.setAttribute("aria-hidden","true"),e.appendChild(o),e.appendChild(s),e.setAttribute("aria-label","Chat with Springfield College"),e.setAttribute("aria-expanded","false"),document.body.appendChild(e);let t=document.createElement("iframe");t.className="sfcw-frame",t.src=`${r}/widget/frame`,t.title="Chat with Springfield College",t.hidden=!0,document.body.appendChild(t);let n,c=!1;function m(){var i;c=!0,delete e.dataset.closing,n!==void 0&&(window.clearTimeout(n),n=void 0),t.hidden=!1,window.requestAnimationFrame(()=>{window.requestAnimationFrame(()=>{c&&t.classList.add("sfcw-frame-in")})}),e.setAttribute("aria-label","Close chat"),e.setAttribute("aria-expanded","true"),(i=t.contentWindow)==null||i.focus()}function l(){c=!1,t.classList.remove("sfcw-frame-in"),e.dataset.closing="true",e.setAttribute("aria-label","Chat with Springfield College"),e.setAttribute("aria-expanded","false"),e.focus(),n!==void 0&&window.clearTimeout(n),n=window.setTimeout(()=>{t.hidden=!0,delete e.dataset.closing,n=void 0},200)}e.addEventListener("click",()=>{c?l():m()}),window.addEventListener("message",i=>{var u;i.origin===r&&((u=i.data)==null?void 0:u.type)==="sfcw:close"&&l()})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",h,{once:!0}):h();})();
