<script lang="ts">
  import { getAllCategories, getCurrentSpace } from '../lib/state.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import { getFlatpickrLocale } from '../lib/flatpickrLocale.js';
  import { countActiveFilters, defaultListFilters, type ListFilters, type SortField } from '../lib/listFilters.js';
  import type { Expense } from '../types.js';

  // One dropdown holding search, sort and every list filter. Mounted only in
  // list mode, so flatpickr attaches/detaches with the panel's date inputs.
  let { filters = $bindable(), type, items, searchPlaceholder, idPrefix } = $props<{
    filters: ListFilters;
    type: 'expense' | 'income';
    items: Expense[];
    searchPlaceholder: string;
    idPrefix: string;
  }>();

  let open = $state<boolean>(false);
  let dateFromInputEl = $state<HTMLInputElement | null>(null);
  let dateToInputEl = $state<HTMLInputElement | null>(null);
  let fpFrom = $state<any>(null);
  let fpTo = $state<any>(null);

  let availableCategories = $derived(getAllCategories(type));
  let availableContributors = $derived.by(() => {
    const space = getCurrentSpace();
    if (space) return space.members.map(m => m.nickname).filter(Boolean).sort();
    const names = new Set<string>();
    for (const i of items) if (i.familyMember) names.add(i.familyMember);
    return [...names].sort();
  });
  let activeFilterCount = $derived(countActiveFilters(filters));

  $effect(() => {
    if (!dateFromInputEl) return;
    let cancelled = false;
    let instance: any = null;
    import('flatpickr').then(async (mod) => {
      if (cancelled) return;
      instance = mod.default(dateFromInputEl as HTMLElement, {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        locale: await getFlatpickrLocale(mod.default),
        disableMobile: true,
        defaultDate: filters.dateFrom || undefined,
        onChange: (selectedDates: Date[]) => {
          filters.dateFrom = selectedDates[0] ? selectedDates[0].toISOString().split('T')[0] : '';
        }
      });
      fpFrom = instance;
    });
    return () => {
      cancelled = true;
      instance?.destroy();
      fpFrom = null;
    };
  });

  $effect(() => {
    if (!dateToInputEl) return;
    let cancelled = false;
    let instance: any = null;
    import('flatpickr').then(async (mod) => {
      if (cancelled) return;
      instance = mod.default(dateToInputEl as HTMLElement, {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        locale: await getFlatpickrLocale(mod.default),
        disableMobile: true,
        defaultDate: filters.dateTo || undefined,
        onChange: (selectedDates: Date[]) => {
          filters.dateTo = selectedDates[0] ? selectedDates[0].toISOString().split('T')[0] : '';
        }
      });
      fpTo = instance;
    });
    return () => {
      cancelled = true;
      instance?.destroy();
      fpTo = null;
    };
  });

  function toggleSort(field: SortField) {
    if (filters.sortBy === field) {
      filters.sortDir = filters.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      filters.sortBy = field;
      filters.sortDir = 'desc';
    }
  }

  function toggleCategory(cat: string) {
    filters.categories = filters.categories.includes(cat) ? filters.categories.filter((c: string) => c !== cat) : [...filters.categories, cat];
  }

  function toggleContributor(name: string) {
    filters.contributors = filters.contributors.includes(name) ? filters.contributors.filter((c: string) => c !== name) : [...filters.contributors, name];
  }

  function clearFilters() {
    const { search, sortBy, sortDir } = filters;
    filters = { ...defaultListFilters(), search, sortBy, sortDir };
    fpFrom?.clear();
    fpTo?.clear();
  }
</script>

