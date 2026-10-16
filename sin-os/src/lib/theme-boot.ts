/** Chaves da aparência e do visual escolhidos, e o script do <head> que os aplica antes da pintura (evita piscar o tema errado). */
export const APPEARANCE_KEY = "sinos-appearance";
export const UI_KEY = "sinos-ui";
export const THEME_BOOT = `try{var d=document.documentElement,a=localStorage.getItem("${APPEARANCE_KEY}");if(a==="light"||a==="dark")d.dataset.theme=a;if(localStorage.getItem("${UI_KEY}")==="terminal")d.dataset.ui="terminal"}catch(e){}`;
