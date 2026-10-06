(() => {
  'use strict';
  const HOSTS = new Set(['www.zhihu.com', 'zhihu.com', 'zhuanlan.zhihu.com']);
  const PREFIX = 'data-zhn-';
  const MARKERS = ['bg', 'fg', 'border', 'gradient'].map(x => PREFIX + x);
  const SKIP = 'script,style,link,meta,noscript,img,picture,video,audio,canvas,iframe,object,embed,svg,svg *,[data-zhn-control]';
  const rgba = value => {
    const m = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
    return m ? {r:+m[1], g:+m[2], b:+m[3], a:m[4] === undefined ? 1 : +m[4]} : null;
  };
  const neutral = c => c && Math.max(c.r,c.g,c.b) - Math.min(c.r,c.g,c.b) < 38;
  const brightness = c => (c.r + c.g + c.b) / 3;

  function create(adapter) {
    if (!HOSTS.has(location.hostname) || /^(?:\/signin|\/signup|\/settings\/|\/creator\/)/.test(location.pathname)) return null;
    if (globalThis.__zhnController) return globalThis.__zhnController;
    let enabled = false, dead = false, originalTheme, root, host, button, label;
    let timer = null, observer = null, themeObserver = null, unsubscribe = null;
    let revision = 0, inspected = 0;
    const marked = new Set(), queue = new Set();

    function updateControl(error = '') {
      if (!button) return;
      button.setAttribute('aria-checked', String(enabled));
      button.title = error || (enabled ? '点击恢复网页原来的外观' : '点击启用柔和夜间模式');
      label.textContent = error ? '保存失败，点击重试' : enabled ? '夜间模式' : '浅色模式';
      host.setAttribute(PREFIX + 'state', enabled ? 'on' : 'off');
    }
    function mountControl() {
      if (dead || host || !document.body) return;
      host = document.createElement('div');
      host.setAttribute(PREFIX + 'control', '');
      host.id = 'zhihu-soft-night-control';
      // Important inline positioning protects the control from the site's CSS.
      host.style.cssText = 'position:fixed!important;right:20px!important;bottom:92px!important;z-index:2147483600!important;display:block!important;width:auto!important;height:auto!important;';
      const shadow = host.attachShadow({mode:'open'});
      shadow.innerHTML = `<style>
        :host{all:initial;font-family:system-ui,"Microsoft YaHei",sans-serif}
        button{display:flex;align-items:center;gap:9px;padding:10px 12px;border:1px solid #4b5666;border-radius:24px;background:#2d333d;color:#dce1e8;box-shadow:0 3px 15px #10131855;cursor:pointer;font:13px/1.3 system-ui,"Microsoft YaHei",sans-serif}
        button:hover{background:#374151}button:focus-visible{outline:2px solid #7aaeff;outline-offset:3px}
        .track{width:30px;height:17px;border-radius:12px;background:#596474;position:relative;flex:none}
        .track:after{content:"";position:absolute;top:3px;left:3px;width:11px;height:11px;border-radius:50%;background:#e1e7ef;transition:transform .12s}
        button[aria-checked=true] .track{background:#548bda}button[aria-checked=true] .track:after{transform:translateX(13px)}
        @media(max-width:600px){button{padding:8px 10px;font-size:12px}}
        @media(prefers-reduced-motion:reduce){.track:after{transition:none}}
      </style><button type="button" role="switch" aria-label="切换知乎夜间模式" aria-checked="false"><span aria-hidden="true">☾</span><span class="label"></span><span class="track" aria-hidden="true"></span></button>`;
      button = shadow.querySelector('button'); label = shadow.querySelector('.label');
      button.addEventListener('click', () => persist(!enabled));
      document.body.appendChild(host);
      updateControl();
    }
    function clearMarkers(e) {
      for (const name of MARKERS) e.removeAttribute(name);
    }
    function mark(e, type, value) {
      e.setAttribute(PREFIX + type, value);
      marked.add(e);
    }
    function inspect(e) {
      if (!(e instanceof HTMLElement) || e.matches(SKIP) || e.closest('[data-zhn-control]')) return;
      // Remove only our own annotations before reading the current site's styles.
      clearMarkers(e);
      const s = getComputedStyle(e);
      if (s.display === 'none') return;
      inspected++;
      const bg = rgba(s.backgroundColor), fg = rgba(s.color);
      if (neutral(bg) && bg.a > .4) {
        const b = brightness(bg);
        if (b > 232) mark(e,'bg','surface');
        else if (b > 180) mark(e,'bg','inset');
        else if (b < 8 && bg.a >= .95 && !e.closest('.RichText figure')) mark(e,'bg','inset');
      }
      if (neutral(fg) && fg.a > .4) {
        const b = brightness(fg);
        if (b < 90) mark(e,'fg','text');
        else if (b < 165) mark(e,'fg','muted');
      } else if (fg && fg.a > .4 && e.matches('a') && fg.r < 100 && fg.g < 160 && fg.b > 100 && fg.b > fg.g*1.25) {
        mark(e,'fg','link');
      }
      if (s.borderTopStyle !== 'none' || s.borderBottomStyle !== 'none' || s.borderLeftStyle !== 'none' || s.borderRightStyle !== 'none') {
        const borders = [s.borderTopColor,s.borderBottomColor,s.borderLeftColor,s.borderRightColor].map(rgba);
        if (borders.some(c => neutral(c) && c.a > .2 && brightness(c) > 170)) mark(e,'border','line');
      }
      // Only replace all-neutral bright gradients; retain photos and colored art.
      if (/gradient\(/.test(s.backgroundImage) && !/url\(/.test(s.backgroundImage)) {
        const colors = (s.backgroundImage.match(/rgba?\([^)]*\)/g) || []).map(rgba);
        if (colors.length && colors.every(c => neutral(c) && (brightness(c)>180 || c.a===0))) mark(e,'gradient','surface');
      }
    }
    function collect(node) {
      if (!(node instanceof Element) || node.matches(SKIP) || node.closest('[data-zhn-control]')) return;
      queue.add(node);
      if (timer === null) timer = setTimeout(flush, 60);
    }
    function flush() {
      timer = null;
      if (!enabled || dead) {queue.clear(); return;}
      const pending = Array.from(queue); queue.clear();
      // Discard descendants already covered by an ancestor in this batch.
      const roots = pending.filter(e => e.isConnected && !pending.some(p=>p!==e && p.contains(e)));
      const work = [];
      for (const e of roots) {work.push(e); work.push(...e.querySelectorAll('*'));}
      let i = 0;
      const chunk = () => {
        if (!enabled || dead) return;
        const until = Math.min(i+300, work.length);
        while (i < until) {const e=work[i++]; if(e.isConnected) inspect(e);}
        if (i < work.length) setTimeout(chunk, 0);
        else for (const e of marked) if (!e.isConnected) marked.delete(e);
      };
      chunk();
    }
    function watchBody() {
      if (observer || !document.body || !enabled) return;
      observer = new MutationObserver(records => {
        for (const m of records) {
          if (m.type === 'attributes') collect(m.target);
          else for (const node of m.addedNodes) collect(node);
        }
        if (host && !host.isConnected) {host=null; mountControl();}
      });
      observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden']});
      collect(document.body);
    }
    function activate() {
      root=document.documentElement;
      if (!root) return;
      originalTheme={present:root.hasAttribute('data-theme'),value:root.getAttribute('data-theme')};
      root.setAttribute(PREFIX+'enabled','true');
      root.setAttribute('data-theme','dark');
      themeObserver = new MutationObserver(() => {
        if (!enabled || !root || root.getAttribute('data-theme') === 'dark') return;
        originalTheme={present:root.hasAttribute('data-theme'),value:root.getAttribute('data-theme')};
        root.setAttribute('data-theme','dark');
      });
      themeObserver.observe(root,{attributes:true,attributeFilter:['data-theme']});
      watchBody();
    }
    function deactivate() {
      observer?.disconnect(); observer=null;
      themeObserver?.disconnect(); themeObserver=null;
      if (timer!==null) clearTimeout(timer); timer=null; queue.clear();
      for (const e of marked) clearMarkers(e); marked.clear();
      root?.removeAttribute(PREFIX+'enabled');
      if (root && originalTheme) {
        if (originalTheme.present) root.setAttribute('data-theme',originalTheme.value);
        else root.removeAttribute('data-theme');
      }
      originalTheme=null;
    }
    function setEnabled(value) {
      if(dead) return;
      value=Boolean(value);
      if (enabled!==value) {enabled=value; if(value) activate(); else deactivate();}
      mountControl(); updateControl();
    }
    async function persist(value) {
      const id=++revision, previous=enabled;
      setEnabled(value);
      try {await adapter.write(value);}
      catch (error) {if(id===revision){setEnabled(previous);updateControl('保存失败，点击重试');} console.warn('[Zhihu Night] Preference could not be saved:',error);}
    }
    function onReady() {mountControl(); if(enabled && !root) activate(); watchBody();}
    document.addEventListener('DOMContentLoaded',onReady,{once:true});
    const initialRevision = revision;
    const ready = Promise.resolve().then(()=>adapter.read()).then(value=>{if(!dead && revision===initialRevision)setEnabled(value!==false);}).catch(error=>{console.warn('[Zhihu Night] Using the default preference:',error);if(revision===initialRevision)setEnabled(true);});
    unsubscribe=adapter.subscribe(value=>{++revision;setEnabled(value!==false);});
    const controller={
      ready, setEnabled, toggle:()=>persist(!enabled),
      stats:()=>({enabled,marked:marked.size,inspected,version:'0.1.0'}),
      destroy:()=>{if(dead)return;setEnabled(false);dead=true;unsubscribe?.();document.removeEventListener('DOMContentLoaded',onReady);host?.remove();delete globalThis.__zhnController;}
    };
    globalThis.__zhnController=controller;
    return controller;
  }
  globalThis.ZhihuSoftNight={create};
})();
