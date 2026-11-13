/* Welcome -> workspace. Existing import and approval gates remain authoritative. */
(() => {
  'use strict';
  const init = () => {
    const cover = document.getElementById('welcomeCover');
    const workspace = document.getElementById('appLayout');
    if (!cover || !workspace) return;
    const start = document.getElementById('coverStart');
    const demo = document.getElementById('coverDemo');
    const home = document.getElementById('backToCover');
    const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const pointerMotion = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    const lightSurfaces = '.cover-main, .welcome-row, .cover-visual, .cover-button, .welcome-cta-group .btn, .topbar-actions button';
    let lightTargets = [];
    let pointerFrame = 0;

    function clearPointerLight() {
      window.cancelAnimationFrame(pointerFrame);
      pointerFrame = 0;
      lightTargets.forEach(element => element.classList.remove('light-tracking'));
      lightTargets = [];
    }

    function movePointerLight(event) {
      if (!pointerMotion.matches || event.pointerType === 'touch') return;
      const control = event.target.closest(lightSurfaces);
      const surface = event.target.closest('.cover-main, .welcome-row');
      const targets = [surface, control !== surface ? control : null]
        .filter(element => element && !element.disabled);
      lightTargets.forEach(element => {
        if (!targets.includes(element)) element.classList.remove('light-tracking');
      });
      lightTargets = targets;
      window.cancelAnimationFrame(pointerFrame);
      const {clientX, clientY} = event;
      pointerFrame = window.requestAnimationFrame(() => {
        pointerFrame = 0;
        const positions = lightTargets.map(element => [element, element.getBoundingClientRect()]);
        positions.forEach(([element, rect]) => {
          element.style.setProperty('--light-x', ((clientX - rect.left) / rect.width * 100) + '%');
          element.style.setProperty('--light-y', ((clientY - rect.top) / rect.height * 100) + '%');
          element.classList.add('light-tracking');
        });
      });
    }

    for (const page of [cover, workspace]) {
      page.addEventListener('pointermove', movePointerLight, {passive:true});
      page.addEventListener('pointerleave', clearPointerLight);
      page.addEventListener('pointercancel', clearPointerLight);
    }
    window.addEventListener('blur', clearPointerLight);
    pointerMotion.addEventListener('change', clearPointerLight);

    const revealCards = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      const visibleCards = entries.filter(entry => entry.isIntersecting);
      visibleCards.forEach(({target}, index) => {
        revealCards.unobserve(target);
        if (reduceMotion()) return;
        window.SmoothMotion?.animate(target, [
          {opacity:0, translate:'0 14px'},
          {opacity:1, translate:'0 0'}
        ], {duration:500, delay:Math.min(index * 55, 165), fill:'backwards'});
      });
    }, {threshold:.18}) : null;
    document.querySelectorAll('[data-overview-card]').forEach(card => revealCards?.observe(card));


    let inWorkspace = false;
    let busy = false;
    let queued = null;

    const fade = async (element, frames, duration) => {
      if (reduceMotion() || typeof element.animate !== 'function') return;
      try {
        const animation = element.animate(frames, {
          duration, easing:'cubic-bezier(.22,1,.36,1)', fill:'both'
        });
        await animation.finished;
        animation.cancel();
      } catch (_) { /* Navigation still completes if an animation is interrupted. */ }
    };

    async function go(toWorkspace, { sample = false, record = true } = {}) {
      if (busy) { queued = { toWorkspace, sample, record }; return; }
      if (toWorkspace === inWorkspace) return;
      busy = true;
      clearPointerLight();
      document.body.classList.add('cover-transitioning');
      const outgoing = toWorkspace ? cover : workspace;
      const incoming = toWorkspace ? workspace : cover;
      outgoing.setAttribute('aria-busy','true');
      outgoing.inert = true;
      try {
        await fade(outgoing, [
          { opacity:1, filter:'blur(0px)' },
          { opacity:.55, filter:'blur(3px)', offset:.53 },
          { opacity:0, filter:'blur(7px)' }
        ], 390);

        outgoing.hidden = true;
        incoming.hidden = false;
        incoming.inert = true;
        document.body.classList.toggle('cover-view', !toWorkspace);
        if (toWorkspace && typeof AppState !== 'undefined' && AppState.currentStep === 1) {
          document.body.classList.add('workflow-view');
        }
        inWorkspace = toWorkspace;
        if (record) history.pushState({ codekitPage:toWorkspace?'workspace':'welcome' }, '',
          toWorkspace ? '#workspace' : '#welcome');
        window.scrollTo({ top:0, left:0, behavior:'instant' });
        window.dispatchEvent(new Event('resize'));
        await fade(incoming, [
          { opacity:0 },
          { opacity:.48, offset:.35 },
          { opacity:1 }
        ], 660);
        incoming.inert = false;

        const focusTarget = toWorkspace
          ? document.getElementById('workspaceTitle') : start;
        focusTarget?.focus({ preventScroll:true });
        window.SmoothMotion?.refresh();
        if (toWorkspace && sample) document.getElementById('useSampleData')?.click();
      } finally {
        outgoing.removeAttribute('aria-busy');
        outgoing.inert = outgoing.hidden;
        incoming.inert = incoming.hidden;
        document.body.classList.remove('cover-transitioning');
        busy = false;
        if (queued) {
          const pending = queued; queued = null;
          void go(pending.toWorkspace, pending);
        }
      }
    }

    start?.addEventListener('click', () => void go(true));
    demo?.addEventListener('click', () => void go(true, { sample:true }));
    home?.addEventListener('click', () => void go(false));
    window.addEventListener('popstate', () =>
      void go(location.hash === '#workspace', { record:false }));

    const isReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
    if (isReload) {
      if (location.hash) history.replaceState({codekitPage:'welcome'}, '', '#welcome');
      window.addEventListener('pageshow', () => {
        window.requestAnimationFrame(() => window.scrollTo({top:0, left:0, behavior:'instant'}));
      }, {once:true});
    }
    if (!isReload && location.hash === '#workspace') {
      cover.hidden = true; cover.inert = true;
      workspace.hidden = false; workspace.inert = false;
      document.body.classList.remove('cover-view');
      document.body.classList.add('workflow-view');
      inWorkspace = true;
      window.dispatchEvent(new Event('resize'));
    } else {
      cover.hidden = false; cover.inert = false;
      workspace.hidden = true; workspace.inert = true;
    }
    window.CodeKitWelcome = { enter:options => go(true, options), show:() => go(false) };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
