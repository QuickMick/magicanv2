import MainView from "./views/main-view.svelte";
import Connector from "./connector";

Connector.init();


const renderTarget = new MainView({
  target: document.body,
  props: {
    connector: Connector,
    test: "sdfdsf"
  }
});