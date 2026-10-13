<script lang="ts">
  import { formatMoney } from '../../lib/currency.js';
  import { t } from '../../lib/i18n.svelte.js';

  const stats = $derived([
    { label: t('landing.preview.income'), value: formatMoney(1050, 'USD'), cls: 'text-emerald-600' },
    { label: t('landing.preview.expenses'), value: formatMoney(486.2, 'USD'), cls: 'text-rose-600' },
    { label: t('landing.summaryPreview.net'), value: formatMoney(563.8, 'USD'), cls: '' },
  ]);
  const categories = $derived([t('landing.preview.groceries'), t('landing.summaryPreview.dining'), t('landing.summaryPreview.transport')]);
</script>

<!-- Illustrative weekly recap for the landing page's summaries spotlight. -->
<div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6 shadow-xl shadow-slate-900/5" aria-hidden="true">
  <div class="flex items-center justify-between">
    <p class="text-sm font-medium">{t('landing.summaryPreview.week')}</p>
    <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <i class="ph ph-trend-down"></i>{t('landing.summaryPreview.change')}
    </span>
  </div>

  <p class="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('landing.summaryPreview.narrative')}</p>

  <div class="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 dark:border-slate-800 pt-5">
    {#each stats as s (s.label)}
      <div>
        <p class="text-xs text-slate-400">{s.label}</p>
        <p class="mt-1 font-semibold tabular-nums {s.cls}">{s.value}</p>
      </div>
    {/each}
  </div>

  <div class="mt-5 flex flex-wrap gap-2">
    {#each categories as c (c)}
      <span class="rounded-full border border-slate-200 dark:border-slate-800 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400">{c}</span>
    {/each}
  </div>
</div>
