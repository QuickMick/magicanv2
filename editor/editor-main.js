import MainView from "./editor.svelte";


const renderTarget = new MainView({
  target: document.body,
  props: {
    test: "sdfdsf"
  }
});