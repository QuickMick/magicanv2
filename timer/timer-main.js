import MainView from "./timer.svelte";
Number.prototype.pad = function(size) {
  var s = String(this);
  while (s.length < (size || 2)) { s = "0" + s; }
  return s;
}

const renderTarget = new MainView({
  target: document.body,
  props: {
    test: "sdfdsf"
  }
});