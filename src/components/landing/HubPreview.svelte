<script lang="ts">
  import { formatMoney } from '../../lib/currency.js';
  import { t } from '../../lib/i18n.svelte.js';

  // Illustrative data for the landing page's shared-Hub spotlight.
  const members = [
    { name: 'Sam', initial: 'S', amount: 1120.4, share: 58, color: 'bg-blue-600' },
    { name: 'Alex', initial: 'A', amount: 812.1, share: 42, color: 'bg-slate-400 dark:bg-slate-500' },
  ];
</script>

<div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6 shadow-xl shadow-slate-900/5" aria-hidden="true">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <i class="ph ph-house-line text-blue-600"></i>
      <p class="text-sm font-medium">{t('landing.hubPreview.name')}</p>
    </div>
    <div class="flex -space-x-2">
      {#each members as m (m.name)}
        <span class="grid place-items-center w-7 h-7 rounded-full ring-2 ring-white dark:ring-slate-950 text-[11px] font-semibold text-white {m.color}">{m.initial}</span>
      {/each}
    </div>
  </div>

  <p class="mt-6 text-xs text-slate-400">{t('landing.hubPreview.byMember')}</p>
  <div class="mt-3 space-y-4">
    {#each members as m (m.name)}
      <div>
        <div class="flex items-center justify-between text-sm">
          <span>{m.name}</span>
          <span class="tabular-nums font-medium">{formatMoney(m.amount, 'USD')}</span>
        </div>
        <div class="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div class="h-full rounded-full {m.color}" style="width: {m.share}%"></div>
        </div>
      </div>
    {/each}
  </div>

  <div class="mt-6 flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-900 px-3 py-2.5">
    <span class="grid place-items-center w-8 h-8 rounded-full bg-white dark:bg-slate-950 text-slate-500"><i class="ph ph-lightning"></i></span>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium truncate">{t('landing.hubPreview.entry')}</p>
      <p class="text-xs text-slate-400 truncate">{t('landing.hubPreview.entryMeta')}</p>
    </div>
    <span class="text-sm tabular-nums">−{formatMoney(64.3, 'USD')}</span>
  </div>
</div>
