/* Shared motion system, also embedded in exported offline reports. */
function installSmoothMotion() {
  if (window.SmoothMotion) return window.SmoothMotion;
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
  const ease = 'cubic-bezier(.22, 1, .36, 1)';
  const animations = new WeakMap();
  const presses = new WeakMap();
  const layouts = new WeakMap();
  let navigationObserver = null;
  let navigationGeneration = 0;
  let scheduled = false;
  const groups = new Set();
  const railPreviews = new WeakMap();
  const chartEntries = new WeakMap();
  const chartOwners = new WeakMap();
  const chartHosts = new Set();
  let chartDataRevision = 0;
  const refreshChartData = () => { chartDataRevision++; };
  const groupSelector = '.topnav, .nav-menu, .segmented, .period-pills, .workflow-stepper-bar, .mode-switch, .section-nav';
  const controlSelector = 'button, a[href], [role="button"], .stepper-item';
  const style = document.createElement('style');
  style.id = 'smooth-motion-style';
  style.textContent = `
    .motion-control:not(:disabled) { -webkit-tap-highlight-color:transparent; touch-action:manipulation;
      transition:background-color .24s ease, color .24s ease, border-color .24s ease, box-shadow .28s ease, transform .28s cubic-bezier(.22,1,.36,1), opacity .2s ease !important; }
    .motion-control.motion-relative { position:relative; }
    .motion-control:not(:disabled):not([aria-disabled="true"]):hover { transform:translateY(-1px) !important; }
    .motion-control:not(:disabled):not([aria-disabled="true"]):active { transform:translateY(1px) scale(.978) !important; transition-duration:.12s !important; }
    .motion-tab-group { position:relative; isolation:isolate; }
    .motion-tab-group > .motion-control { position:relative; z-index:1; }
    .motion-tab-group > .motion-active-track { position:absolute; top:0; left:0; z-index:0; pointer-events:none;
      border-radius:24px; background:var(--bg-surface,var(--card,#fff)); box-shadow:0 2px 9px #573a2707;
      transition:transform .42s cubic-bezier(.22,1,.36,1),width .36s cubic-bezier(.22,1,.36,1),height .36s cubic-bezier(.22,1,.36,1),opacity .2s;
      opacity:0; }
    .motion-active-track.motion-track-initial { transition:none !important; }
    .motion-chart-host { animation:none !important; }
    .motion-chart-host :is(.bar-fill,.rank-bar-fill) { animation:none !important; }
    .motion-chart-pending { opacity:0; transform:translate3d(0,18px,0); will-change:opacity,transform; }
    .motion-tab-group.topnav > .topnav-link.active,
    .motion-tab-group.segmented > button.active,
    .motion-tab-group.period-pills > .pill-btn.active,
    .motion-tab-group.status-filter-pills > .filter-pill.active,
    .motion-tab-group.nav-menu > .nav-item.active,
    .motion-tab-group.mode-switch > button.active,
    .motion-tab-group.section-nav > a { background:transparent !important; box-shadow:none !important; }
    .motion-tab-group.segmented > .motion-active-track,
    .motion-tab-group.period-pills > .motion-active-track,
    .motion-tab-group.nav-menu > .motion-active-track,
    .motion-tab-group.mode-switch > .motion-active-track { background:var(--control-fill,#79583f); }
    .motion-tab-group.nav-menu > .motion-active-track { border-radius:var(--rail-item-radius,50%); }
    .motion-tab-group.nav-menu.rail-hover-enabled > .motion-active-track {
      background:var(--control-gradient,linear-gradient(145deg,#8b6549,#6b4a34)); border:1px solid #ffffff28;
      box-shadow:0 4px 12px var(--control-shadow,rgba(87,58,39,.2));
      transition:transform .36s cubic-bezier(.18,.88,.26,1.12),width .3s ease,height .3s ease,box-shadow .24s ease;
    }
    .motion-tab-group.nav-menu.rail-hovering > .motion-active-track {
      box-shadow:0 6px 17px var(--control-shadow,rgba(87,58,39,.26)),0 0 0 4px var(--control-soft,rgba(121,88,63,.12));
    }
    .motion-tab-group.nav-menu.rail-hover-enabled > .nav-item.rail-highlighted {
      color:var(--control-ink,#fff8f0) !important; background:transparent !important; box-shadow:none !important;
    }
    .motion-tab-group.nav-menu.rail-hover-enabled > .nav-item:not(.rail-highlighted) {
      color:var(--text-sub,#796b5e) !important; background:transparent !important; box-shadow:none !important;
    }
    .motion-tab-group.nav-menu.rail-hover-enabled > .nav-item svg {
      transition:transform .24s cubic-bezier(.22,1,.36,1),stroke-width .2s; transform-origin:center;
    }
    .motion-tab-group.nav-menu.rail-hovering > .nav-item.rail-highlighted svg { transform:scale(1.13); stroke-width:2; }
    .motion-tab-group.nav-menu.rail-hover-enabled > .nav-item.active:not(.rail-highlighted)::after {
      content:''; position:absolute; width:4px; height:4px; left:calc(50% - 2px); bottom:3px;
      border-radius:50%; background:var(--control-label,#79583f); pointer-events:none;
    }
    .motion-tab-group.status-filter-pills > .motion-active-track,
    .motion-tab-group.workflow-stepper-bar > .motion-active-track,
    .motion-tab-group.section-nav > .motion-active-track { background:var(--bg-input,var(--soft,#f0e5d8)); border:1px solid var(--border-focus,var(--line,#c8ae94)); }
    .motion-tab-group.workflow-stepper-bar > .motion-active-track { border-radius:13px; background:var(--bg-surface-subtle,#f5ede4); border:0; }
    .motion-tab-group.status-filter-pills > .filter-pill.active { border-color:transparent; }
    .motion-tab-group.section-nav > a.active { color:var(--coral-primary,var(--control-label,#79583f)); }
    .motion-wave-clip { position:absolute; inset:0; overflow:hidden; border-radius:inherit; pointer-events:none; z-index:3; }
    .motion-wave { position:absolute; width:22px; height:22px; margin:-11px 0 0 -11px; border-radius:50%; background:currentColor; opacity:.12; pointer-events:none; }
    .motion-managed.pipeline-step-pane.active,
    .motion-managed.pipeline-step-pane.active.step-entering > .step-reveal-item,
    .motion-managed.pipeline-step-pane.active .stat-mini-card,
    .motion-managed.pipeline-step-pane.active .kpi-mini-box { animation:none !important; }
    .header-popover,.overview-search { transition:opacity .22s ease,transform .3s cubic-bezier(.22,1,.36,1),display .3s allow-discrete; }
    .header-popover[hidden],.overview-search[hidden] { opacity:0; transform:translateY(8px); }
    @starting-style { .header-popover:not([hidden]),.overview-search:not([hidden]) { opacity:0; transform:translateY(8px); } }
    .config-modal-backdrop,.error-giant-overlay,.bulk-delete-overlay { transition:opacity .22s ease,display .22s allow-discrete; }
    .config-modal-backdrop:not(.active),.error-giant-overlay:not(.active),.bulk-delete-overlay[hidden] { opacity:0; }
    @starting-style { .config-modal-backdrop.active,.error-giant-overlay.active,.bulk-delete-overlay:not([hidden]) { opacity:0; } }
    @media(max-width:760px) {
      .motion-tab-group.topnav > .motion-active-track { background:var(--control-fill,#79583f); }
    }
    @media(prefers-reduced-motion:reduce) {
      .motion-control,.motion-control:not(:disabled),.motion-active-track,.header-popover,.overview-search,.config-modal-backdrop,.error-giant-overlay,.bulk-delete-overlay { transition:none !important; }
      .motion-control:not(:disabled):not([aria-disabled="true"]):hover,.motion-control:not(:disabled):not([aria-disabled="true"]):active { transform:none !important; }
      .motion-wave-clip { display:none !important; }
      .motion-chart-pending { opacity:1; transform:none; will-change:auto; }
      .motion-tab-group.nav-menu.rail-hover-enabled > .motion-active-track,
      .motion-tab-group.nav-menu.rail-hover-enabled > .nav-item svg { transition:none !important; }
      .motion-tab-group.nav-menu.rail-hovering > .nav-item.rail-highlighted svg { transform:none; }
    }
    @media print { .motion-active-track,.motion-wave-clip { display:none !important; } .motion-chart-host,.motion-chart-pending {opacity:1 !important;transform:none !important;animation:none !important;} }
  `;
  document.head.appendChild(style);

  function cancel(element) {
    const running = animations.get(element);
    if (running) { running.cancel(); animations.delete(element); }
  }
  function animate(element, frames, options = {}) {
    if (!element || reduced() || typeof element.animate !== 'function') return;
    // Start from the last visible pose when clicks arrive during a transition.
    const running = animations.get(element);
    let pose;
    if (running && typeof getComputedStyle === 'function') {
      const current = getComputedStyle(element);
      pose = { opacity:current.opacity, transform:current.transform };
    }
    cancel(element);
    const animation = element.animate(pose ? [pose, frames.at(-1)] : frames, {duration:360,easing:ease,...options});
    animations.set(element,animation);
    animation.finished?.then(() => { if (animations.get(element) === animation) animations.delete(element); }).catch(() => {});
    return animation;
  }
  function reveal(element, options = {}) {
    if (!element) return;
    navigationGeneration++;
    navigationObserver?.disconnect(); navigationObserver=null;
    element.classList.add('motion-managed');
    const x = (options.direction || 1) * (options.distance ?? 16);
    const targets = options.stagger ? [...element.children].filter(child => !child.hidden) : [];
    animate(element,[{opacity:.4,transform:`translate3d(${x}px,6px,0)`},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:420});
    targets.forEach((child,index) => animate(child,[{opacity:0,transform:'translate3d(0,10px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:360,delay:Math.min(index*28,140),fill:'backwards'}));
  }
  function bounce(control) {
    if(!control || reduced() || typeof control.animate!=='function')return;
    const previous=presses.get(control);
    let start={scale:'.97',translate:'0px 1px'};
    if(previous) {
      const pose=getComputedStyle(control);
      start={scale:pose.scale==='none'?'1':pose.scale,translate:pose.translate==='none'?'0px 0px':pose.translate};
      previous.cancel();
    }
    const animation=control.animate([
      {...start,offset:0},
      {scale:'1.035',translate:'0px -3px',offset:.40},
      {scale:'.995',translate:'0px .5px',offset:.75},
      {scale:'1',translate:'0px 0px',offset:1}
    ],{duration:360,easing:'cubic-bezier(.2,.7,.3,1)'});
    presses.set(control,animation);
    animation.finished?.then(()=>{if(presses.get(control)===animation)presses.delete(control);}).catch(()=>{});
  }
  function measureLayout(element) {
    return !element || reduced() ? null : element.getBoundingClientRect().height;
  }
  function settleLayout(element, before) {
    if(!element || before===null || reduced() || typeof element.animate!=='function')return;
    const current=layouts.get(element);
    current?.cancel();
    const after=element.getBoundingClientRect().height;
    if(Math.abs(before-after)<2) {layouts.delete(element);element.classList.remove('motion-stage-resizing');return;}
    element.classList.add('motion-stage-resizing');
    const animation=element.animate([{height:`${before}px`},{height:`${after}px`}],{duration:330,easing:ease});
    layouts.set(element,animation);
    const clear=()=>{if(layouts.get(element)===animation){layouts.delete(element);element.classList.remove('motion-stage-resizing');}};
    animation.finished?.then(clear).catch(clear);
  }
  function navigate(element,options={}) {
    if(!element)return;
    const generation=++navigationGeneration;
    navigationObserver?.disconnect();navigationObserver=null;
    const scrollTarget=options.scrollTarget || element;
    const rect=element.getBoundingClientRect();
    const visible=rect.bottom>100 && rect.top<(window.innerHeight || 768)*.85;
    if(reduced()) {scrollTarget.scrollIntoView({behavior:'auto',block:'start'});return;}
    if(visible || typeof IntersectionObserver!=='function')reveal(element,options);
    else {
      navigationObserver=new IntersectionObserver(entries=>{
        if(generation===navigationGeneration && entries.some(entry=>entry.isIntersecting))reveal(element,options);
      },{rootMargin:'-90px 0px -12% 0px',threshold:.03});
      navigationObserver.observe(element);
    }
    scrollTarget.scrollIntoView({behavior:'smooth',block:'start'});
  }
  const chartObserver=typeof IntersectionObserver==='function' ? new IntersectionObserver(entries=>{
    entries.forEach(({target,isIntersecting})=>{
      const host=chartOwners.get(target),entry=host && chartEntries.get(host);
      if(!isIntersecting || !entry || entry.trigger!==target || entry.seen)return;
      entry.seen=true;chartObserver.unobserve(target);host.classList.remove('motion-chart-pending');
      animate(host,[{opacity:0,transform:'translate3d(0,18px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:520});
      entry.play(!reduced());
    });
  },{rootMargin:'0px 0px -28px 0px',threshold:.08}) : null;
  function watchChart(host,signature,play,trigger=host) {
    if(!host){play(false);return;}
    signature = chartDataRevision + ':' + signature;
    const previous=chartEntries.get(host),entry={signature,seen:false,play,trigger};
    cancel(host);
    if(previous?.trigger)chartObserver?.unobserve(previous.trigger);
    chartOwners.set(trigger,host);
    chartEntries.set(host,entry);chartHosts.add(host);host.classList.add('motion-chart-host');
    if(!chartObserver || reduced() || previous?.seen && previous.signature===signature) {
      entry.seen=true;chartObserver?.unobserve(trigger);host.classList.remove('motion-chart-pending');play(false);return;
    }
    host.classList.add('motion-chart-pending');chartObserver.observe(trigger);
  }
  function createChart(canvas,config) {
    if(!chartObserver || reduced())return new window.Chart(canvas,reduced()?{...config,options:{...config.options,animation:false}}:config);
    const host=canvas.parentElement || canvas;
    if (canvas.hidden) {
      forgetChart(host);
      return new window.Chart(canvas,{...config,options:{...config.options,animation:false}});
    }
    const requested=config.options?.animation ?? {duration:850,easing:'easeOutQuart'};
    const signature=JSON.stringify({type:config.type,labels:config.data.labels,data:config.data.datasets.map(dataset=>dataset.data)});
    const chart=new window.Chart(canvas,{...config,options:{...config.options,animation:false}});
    watchChart(host,signature,play=>{
      if(!chart.ctx)return;
      chart.stop?.();
      chart.resize?.();
      chart.options.animation = reduced() ? false : requested;
      if (play && requested !== false) {
        chart.update('reset');
        // Chart.js leaves the bar's value-axis size unset in reset mode.
        if (config.type === 'bar') {
          const size = config.options?.indexAxis === 'y' ? 'width' : 'height';
          config.data.datasets.forEach((_, index) => {
            chart.getDatasetMeta(index).data.forEach(bar => {
              if (!Number.isFinite(bar[size])) bar[size] = 0;
            });
          });
        }
        chart.update();
      } else {
        chart.update('none');
      }
    },canvas);
    return chart;
  }
  function watchSVG(container,signature) {
    if(!container)return;
    const host=container.closest('[data-overview-card]') ? container : container.closest('.bento-card,.card,.chart-panel') || container;
    watchChart(host,signature,play=>{
      if(!play || reduced())return;
      container.querySelectorAll('.bar-body,.bar-fill,.rank-bar-fill,svg rect.plot-mark').forEach((bar,index)=>{
        const horizontal=bar.matches('.bar-fill,.rank-bar-fill');
        bar.style.transformBox='fill-box';bar.style.transformOrigin=horizontal?'left center':'center bottom';
        animate(bar,[{opacity:.3,transform:horizontal?'scaleX(0)':'scaleY(0)'},{opacity:1,transform:'scale(1)'}],{duration:680,delay:Math.min(index*45,240),fill:'backwards'});
      });
      container.querySelectorAll('path[stroke]').forEach(path=>{
        if(typeof path.getTotalLength!=='function')return;
        const length=path.getTotalLength();if(!length)return;
        path.animate([{strokeDasharray:`${length} ${length}`,strokeDashoffset:length},{strokeDasharray:`${length} ${length}`,strokeDashoffset:0}],{duration:900,easing:ease});
      });
      container.querySelectorAll('path[fill]:not([fill="none"])').forEach(path=>animate(path,[{opacity:0},{opacity:1}],{duration:700}));
      container.querySelectorAll('circle').forEach((circle,index)=>animate(circle,[{opacity:0},{opacity:1}],{duration:650,delay:Math.min(index*45,220),fill:'backwards'}));
    },container);
  }
  function showAllCharts() {
    chartHosts.forEach(host=>{
      if(!host.isConnected){chartHosts.delete(host);const removed=chartEntries.get(host);if(removed)chartObserver?.unobserve(removed.trigger);return;}
      const entry=chartEntries.get(host);if(!entry)return;
      chartObserver?.unobserve(entry.trigger);host.classList.remove('motion-chart-pending');cancel(host);
      host.getAnimations?.({subtree:true}).forEach(animation=>animation.cancel());
      entry.seen=true;entry.play(false);
    });
  }
  function forgetChart(container) {
    if(!container)return;
    const host=chartEntries.has(container) || container.closest('[data-overview-card]')
      ? container : container.closest('.bento-card,.card,.chart-panel') || container;
    const entry=chartEntries.get(host);
    if(entry)chartObserver?.unobserve(entry.trigger);
    chartEntries.delete(host);chartHosts.delete(host);cancel(host);
    host.classList.remove('motion-chart-pending');host.classList.remove('motion-chart-host');
  }
  function refresh() {
    if (scheduled) return;
    scheduled=true;
    requestAnimationFrame(() => { scheduled=false; scan(); groups.forEach(positionTrack); });
  }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null;
  function scan() {
    document.querySelectorAll(controlSelector).forEach(control => {
      if (!control.classList.contains('motion-control')) control.classList.add('motion-control');
    });
    document.querySelectorAll(groupSelector).forEach(group => {
      if (groups.has(group)) return;
      group.classList.add('motion-tab-group');
      const track=document.createElement('span'); track.className='motion-active-track motion-track-initial'; track.setAttribute('aria-hidden','true');
      group.insertBefore(track,group.firstChild);
      groups.add(group); resizeObserver?.observe(group);
      group.addEventListener('scroll',refresh,{passive:true});
      if(group.matches('.nav-menu'))installRailPreview(group);
      if (group.matches('.section-nav') && !group.querySelector('a.active')) group.querySelector('a')?.classList.add('active');
    });
  }
  function positionTrack(group) {
    if (!group.isConnected) { groups.delete(group); resizeObserver?.unobserve(group); return; }
    const track=group.querySelector(':scope > .motion-active-track');
    let active=[...group.children].find(child => child.matches(controlSelector) && (child.classList.contains('active') || child.getAttribute('aria-current')==='page' || child.getAttribute('aria-pressed')==='true'));
    const state=railPreviews.get(group);
    if(state) {
      const candidate=state.pointer || state.focus;
      const preview=candidate?.parentElement===group && validControl(candidate) ? candidate : null;
      if(preview)active=preview;
      const hovering=Boolean(preview);
      if(group.classList.contains('rail-hovering')!==hovering)group.classList.toggle('rail-hovering',hovering);
      [...group.children].filter(child=>child.matches('.nav-item')).forEach(child=>{
        if(child.classList.contains('rail-highlighted')!==(child===active))child.classList.toggle('rail-highlighted',child===active);
      });
    }
    if (!track || !active || !active.getClientRects().length) { if(track)track.style.opacity='0'; return; }
    track.style.width=`${active.offsetWidth}px`; track.style.height=`${active.offsetHeight}px`;
    track.style.transform=`translate3d(${active.offsetLeft}px,${active.offsetTop}px,0)`;
    track.style.opacity='1';
    if (track.classList.contains('motion-track-initial')) requestAnimationFrame(()=>track.classList.remove('motion-track-initial'));
  }
  function installRailPreview(group) {
    const state={pointer:null,focus:null};railPreviews.set(group,state);
    group.classList.add('rail-hover-enabled');
    group.addEventListener('pointerover',event=>{
      if(event.pointerType==='touch')return;
      const target=validControl(event.target);
      if(!target || target.parentElement!==group || state.pointer===target)return;
      state.pointer=target;positionTrack(group);
    },{passive:true});
    group.addEventListener('pointerleave',()=>{state.pointer=null;positionTrack(group);},{passive:true});
    group.addEventListener('focusin',event=>{
      const target=validControl(event.target);
      state.focus=target?.parentElement===group && target.matches(':focus-visible')?target:null;
      positionTrack(group);
    });
    group.addEventListener('focusout',()=>{state.focus=null;positionTrack(group);});
  }
  function validControl(target) {
    const control=target?.closest?.(controlSelector);
    return control && !control.disabled && !control.matches(':disabled') && control.getAttribute('aria-disabled')!=='true' && !control.closest('[inert]') ? control : null;
  }
  function wave(control,event) {
    if (reduced() || typeof control.animate !== 'function') return;
    if (getComputedStyle(control).position==='static') control.classList.add('motion-relative');
    const rect=control.getBoundingClientRect();
    const clip=document.createElement('span'); clip.className='motion-wave-clip';clip.setAttribute('aria-hidden','true');
    const ink=document.createElement('span');ink.className='motion-wave';
    ink.style.left=`${event?.clientX ? event.clientX-rect.left : rect.width/2}px`;
    ink.style.top=`${event?.clientY ? event.clientY-rect.top : rect.height/2}px`;
    clip.appendChild(ink); control.appendChild(clip);
    const size=Math.hypot(rect.width,rect.height)/11;
    const animation=ink.animate([{transform:'scale(.2)',opacity:.15},{transform:`scale(${size})`,opacity:0}],{duration:440,easing:ease});
    animation.finished.then(()=>clip.remove()).catch(()=>clip.remove());
  }
  document.addEventListener('pointerdown',event => {
    if (event.button>0) return;
    const control=validControl(event.target);if(control)wave(control,event);
  },{passive:true});
  document.addEventListener('pointerup',event=>{
    if(event.button>0)return;
    const control=validControl(event.target);if(control)bounce(control);
  },{passive:true});
  document.addEventListener('click',event => {
    const control=validControl(event.target);if(!control)return;
    if(event.detail===0){wave(control,event);bounce(control);}
    if(control.matches('.section-nav a')) {
      control.closest('.section-nav').querySelectorAll('a').forEach(link=>link.classList.toggle('active',link===control));
    }
    // Run after handlers have updated the actual content; never delay the action.
    const panel=control.closest('.pipeline-step-pane');
    const panelId=panel?.id;
    let contentId;
    if(control.closest('#step3StatusTabs,.review-bulk-toolbar,.page-nav-btns'))contentId='reviewDataTable';
    else if(control.closest('#overviewPeriod'))contentId='overviewBarChart';
    else if(control.closest('#analyticsPeriodTabs'))contentId='financeChart';
    else if(control.id==='recentShowAll' || control.id==='recentExpand')contentId='overviewRecentRows';
    const isTimeControl=Boolean(control.closest('.time-slicer'));
    requestAnimationFrame(()=>{
      refresh();
      if(panelId && !document.getElementById(panelId)?.classList.contains('active'))return;
      const content=contentId ? document.getElementById(contentId) : isTimeControl ? panel?.querySelector('.kpi-four-grid') || document.querySelector('.bento-grid') : null;
      if(content)animate(content,[{opacity:.55,transform:'translate3d(9px,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:290});
    });
  },{capture:true});
  const observer=new MutationObserver(records=>{
    const relevant=records.some(record=>{
      if(record.type==='attributes')return record.target.matches('body,.pipeline-step-pane') || Boolean(record.target.closest(groupSelector));
      return [...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1 && !node.matches('.motion-wave-clip,.motion-wave,.motion-active-track') && (node.matches(controlSelector+','+groupSelector) || node.querySelector(controlSelector+','+groupSelector)));
    });
    if(relevant)refresh();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-current','aria-pressed','hidden']});
  window.addEventListener('resize',refresh,{passive:true});
  window.addEventListener('beforeprint',showAllCharts);
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.addEventListener?.('change',()=>{
    if(reduced()) {
      navigationGeneration++;
      navigationObserver?.disconnect();navigationObserver=null;
      document.querySelectorAll('.motion-managed').forEach(element=>{cancel(element);[...element.children].forEach(cancel);});
      document.querySelectorAll('.motion-control').forEach(element=>{presses.get(element)?.cancel();presses.delete(element);});
      document.querySelectorAll('.motion-stage-resizing').forEach(element=>{layouts.get(element)?.cancel();layouts.delete(element);element.classList.remove('motion-stage-resizing');});
      showAllCharts();
    }
    refresh();
  });
  document.fonts?.ready.then(refresh);
  window.SmoothMotion={reveal,animate,cancel,refresh,bounce,navigate,measureLayout,settleLayout,createChart,watchSVG,forgetChart,refreshChartData};
  refresh();
  return window.SmoothMotion;
}
if (typeof document !== 'undefined') {
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>installSmoothMotion(),{once:true});
  else installSmoothMotion();
}
