/* Viewport-driven overview unlocks. Data eligibility remains owned by dashboard.js. */
(() => {
  'use strict';
  const states=new Map(),charts=new Map();
  const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
  let locked=true,visible=true;
  const overlayFor=card=>[...card.children].find(child=>child.classList.contains('overview-card-lock'));
  function access(card,enabled) {
    card.setAttribute('aria-disabled',String(!enabled));
    card.querySelectorAll('button,input,select').forEach(control=>control.disabled=!enabled);
    [...card.children].forEach(child=>{
      if(child.classList.contains('overview-card-lock'))return;
      child.inert=!enabled;
      if(enabled)child.removeAttribute('aria-hidden');else child.setAttribute('aria-hidden','true');
    });
  }
  function clearTimers(state) {state.timers.forEach(clearTimeout);state.timers=[];}
  function playCharts(card) {
    charts.forEach((signature,container)=>{
      if(card.contains(container))window.SmoothMotion?.watchSVG(container,signature);
    });
  }
  function finish(card,state) {
    clearTimers(state);observer?.unobserve(card);state.phase='open';state.released=true;
    card.classList.remove('dashboard-card-locked','overview-unlock-pending','overview-unlocking');
    const overlay=overlayFor(card);if(overlay)overlay.hidden=true;
    access(card,true);playCharts(card);
  }
  function reveal(card) {
    const state=states.get(card);
    if(locked || !visible || state?.phase!=='pending')return;
    observer.unobserve(card);
    if(reduced()){finish(card,state);return;}
    state.phase='unlocking';
    card.classList.remove('overview-unlock-pending');card.classList.add('overview-unlocking');
    const overlay=overlayFor(card);
    const title=overlay?.querySelector('strong');if(title)title.textContent='Đang mở khóa dữ liệu';
    const note=overlay?.querySelector(':scope > span:last-child');if(note)note.textContent='Đang hiển thị số liệu và biểu đồ…';
    state.timers.push(setTimeout(()=>{
      if(locked || state.phase!=='unlocking')return;
      state.released=true;playCharts(card);
    },550));
    state.timers.push(setTimeout(()=>{
      if(!locked && state.phase==='unlocking')finish(card,state);
    },1150));
  }
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    entries.forEach(entry=>{if(entry.isIntersecting)reveal(entry.target);});
  },{rootMargin:'-85px 0px -35px 0px',threshold:.18}):null;
  function sync(options) {
    locked=options.locked;visible=options.visible;
    if(locked) {charts.forEach((_,container)=>window.SmoothMotion?.forgetChart(container));charts.clear();}
    document.querySelectorAll('[data-overview-card]').forEach(card=>{
      let state=states.get(card);
      if(!state){state={phase:'locked',timers:[],released:false};states.set(card,state);}
      const overlay=overlayFor(card);
      if(locked) {
        clearTimers(state);observer?.unobserve(card);state.phase='locked';state.released=false;
        card.classList.remove('overview-unlock-pending','overview-unlocking');card.classList.add('dashboard-card-locked');
        if(overlay){overlay.hidden=false;const title=overlay.querySelector('strong');if(title)title.textContent='Chưa có dữ liệu';const note=overlay.querySelector(':scope > span:last-child');if(note)note.textContent='Nhập bảng tính để mở khóa';}
        access(card,false);return;
      }
      if(state.phase==='locked') {
        card.classList.remove('dashboard-card-locked');
        if(!observer || reduced()){finish(card,state);return;}
        state.phase='pending';card.classList.add('overview-unlock-pending');
        if(overlay){overlay.hidden=false;const title=overlay.querySelector('strong');if(title)title.textContent='Dữ liệu đã sẵn sàng';const note=overlay.querySelector(':scope > span:last-child');if(note)note.textContent='Cuộn tới thẻ để mở khóa';}
        access(card,false);
      }
      if(((!visible || reduced()) && state.phase==='unlocking') || (reduced() && state.phase==='pending'))finish(card,state);
      if(state.phase==='pending') {
        if(visible)observer.observe(card);else observer.unobserve(card);
      }
    });
  }
  function watchChart(container,signature) {
    if(!container)return;
    charts.set(container,signature);
    const state=states.get(container.closest('[data-overview-card]'));
    if(locked || state && state.phase!=='open' && !state.released)return;
    window.SmoothMotion?.watchSVG(container,signature);
  }
  function revealAll() {
    if(locked)return;
    states.forEach((state,card)=>{if(state.phase!=='open')finish(card,state);});
  }
  window.addEventListener('beforeprint',revealAll);
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.addEventListener?.('change',()=>{if(reduced())revealAll();});
  window.OverviewReveal={sync,watchChart};
})();
