<script>
  export let card = {};

  const CARD_RATIO = 0.71764705882;
  let _height = 250;
  let _width = Math.floor(_height * CARD_RATIO);
  let height = _height;
  let width = _width;
</script>

<style>
  .entry {
    position: relative;
    padding: 10px;
    flex-shrink: 0;
  }

  .card {
    position: absolute;
    border: 6px solid rgb(22, 22, 22);
    border-radius: 10px;
    outline: 0;
    box-shadow: 0px 0px 10px black;
  }
</style>

<div class="entry" style={'width:' + width + 'px; height:' + height + 'px;'}>

  <img
    class="card"
    style={'margin-top: 0px'}
    src={card.url}
    alt={card.name}
    {width}
    {height} />

</div>