<div class="relative inline-block">
  <button type="button" onclick={() => open = !open}
    class="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-100 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer">
    <i class="ph ph-funnel text-blue-600"></i>
    {t('filter.filters')}
    {#if activeFilterCount > 0}
      <span class="min-w-4 h-4 px-1 flex items-center justify-center rounded-full text-[10px] font-bold bg-blue-600 text-white">{activeFilterCount}</span>
    {/if}
    <i class="ph ph-caret-down text-xs text-slate-400"></i>
  </button>

  {#if open}
    <div role="presentation" class="fixed inset-0 z-40" onclick={() => open = false}></div>
    <div class="absolute left-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-[32rem] overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg z-50 p-4 space-y-4 animate-fade-in">
      <div>
        <label for="{idPrefix}-filter-search" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{searchPlaceholder}</label>
        <div class="relative">
          <i class="ph ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
          <input id="{idPrefix}-filter-search" type="text" placeholder={searchPlaceholder}
            bind:value={filters.search}
            class="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div>
        <p class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('list.sortDate')} / {t('list.sortAmount')}</p>
        <div class="flex gap-1">
          {#each [{k:'date' as const,l:t('list.sortDate')},{k:'amount' as const,l:t('list.sortAmount')}] as opt}
            <button onclick={() => toggleSort(opt.k)}
              class="px-3 py-1.5 text-xs rounded-lg font-medium transition-colors {filters.sortBy === opt.k ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}">
              {opt.l}
              {#if filters.sortBy === opt.k}
                <i class="ph ph-caret-{filters.sortDir === 'asc' ? 'up' : 'down'} ml-1"></i>
              {/if}
            </button>
          {/each}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="{idPrefix}-filter-date-from" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('filter.dateFrom')}</label>
          <input id="{idPrefix}-filter-date-from" bind:this={dateFromInputEl} type="text" bind:value={filters.dateFrom} placeholder={t('filter.dateFrom')}
            class="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label for="{idPrefix}-filter-date-to" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('filter.dateTo')}</label>
          <input id="{idPrefix}-filter-date-to" bind:this={dateToInputEl} type="text" bind:value={filters.dateTo} placeholder={t('filter.dateTo')}
            class="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="{idPrefix}-filter-amount-min" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('filter.amountMin')}</label>
          <input id="{idPrefix}-filter-amount-min" type="number" step="0.01" bind:value={filters.amountMin} placeholder="0.00"
            class="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label for="{idPrefix}-filter-amount-max" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('filter.amountMax')}</label>
          <input id="{idPrefix}-filter-amount-max" type="number" step="0.01" bind:value={filters.amountMax} placeholder="0.00"
            class="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div>
        <p class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('filter.category')}</p>
        {#if availableCategories.length === 0}
          <p class="text-xs text-slate-400 dark:text-slate-500">{t('filter.allCategories')}</p>
        {:else}
          <div class="max-h-32 overflow-y-auto border border-slate-200 dark:border-slate-600 rounded-lg">
            {#each availableCategories as cat (cat)}
              <label class="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={filters.categories.includes(cat)} onchange={() => toggleCategory(cat)} class="rounded text-blue-600 focus:ring-blue-500" />
                <span class="truncate">{cat}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>

      {#if availableContributors.length > 0}
        <div>
          <p class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('filter.contributor')}</p>
          <div class="max-h-32 overflow-y-auto border border-slate-200 dark:border-slate-600 rounded-lg">
            {#each availableContributors as name (name)}
              <label class="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={filters.contributors.includes(name)} onchange={() => toggleContributor(name)} class="rounded text-blue-600 focus:ring-blue-500" />
                <span class="truncate">{name}</span>
              </label>
            {/each}
          </div>
        </div>
      {/if}

      <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
        <input type="checkbox" bind:checked={filters.recurringOnly} class="rounded text-blue-600 focus:ring-blue-500" />
        {t('filter.recurringOnly')}
      </label>

      {#if activeFilterCount > 0}
        <button onclick={clearFilters} class="text-xs font-medium text-blue-600 hover:underline cursor-pointer">
          {t('filter.clear')}
        </button>
      {/if}
    </div>
  {/if}
</div>
