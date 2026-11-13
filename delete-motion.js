/* Delete-button interaction adapted from Uiverse.io by vinodjangid07. */
(() => {
  const selector='[data-delete-action],.btn-row-del,.tag-item > button,#btnDeleteSelected,#btnDeleteFiltered,#btnDeleteAllRows,#btnConfirmBulkDelete,#btnDiscardSession,#btnClearLinkedFilters';
  const icon='<svg class="delete-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2ZM6 9h12l-1 12H7L6 9Z"/></svg>';
  function setLabel(button,label) {
    if(!button)return;
    button.classList.add('delete-motion');
    button.setAttribute('data-delete-label',label);button.setAttribute('aria-label',label);button.setAttribute('title',label);
    if(button.querySelector('.delete-label'))button.querySelector('.delete-label').textContent=label;
    else {button.innerHTML=icon;const text=document.createElement('span');text.className='delete-label';text.textContent=label;button.appendChild(text);}
  }
  function decorate(root=document) {
    const buttons=[...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)];
    buttons.forEach(button=>{if(!button.classList.contains('delete-motion'))setLabel(button,button.getAttribute('aria-label')||button.getAttribute('title')||button.textContent.trim());});
  }
  window.DeleteMotion={decorate,setLabel};
  function init() {
    decorate();
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)decorate(node);}))).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
