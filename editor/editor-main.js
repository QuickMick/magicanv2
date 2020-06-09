const __dirname = "./";
window.__dirname = "./";
import MainView from "./editor.svelte";


window.onload = function() {
  const renderTarget = new MainView({
    target: document.body,
    props: {
      test: "sdfdsf"
    }
  });
};