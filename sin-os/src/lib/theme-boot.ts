/** Chave da aparência escolhida e script do <head> que a aplica antes da pintura (evita piscar o tema errado). */
export const APPEARANCE_KEY = "sinos-appearance";
export const THEME_BOOT = `try{var a=localStorage.getItem("${APPEARANCE_KEY}");if(a==="light"||a==="dark")document.documentElement.dataset.theme=a}catch(e){}`;
