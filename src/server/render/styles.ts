/** CSS da página intermediária (inline com nonce: evita uma requisição extra por visita). */
export const INTERSTITIAL_CSS = `
:root{color-scheme:light dark;--bg:#f6f7f9;--surface:#fff;--text:#14171c;--muted:#525a66;--border:#d5d9e0;--primary:#1d4ed8;--primary-text:#fff;--focus:#f59e0b;--warn-bg:#fff7e6;--warn-border:#f0c36d;--danger:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--surface:#181b21;--text:#eceff4;--muted:#a7b0bd;--border:#323844;--primary:#6b9bff;--primary-text:#0b1020;--warn-bg:#2a2214;--warn-border:#7a5b1e;--danger:#ff8a80}}
*{box-sizing:border-box}
html{font-size:100%}
body{margin:0;background:var(--bg);color:var(--text);font:1rem/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif}
a{color:var(--primary)}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.skip{position:absolute;left:-9999px;top:0}
.skip:focus{left:1rem;top:1rem;background:var(--surface);padding:.5rem 1rem;z-index:10}
.wrap{max-width:44rem;margin:0 auto;padding:1rem}
.site-header{display:flex;align-items:center;justify-content:space-between;padding:.75rem 0}
.brand{font-weight:700;font-size:1.15rem;text-decoration:none;color:var(--text)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem}
h1{font-size:1.4rem;line-height:1.3;margin:0 0 .75rem}
.lead{margin:.25rem 0;color:var(--muted)}
.destination{font-size:1.35rem;font-weight:700;word-break:break-all;margin:.25rem 0 .75rem}
.idn{background:var(--warn-bg);border:1px solid var(--warn-border);border-radius:8px;padding:.6rem .8rem;margin:.5rem 0}
details{margin:.5rem 0 1rem}
summary{cursor:pointer;color:var(--primary)}
.full-url{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9rem;word-break:break-all;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.5rem;margin:.5rem 0 0}
.notice{border-left:4px solid var(--warn-border);background:var(--warn-bg);padding:.6rem .8rem;margin:.75rem 0;border-radius:4px}
.continue-form{margin:1rem 0}
.button{display:inline-block;width:100%;min-height:3rem;padding:.8rem 1.2rem;border-radius:10px;border:2px solid transparent;font:inherit;font-weight:700;font-size:1.05rem;cursor:pointer;text-align:center}
.button-primary{background:var(--primary);color:var(--primary-text)}
.button-primary:disabled{opacity:.6;cursor:not-allowed}
.button-secondary{background:transparent;color:var(--text);border-color:var(--border);width:auto;min-height:2.5rem;font-size:.95rem}
.warning{font-size:.92rem;color:var(--muted)}
.meta{font-size:.92rem;color:var(--muted);margin-bottom:0}
.ad-area{margin:1.25rem 0;padding:1rem;border:1px dashed var(--border);border-radius:12px;background:var(--surface)}
.ad-label{font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 .5rem}
.ad-slot{min-height:1rem;overflow:hidden}
.ad-slot--empty::after{content:"Anúncio indisponível no momento.";display:block;color:var(--muted);font-size:.9rem}
.ad-placeholder{display:flex;align-items:center;justify-content:center;min-height:90px;border:2px dashed var(--border);border-radius:8px;color:var(--muted);font-size:.9rem;text-align:center;padding:.5rem}
.consent p{margin:.25rem 0 .75rem}
.consent-actions{display:flex;flex-wrap:wrap;gap:.5rem}
.status-code{color:var(--muted);font-size:.9rem;margin:0}
footer{font-size:.9rem;color:var(--muted);padding:1rem 0 2rem}
footer nav{display:flex;flex-wrap:wrap;gap:.75rem 1.25rem}
@media (min-width:40rem){.button{width:auto;min-width:16rem}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

/**
 * Script inline (com nonce) da página intermediária. Mantido como texto
 * estático e sem dependências: evita envio duplo do formulário, mostra a
 * espera opcional e marca espaços publicitários que não carregaram.
 * A página funciona integralmente sem JavaScript.
 */
export const INTERSTITIAL_SCRIPT = `(function(){
  var body=document.body;
  var wait=parseInt(body.getAttribute('data-wait')||'0',10);
  var adTimeout=parseInt(body.getAttribute('data-ad-timeout')||'8000',10);
  var form=document.getElementById('continue-form');
  var button=document.getElementById('continuar');
  var sent=false;
  if(form){form.addEventListener('submit',function(e){if(sent){e.preventDefault();return;}sent=true;});}
  if(button&&wait>0){
    var label=button.textContent;var left=wait;button.disabled=true;
    var tick=function(){if(left<=0){button.disabled=false;button.textContent=label;return;}button.textContent='Aguarde '+left+' s';left-=1;setTimeout(tick,1000);};
    tick();
  }
  setTimeout(function(){
    var slots=document.querySelectorAll('[data-ad-slot]');
    for(var i=0;i<slots.length;i++){
      var slot=slots[i];var ok=false;
      for(var j=0;j<slot.children.length;j++){var c=slot.children[j];if(c.tagName!=='SCRIPT'&&(c.childElementCount>0||c.tagName==='IFRAME'||c.tagName==='IMG'||c.offsetHeight>0)){ok=true;break;}}
      if(!ok){slot.classList.add('ad-slot--empty');}
    }
  },adTimeout);
})();`;
