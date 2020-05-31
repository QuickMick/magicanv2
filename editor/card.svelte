<div
  class="entry"
  style={'width:' + width + 'px; height:' + (card.count <= 4 ? height + ((card.count || 1) - 1) * 40 : height + 3 * 40) + 'px;'}>

  {#each { length: card.count > 4 ? 4 : card.count } as _, i}
    <img
      class:banned={card.data.legalities[format.value] !== 'legal'}
      on:dblclick={() => remove(card)}
      class="card"
      style={'margin-top: ' + i * 40 + 'px'}
      src={card.url}
      alt={card.name}
      {width}
      {height} />
  {/each}

  {#if card.data.legalities[format.value] !== 'legal'}
    <div class="banned-text">BANNED</div>
  {/if}
  {#if card.count > 4}
    <div class="count">{card.count}x</div>
  {/if}

  {#if scaling > 90}
    <div class="price">{card.data.prices.usd + '$' || '???'}</div>
  {/if}

</div>
