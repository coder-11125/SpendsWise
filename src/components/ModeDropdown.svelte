<script lang="ts">
  let { mode, overviewLabel, listLabel, ariaLabel, onselect } = $props<{
    mode: 'overview' | 'list';
    overviewLabel: string;
    listLabel: string;
    ariaLabel: string;
    onselect: (m: 'overview' | 'list') => void;
  }>();

  let open = $state<boolean>(false);

  function select(m: 'overview' | 'list') {
    open = false;
    onselect(m);
  }
</script>

<div class="relative inline-block">
  <button type="button" onclick={() => open = !open}
    aria-label={ariaLabel}
    class="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-100 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer">
    <i class="ph {mode === 'list' ? 'ph-list-bullets' : 'ph-squares-four'} text-blue-600"></i>
    {mode === 'list' ? listLabel : overviewLabel}
    <i class="ph ph-caret-down text-xs text-slate-400"></i>
  </button>

  {#if open}
    <div role="presentation" class="fixed inset-0 z-40" onclick={() => open = false}></div>
    <div class="absolute left-0 mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg z-50 py-1 animate-fade-in">
      <button onclick={() => select('overview')}
        class="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors {mode === 'overview' ? 'text-blue-600 font-medium' : 'text-slate-700 dark:text-slate-200'}">
        <i class="ph ph-squares-four"></i>
        {overviewLabel}
        {#if mode === 'overview'}<i class="ph ph-check ml-auto text-blue-600"></i>{/if}
      </button>
      <button onclick={() => select('list')}
        class="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors {mode === 'list' ? 'text-blue-600 font-medium' : 'text-slate-700 dark:text-slate-200'}">
        <i class="ph ph-list-bullets"></i>
        {listLabel}
        {#if mode === 'list'}<i class="ph ph-check ml-auto text-blue-600"></i>{/if}
      </button>
    </div>
  {/if}
</div>
